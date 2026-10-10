import { expect, it } from 'vitest'

import { createClient } from '@gaussian-id/meridian'
import { createBrowserClient } from '@gaussian-id/meridian/browser'
import { createForwardHandler } from '@gaussian-id/meridian/server'

import { HIDDEN_FORWARD_CODES } from '../src/internal/errors'

import { describeEngine, describeFake, testEngine } from './support/engine'
import { chunk, engineError, envelope, frame } from './support/fake-engine'

const allowAll = () => true

function setup(options: Partial<Parameters<typeof createForwardHandler>[0]> = {}) {
  const engine = testEngine()
  const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })
  const handler = createForwardHandler({ client, authorize: allowAll, ...options })

  return { engine, handler }
}

const post = (body: unknown) =>
  new Request('http://app.test/api/meridian/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

describeEngine('createForwardHandler', () => {
  it('throws at creation without authorize (the one deliberate throw)', () => {
    const engine = testEngine()
    const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    expect(() => createForwardHandler({ client } as never)).toThrow(TypeError)
  })

  it('streams the engine events back for a streamed request', async () => {
    const { engine, handler } = setup({ allow: { model: true } })

    const response = await handler(
      post({ model: engine.model, stream: true, messages: [{ role: 'user', content: 'hi' }] })
    )

    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('returns the completion as JSON for a buffered request', async () => {
    const { engine, handler } = setup({ allow: { model: ['gemini-3.8-flash'] } })

    const response = await handler(post({ model: engine.model, messages: [{ role: 'user', content: 'hi' }] }))
    const json = (await response.json()) as { choices: unknown[] }

    expect(response.status).toBe(200)
    expect(json.choices.length).toBeGreaterThan(0)
  })

  it('answers 403 permission_denied when authorize says no, and passes through a Response it returns', async () => {
    const denied = setup({ authorize: () => false })
    const custom = setup({ authorize: () => new Response('login first', { status: 401 }) })

    const a = await denied.handler(post({ messages: [{ role: 'user', content: 'hi' }] }))
    const b = await custom.handler(post({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(a.status).toBe(403)
    expect(((await a.json()) as { error: { code: string } }).error.code).toBe('permission_denied')
    expect(b.status).toBe(401)
    expect(await b.text()).toBe('login first')
  })

  it('answers 405 to anything but POST', async () => {
    const { handler } = setup()

    const response = await handler(new Request('http://app.test/api/meridian/chat'))

    expect(response.status).toBe(405)
  })
})

describeFake('forwarding allowlist', () => {
  it('asks for stream usage itself and ignores a browser stream_options', async () => {
    const { engine, handler } = setup()

    const response = await handler(
      post({ stream: true, stream_options: { include_usage: false }, messages: [{ role: 'user', content: 'hi' }] })
    )

    await response.text()
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent.stream).toBe(true)
    expect(sent.stream_options).toEqual({ include_usage: true })
  })

  it('passes extra options only by name, never model, stream or messages', async () => {
    const { engine, handler } = setup({ allow: { options: ['top_p', 'model', 'stream'] } })

    await handler(
      post({ top_p: 0.5, model: 'x', stream: false, tools: [], messages: [{ role: 'user', content: 'hi' }] })
    )
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent.top_p).toBe(0.5)
    expect(sent).not.toHaveProperty('model')
    expect(sent).not.toHaveProperty('tools')
  })

  it('honours a custom maxTokensCap', async () => {
    const { engine, handler } = setup({ allow: { maxTokensCap: 100 } })

    await handler(post({ max_tokens: 5000, messages: [{ role: 'user', content: 'hi' }] }))
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent.max_tokens).toBe(100)
  })
  it('drops model, stream_options, tools and unknown fields, and clamps max_tokens', async () => {
    const { engine, handler } = setup()

    await handler(
      post({
        model: 'expensive-model',
        stream: false,
        stream_options: { include_usage: false },
        tools: [{ type: 'function' }],
        evil: true,
        temperature: 0.2,
        max_tokens: 1_000_000,
        messages: [{ role: 'user', content: 'hi' }]
      })
    )
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
      stream: false
    })
  })

  it('passes a model only when allowed, and only a listed one', async () => {
    const { engine, handler } = setup({ allow: { model: ['gemini-3.8-flash'] } })

    await handler(post({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'a' }] }))
    const first = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    await handler(post({ model: 'other', messages: [{ role: 'user', content: 'b' }] }))
    const second = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(first.model).toBe('gemini-3.8-flash')
    expect(second).not.toHaveProperty('model')
  })

  it('answers 400 invalid_request for a body that is not JSON or has no message list', async () => {
    const { engine, handler } = setup()

    const notJson = await handler(post('not json'))
    const noList = await handler(post({ messages: 'hi' }))
    const empty = await handler(post({ messages: [] }))

    for (const response of [notJson, noList, empty]) {
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_request')
    }

    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('maps an engine refusal to the same envelope and status', async () => {
    const { engine, handler } = setup({ allow: { model: true } })

    const response = await handler(post({ model: 'sim-fail', messages: [{ role: 'user', content: 'x' }] }))
    const json = (await response.json()) as { error: { code: string; request_id: string } }

    expect(response.status).toBe(502)
    expect(json.error.code).toBe('upstream_unavailable')
    expect(json.error.request_id).toEqual(expect.any(String))
    expect(engine.fake!.requests).toHaveLength(1)
  })
})

describeFake('forwarding handler hardening', () => {
  const hi = [{ role: 'user', content: 'hi' }]

  const sentTo = async (engine: ReturnType<typeof setup>['engine']) =>
    (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

  it.each([
    [
      'a throwing authorize',
      () => {
        throw new Error('boom')
      }
    ],
    ['a rejecting authorize', () => Promise.reject(new Error('boom'))],
    ['a truthy non-true verdict', () => 'yes']
  ])('answers 403 permission_denied for %s and never reaches the engine', async (_name, authorize) => {
    const { engine, handler } = setup({ authorize: authorize as never })

    const response = await handler(post({ messages: hi }))

    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('permission_denied')
    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('keeps the token cap even when options lists max_tokens or temperature', async () => {
    const { engine, handler } = setup({ allow: { options: ['max_tokens', 'temperature'] } })

    await handler(post({ max_tokens: 1_000_000, temperature: 'hot', messages: hi }))
    const sent = await sentTo(engine)

    expect(sent.max_tokens).toBe(4096)
    expect(sent).not.toHaveProperty('temperature')
  })

  it('refuses a body that is not declared application/json with 415', async () => {
    const { engine, handler } = setup()

    const plain = new Request('http://app.test/api/meridian/chat', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ messages: hi })
    })

    const charset = new Request('http://app.test/api/meridian/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ messages: hi })
    })

    const refused = await handler(plain)
    const accepted = await handler(charset)

    expect(refused.status).toBe(415)
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('invalid_request')
    expect(accepted.status).toBe(200)
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it('never copies inherited keys named in options', async () => {
    const { engine, handler } = setup({ allow: { options: ['constructor', 'toString', '__proto__'] } })

    await handler(post('{"messages":[{"role":"user","content":"hi"}],"__proto__":{"x":1}}'))
    const sent = await sentTo(engine)

    expect(Object.keys(sent).sort()).toEqual(['max_tokens', 'messages', 'stream'])
  })

  it('falls back to 4096 for an invalid maxTokensCap', async () => {
    for (const bad of [0, -5, 1.5, Number.NaN, '10' as never]) {
      const { engine, handler } = setup({ allow: { maxTokensCap: bad } })

      await handler(post({ max_tokens: 1_000_000, messages: hi }))

      expect((await sentTo(engine)).max_tokens).toBe(4096)
    }
  })

  it('normalises negative, fractional and string max_tokens', async () => {
    const { engine, handler } = setup()

    const run = async (max_tokens: unknown) => {
      await handler(post({ max_tokens, messages: hi }))

      return (await sentTo(engine)).max_tokens
    }

    expect(await run(-7)).toBe(1)
    expect(await run(2.7)).toBe(2)
    expect(await run('50')).toBe(4096)
  })

  it('sends Allow: POST with the 405', async () => {
    const { handler } = setup()

    const response = await handler(new Request('http://app.test/api/meridian/chat'))

    expect(response.headers.get('allow')).toBe('POST')
  })
})

describeFake('forwarding the idempotency key', () => {
  const withKey = (key: string | null) =>
    new Request('http://app.test/api/meridian/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }) },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
    })

  it('sends the browser key to the engine, the same on every retry of the browser', async () => {
    const { engine, handler } = setup()

    await handler(withKey('k-123'))
    await handler(withKey('k-123'))
    const [a, b] = engine.fake!.requests.slice(-2)

    expect(a!.headers.get('idempotency-key')).toBe('k-123')
    expect(b!.headers.get('idempotency-key')).toBe('k-123')
  })

  it('also forwards it for a streamed request', async () => {
    const { engine, handler } = setup()

    const response = await handler(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k-stream' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] })
      })
    )

    await response.text()
    expect(engine.fake!.requests.at(-1)!.headers.get('idempotency-key')).toBe('k-stream')
  })

  it.each([
    ['empty', ''],
    ['too long', 'k'.repeat(300)],
    ['not printable ASCII', 'k\u00e9y']
  ])('replaces an invalid key (%s) with a generated one', async (_name, key) => {
    const { engine, handler } = setup()

    await handler(withKey(key))
    const sent = engine.fake!.requests.at(-1)!.headers.get('idempotency-key')

    expect(sent).toBeTruthy()
    expect(sent).not.toBe(key)
    expect(sent!.length).toBeLessThanOrEqual(255)
  })

  it('generates a key when the browser sent none', async () => {
    const { engine, handler } = setup()

    await handler(withKey(null))

    expect(engine.fake!.requests.at(-1)!.headers.get('idempotency-key')).toBeTruthy()
  })
})

describeFake('lazy client', () => {
  it('calls the factory per request and not at creation', async () => {
    const engine = testEngine()
    let calls = 0

    const handler = createForwardHandler({
      client: () => {
        calls++

        return createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })
      },
      authorize: allowAll
    })

    expect(calls).toBe(0)
    await handler(post({ messages: [{ role: 'user', content: 'hi' }] }))
    await handler(post({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(calls).toBe(2)
  })

  it('answers the generic 503, not a throw, when the key is missing', async () => {
    const handler = createForwardHandler({ client: () => createClient('http://engine.test', ''), authorize: allowAll })

    const response = await handler(post({ messages: [{ role: 'user', content: 'hi' }] }))
    const json = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(503)
    expect(json.error.code).toBe('service_unavailable')
  })

  it('answers an error response when the factory itself throws', async () => {
    const handler = createForwardHandler({
      client: () => {
        throw new Error('env missing')
      },
      authorize: allowAll
    })

    const response = await handler(post({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(response.status).toBe(503)
  })
})

describeFake("forwarding hides the app's own key and billing refusals", () => {
  const ask = { messages: [{ role: 'user', content: 'hi' }] }

  it.each(HIDDEN_FORWARD_CODES)('answers a generic 503 for %s and keeps the request id', async code => {
    const { engine, handler } = setup()

    engine.fake!.next({
      status: 402,
      headers: { 'x-request-id': 'req_hidden_1', 'retry-after': '7' },
      json: envelope(code, 'req_hidden_1')
    })

    const response = await handler(post(ask))
    const text = await response.text()
    const json = JSON.parse(text) as { error: Record<string, string | boolean> }

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(json.error).toEqual({
      message: 'The service is temporarily unavailable.',
      type: 'api_error',
      code: 'service_unavailable',
      retryable: false,
      request_id: 'req_hidden_1'
    })
    expect(text).not.toContain(code)
  })

  it('lists exactly the ten codes of the spec', () => {
    expect([...HIDDEN_FORWARD_CODES].sort()).toEqual(
      [
        'byok_required',
        'entitlement_missing',
        'hard_limit_reached',
        'insufficient_credit',
        'invalid_api_key',
        'key_expired',
        'key_revoked',
        'organisation_unavailable',
        'project_host_mismatch',
        'project_unavailable'
      ].sort()
    )
  })

  it('hides the code on a refusal that arrives before a stream starts', async () => {
    const { engine, handler } = setup()

    engine.fake!.next({
      status: 401,
      headers: { 'retry-after': '9' },
      json: envelope('invalid_api_key', 'req_pre')
    })

    const response = await handler(post({ ...ask, stream: true }))
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(text).not.toContain('invalid_api_key')
    expect((JSON.parse(text) as { error: { request_id: string } }).error.request_id).toBe('req_pre')
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('service_unavailable')
  })

  it.each(['rate_limited', 'model_not_allowed'])('passes %s through unchanged', async code => {
    const { engine, handler } = setup()

    engine.fake!.next(engineError(code))

    const response = await handler(post(ask))
    const json = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(code === 'rate_limited' ? 429 : 403)
    expect(json.error.code).toBe(code)
  })

  it('leaves the server-side client with the real error', async () => {
    const engine = testEngine()
    const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })

    engine.fake!.next(engineError('insufficient_credit'))

    const { error } = await client.chat.create(ask as never)

    expect(error?.code).toBe('insufficient_credit')
  })

  it('rewrites a mid-stream error frame, keeping the earlier text byte for byte', async () => {
    const { engine, handler } = setup()

    engine.fake!.next({
      headers: { 'x-request-id': 'req_mid' },
      chunks: [frame(chunk('Halo \u{1F600}')), frame(envelope('insufficient_credit', 'req_mid'))]
    })

    const response = await handler(post({ ...ask, stream: true }))
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain(frame(chunk('Halo \u{1F600}')))
    expect(text).not.toContain('insufficient_credit')
    expect(text).toContain('"code":"service_unavailable"')
    expect(text).toContain('"request_id":"req_mid"')
  })

  it('rewrites an error frame cut into pieces at any byte', async () => {
    const { engine, handler } = setup()
    const bytes = new TextEncoder().encode(frame(chunk('ok \u{1F600}')) + frame(envelope('key_revoked', 'req_cut')))

    engine.fake!.next({ chunks: Array.from(bytes, byte => new Uint8Array([byte])) })

    const text = await (await handler(post({ ...ask, stream: true }))).text()

    expect(text).toContain(frame(chunk('ok \u{1F600}')))
    expect(text).not.toContain('key_revoked')
    expect(text).toContain('service_unavailable')
  })

  it('passes a mid-stream pass-through error frame unchanged', async () => {
    const { engine, handler } = setup()
    const error = frame(envelope('upstream_unavailable', 'req_up'))

    engine.fake!.next({ chunks: [frame(chunk('a')), error] })

    const text = await (await handler(post({ ...ask, stream: true }))).text()

    expect(text).toBe(frame(chunk('a')) + error)
  })

  it('still rewrites a hidden error frame that is larger than 64 KiB and arrives in small pieces', async () => {
    const { engine, handler } = setup()
    const big = { error: { ...envelope('hard_limit_reached', 'req_big').error, message: 'x'.repeat(200_000) } }
    const bytes = new TextEncoder().encode(frame(chunk('a')) + frame(big))
    const pieces: Uint8Array[] = []

    for (let at = 0; at < bytes.length; at += 512) pieces.push(bytes.slice(at, at + 512))

    engine.fake!.next({ chunks: pieces })

    const text = await (await handler(post({ ...ask, stream: true }))).text()

    expect(text).toContain(frame(chunk('a')))
    expect(text).not.toContain('hard_limit_reached')
    expect(text.length).toBeLessThan(1000)
  })

  it('passes a large non-error event through untouched', async () => {
    const { engine, handler } = setup()
    const big = frame(chunk('y'.repeat(200_000)))

    engine.fake!.next({ chunks: [big, frame('[DONE]')] })

    expect(await (await handler(post({ ...ask, stream: true }))).text()).toBe(big + frame('[DONE]'))
  })
})

describeEngine('createForwardHandler setup errors', () => {
  const messages = [{ role: 'user', content: 'hi' }]

  const expectGeneric503 = async (response: Response) => {
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(text)).toEqual({
      error: {
        message: 'The service is temporarily unavailable.',
        type: 'api_error',
        code: 'service_unavailable',
        retryable: false
      }
    })
    expect(text).not.toMatch(/key|MERIDIAN|NUXT_|url/i)
  }

  it('answers the generic 503 when the server client has no key, buffered and streamed', async () => {
    const client = createClient('http://engine.test', '')
    const handler = createForwardHandler({ client, authorize: allowAll })

    await expectGeneric503(await handler(post({ messages })))
    await expectGeneric503(await handler(post({ messages, stream: true })))
  })

  it('answers the generic 503 when the server client has no url', async () => {
    const handler = createForwardHandler({ client: createClient('', 'gmr_x'), authorize: allowAll })

    await expectGeneric503(await handler(post({ messages })))
  })

  it('answers the generic 503 when the client factory throws', async () => {
    const handler = createForwardHandler({
      client: () => {
        throw new Error('MERIDIAN_KEY is not set')
      },
      authorize: allowAll
    })

    await expectGeneric503(await handler(post({ messages })))
  })

  it('still returns the real config error from the server client itself', async () => {
    const { error } = await createClient('http://engine.test', '').chat.create({ messages: [] })

    expect(error?.type).toBe('client_error')
    expect(error?.message).toMatch(/key/i)
  })
})

// Scripts a refusal the real engine cannot be told to produce, so it is fake-only
describeFake('createForwardHandler hidden codes in the browser client', () => {
  it('marks the forwarded hidden-code and generic errors as not retryable in the browser client', async () => {
    const { engine, handler } = setup()

    engine.fake!.next(engineError('insufficient_credit'))

    const browser = createBrowserClient({
      route: 'http://app.test/api/meridian/chat',
      maxRetries: 0,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch
    })

    const { error } = await browser.chat.create({ messages: [{ role: 'user', content: 'hi' }] })

    expect(error?.code).toBe('service_unavailable')
    expect(error?.retryable).toBe(false)
  })
})

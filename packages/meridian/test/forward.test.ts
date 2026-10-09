import { describe, expect, it } from 'vitest'

import { createClient } from 'meridian'
import { createForwardHandler } from 'meridian/server'

import { describeFake, testEngine } from './support/engine'

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

describe('createForwardHandler', () => {
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

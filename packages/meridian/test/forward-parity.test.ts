// Forwarding route parity with meridian-go and meridian-python (cross-lane rulings, 10 Oct): the body cap and
// strictness, the fail-closed error and stream guard, the shared idempotency-key rule, request ids fit for a header,
// and the Retry-After relay.

import { expect, it } from 'vitest'

import { createClient } from 'meridian'
import { createForwardHandler, type ForwardHandlerOptions } from 'meridian/server'

import { describeFake, testEngine } from './support/engine'
import { chunk, envelope, frame } from './support/fake-engine'

const hi = [{ role: 'user', content: 'hi' }]
const MIB = 1024 * 1024
const encoder = new TextEncoder()

const GENERIC = {
  message: 'The service is temporarily unavailable.',
  type: 'api_error',
  code: 'service_unavailable',
  retryable: false
}

function setup(options: Partial<ForwardHandlerOptions> = {}) {
  const engine = testEngine()
  const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })
  const handler = createForwardHandler({ client, authorize: () => true, ...options })

  return { engine, handler }
}

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://app.test/api/meridian/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {})
  } as RequestInit)

const ask = (extra: Record<string, unknown> = {}) => post(JSON.stringify({ messages: hi, ...extra }))
const errorOf = async (response: Response) => ((await response.json()) as { error: Record<string, unknown> }).error

/** An engine answering one stream, which records whether the route closed it. */
function streamedHandler(
  pieces: (string | Uint8Array)[],
  options: { hang?: boolean; broken?: boolean; id?: string } = {}
) {
  const state = { closed: false }

  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => (state.closed = true))

    let pulls = 0

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // The first pull gives every piece; the next one breaks, ends or waits
        if (pulls++ === 0) {
          for (const piece of pieces) controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece)
        } else if (options.broken) controller.error(new TypeError('terminated'))
        else if (!options.hang) controller.close()
        else return new Promise<void>(() => {})
      },
      cancel() {
        state.closed = true
      }
    })

    const headers = { 'content-type': 'text/event-stream', ...(options.id ? { 'x-request-id': options.id } : {}) }

    return new Response(body, { status: 200, headers })
  }) as typeof globalThis.fetch

  const client = createClient('http://engine.test', 'gmr_x', { fetch, maxRetries: 0 })
  const handler = createForwardHandler({ client, authorize: () => true })

  return { state, handler }
}

function streamed(pieces: (string | Uint8Array)[], options: { hang?: boolean; broken?: boolean; id?: string } = {}) {
  const { state, handler } = streamedHandler(pieces, options)

  // Decoded keeping a byte order mark, which Response.text() would drop
  const relay = async () =>
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(await (await handler(ask({ stream: true }))).arrayBuffer())

  return { state, relay }
}

const genericFrame = (requestId?: string) =>
  `data: ${JSON.stringify({ error: { ...GENERIC, ...(requestId ? { request_id: requestId } : {}) } })}\n\n`

describeFake('forwarding parity: the body', () => {
  it('refuses a body over 8 MiB with 413 body_too_large, after authorize, without reaching the engine', async () => {
    const seen: string[] = []
    const { engine, handler } = setup({ authorize: () => (seen.push('authorize'), true) })
    const over = `{"messages":[{"role":"user","content":"${'x'.repeat(8 * MIB)}"}]}`

    const response = await handler(post(over))

    expect(response.status).toBe(413)
    expect((await errorOf(response)).code).toBe('body_too_large')
    expect(seen).toEqual(['authorize'])
    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('accepts a body of exactly 8 MiB', async () => {
    const { handler } = setup()
    const head = '{"messages":[{"role":"user","content":"'
    const tail = '"}]}'
    const exact = head + 'x'.repeat(8 * MIB - head.length - tail.length) + tail

    expect(encoder.encode(exact).length).toBe(8 * MIB)
    expect((await handler(post(exact))).status).toBe(200)
  })

  it('reads the body incrementally: it stops past the cap and cancels the rest', async () => {
    const { handler } = setup()
    let pulled = 0
    let cancelled = false
    const piece = new Uint8Array(64 * 1024).fill(0x20)

    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += piece.length
        controller.enqueue(piece)
      },
      cancel() {
        cancelled = true
      }
    })

    const response = await handler(post(endless))

    expect(response.status).toBe(413)
    expect(pulled).toBeLessThanOrEqual(8 * MIB + 4 * piece.length)
    expect(cancelled).toBe(true)
  })

  it('refuses before reading when authorize says no', async () => {
    const { handler } = setup({ authorize: () => false })

    expect((await handler(post(`{"messages":"${'x'.repeat(9 * MIB)}"}`))).status).toBe(403)
  })

  it.each([
    ['a byte order mark', new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(JSON.stringify({ messages: hi }))])],
    [
      'invalid UTF-8',
      new Uint8Array([...encoder.encode('{"messages":[{"role":"user","content":"'), 0xff, 0x22, 0x7d, 0x5d, 0x7d])
    ],
    [
      'UTF-16',
      new Uint8Array([0xff, 0xfe, ...Array.from(JSON.stringify({ messages: hi }), c => [c.charCodeAt(0), 0]).flat()])
    ]
  ])('refuses %s with 400 invalid_request', async (_name, bytes) => {
    const { engine, handler } = setup()
    const response = await handler(post(bytes))

    expect(response.status).toBe(400)
    expect((await errorOf(response)).code).toBe('invalid_request')
    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('takes 64 levels of nesting and refuses 65 (the body is level 1; brackets in strings do not count)', async () => {
    const { engine, handler } = setup()
    const nested = (levels: number) => '['.repeat(levels) + ']'.repeat(levels)
    const body = (levels: number) => `{"messages":[{"role":"user","content":"[[[{{{"}],"deep":${nested(levels)}}`

    expect((await handler(post(body(63)))).status).toBe(200)
    const refused = await handler(post(body(64)))

    expect(refused.status).toBe(400)
    expect((await errorOf(refused)).code).toBe('invalid_request')
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it('never copies max_completion_tokens or n raw, whatever options says', async () => {
    const { engine, handler } = setup({ allow: { options: ['max_completion_tokens', 'n', 'top_p'] } })

    await handler(ask({ max_completion_tokens: 1_000_000, n: 8, top_p: 0.5 }))
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent).not.toHaveProperty('max_completion_tokens')
    expect(sent).not.toHaveProperty('n')
    expect(sent.top_p).toBe(0.5)
  })

  it('refuses a number JSON cannot hold (1e999) with 400, never forwarding it as null', async () => {
    const { engine, handler } = setup({ allow: { options: ['top_p'] } })
    const response = await handler(post(`{"messages":${JSON.stringify(hi)},"top_p":1e999}`))

    expect(response.status).toBe(400)
    expect((await errorOf(response)).code).toBe('invalid_request')
    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('reads a bare string in options as one name, not its letters', async () => {
    const { engine, handler } = setup({ allow: { options: 'top_p' as unknown as string[] } })

    await handler(ask({ top_p: 0.5, t: 1, o: 2, p: 3 }))
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent.top_p).toBe(0.5)
    expect(sent).not.toHaveProperty('t')
    expect(sent).not.toHaveProperty('o')
    expect(sent).not.toHaveProperty('p')
  })
})

describeFake('forwarding parity: the idempotency key', () => {
  it.each([
    ['k-123', true],
    ['!'.repeat(255), true],
    ['~', true],
    ['k 123', false],
    ['k\t1', false],
    ['x'.repeat(256), false],
    ['ké', false]
  ])('forwards %j only when it is 1-255 characters of 0x21-0x7E: %s', async (key, forwarded) => {
    const { engine, handler } = setup()
    let request: Request

    try {
      request = ask()
      request.headers.set('idempotency-key', key)
    } catch {
      return // a value no header can carry never reaches the route
    }

    await handler(request)
    const sent = engine.fake!.requests.at(-1)!.headers.get('idempotency-key')

    if (forwarded) expect(sent).toBe(key)
    else expect(sent).toMatch(/^[!-~]{1,255}$/)
    if (!forwarded) expect(sent).not.toBe(key)
  })
})

describeFake('forwarding parity: buffered errors fail closed', () => {
  it('answers the generic 503 for a code this SDK does not recognise', async () => {
    const { engine, handler } = setup()

    engine.fake!.next({ status: 402, json: envelope('wallet_frozen', 'req_new') })
    const response = await handler(ask())

    expect(response.status).toBe(503)
    expect(await errorOf(response)).toEqual({ ...GENERIC, request_id: 'req_new' })
  })

  it('passes a known internal unchanged', async () => {
    const { engine, handler } = setup()

    engine.fake!.next({ status: 500, json: envelope('internal', 'req_int') })
    const response = await handler(ask())

    expect(response.status).toBe(500)
    expect((await errorOf(response)).code).toBe('internal')
  })

  it.each([
    ['no code', { error: { message: 'm', type: 'api_error' } }],
    ['an empty code', { error: { message: 'm', type: 'api_error', code: '' } }],
    ['a code that is no string', { error: { message: 'm', type: 'api_error', code: 7 } }],
    ['Error at the top level', { Error: { message: 'm', type: 'api_error', code: 'rate_limited' } }],
    ['Code inside the error', { error: { message: 'm', type: 'api_error', code: 'rate_limited', Code: 'x' } }],
    ['CHOICES at the top level', { error: { message: 'm', type: 'api_error', code: 'rate_limited' }, CHOICES: [] }],
    ['a long-s choices', { error: { message: 'm', type: 'api_error', code: 'rate_limited' }, ['choiceſ']: [] }]
  ])('answers the generic 503 for an error body with %s', async (_name, json) => {
    const { engine, handler } = setup()

    engine.fake!.next({ status: 429, json })
    const response = await handler(ask())

    expect(response.status).toBe(503)
    expect(await errorOf(response)).toEqual(GENERIC)
  })

  it.each([
    ['a non-null error', { error: { message: 'm', type: 'api_error', code: 'internal' }, choices: [] }],
    ['an error that is a string', { error: 'boom', choices: [] }],
    ['an Error variant', { Error: null, id: 'c', choices: [] }],
    ['a CHOICES variant', { id: 'c', choices: [], CHOICES: [] }]
  ])('answers the generic 503 for a 2xx reply with %s', async (_name, json) => {
    const { engine, handler } = setup()

    engine.fake!.next({ status: 200, json })
    const response = await handler(ask())

    expect(response.status).toBe(503)
    expect((await errorOf(response)).code).toBe('service_unavailable')
  })

  it('passes a 2xx reply with error: null, and never inspects nested content', async () => {
    const { engine, handler } = setup()
    const message = { role: 'assistant', content: 'x', Error: 'nested', error: { code: 'key_revoked' } }

    engine.fake!.next({ status: 200, json: { id: 'c', error: null, choices: [{ index: 0, message }] } })
    const response = await handler(ask())

    expect(response.status).toBe(200)
  })
})

describeFake('forwarding parity: request ids and Retry-After', () => {
  it.each([
    ['a line break', 'req\nx'],
    ['a leading space', ' req'],
    ['a trailing space', 'req '],
    ['256 characters', 'r'.repeat(256)],
    ['a non-ASCII character', 'réq'],
    ['an empty id', '']
  ])('leaves out a request id with %s, in the header and the body', async (_name, id) => {
    for (const code of ['rate_limited', 'key_revoked']) {
      const { engine, handler } = setup()

      engine.fake!.next({ status: 429, json: envelope(code, id) })
      const response = await handler(ask())

      expect(response.headers.get('x-request-id')).toBeNull()
      expect(await errorOf(response)).not.toHaveProperty('request_id')
    }
  })

  it('keeps a request id of 255 printable characters', async () => {
    const { engine, handler } = setup()
    const id = 'r' + ' '.repeat(253) + 'q'

    engine.fake!.next({ status: 429, json: envelope('rate_limited', id) })
    const response = await handler(ask())

    expect(response.headers.get('x-request-id')).toBe(id)
    expect((await errorOf(response)).request_id).toBe(id)
  })

  it.each([
    ['7', '7'],
    ['Wed, 21 Oct 2037 07:28:00 GMT', 'Wed, 21 Oct 2037 07:28:00 GMT'],
    [' 12 ', '12'],
    ['soon', null],
    ['1.5', null],
    ['-1', null],
    ['Wed, 21 Oct 99999 07:28:00 GMT', null]
  ])('relays a rate_limited Retry-After %j as %j', async (sent, relayed) => {
    const { engine, handler } = setup()

    engine.fake!.next({ status: 429, headers: { 'retry-after': sent }, json: envelope('rate_limited', 'req_rl') })
    const response = await handler(ask())

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe(relayed)
  })

  it('never relays Retry-After on another code', async () => {
    const { engine, handler } = setup()

    engine.fake!.next({ status: 502, headers: { 'retry-after': '7' }, json: envelope('upstream_unavailable') })

    expect((await handler(ask())).headers.get('retry-after')).toBeNull()
  })
})

describeFake('forwarding parity: the stream guard', () => {
  const text = frame(chunk('a'))

  it.each([
    ['an error that is a string', frame({ error: 'boom' })],
    ['an error with no code', frame({ error: { message: 'm', type: 'api_error' } })],
    ['an error with an empty code', frame({ error: { message: 'm', type: 'api_error', code: '' } })],
    ['an error whose code is no string', frame({ error: { message: 'm', code: 5 } })],
    ['an Error variant', frame({ Error: envelope('upstream_unavailable').error })],
    ['a Code variant', frame({ error: { ...envelope('upstream_unavailable', 'req_s').error, Code: 'x' } })],
    ['a CHOICES variant', frame({ ...chunk('b'), CHOICES: [] })],
    ['another event name', 'event: ping\ndata: {}\n\n'],
    ['an unknown field', 'foo: bar\ndata: {}\n\n'],
    ['data that is no JSON', 'data: hello\n\n'],
    ['data that is an array', 'data: [1]\n\n'],
    ['data that is null', 'data: null\n\n'],
    ['NaN', 'data: NaN\n\n'],
    ['Infinity', 'data: {"x": Infinity}\n\n']
  ])('ends with the generic frame and closes upstream for %s', async (_name, bad) => {
    const { state, relay } = streamed([text, bad, frame(chunk('later'))], { hang: true, id: 'req_s' })
    const body = await relay()

    expect(body).toBe(text + '\n\n' + genericFrame('req_s'))
    expect(state.closed).toBe(true)
  })

  it('ends a body whose last content holds no data line with the generic frame', async () => {
    const { relay } = streamed([text, ': only a comment'], { id: 'req_c' })

    expect(await relay()).toBe(text + '\n\n' + genericFrame('req_c'))
  })

  it('hides a frame with a code this SDK does not recognise', async () => {
    const { relay } = streamed([text, frame(envelope('wallet_frozen', 'req_f')), frame('[DONE]')])

    expect(await relay()).toBe(text + genericFrame('req_f') + frame('[DONE]'))
  })

  it('passes known codes, comments, id, retry and message events byte for byte, in any line ending', async () => {
    const known = frame(envelope('upstream_unavailable', 'req_k'))
    const pieces = [`﻿: hello\r\n\r\n`, `event: message\r\nid: 1\r\nretry: 5\r\ndata: {"choices":[]}\r\n\r\n`, known]
    const { relay } = streamed([...pieces, 'data: [DONE]\r\r'])

    expect(await relay()).toBe(pieces.join('') + 'data: [DONE]\r\r')
  })

  it('ends a stream that breaks mid-way with the generic frame', async () => {
    const { relay } = streamed([text], { broken: true, id: 'req_b' })

    expect(await relay()).toBe(text + '\n\n' + genericFrame('req_b'))
  })

  it('closes upstream when the browser goes away mid-stream', async () => {
    const { state, handler } = streamedHandler([text], { hang: true })
    const reader = (await handler(ask({ stream: true }))).body!.getReader()

    await reader.read()
    await reader.cancel()

    expect(state.closed).toBe(true)
  })

  it('leaves out a frame request id unfit for a header', async () => {
    const { relay } = streamed([frame(envelope('key_revoked', 'bad id\u0001'))])

    expect(await relay()).toBe(genericFrame())
  })
})

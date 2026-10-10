// Client, transport and admin parity with meridian-go and meridian-python (cross-lane rulings, 10 Oct).

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createClient } from '@gaussian/meridian'
import { createAdminClient } from '@gaussian/meridian/admin'

import { retryAfterMs } from '../src/internal/transport'
import { describeFake, testEngine } from './support/engine'
import { createFakeAdmin } from './support/fake-admin'
import { engineError, envelope, type Scripted } from './support/fake-engine'

const messages = [{ role: 'user' as const, content: 'hi' }]
const MIB = 1024 * 1024

function admin(maxRetries = 2) {
  const engine = testEngine(createFakeAdmin())

  return { engine, ops: createAdminClient(engine.adminUrl, engine.integratorKey, { fetch: engine.fetch, maxRetries }) }
}

function client(options: { maxRetries?: number; timeout?: number } = {}) {
  const engine = testEngine()

  return { engine, meridian: createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, ...options }) }
}

const unavailable = (): Scripted => engineError('upstream_unavailable', { 'retry-after': '0' })
const limited = (): Scripted => engineError('rate_limited', { 'retry-after': '0' })

describeFake('admin writes retry only on rate_limited', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const settle = async <T>(pending: Promise<T>) => {
    await vi.runAllTimersAsync()

    return pending
  }

  it.each<[string, (ops: ReturnType<typeof admin>['ops']) => Promise<{ error: { code: string } | null }>]>([
    ['projects.update', (ops: ReturnType<typeof admin>['ops']) => ops.projects.update('o1', 'p1', { name: 'n' })],
    [
      'providerCredentials.put',
      (ops: ReturnType<typeof admin>['ops']) =>
        ops.providerCredentials.put('o1', 'gemini', { api_key: 'k', policy: 'prefer' } as never)
    ],
    [
      'projectModels.put',
      (ops: ReturnType<typeof admin>['ops']) => ops.projectModels.put('o1', 'p1', { models: [] } as never)
    ],
    ['orgs.create without a reference', (ops: ReturnType<typeof admin>['ops']) => ops.orgs.create({ name: 'n' })],
    [
      'orgs.create with a blank reference',
      (ops: ReturnType<typeof admin>['ops']) => ops.orgs.create({ name: 'n', external_reference: '  ' })
    ]
  ])('%s is sent once on upstream_unavailable, and again on rate_limited', async (_name, call) => {
    const once = admin()

    once.engine.fake!.next(unavailable())
    expect((await settle(call(once.ops))).error?.code).toBe('upstream_unavailable')
    expect(once.engine.fake!.requests).toHaveLength(1)

    const twice = admin()

    twice.engine.fake!.next(limited(), limited())
    await settle(call(twice.ops))
    expect(twice.engine.fake!.requests).toHaveLength(3)
  })

  it('repeats orgs.create with a reference, and reads and deletes', async () => {
    const { engine, ops } = admin()

    engine.fake!.next(unavailable(), unavailable(), unavailable(), unavailable(), unavailable(), unavailable())
    await settle(ops.orgs.create({ name: 'n', external_reference: 'ref-1' }))
    await settle(ops.orgs.get('o1'))
    await settle(ops.projects.delete('o1', 'p1'))

    expect(engine.fake!.requests.map(request => request.method)).toEqual([
      'POST',
      'POST',
      'POST',
      'GET',
      'GET',
      'GET',
      'DELETE'
    ])
  })
})

describeFake('admin: an organisation id is never by-reference', () => {
  it.each(['by-reference', 'by%2Dreference', 'by%2dreference'])(
    'refuses %j in the org position, nothing sent',
    async org => {
      const { engine, ops } = admin()

      const results = [
        await ops.orgs.get(org),
        await ops.projects.list(org),
        await ops.projects.get(org, 'p1'),
        await ops.keys.list(org, 'p1'),
        await ops.providerCredentials.list(org)
      ]

      for (const { data, error } of results) {
        expect(data).toBeNull()
        expect(error).toMatchObject({ code: 'invalid_request', type: 'client_error' })
      }

      expect(engine.fake!.requests).toHaveLength(0)
    }
  )

  it('allows by-reference as a project or a reference', async () => {
    const { engine, ops } = admin()

    await ops.projects.get('o1', 'by-reference')
    await ops.orgs.getByReference('by-reference')

    expect(engine.fake!.requests).toHaveLength(2)
  })
})

describeFake('replies the client cannot use', () => {
  it.each([
    ['a non-null error', { id: 'c', choices: [], error: { message: 'm', type: 'api_error', code: 'internal' } }],
    ['an error that is a string', { id: 'c', choices: [], error: 'boom' }],
    ['an Error variant', { id: 'c', choices: [], Error: null }]
  ])('a 2xx with %s is a network_error, for chat and admin', async (_name, json) => {
    const { engine, meridian } = client({ maxRetries: 0 })

    engine.fake!.next({ status: 200, headers: { 'x-request-id': 'req_h' }, json })
    const { error } = await meridian.chat.create({ messages })

    expect(error).toMatchObject({ code: 'network_error', type: 'client_error', status: 200, requestId: 'req_h' })

    const { engine: adminEngine, ops } = admin(0)

    adminEngine.fake!.next({ status: 200, json })
    expect((await ops.orgs.get('o1')).error?.code).toBe('network_error')
  })

  it("keeps the error's own request id when it is fit to show", async () => {
    const { engine, meridian } = client({ maxRetries: 0 })

    engine.fake!.next({
      status: 200,
      headers: { 'x-request-id': 'req_h' },
      json: { error: envelope('internal', 'req_own').error }
    })

    expect((await meridian.chat.create({ messages })).error?.requestId).toBe('req_own')
  })

  it('a literal null 2xx is a network_error', async () => {
    const { engine, meridian } = client({ maxRetries: 0 })

    engine.fake!.next({ status: 200, text: 'null', headers: { 'content-type': 'application/json' } })
    expect((await meridian.chat.create({ messages })).error?.code).toBe('network_error')
    engine.fake!.next({ status: 200, text: 'null', headers: { 'content-type': 'application/json' } })
    expect((await meridian.models.list()).error?.code).toBe('network_error')
  })

  it('a 204 is an answer only for a DELETE', async () => {
    const { engine, meridian } = client({ maxRetries: 0 })

    engine.fake!.next({ status: 204 })
    expect((await meridian.chat.create({ messages })).error?.code).toBe('network_error')

    const { engine: adminEngine, ops } = admin(0)

    adminEngine.fake!.next({ status: 204 }, { status: 204 })
    expect(await ops.projects.delete('o1', 'p1')).toEqual({ data: null, error: null })
    expect((await ops.orgs.get('o1')).error?.code).toBe('network_error')
  })

  it('refuses a number JSON cannot hold (1e999), in a reply and in a stream frame', async () => {
    const { engine, meridian } = client({ maxRetries: 0 })

    engine.fake!.next({
      status: 200,
      text: '{"id":"c","choices":[],"x":1e999}',
      headers: { 'content-type': 'application/json' }
    })
    expect((await meridian.chat.create({ messages })).error?.code).toBe('network_error')

    engine.fake!.next({
      chunks: ['data: {"choices":[{"index":0,"delta":{"content":"a"}}],"x":-1e999}\n\n', 'data: [DONE]\n\n']
    })
    const { data: stream } = await meridian.chat.stream({ messages })

    await stream!.text()
    expect(stream!.error?.code).toBe('network_error')
  })

  it('refuses an error body over 1 MiB, reading no further than the cap', async () => {
    const { engine } = client({ maxRetries: 0 })
    const head = `{"error":{"code":"invalid_request","type":"invalid_request_error","message":"`
    let pulled = 0

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(head))
      },
      pull(controller) {
        pulled += 64 * 1024
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x61))
      }
    })

    const fetch = (async () => new Response(body, { status: 400 })) as unknown as typeof globalThis.fetch
    const refused = createClient(engine.publicUrl, engine.projectKey, { fetch, maxRetries: 0 })
    const { error } = await refused.chat.create({ messages })

    expect(error).toMatchObject({ code: 'network_error', status: 400 })
    expect(pulled).toBeLessThanOrEqual(MIB + 4 * 64 * 1024)
  })

  it('refuses a reply over 64 MiB, reading no further than the cap', async () => {
    const { engine } = client()
    let pulled = 0
    const piece = new Uint8Array(MIB).fill(0x20)

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += piece.length
        controller.enqueue(piece)
      }
    })

    const fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch
    const { error } = await createClient(engine.publicUrl, engine.projectKey, { fetch, maxRetries: 0 }).models.list()

    expect(error?.code).toBe('network_error')
    expect(pulled).toBeLessThanOrEqual(64 * MIB + 4 * MIB)
  })
})

describeFake('unknown codes and retries', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports a code this SDK does not know as internal, with the engine code kept apart, not retryable', async () => {
    const { engine, meridian } = client()

    engine.fake!.next({
      status: 503,
      headers: { 'retry-after': '0' },
      json: { error: { ...envelope('wallet_frozen').error, retryable: true } }
    })
    const pending = meridian.chat.create({ messages })

    await vi.runAllTimersAsync()
    const { error } = await pending

    expect(error).toMatchObject({
      code: 'internal',
      engineCode: 'wallet_frozen',
      retryable: false,
      message: 'fake wallet_frozen'
    })
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it("answers a retry's idempotency_conflict with the previous attempt's error", async () => {
    const { engine, meridian } = client()

    engine.fake!.next(unavailable(), engineError('idempotency_conflict'))
    const pending = meridian.chat.create({ messages })

    await vi.runAllTimersAsync()

    expect((await pending).error?.code).toBe('upstream_unavailable')
    expect(engine.fake!.requests).toHaveLength(2)
  })

  it('keeps the conflict when the previous attempt was rate limited (the engine released the key)', async () => {
    const { engine, meridian } = client()

    engine.fake!.next(limited(), engineError('idempotency_conflict'))
    const pending = meridian.chat.create({ messages })

    await vi.runAllTimersAsync()

    expect((await pending).error?.code).toBe('idempotency_conflict')
  })

  it('waits 300 s for a buffered chat reply by default, 60 s for a stream or an admin call', async () => {
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      )) as unknown as typeof fetch

    const meridian = createClient('http://engine.test', 'gmr_x', { fetch: hang, maxRetries: 0 })
    const ops = createAdminClient('http://admin.test', 'gmi_x', { fetch: hang, maxRetries: 0 })
    const settled: string[] = []

    void meridian.chat.create({ messages }).then(() => settled.push('create'))
    void meridian.chat.stream({ messages }).then(() => settled.push('stream'))
    void ops.orgs.list().then(() => settled.push('admin'))

    await vi.advanceTimersByTimeAsync(60_000)
    expect(settled.sort()).toEqual(['admin', 'stream'])
    await vi.advanceTimersByTimeAsync(240_000)
    expect(settled).toContain('create')
  })

  it("applies the caller's timeout to a buffered chat reply too", async () => {
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      )) as unknown as typeof fetch

    const pending = createClient('http://engine.test', 'gmr_x', {
      fetch: hang,
      maxRetries: 0,
      timeout: 1_000
    }).chat.create({
      messages
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect((await pending).error?.message).toContain('1000 ms')
  })
})

describeFake('the idempotency key parameter', () => {
  it.each(['k 1', 'x'.repeat(256), 'ké', 'k\n'])('refuses %j as a configuration error, nothing sent', async key => {
    const { engine, meridian } = client()

    const results = [
      await meridian.chat.create({ messages }, { idempotencyKey: key }),
      await meridian.chat.stream({ messages }, { idempotencyKey: key })
    ]

    for (const { error } of results) expect(error).toMatchObject({ code: 'invalid_request', type: 'client_error' })
    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('sends a valid key, and makes one for an empty key', async () => {
    const { engine, meridian } = client()

    await meridian.chat.create({ messages }, { idempotencyKey: '!'.repeat(255) })
    await meridian.chat.create({ messages }, { idempotencyKey: '' })
    const [given, made] = engine.fake!.requests.map(request => request.headers.get('idempotency-key'))

    expect(given).toBe('!'.repeat(255))
    expect(made).toMatch(/^[!-~]{1,255}$/)
  })
})

describeFake('Retry-After and streams', () => {
  it.each(['Wed, 21 Oct 99999 07:28:00 GMT', 'Fri, 31 Dec 275760 23:59:59 GMT', '1e999', '9'.repeat(400), 'soon', ''])(
    'never throws on %j',
    value => {
      expect(() => retryAfterMs(value)).not.toThrow()
    }
  )

  it('reads delta-seconds and an HTTP date', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs(' 3 ')).toBe(3000)
    expect(retryAfterMs('0x10')).toBeNull()
    expect(retryAfterMs('Wed, 21 Oct 2037 07:28:00 GMT')).toBeGreaterThan(0)
  })

  it('aborts a second read of a stream with "This stream was already read."', async () => {
    const { meridian } = client()
    const { data: stream } = await meridian.chat.stream({ messages })

    await stream!.text()
    const again = await stream!.text()

    expect(again.error).toMatchObject({ code: 'aborted', message: 'This stream was already read.' })
  })
})

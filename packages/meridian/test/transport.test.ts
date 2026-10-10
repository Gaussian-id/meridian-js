import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createClient } from '@gaussian-id/meridian'

import { describeEngine, describeFake, testEngine } from './support/engine'
import { engineError } from './support/fake-engine'

const messages = [{ role: 'user' as const, content: 'hi' }]

describeFake('transport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries a retryable error twice, then succeeds', async () => {
    const engine = testEngine()

    engine.fake!.next(engineError('service_unavailable'), engineError('rate_limited'))
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const pending = meridian.chat.create({ messages })

    await vi.runAllTimersAsync()
    const { data, error } = await pending

    expect(error).toBeNull()
    expect(data?.choices[0]?.message.content).toBe('Hello world')
    expect(engine.fake!.requests).toHaveLength(3)

    // One logical call keeps one idempotency key across its retries, so the engine never runs it twice
    const keys = engine.fake!.requests.map(request => request.headers.get('idempotency-key'))

    expect(keys[0]).toEqual(expect.any(String))
    expect(new Set(keys).size).toBe(1)
  })

  it('uses a caller-supplied idempotency key as-is', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    await meridian.chat.create({ messages }, { idempotencyKey: 'order-42' })

    expect(engine.fake!.requests[0]!.headers.get('idempotency-key')).toBe('order-42')
  })

  it('stops after maxRetries and returns the last error', async () => {
    const engine = testEngine()

    engine.fake!.next(
      engineError('upstream_unavailable'),
      engineError('upstream_unavailable'),
      engineError('upstream_unavailable')
    )
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 1 })

    const pending = meridian.chat.create({ messages })

    await vi.runAllTimersAsync()
    const { error } = await pending

    expect(error?.code).toBe('upstream_unavailable')
    expect(engine.fake!.requests).toHaveLength(2)
  })

  it('honours a short Retry-After', async () => {
    const engine = testEngine()

    engine.fake!.next(engineError('rate_limited', { 'retry-after': '2' }))
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const pending = meridian.chat.create({ messages })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(engine.fake!.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.runAllTimersAsync()
    expect((await pending).error).toBeNull()
    expect(engine.fake!.requests).toHaveLength(2)
  })

  it('returns at once when Retry-After is longer than 30 seconds, with the request id', async () => {
    const engine = testEngine()

    engine.fake!.next(engineError('rate_limited', { 'retry-after': '3600' }))
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const { error } = await meridian.chat.create({ messages })

    expect(error).toMatchObject({ code: 'rate_limited', retryable: true })
    expect(error?.requestId).toEqual(expect.any(String))
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it('returns aborted promptly when the caller aborts during the backoff wait', async () => {
    const engine = testEngine()

    engine.fake!.next(engineError('service_unavailable', { 'retry-after': '20' }))
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })
    const controller = new AbortController()

    const pending = meridian.chat.create({ messages }, { signal: controller.signal })

    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    const { error } = await pending

    expect(error).toMatchObject({ code: 'aborted', retryable: false })
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it('times out when headers do not arrive, as a retryable network_error', async () => {
    const engine = testEngine()

    engine.fake!.next({ delayMs: 10_000 })

    const meridian = createClient(engine.publicUrl, engine.projectKey, {
      fetch: engine.fetch,
      timeout: 1_000,
      maxRetries: 0
    })

    const pending = meridian.chat.create({ messages })

    await vi.advanceTimersByTimeAsync(1_000)
    const { error } = await pending

    expect(error).toMatchObject({ code: 'network_error', retryable: true })
    expect(error?.message).toContain('1000 ms')
  })

  it('reports a network failure as network_error and retries it', async () => {
    const engine = testEngine()

    engine.fake!.next({ networkError: true })
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const pending = meridian.chat.create({ messages })

    await vi.runAllTimersAsync()

    expect((await pending).error).toBeNull()
    expect(engine.fake!.requests).toHaveLength(2)
  })
})

describeFake('transport option sanitizing', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -3],
    ['fractional', 1.9]
  ])('sanitizes maxRetries: %s', async (name, value) => {
    vi.useRealTimers()
    const engine = testEngine()

    engine.fake!.next(...Array.from({ length: 6 }, () => engineError('upstream_unavailable', { 'retry-after': '0' })))
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: value })

    await meridian.chat.create({ messages })

    const expected = name === 'negative' ? 1 : name === 'fractional' ? 2 : 3

    expect(engine.fake!.requests).toHaveLength(expected)
  })
})

describeEngine('transport timeouts', () => {
  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('falls back to the default timeout for %s', async (_name, value) => {
    vi.useRealTimers()
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, timeout: value })
    const { data, error } = await meridian.chat.create({ messages })

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })
})

describeFake('transport: replies that are not Meridian errors, and waits', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const settle = async <T>(pending: Promise<T>) => {
    await vi.runAllTimersAsync()

    return pending
  }

  it('takes a non-Meridian 429 as a retryable network_error with its status, and retries it', async () => {
    const engine = testEngine()

    engine.fake!.next({ status: 429, text: 'Too Many Requests' }, { status: 429, text: 'Too Many Requests' })
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 1 })
    const { error } = await settle(meridian.chat.create({ messages }))

    expect(error).toMatchObject({ code: 'network_error', type: 'client_error', status: 429, retryable: true })
    expect(engine.fake!.requests).toHaveLength(2)
  })

  it('takes an HTML 404 as a network_error with its status that is not retried, keeping x-request-id', async () => {
    const engine = testEngine()

    engine.fake!.next({
      status: 404,
      headers: { 'content-type': 'text/html', 'x-request-id': 'req_html' },
      text: '<html><body>Not Found</body></html>'
    })
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })
    const { error } = await settle(meridian.models.list())

    expect(error).toMatchObject({ code: 'network_error', status: 404, retryable: false, requestId: 'req_html' })
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it('takes the x-request-id header when the envelope carries no request id', async () => {
    const engine = testEngine()

    engine.fake!.next({
      status: 403,
      headers: { 'x-request-id': 'req_header' },
      json: { error: { message: 'm', type: 'permission_error', code: 'model_not_allowed' } }
    })

    const { error } = await createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch }).chat.create({
      messages
    })

    expect(error).toMatchObject({ code: 'model_not_allowed', requestId: 'req_header' })
  })

  it('waits until an HTTP-date Retry-After', async () => {
    const engine = testEngine()

    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    engine.fake!.next(engineError('rate_limited', { 'retry-after': 'Tue, 01 Jan 2030 00:00:05 GMT' }))

    const pending = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch }).chat.create({
      messages
    })

    await vi.advanceTimersByTimeAsync(4_900)
    expect(engine.fake!.requests).toHaveLength(1)
    expect((await settle(pending)).error).toBeNull()
    expect(engine.fake!.requests).toHaveLength(2)
  })

  it('waits for a Retry-After of exactly 30 seconds, and returns at once for 31', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    engine.fake!.next(engineError('rate_limited', { 'retry-after': '30' }))
    expect((await settle(meridian.chat.create({ messages }))).error).toBeNull()
    expect(engine.fake!.requests).toHaveLength(2)

    engine.fake!.next(engineError('rate_limited', { 'retry-after': '31' }))
    expect((await meridian.chat.create({ messages })).error?.code).toBe('rate_limited')
    expect(engine.fake!.requests).toHaveLength(3)
  })

  it('clamps a timeout beyond what a timer holds (2^31 - 1 ms) instead of timing out at once', async () => {
    const engine = testEngine()

    engine.fake!.next({
      delayMs: 1_000,
      json: { id: 'c', object: 'chat.completion', created: 0, model: 'm', choices: [] }
    })

    const meridian = createClient(engine.publicUrl, engine.projectKey, {
      fetch: engine.fetch,
      timeout: 2 ** 40,
      maxRetries: 0
    })

    const pending = meridian.chat.create({ messages })

    await vi.advanceTimersByTimeAsync(1_000)
    expect((await pending).error).toBeNull()
  })
})

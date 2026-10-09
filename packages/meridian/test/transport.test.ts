import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createClient } from 'meridian'

import { describeFake, testEngine } from './support/engine'
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

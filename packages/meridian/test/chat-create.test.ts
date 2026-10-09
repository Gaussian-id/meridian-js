import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient } from 'meridian'

import { describeFake, testEngine } from './support/engine'
import { engineError } from './support/fake-engine'

const messages = [{ role: 'user' as const, content: 'hello' }]

describe('chat.create', () => {
  it('returns the completion with token usage and no cost', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const { data, error } = await meridian.chat.create({ model: engine.model, messages })

    expect(error).toBeNull()
    expect(typeof data?.choices[0]?.message.content).toBe('string')
    expect(typeof data?.usage?.total_tokens).toBe('number')
    expect(JSON.stringify(data)).not.toMatch(/cost|price/i)
  })

  it('returns an invalid key as an error value with the engine code, type and request id', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, `gmr_${'f'.repeat(64)}`, { fetch: engine.fetch })

    const { data, error } = await meridian.chat.create({ model: engine.model, messages })

    expect(data).toBeNull()
    expect(error).toMatchObject({
      code: 'invalid_api_key',
      type: 'authentication_error',
      status: 401,
      retryable: false
    })
    expect(error?.requestId).toEqual(expect.any(String))
  })

  it('lists the models the key may use', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const { data, error } = await meridian.models.list()

    expect(error).toBeNull()
    expect(data?.map(model => model.id)).toContain(engine.model)
  })

  it('sends no model when the caller names none (the engine decides, D-25)', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    await meridian.chat.create({ messages })

    if (engine.fake) {
      const sent = (await engine.fake.requests.at(-1)!.json()) as Record<string, unknown>

      expect(sent).not.toHaveProperty('model')
    }
  })
})

describeFake('chat.create against scripted failures', () => {
  it('decodes a body that is not a Meridian error as network_error with the real status', async () => {
    const engine = testEngine()

    engine.fake!.next(
      { status: 502, text: '<html>Bad gateway</html>' },
      { status: 502, text: '' },
      { status: 502, text: '' }
    )
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })

    const { error } = await meridian.chat.create({ messages })

    expect(error).toMatchObject({ code: 'network_error', status: 502, retryable: true, type: 'client_error' })
  })

  it('decodes an empty 503 without throwing', async () => {
    const engine = testEngine()

    engine.fake!.next({ status: 503, text: '' })
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })

    const { error } = await meridian.chat.create({ messages })

    expect(error).toMatchObject({ code: 'network_error', status: 503, retryable: true })
  })

  it('does not retry a non-retryable error', async () => {
    const engine = testEngine()

    engine.fake!.next(engineError('invalid_request'))
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const { error } = await meridian.chat.create({ messages })

    expect(error?.code).toBe('invalid_request')
    expect(engine.fake!.requests).toHaveLength(1)
  })
})

describe('createClient refusals', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses to run in a browser and names the browser client', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const { error } = await meridian.chat.create({ messages })

    expect(error).toMatchObject({ code: 'invalid_request', type: 'client_error', status: 0 })
    expect(error?.message).toContain('createBrowserClient')
  })

  it('refuses to run in React Native', async () => {
    vi.stubGlobal('navigator', { product: 'ReactNative' })
    const engine = testEngine()

    const { error } = await createClient(engine.publicUrl, engine.projectKey).models.list()

    expect(error?.message).toContain('createBrowserClient')
  })

  it('refuses an empty key or a URL that is not http(s), without sending anything', async () => {
    const engine = testEngine()

    const noKey = await createClient(engine.publicUrl, '', { fetch: engine.fetch }).models.list()
    const badUrl = await createClient('ftp://x', engine.projectKey, { fetch: engine.fetch }).models.list()

    expect(noKey.error?.code).toBe('invalid_request')
    expect(badUrl.error?.code).toBe('invalid_request')
    expect(engine.fake?.requests ?? []).toHaveLength(0)
  })
})

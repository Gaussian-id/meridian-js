import { afterEach, expect, it, vi } from 'vitest'

import { createClient } from '@gaussian-id/meridian'
import type { ChatParams } from '@gaussian-id/meridian'

import { describeEngine, describeFake, testEngine } from './support/engine'
import { engineError } from './support/fake-engine'

const messages = [{ role: 'user' as const, content: 'hello' }]

describeEngine('chat.create', () => {
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

  it('always sends stream: false, even if the caller passes stream: true', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    await meridian.chat.create({ messages, stream: true } as ChatParams)

    if (engine.fake) {
      const sent = (await engine.fake.requests.at(-1)!.json()) as Record<string, unknown>

      expect(sent.stream).toBe(false)
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

describeFake('chat.create when the body is cut', () => {
  it('returns aborted when the caller aborts while the body is being read', async () => {
    const engine = testEngine()

    engine.fake!.next({ headers: { 'content-type': 'application/json' }, hang: true })
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })
    const controller = new AbortController()

    setTimeout(() => controller.abort(), 20)
    const { data, error } = await meridian.chat.create({ messages }, { signal: controller.signal })

    expect(data).toBeNull()
    expect(error).toMatchObject({ code: 'aborted', status: 0, retryable: false })
  })
})

describeEngine('createClient refusals', () => {
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

    const { error } = await createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch }).models.list()

    expect(error?.message).toContain('createBrowserClient')
    expect(engine.fake?.requests ?? []).toHaveLength(0)
  })

  it('refuses an empty key or a URL that is not http(s), without sending anything', async () => {
    const engine = testEngine()

    const noKey = await createClient(engine.publicUrl, '', { fetch: engine.fetch }).models.list()
    const badUrl = await createClient('ftp://x', engine.projectKey, { fetch: engine.fetch }).models.list()

    expect(noKey.error?.code).toBe('invalid_request')
    expect(badUrl.error?.code).toBe('invalid_request')
    expect(engine.fake?.requests ?? []).toHaveLength(0)
  })

  it('returns a configuration error, not a throw, when no fetch exists', async () => {
    const engine = testEngine()

    vi.stubGlobal('fetch', undefined)

    const meridian = createClient(engine.publicUrl, engine.projectKey)
    const { error } = await meridian.models.list()

    expect(error).toMatchObject({ code: 'invalid_request', type: 'client_error', status: 0, retryable: false })
    expect(error?.message).toContain('fetch')
  })
})

describeFake('chat.create usage', () => {
  it('returns only the present token counts, without details or extra fields', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })

    engine.fake!.next({
      json: {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, prompt_tokens_details: { cached_tokens: 1 }, cost: 1 }
      }
    })

    const { data } = await meridian.chat.create({ messages })

    expect(data?.usage).toStrictEqual({ prompt_tokens: 4 })
  })
})

import { createApp, toWebHandler } from 'h3'
import { expect, it, vi } from 'vitest'

import { createClient } from 'meridian'

import { useMeridian } from 'meridian-nuxt/composables'
import { defineMeridianHandler, useMeridianServerClient } from 'meridian-nuxt/server'

import { describeEngine, testEngine } from '../../meridian/test/support/engine'

describeEngine('meridian-nuxt', () => {
  it('serves a forwarding route as a Nitro handler that streams', async () => {
    const engine = testEngine()
    const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })

    const app = createApp().use(
      '/api/meridian/chat',
      defineMeridianHandler({ client, authorize: () => true, allow: { model: true } })
    )

    const web = toWebHandler(app)

    const response = await web(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: engine.model, stream: true, messages: [{ role: 'user', content: 'hi' }] })
      })
    )

    expect((await response.text()).trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('throws at creation without authorize, like the core', () => {
    expect(() => defineMeridianHandler({} as never)).toThrow(TypeError)
  })

  it('gives a browser client preset to the default route', async () => {
    vi.stubGlobal('location', { href: 'http://app.test/' })

    try {
      const seen: string[] = []

      const spy = (async (input: RequestInfo | URL) => {
        seen.push(String(input))

        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }) as typeof fetch

      await useMeridian({ fetch: spy }).chat.create({ messages: [{ role: 'user', content: 'x' }] })

      expect(seen).toEqual(['/api/meridian/chat'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns an error value, not a throw, from the server client when runtime config is empty', async () => {
    const result = await useMeridianServerClient().chat.create({ messages: [{ role: 'user', content: 'x' }] })

    expect(result.data).toBeNull()
    expect(result.error?.message).toContain('NUXT_MERIDIAN_KEY')
  })

  it('never shows the browser a setup error: missing runtime config gives the generic 503', async () => {
    const web = toWebHandler(createApp().use('/api/meridian/chat', defineMeridianHandler({ authorize: () => true })))

    const response = await web(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
      })
    )

    const text = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(text).error.code).toBe('service_unavailable')
    expect(text).not.toMatch(/key|MERIDIAN|NUXT_|runtimeConfig/i)
  })

  it('closes the engine stream when the browser goes away mid-stream', async () => {
    let closed = false

    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => (closed = true))

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
        },
        cancel() {
          closed = true
        }
      })

      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch

    const client = createClient('http://engine.test', 'gmr_x', { fetch: hanging })

    const web = toWebHandler(
      createApp().use('/api/meridian/chat', defineMeridianHandler({ client, authorize: () => true }))
    )

    const response = await web(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] })
      })
    )

    const reader = response.body!.getReader()

    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(closed).toBe(true))
  })
})

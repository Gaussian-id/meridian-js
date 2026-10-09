import { createApp, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { createClient } from 'meridian'

import { useMeridian } from 'meridian-nuxt/composables'
import { defineMeridianHandler, useMeridianServerClient } from 'meridian-nuxt/server'

import { testEngine } from '../../meridian/test/support/engine'

describe('meridian-nuxt', () => {
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
})

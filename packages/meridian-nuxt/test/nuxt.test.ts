import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createApp, toNodeListener, toWebHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient } from 'meridian'

import { useMeridian } from 'meridian-nuxt/composables'
import { defineMeridianHandler, useMeridianServerClient, type MeridianHandlerOptions } from 'meridian-nuxt/server'

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

// The handler as Nitro runs it on Node: a real server on loopback, no web Request on the event
describe('meridian-nuxt on a Node server (toNodeListener)', () => {
  let server: Server | undefined
  const uncaught: unknown[] = []
  const record = (error: unknown) => uncaught.push(error)

  const serve = async (options: MeridianHandlerOptions) => {
    process.on('uncaughtException', record)
    server = createServer(toNodeListener(createApp().use('/api/meridian/chat', defineMeridianHandler(options))))
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))

    return (server.address() as AddressInfo).port
  }

  afterEach(() => {
    server?.closeAllConnections()
    server?.close()
    process.off('uncaughtException', record)
    uncaught.length = 0
  })

  /** POSTs `size` bytes in 1 MiB writes (waiting on drain) and resolves with the status; a reset after it is fine. */
  const postLarge = (port: number, size: number) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/meridian/chat',
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        },
        res => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )

      req.on('error', reject)
      const piece = Buffer.alloc(1024 * 1024, 0x20)
      let sent = 0

      const pump = () => {
        while (sent < size) {
          sent += piece.byteLength
          if (!req.write(piece)) return void req.once('drain', pump)
        }

        req.end()
      }

      pump()
    })

  it('refuses a body over 8 MiB with 413, without an uncaught error, and keeps serving', async () => {
    const neverCalled = (async () => {
      throw new Error('the engine must not be called')
    }) as typeof fetch

    const port = await serve({
      client: createClient('http://engine.test', 'gmr_x', { fetch: neverCalled }),
      authorize: () => true
    })

    expect(await postLarge(port, 12 * 1024 * 1024)).toBe(413)

    // The server is still up: the next request gets an answer
    const next = await fetch(`http://127.0.0.1:${port}/api/meridian/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })

    expect(next.status).toBe(400)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(uncaught).toEqual([])
  })

  it('closes the engine stream when the browser disconnects mid-stream, and pulls nothing more', async () => {
    const encoder = new TextEncoder()
    let pulls = 0
    let closed = false

    // An endless engine stream that, like fetch, errors its body when the call is aborted
    const endless = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            closed = true
            controller.error(new DOMException('aborted', 'AbortError'))
          })
        },
        async pull(controller) {
          await new Promise(resolve => setTimeout(resolve, 10))
          pulls++
          controller.enqueue(encoder.encode('data: {"choices":[]}\n\n'))
        },
        cancel() {
          closed = true
        }
      })

      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch

    const port = await serve({
      client: createClient('http://engine.test', 'gmr_x', { fetch: endless }),
      authorize: () => true
    })

    // The browser reads the first frame, then leaves
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/meridian/chat',
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        },
        res => {
          res.once('data', () => {
            req.destroy()
            resolve()
          })
        }
      )

      req.on('error', () => {})
      req.on('timeout', reject)
      req.end(JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }))
    })

    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1000 })
    const settled = pulls

    await new Promise(resolve => setTimeout(resolve, 200))
    expect(pulls).toBe(settled)
    expect(uncaught).toEqual([])
  })
})

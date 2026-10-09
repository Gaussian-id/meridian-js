import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient } from 'meridian'

import { createRouteHandler, createServerClient } from 'meridian-next'
import { createBrowserClient } from 'meridian-next/browser'
import { createPagesHandler } from 'meridian-next/pages'

import { contract, testEngine } from '../../meridian/test/support/engine'

const messages = [{ role: 'user', content: 'hi' }]
const json = { 'content-type': 'application/json' }

describe('meridian-next', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('builds the server client from MERIDIAN_URL and MERIDIAN_KEY', async () => {
    const engine = testEngine()

    vi.stubEnv('MERIDIAN_URL', engine.publicUrl)
    vi.stubEnv('MERIDIAN_KEY', engine.projectKey)

    const { data, error } = await createServerClient({ fetch: engine.fetch }).models.list()

    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })

  it('reports a missing MERIDIAN_KEY as an error value', async () => {
    vi.stubEnv('MERIDIAN_URL', 'http://engine.test')
    vi.stubEnv('MERIDIAN_KEY', '')

    const { error } = await createServerClient().models.list()

    expect(error?.code).toBe('invalid_request')
  })

  it('gives an App Router POST that streams', async () => {
    const engine = testEngine()
    const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })
    const { POST } = createRouteHandler({ client, authorize: () => true, allow: { model: true } })

    const response = await POST(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ model: engine.model, stream: true, messages })
      })
    )

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect((await response.text()).trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('builds the server client per request, so a missing env at creation is harmless', async () => {
    vi.stubEnv('MERIDIAN_URL', '')
    vi.stubEnv('MERIDIAN_KEY', '')

    const { POST } = createRouteHandler({ authorize: () => true })

    const response = await POST(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ messages })
      })
    )

    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_request')
  })

  it.runIf(!contract)('hides a revoked app key from the browser behind the route', async () => {
    const engine = testEngine()
    const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })
    const { POST } = createRouteHandler({ client, authorize: () => true })

    engine.fake!.next({
      status: 401,
      json: { error: { message: 'revoked', type: 'authentication_error', code: 'key_revoked', request_id: 'req_n' } }
    })

    const response = await POST(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ messages })
      })
    )

    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).not.toContain('key_revoked')
    expect(text).toContain('service_unavailable')
  })

  it('refuses a POST without a JSON content-type', async () => {
    const { POST } = createRouteHandler({ authorize: () => true })

    const response = await POST(
      new Request('http://app.test/api/meridian/chat', { method: 'POST', body: JSON.stringify({ messages }) })
    )

    expect(response.status).toBe(415)
  })

  it('has a browser client that posts JSON to /api/meridian/chat without a key', async () => {
    vi.stubGlobal('location', { href: 'http://app.test/' })

    try {
      const seen: { url: string; init: RequestInit }[] = []

      const browserFetch = (async (url: string, init: RequestInit) => {
        seen.push({ url: String(url), init })

        return Response.json({ id: 'c', object: 'chat.completion', created: 0, model: 'm', choices: [] })
      }) as unknown as typeof fetch

      await createBrowserClient({ fetch: browserFetch }).chat.create({ messages: [{ role: 'user', content: 'hi' }] })

      const headers = new Headers(seen[0]!.init.headers)

      expect(seen[0]!.url).toBe('/api/meridian/chat')
      expect(seen[0]!.init.method).toBe('POST')
      expect(headers.get('content-type')).toContain('application/json')
      expect(headers.get('authorization')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe('Pages Router', () => {
    const serve = async (handler: ReturnType<typeof createPagesHandler>) => {
      const server = createServer((req, res) => {
        let raw = ''

        req.on('data', part => (raw += part))
        req.on('end', () => void handler(Object.assign(req, { body: JSON.parse(raw) }), res))
      })

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

      return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat` }
    }

    it('streams through a Node response', async () => {
      const engine = testEngine()
      const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })
      const { server, url } = await serve(createPagesHandler({ client, authorize: () => true, allow: { model: true } }))

      const response = await fetch(url, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ model: engine.model, stream: true, messages })
      })

      const body = await response.text()

      server.close()

      expect(response.status).toBe(200)
      expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true)
    })

    it('aborts the upstream call when the response closes early', async () => {
      const encoder = new TextEncoder()
      let upstreamSignal: AbortSignal | undefined

      const hangingFetch = (async (_url: string, init: RequestInit) => {
        upstreamSignal = init.signal ?? undefined

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
                )
              )
              init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
            }
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      }) as unknown as typeof fetch

      const client = createClient('http://engine.test', 'gmr_test', { fetch: hangingFetch })
      const { server, url } = await serve(createPagesHandler({ client, authorize: () => true }))

      const response = await fetch(url, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ stream: true, messages })
      })

      const reader = response.body!.getReader()

      await reader.read()
      await reader.cancel()

      await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true))
      server.close()
    })
  })
})

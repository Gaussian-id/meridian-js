import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient } from 'meridian'
import { createBrowserClient } from 'meridian/browser'
import { createForwardHandler } from 'meridian/server'

import { describeFake, testEngine } from './support/engine'

/** The app's server: a forwarding handler in front of the engine, reached through `fetch`. */
function app(authorize: (request: Request) => boolean = () => true) {
  const engine = testEngine()
  const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 })
  const handler = createForwardHandler({ client, authorize, allow: { model: true } })

  const routeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof fetch

  return { engine, routeFetch }
}

const route = 'http://app.test/api/meridian/chat'

describeFake('createBrowserClient through the app route', () => {
  it('streams through the app route with the same API as the server client', async () => {
    const { engine, routeFetch } = app()
    const meridian = createBrowserClient({ route, fetch: routeFetch })

    const { data: stream, error } = await meridian.chat.stream({
      model: engine.model,
      messages: [{ role: 'user', content: 'hi' }]
    })

    const text = await stream!.text()

    expect(error).toBeNull()
    expect(text.error).toBeNull()
    expect(text.data!.length).toBeGreaterThan(0)
  })

  it('creates a buffered completion through the app route', async () => {
    const { engine, routeFetch } = app()
    const meridian = createBrowserClient({ route, fetch: routeFetch })

    const { data, error } = await meridian.chat.create({
      model: engine.model,
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect(error).toBeNull()
    expect(data!.choices.length).toBeGreaterThan(0)
  })

  it('decodes the route refusal into the same error shape', async () => {
    const { routeFetch } = app(() => false)
    const meridian = createBrowserClient({ route, fetch: routeFetch })

    const { error } = await meridian.chat.create({ messages: [{ role: 'user', content: 'hi' }] })

    expect(error).toMatchObject({ code: 'permission_denied', status: 403, type: 'permission_error' })
  })
})

describe('createBrowserClient requests', () => {
  it('never sends a key, and never calls the engine directly', async () => {
    const seen: Request[] = []

    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init))

      return new Response(JSON.stringify({ choices: [] }), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    await createBrowserClient({ route, fetch: spy }).chat.create({ messages: [{ role: 'user', content: 'hi' }] })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe(route)
    expect(seen[0]!.method).toBe('POST')
    expect(seen[0]!.headers.get('content-type')).toBe('application/json')
    expect(seen[0]!.headers.get('authorization')).toBeNull()
  })

  it('defaults to the /api/meridian/chat route', async () => {
    vi.stubGlobal('location', { href: 'http://app.test/' })

    try {
      const seen: string[] = []

      const spy = (async (input: RequestInfo | URL) => {
        seen.push(String(input))

        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }) as typeof fetch

      await createBrowserClient({ fetch: spy }).chat.create({ messages: [{ role: 'user', content: 'x' }] })

      expect(seen).toEqual(['/api/meridian/chat'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createBrowserClient without a page origin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses a relative route as an error value when location is absent', async () => {
    let called = false

    const spy = (async () => {
      called = true

      return new Response('{}')
    }) as typeof fetch

    const meridian = createBrowserClient({ route: '/api/meridian/chat', fetch: spy })
    const created = await meridian.chat.create({ messages: [{ role: 'user', content: 'x' }] })
    const streamed = await meridian.chat.stream({ messages: [{ role: 'user', content: 'x' }] })

    for (const result of [created, streamed]) {
      expect(result.data).toBeNull()
      expect(result.error).toMatchObject({ code: 'invalid_request', type: 'client_error', retryable: false })
      expect(result.error?.message).toContain('absolute')
    }

    expect(called).toBe(false)
  })

  it('refuses the default route when location is absent', async () => {
    const { error } = await createBrowserClient().chat.create({ messages: [{ role: 'user', content: 'x' }] })

    expect(error?.message).toContain('absolute')
  })

  it('accepts a relative route when location exists', async () => {
    vi.stubGlobal('location', { href: 'http://app.test/' })

    const seen: string[] = []

    const spy = (async (input: RequestInfo | URL) => {
      seen.push(String(input))

      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    await createBrowserClient({ route: '/x', fetch: spy }).chat.create({ messages: [{ role: 'user', content: 'x' }] })

    expect(seen).toEqual(['/x'])
  })

  it('accepts an absolute route when location is absent', async () => {
    const seen: string[] = []

    const spy = (async (input: RequestInfo | URL) => {
      seen.push(String(input))

      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    await createBrowserClient({ route: 'https://app.example/x', fetch: spy }).chat.create({
      messages: [{ role: 'user', content: 'x' }]
    })

    expect(seen).toEqual(['https://app.example/x'])
  })
})

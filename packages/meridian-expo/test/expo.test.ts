import { expect, it, vi } from 'vitest'

import { createClient } from '@gaussian/meridian'
import { createForwardHandler } from '@gaussian/meridian/server'

import { createBrowserClient } from '@gaussian/meridian-expo'

import { describeEngine, testEngine } from '../../meridian/test/support/engine'

describeEngine('@gaussian/meridian-expo', () => {
  it('streams from the app backend', async () => {
    const engine = testEngine()
    const client = createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch })
    const handler = createForwardHandler({ client, authorize: () => true, allow: { model: true } })

    const backend = ((input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof fetch

    const meridian = createBrowserClient({ route: 'https://app.example/api/meridian/chat', fetch: backend })

    const { data: stream } = await meridian.chat.stream({
      model: engine.model,
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect((await stream!.text()).data!.length).toBeGreaterThan(0)
  })

  it('closes the engine stream behind the backend when the app cancels its stream', async () => {
    let closed = false

    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => (closed = true))

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'))
        },
        cancel() {
          closed = true
        }
      })

      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch

    const client = createClient('http://engine.test', 'gmr_x', { fetch: hanging })
    const handler = createForwardHandler({ client, authorize: () => true })

    const backend = ((input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof fetch

    const meridian = createBrowserClient({ route: 'https://app.example/api/meridian/chat', fetch: backend })
    const { data: stream } = await meridian.chat.stream({ messages: [{ role: 'user', content: 'hi' }] })

    for await (const piece of stream!) {
      expect(piece.delta).toBe('hi')
      break
    }

    await vi.waitFor(() => expect(closed).toBe(true))
  })

  it('refuses a relative route as an error value', async () => {
    const meridian = createBrowserClient({ route: '/api/meridian/chat' })

    const { error } = await meridian.chat.create({ messages: [{ role: 'user', content: 'x' }] })

    expect(error).toMatchObject({ code: 'invalid_request', type: 'client_error' })
    expect(error?.message).toContain('absolute')
  })

  it('defaults to expo/fetch when no fetch is given', async () => {
    const { error } = await createBrowserClient({ route: 'https://app.example/x', maxRetries: 0 }).chat.create({
      messages: [{ role: 'user', content: 'x' }]
    })

    expect(error?.code).toBe('network_error')
  })
})

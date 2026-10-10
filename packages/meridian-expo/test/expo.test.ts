import { expect, it } from 'vitest'

import { createClient } from 'meridian'
import { createForwardHandler } from 'meridian/server'

import { createBrowserClient } from 'meridian-expo'

import { describeEngine, testEngine } from '../../meridian/test/support/engine'

describeEngine('meridian-expo', () => {
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

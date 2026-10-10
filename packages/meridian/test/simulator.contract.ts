// The contract matrix against the real local engine in simulator mode (pnpm test:contract only: registered nowhere
// else). The simulator's reply is fixed: ten deltas `sim token 1` ... `sim token 10`, ten completion tokens. No test
// here prints a key.

import { beforeAll, expect, it } from 'vitest'

import { createAdminClient } from 'meridian/admin'
import { createClient } from 'meridian'
import { createForwardHandler } from 'meridian/server'

import { contractEngine, describeSimulator } from './support/engine'

const messages = [{ role: 'user' as const, content: 'hello' }]
const PIECES = Array.from({ length: 10 }, (_, at) => `sim token ${at + 1}`)
const FIXED = PIECES.join('')
const REVOKED = ['invalid_api_key', 'key_revoked']
const unique = () => `contract-${crypto.randomUUID()}`

function clients() {
  // Not testEngine(): beforeAll has no test or tag to vouch for it. This file runs only in contract mode, so it asks
  // for the real engine directly, behind the same guard.
  const engine = contractEngine(process.env)

  return {
    engine,
    meridian: createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 }),
    ops: createAdminClient(engine.adminUrl, engine.integratorKey, { fetch: engine.fetch, maxRetries: 0 })
  }
}

/** A fresh organisation and project, with a key of its own: the seeded keys are never revoked. */
async function ownKey() {
  const { engine, ops } = clients()
  const org = await ops.orgs.create({ name: 'Contract', external_reference: unique() })
  const project = await ops.projects.create(org.data!.id, { name: 'Contract project' })
  const issued = await ops.keys.create(org.data!.id, project.data!.id, {})

  return { engine, ops, org: org.data!, project: project.data!, issued: issued.data! }
}

describeSimulator('simulator contract', () => {
  // The tripwire: if the reply is not the simulator's, nothing after this runs (a failing beforeAll fails them all)
  beforeAll(async () => {
    const { engine, meridian } = clients()
    const { data, error } = await meridian.chat.create({ model: engine.model, messages })

    if (error !== null || data?.choices[0]?.message.content !== FIXED || data.usage?.completion_tokens !== 10) {
      throw new Error('The canary failed: the engine did not answer with the simulator reply. Stop and tear down.')
    }
  })

  it('canary: the fixed reply, ten completion tokens, no cost', async () => {
    const { engine, meridian } = clients()
    const { data, error } = await meridian.chat.create({ model: engine.model, messages })

    expect(error).toBeNull()
    expect(data?.choices[0]?.message.content).toBe(FIXED)
    expect(data?.usage?.completion_tokens).toBe(10)
    expect(JSON.stringify(data)).not.toMatch(/cost|price/i)
  })

  it('chat create: a completion with usage and a request id', async () => {
    const { engine, meridian } = clients()
    const { data, error } = await meridian.chat.create({ model: engine.model, messages })

    expect(error).toBeNull()
    expect(data?.usage?.total_tokens).toBe((data?.usage?.prompt_tokens ?? 0) + 10)
    expect(data?.id).toEqual(expect.any(String))
  })

  it('an invalid key is invalid_api_key, with the engine code, type and request id', async () => {
    const { engine } = clients()
    const meridian = createClient(engine.publicUrl, `gmr_${'f'.repeat(64)}`, { fetch: engine.fetch, maxRetries: 0 })
    const { data, error } = await meridian.chat.create({ model: engine.model, messages })

    expect(data).toBeNull()
    expect(error).toMatchObject({ code: 'invalid_api_key', type: 'authentication_error', status: 401 })
    expect(error?.requestId).toEqual(expect.any(String))
  })

  it('stream: exactly ten text pieces, then usage', async () => {
    const { engine, meridian } = clients()
    const { data: stream, error } = await meridian.chat.stream({ model: engine.model, messages })

    expect(error).toBeNull()
    const deltas: string[] = []

    for await (const piece of stream!) if (piece.delta !== '') deltas.push(piece.delta)

    expect(deltas).toEqual(PIECES)
    expect(stream!.error).toBeNull()
    expect(stream!.usage?.completion_tokens).toBe(10)
  })

  it('admin: provision an organisation, a project and a key, list it, revoke it', async () => {
    const { ops, org, project, issued } = await ownKey()
    const listed = await ops.keys.list(org.id, project.id)
    const revoked = await ops.keys.revoke(org.id, project.id, issued.key_id)
    const after = await ops.keys.list(org.id, project.id)

    expect(issued.api_key).toMatch(/^gmr_[0-9a-f]{64}$/)
    expect(listed.data?.find(key => key.id === issued.key_id)?.active).toBe(true)
    expect(JSON.stringify(listed.data)).not.toContain(issued.api_key)
    expect(revoked).toEqual({ data: null, error: null })
    expect(after.data?.find(key => key.id === issued.key_id)?.active).toBe(false)
  })

  it('a revoked key used directly is refused (models list)', async () => {
    const { engine, ops, org, project, issued } = await ownKey()
    const own = createClient(engine.publicUrl, issued.api_key, { fetch: engine.fetch, maxRetries: 0 })

    expect((await own.models.list()).error).toBeNull()
    await ops.keys.revoke(org.id, project.id, issued.key_id)

    // [1] The engine may keep accepting a revoked key for up to 5 s (its key cache), so poll for 8 s
    let { data, error } = await own.models.list()

    for (const deadline = Date.now() + 8_000; error === null && Date.now() < deadline;) {
      await new Promise(resolve => setTimeout(resolve, 250))
      ;({ data, error } = await own.models.list())
    }

    expect(data).toBeNull()
    expect(error?.status).toBe(401)
    expect(REVOKED).toContain(error?.code)
  }, 15_000)

  it('forwarding: a buffered and a streamed request, through the core handler, against the real engine', async () => {
    const { engine, meridian } = clients()
    const handler = createForwardHandler({ client: meridian, authorize: () => true, allow: { model: true } })

    const post = (body: unknown) =>
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })

    const buffered = await handler(post({ model: engine.model, messages }))
    const json = (await buffered.json()) as { choices: { message: { content: string } }[] }
    const streamed = await handler(post({ model: engine.model, messages, stream: true }))
    const body = await streamed.text()

    expect(buffered.status).toBe(200)
    expect(json.choices[0]?.message.content).toBe(FIXED)
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('content-type')).toContain('text/event-stream')
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true)
    for (const piece of PIECES) expect(body).toContain(piece)
  })

  it('forwarding with the revoked key: the browser gets the generic 503, the server-side client sees the code', async () => {
    const { engine, ops, org, project, issued } = await ownKey()
    const own = createClient(engine.publicUrl, issued.api_key, { fetch: engine.fetch, maxRetries: 0 })
    const handler = createForwardHandler({ client: own, authorize: () => true, allow: { model: true } })

    await ops.keys.revoke(org.id, project.id, issued.key_id)

    const response = await handler(
      new Request('http://app.test/api/meridian/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: engine.model, messages })
      })
    )

    const text = await response.text()
    const direct = await own.chat.create({ model: engine.model, messages })

    expect(response.status).toBe(503)
    expect(JSON.parse(text)).toMatchObject({
      error: { message: 'The service is temporarily unavailable.', code: 'service_unavailable', retryable: false }
    })
    for (const code of REVOKED) expect(text).not.toContain(code)
    expect(REVOKED).toContain(direct.error?.code)
  })

  // Only here because the canary above proved the simulator: the model `sim-fail` always fails at its direct
  // provider, so the engine answers through its fallback. Only the reply shape is asserted, nothing about timing.
  it('sim-fail: the fallback still answers with a completion', async () => {
    const { meridian } = clients()
    const { data, error } = await meridian.chat.create({ model: 'sim-fail', messages })

    expect(error).toBeNull()
    expect(typeof data?.choices[0]?.message.content).toBe('string')
    expect(data?.usage?.completion_tokens).toBe(10)
  })
})

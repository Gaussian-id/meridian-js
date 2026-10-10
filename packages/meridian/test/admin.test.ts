import { readFileSync } from 'node:fs'
import { format, inspect } from 'node:util'

import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest'

import { createAdminClient, type AdminClient } from '@gaussian/meridian/admin'

import type { components } from '../src/generated/admin'
import { withoutPrices, type WithoutPrices } from '../src/internal/cost-opacity'
import type { Result } from '../src/internal/errors'
import { describeEngine, describeFake, testEngine } from './support/engine'
import { createFakeAdmin } from './support/fake-admin'
import { engineError } from './support/fake-engine'

function admin(maxRetries = 0) {
  const engine = testEngine(createFakeAdmin())

  return { engine, ops: createAdminClient(engine.adminUrl, engine.integratorKey, { fetch: engine.fetch, maxRetries }) }
}

const unique = () => `sdk-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

describeEngine('createAdminClient', () => {
  it('creates an organisation once per external reference; a retry returns the same one', async () => {
    const { ops } = admin()
    const reference = unique()

    const first = await ops.orgs.create({ name: 'SDK test', external_reference: reference })
    const again = await ops.orgs.create({ name: 'SDK test', external_reference: reference })
    const found = await ops.orgs.getByReference(reference)

    expect(first.error).toBeNull()
    expect(again.data).toEqual(first.data)
    expect(found.data).toEqual(first.data)
  })

  it('creates a project, issues a key whose secret comes back once, lists and revokes it', async () => {
    const { ops } = admin()
    const { data: org } = await ops.orgs.create({ name: 'SDK keys', external_reference: unique() })
    const { data: project } = await ops.projects.create(org!.id, { name: 'SDK project' })

    const issued = await ops.keys.create(org!.id, project!.id, {})
    const listed = await ops.keys.list(org!.id, project!.id)
    const revoked = await ops.keys.revoke(org!.id, project!.id, issued.data!.key_id)

    expect(issued.data!.api_key).toMatch(/^gmr_[0-9a-f]{64}$/)
    expect(JSON.stringify(listed.data)).not.toContain(issued.data!.api_key)
    expect(revoked).toEqual({ data: null, error: null })
  })

  it('sets a project model allowlist and BYOK credential without echoing the secret', async () => {
    const { engine, ops } = admin()
    const { data: org } = await ops.orgs.create({ name: 'SDK byok', external_reference: unique() })
    const { data: project } = await ops.projects.create(org!.id, { name: 'p' })

    const set = await ops.projectModels.put(org!.id, project!.id, { models: ['gemini-3.8-flash'] })

    const credential = await ops.providerCredentials.put(org!.id, 'gemini', {
      credential: 'test-credential-0000',
      policy: 'prefer'
    })

    expect(set.error).toBeNull()
    expect(JSON.stringify(credential.data)).not.toContain('test-credential-0000')
    expect(JSON.stringify(credential.error)).not.toContain('test-credential-0000')

    if (engine.fake) {
      expect(credential.error).toBeNull()
      expect(await ops.providerCredentials.delete(org!.id, 'gemini')).toEqual({ data: null, error: null })
    } else {
      // The local engine refuses to seal with no BYOK key: AdminError::Unavailable → service_unavailable 503
      expect(credential.error).toMatchObject({ code: 'service_unavailable', status: 503 })

      // Engine finding: the local engine has no GAUSSMERIDIAN_BYOK_KEY, so it cannot seal a credential and the put is
      // refused. Nothing was stored, so the delete is answered not_found (byok.rs delete: THROW when no row exists).
      expect(await ops.providerCredentials.delete(org!.id, 'gemini')).toMatchObject({
        error: { code: 'not_found', status: 404 }
      })
    }
  })

  it('answers not_found for an organisation outside its scope', async () => {
    const { ops } = admin()

    const { error } = await ops.orgs.get('org_does_not_exist')

    expect(error).toMatchObject({ code: 'not_found', status: 404 })
  })
})

describeEngine('createAdminClient refusals', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses to run in a browser', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    const engine = testEngine()

    const { error } = await createAdminClient(engine.adminUrl, engine.integratorKey).orgs.list()

    expect(error?.message).toContain('server')
    expect(error?.message).not.toContain('createBrowserClient')
  })

  it('refuses an empty key and a relative URL as error values', async () => {
    const engine = testEngine()

    expect((await createAdminClient(engine.adminUrl, '').orgs.list()).error?.message).toContain('integrator key')
    expect((await createAdminClient('/admin', engine.integratorKey).keys.revoke('o', 'p', 'k')).error).not.toBeNull()
  })
})

// The IntegratorKey operations the client wraps (all but EXCLUDED_PRICE_OPERATIONS), each called once with sentinel arguments
const calls: Record<string, (ops: AdminClient) => Promise<Result<unknown>>> = {
  'POST /v1/orgs': ops => ops.orgs.create({ name: 'n' }),
  'GET /v1/orgs': ops => ops.orgs.list(),
  'GET /v1/orgs/{org}': ops => ops.orgs.get('o1'),
  'GET /v1/orgs/by-reference/{reference}': ops => ops.orgs.getByReference('r1'),
  'POST /v1/orgs/{org}/projects': ops => ops.projects.create('o1', { name: 'n' }),
  'GET /v1/orgs/{org}/projects': ops => ops.projects.list('o1'),
  'GET /v1/orgs/{org}/projects/{project}': ops => ops.projects.get('o1', 'p1'),
  'PATCH /v1/orgs/{org}/projects/{project}': ops => ops.projects.update('o1', 'p1', { name: 'n' }),
  'DELETE /v1/orgs/{org}/projects/{project}': ops => ops.projects.delete('o1', 'p1'),
  'POST /v1/orgs/{org}/projects/{project}/keys': ops => ops.keys.create('o1', 'p1'),
  'GET /v1/orgs/{org}/projects/{project}/keys': ops => ops.keys.list('o1', 'p1'),
  'DELETE /v1/orgs/{org}/projects/{project}/keys/{key}': ops => ops.keys.revoke('o1', 'p1', 'k1'),
  'GET /v1/orgs/{org}/provider-credentials': ops => ops.providerCredentials.list('o1'),
  'PUT /v1/orgs/{org}/provider-credentials/{provider}': ops =>
    ops.providerCredentials.put('o1', 'gemini', { credential: 'x' }),
  'DELETE /v1/orgs/{org}/provider-credentials/{provider}': ops => ops.providerCredentials.delete('o1', 'gemini'),
  'GET /v1/orgs/{org}/projects/{project}/models': ops => ops.projectModels.get('o1', 'p1'),
  'PUT /v1/orgs/{org}/projects/{project}/models': ops => ops.projectModels.put('o1', 'p1', { models: [] }),
  'GET /v1/models': ops => ops.models.list(),
  'GET /v1/models/{model}': ops => ops.models.get('m1'),
  'GET /v1/analytics/usage': ops => ops.analytics.usage({ project_id: 'p1' }),
  'GET /v1/logs': ops => ops.logs.list({ project_id: 'p1' })
}

// D-27 / owner decision 10 Oct: the supplier-catalogue operations return only supplier prices, so the admin client
// does not wrap them at all; the billing service reads them from the engine's admin API directly.
const EXCLUDED_PRICE_OPERATIONS = ['GET /v1/catalogue', 'GET /v1/catalogue/{version}']

interface Spec {
  paths: Record<string, Record<string, { security?: Record<string, unknown>[] }>>
}

const spec = JSON.parse(readFileSync(new URL('../../../spec/meridian-admin.json', import.meta.url), 'utf8')) as Spec

const integratorOperations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods)
    .filter(([, op]) => op.security?.some(scheme => 'IntegratorKey' in scheme))
    .map(([method]) => `${method.toUpperCase()} ${path}`)
)

/** The spec path template a concrete request path matches. */
function templateOf(method: string, pathname: string): string | undefined {
  return Object.keys(spec.paths)
    .filter(template => spec.paths[template]![method.toLowerCase()])
    .find(template => new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(pathname))
}

const jsonResponder = (payload: unknown, log?: string[]) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const pathname = new URL(request.url).pathname

    log?.push(`${request.method} ${templateOf(request.method, pathname) ?? pathname}`)

    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

describeEngine('admin operations match the pinned spec', () => {
  it('wraps exactly the IntegratorKey operations, minus the excluded price operations', async () => {
    const engine = testEngine()
    const sent: string[] = []

    const ops = createAdminClient(engine.adminUrl, engine.integratorKey, {
      maxRetries: 0,
      fetch: jsonResponder({}, sent)
    })

    for (const call of Object.values(calls)) await call(ops)

    const wrapped = integratorOperations.filter(operation => !EXCLUDED_PRICE_OPERATIONS.includes(operation))

    // No method hides outside the table, and each call reached the route the spec declares
    const methodCount = Object.values(ops).reduce((sum, group: object) => sum + Object.keys(group).length, 0)

    expect(integratorOperations).toHaveLength(23)
    expect(EXCLUDED_PRICE_OPERATIONS.every(operation => integratorOperations.includes(operation))).toBe(true)
    expect(methodCount).toBe(Object.keys(calls).length)
    expect(Object.keys(calls).sort()).toEqual([...wrapped].sort())
    expect(sent.sort()).toEqual([...wrapped].sort())
  })

  it('has no supplier-catalogue methods', () => {
    const { ops } = admin()

    expect(ops).not.toHaveProperty('catalogue')
  })

  it('has no way to rename or delete an organisation', () => {
    const { ops } = admin()

    expect(Object.keys(ops.orgs).sort()).toEqual(['create', 'get', 'getByReference', 'list'])
  })
})

describeEngine('cost opacity (D-27)', () => {
  const priced = {
    cost_charged: 1,
    cost: 2,
    total_cost: 3,
    provider_cost: 4,
    keep: 'x',
    rows: [{ supplier_price: { input_per_million: 5 }, id: 'a', nested: { Price: 1, id: 'b' } }]
  }

  it('strips every cost or price key from every admin result', async () => {
    const engine = testEngine()

    const ops = createAdminClient(engine.adminUrl, engine.integratorKey, {
      maxRetries: 0,
      fetch: jsonResponder(priced)
    })

    for (const call of Object.values(calls)) {
      const { data, error } = await call(ops)

      if (data === null) continue
      expect(error).toBeNull()
      expect(JSON.stringify(data)).not.toMatch(/"[^"]*(cost|price)[^"]*"\s*:/i)
      expect(data).toMatchObject({ keep: 'x', rows: [{ id: 'a', nested: { id: 'b' } }] })
    }
  })

  it('strips nested per_million, recovery_rate and write_off_rate keys but keeps rate limits', () => {
    const reply = {
      id: 'o1',
      recovery_rate: 1,
      write_off_rate: 2,
      rate_limit_per_minute: 60,
      rows: [
        {
          input_per_million: 3,
          Output_Per_Million: 4,
          rate_limit_per_day: 5,
          deep: { cached_input_per_million: 6, ok: 7 }
        }
      ]
    }

    expect(withoutPrices(reply)).toEqual({
      id: 'o1',
      rate_limit_per_minute: 60,
      rows: [{ rate_limit_per_day: 5, deep: { ok: 7 } }]
    })
  })

  it('removes per_million and finance keys at the type level, and keeps rate limits', () => {
    type Reply = {
      input_per_million: number
      recovery_rate: number
      write_off_rate: number
      rate_limit_per_minute: number
      rows: { cached_input_per_million?: number | null; id: string }[]
    }

    expectTypeOf<WithoutPrices<Reply>>().toEqualTypeOf<{ rate_limit_per_minute: number; rows: { id: string }[] }>()
  })

  it('exports no admin result type with a cost, price, per_million or finance-rate key', () => {
    type Priced<T> = T extends readonly (infer U)[]
      ? Priced<U>
      : T extends object
        ? {
            [K in keyof T]-?:
              | (K extends string
                  ? Lowercase<K> extends
                      | `${string}cost${string}`
                      | `${string}price${string}`
                      | `${string}per_million${string}`
                      | 'recovery_rate'
                      | 'write_off_rate'
                    ? K
                    : never
                  : never)
              | Priced<T[K]>
          }[keyof T]
        : never

    type Data<F> = F extends (...args: never[]) => Promise<Result<infer D>> ? D : never

    type Every = {
      [G in keyof AdminClient]: { [M in keyof AdminClient[G]]: Priced<Data<AdminClient[G][M]>> }[keyof AdminClient[G]]
    }[keyof AdminClient]

    // The walker finds the key in the generated type, so an empty result for the client is meaningful
    expectTypeOf<Priced<components['schemas']['LogRow']>>().toEqualTypeOf<'cost_charged'>()
    expectTypeOf<Priced<components['schemas']['SupplierPriceResponse']>>().toEqualTypeOf<
      'input_per_million' | 'output_per_million' | 'cached_input_per_million'
    >()
    expectTypeOf<[Every]>().toEqualTypeOf<[never]>()
  })
})

describeFake('admin path parameters', () => {
  it.each(['', '.', '..', '%2e%2E', '%2E.'])('rejects %j as a resource id without sending anything', async bad => {
    const { engine, ops } = admin()

    const results = [
      await ops.keys.revoke('o1', 'p1', bad),
      await ops.providerCredentials.delete('o1', bad),
      await ops.projects.get('o1', bad),
      await ops.orgs.getByReference(bad)
    ]

    for (const { data, error } of results) {
      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_request', type: 'client_error', retryable: false })
    }

    expect(engine.fake!.requests).toHaveLength(0)
  })

  it('encodes a non-ASCII external reference', async () => {
    const { engine, ops } = admin()

    await ops.orgs.getByReference('kopi-ü-日本-😀')

    expect(new URL(engine.fake!.requests[0]!.url).pathname).toBe(
      '/v1/orgs/by-reference/kopi-%C3%BC-%E6%97%A5%E6%9C%AC-%F0%9F%98%80'
    )
  })
})

describeFake('admin transport behaviour', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not retry a key issue after the network failed', async () => {
    const { engine, ops } = admin(2)

    engine.fake!.next({ networkError: true })
    const pending = ops.keys.create('o1', 'p1')

    await vi.runAllTimersAsync()

    expect((await pending).error).toMatchObject({ code: 'network_error' })
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it.each(['service_unavailable', 'upstream_unavailable'])('does not retry a project create on %s', async code => {
    const { engine, ops } = admin(2)

    engine.fake!.next(engineError(code))
    const pending = ops.projects.create('o1', { name: 'n' })

    await vi.runAllTimersAsync()

    expect((await pending).error?.code).toBe(code)
    expect(engine.fake!.requests).toHaveLength(1)
  })

  it('still retries a rate limit on a non-idempotent call: the request never ran', async () => {
    const { engine, ops } = admin(2)

    engine.fake!.next(engineError('rate_limited'))
    const pending = ops.keys.create('o1', 'p1')

    await vi.runAllTimersAsync()
    await pending

    expect(engine.fake!.requests).toHaveLength(2)
  })

  it('retries reads, and sends a replacing write once after the network failed (writes retry only on rate_limited)', async () => {
    const { engine, ops } = admin(2)

    engine.fake!.next(engineError('service_unavailable'), engineError('service_unavailable'))
    const read = ops.orgs.list()

    await vi.runAllTimersAsync()

    expect((await read).error).toBeNull()
    expect(engine.fake!.requests).toHaveLength(3)

    engine.fake!.next({ networkError: true })
    const write = ops.projectModels.put('o1', 'p1', { models: [] })

    await vi.runAllTimersAsync()
    expect((await write).error?.code).toBe('network_error')
    expect(engine.fake!.requests).toHaveLength(4)
  })

  it('retries organisation create only when an external reference makes it idempotent', async () => {
    const withReference = admin(2)

    withReference.engine.fake!.next({ networkError: true })
    const first = withReference.ops.orgs.create({ name: 'n', external_reference: 'ref-1' })

    await vi.runAllTimersAsync()
    expect((await first).error).toBeNull()
    expect(withReference.engine.fake!.requests).toHaveLength(2)

    const without = admin(2)

    without.engine.fake!.next({ networkError: true })
    const second = without.ops.orgs.create({ name: 'n' })

    await vi.runAllTimersAsync()
    expect((await second).error?.code).toBe('network_error')
    expect(without.engine.fake!.requests).toHaveLength(1)
  })

  it('sends the integrator key as a bearer token and no idempotency header', async () => {
    const { engine, ops } = admin()

    await ops.orgs.create({ name: 'n', external_reference: 'ref-2' })
    const [request] = engine.fake!.requests

    expect(request!.headers.get('authorization')).toBe(`Bearer ${engine.integratorKey}`)
    expect(request!.headers.get('idempotency-key')).toBeNull()
  })

  it('encodes every path parameter', async () => {
    const { engine, ops } = admin()

    await ops.orgs.getByReference('a/b?c=d#e f')
    await ops.projects.get('o/1', 'p?1')

    const urls = engine.fake!.requests.map(request => new URL(request.url))

    expect(urls[0]!.pathname).toBe('/v1/orgs/by-reference/a%2Fb%3Fc%3Dd%23e%20f')
    expect(urls[0]!.search).toBe('')
    expect(urls[1]!.pathname).toBe('/v1/orgs/o%2F1/projects/p%3F1')
  })

  it('encodes the query in one place and leaves undefined values out', async () => {
    const { engine, ops } = admin()

    await ops.logs.list({ project_id: 'p&1', page_size: 20, cursor: undefined })

    const url = new URL(engine.fake!.requests[0]!.url)

    expect(url.pathname).toBe('/v1/logs')
    expect(url.search).toBe('?project_id=p%261&page_size=20')
  })

  it('returns the key-issue secret once in data and logs nothing', async () => {
    const { ops } = admin()
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name => vi.spyOn(console, name))
    const { data: org } = await ops.orgs.create({ name: 'n', external_reference: 'ref-3' })
    const { data: project } = await ops.projects.create(org!.id, { name: 'p' })

    const { data } = await ops.keys.create(org!.id, project!.id)

    expect(data?.api_key).toEqual(expect.any(String))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('hides the issued key from inspection and logging, and keeps it in JSON, spreads and the field', async () => {
    const { ops } = admin()
    const { data: org } = await ops.orgs.create({ name: 'n', external_reference: 'ref-4' })
    const { data: project } = await ops.projects.create(org!.id, { name: 'p' })

    const result = await ops.keys.create(org!.id, project!.id)
    const key = result.data!.api_key

    // [1] Hidden: util.inspect and console.log's formatting, nested in the result too, and Deno's console
    for (const shown of [
      inspect(result.data),
      inspect(result, { depth: 5 }),
      format(result.data),
      format('%o', result)
    ]) {
      expect(shown).not.toContain(key)
      expect(shown).toContain('[redacted]')
    }

    const deno = (result.data as unknown as Record<symbol, (i: typeof inspect, o: object) => string>)[
      Symbol.for('Deno.customInspect')
    ]!

    expect(deno(inspect, {})).not.toContain(key)

    // [2] Kept, on purpose: a plain field (no getter), JSON, a spread, and no extra enumerable member
    expect(Object.getOwnPropertyDescriptor(result.data, 'api_key')).toMatchObject({ value: key, enumerable: true })
    expect(JSON.parse(JSON.stringify(result.data)).api_key).toBe(key)
    expect({ ...result.data }.api_key).toBe(key)
    expect(Object.keys({ ...result.data })).toEqual(Object.keys(result.data!))
  })
})

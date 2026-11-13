import type { paths } from './generated/admin'
import { withoutPrices, type WithoutPrices } from './internal/cost-opacity'
import { configError, fail, ok, type MeridianError, type Result } from './internal/errors'
import type { OkBody, RequestBody } from './internal/openapi'
import { refusedTransport } from './internal/refused'
import { refusal, urlRefusal } from './internal/runtime'
import { clientInfo } from './internal/client-info'
import { createTransport, type Call, type Transport } from './internal/transport'
import type { ClientOptions, RequestOptions } from './types'

type P = paths
type Body<Op> = RequestBody<Op>
type Query<Op> = Op extends { parameters: { query: infer Q } } ? Q : never

/** The reply, minus any price, cost, per-million or finance-rate field (D-27). The supplier-catalogue operations are not wrapped at all. */
type Out<Op> = Promise<Result<WithoutPrices<OkBody<Op>>>>
type Done = Promise<Result<null>>

/**
 * Provisioning with an integrator key (`gmi_`): the engine's wire shapes, snake_case. `orgs.create` is idempotent by
 * `external_reference`; `keys.create` returns the new `api_key` once, so store it. Inspection and logging hide it
 * (`util.inspect`, `console.log` and Deno's console show `'[redacted]'`); it stays a plain field, so `JSON.stringify`,
 * `%j` (as in `console.log('%j', data)` and `util.format`), a spread (`{ ...data }`) and JSON loggers such as pino or winston carry it, on purpose (the key has to reach your
 * store). Keep the result out of logs.
 */
export interface AdminClient {
  orgs: {
    create(body: Body<P['/v1/orgs']['post']>, o?: RequestOptions): Out<P['/v1/orgs']['post']>
    get(org: string, o?: RequestOptions): Out<P['/v1/orgs/{org}']['get']>
    getByReference(reference: string, o?: RequestOptions): Out<P['/v1/orgs/by-reference/{reference}']['get']>
    list(o?: RequestOptions): Out<P['/v1/orgs']['get']>
  }
  projects: {
    create(
      org: string,
      body: Body<P['/v1/orgs/{org}/projects']['post']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects']['post']>
    get(org: string, project: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/projects/{project}']['get']>
    list(org: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/projects']['get']>
    update(
      org: string,
      project: string,
      body: Body<P['/v1/orgs/{org}/projects/{project}']['patch']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects/{project}']['patch']>
    delete(org: string, project: string, o?: RequestOptions): Done
  }
  keys: {
    create(
      org: string,
      project: string,
      body?: Body<P['/v1/orgs/{org}/projects/{project}/keys']['post']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects/{project}/keys']['post']>
    list(org: string, project: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/projects/{project}/keys']['get']>
    revoke(org: string, project: string, key: string, o?: RequestOptions): Done
  }
  providerCredentials: {
    list(org: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/provider-credentials']['get']>
    put(
      org: string,
      provider: string,
      body: Body<P['/v1/orgs/{org}/provider-credentials/{provider}']['put']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/provider-credentials/{provider}']['put']>
    delete(org: string, provider: string, o?: RequestOptions): Done
  }

  /** The providers this engine takes an organisation's own key for, in display order; any other is refused. */
  byokProviders: {
    list(o?: RequestOptions): Out<P['/v1/byok/providers']['get']>
  }

  /**
   * The organisation's routing policy, the default every Project inherits: `prefer` uses the organisation's keys and
   * falls back to Gaussian's (charged), `require` uses the organisation's keys only, `self_hosted_only` serves only
   * `self/<endpoint>/<model>` and refuses every other model.
   */
  byokPolicy: {
    get(org: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/byok-policy']['get']>
    put(
      org: string,
      body: Body<P['/v1/orgs/{org}/byok-policy']['put']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/byok-policy']['put']>
  }

  /**
   * One Project's routing policy: its own choice (`null` inherits the organisation's), the policy in effect and the
   * organisation default. `put` takes `{ policy: null }` to inherit again.
   */
  projectByokPolicy: {
    get(
      org: string,
      project: string,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects/{project}/byok-policy']['get']>
    put(
      org: string,
      project: string,
      body: Body<P['/v1/orgs/{org}/projects/{project}/byok-policy']['put']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects/{project}/byok-policy']['put']>
  }

  /** The organisation's own OpenAI-compatible servers, called as `self/<name>/<model>`. A key is never echoed. */
  providerEndpoints: {
    list(org: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/provider-endpoints']['get']>
    put(
      org: string,
      name: string,
      body: Body<P['/v1/orgs/{org}/provider-endpoints/{name}']['put']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/provider-endpoints/{name}']['put']>
    check(
      org: string,
      name: string,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/provider-endpoints/{name}/check']['post']>
    delete(org: string, name: string, o?: RequestOptions): Done
  }
  projectModels: {
    get(org: string, project: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/projects/{project}/models']['get']>
    put(
      org: string,
      project: string,
      body: Body<P['/v1/orgs/{org}/projects/{project}/models']['put']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects/{project}/models']['put']>
  }
  models: {
    list(o?: RequestOptions): Out<P['/v1/catalogue/models']['get']>
    get(model: string, o?: RequestOptions): Out<P['/v1/catalogue/models/{model}']['get']>
  }
  analytics: {
    usage(query: Query<P['/v1/analytics/usage']['get']>, o?: RequestOptions): Out<P['/v1/analytics/usage']['get']>
  }
  logs: {
    list(query: Query<P['/v1/logs']['get']>, o?: RequestOptions): Out<P['/v1/logs']['get']>
  }
}

/** A route: the path to call, or the reason a parameter cannot be part of one. */
type Route = string | MeridianError

/** A parameter as written and after one percent-decode. */
function spellings(value: string | number): string[] {
  const text = String(value)

  try {
    return [text, decodeURIComponent(text)]
  } catch {
    // Not valid percent-encoding: the raw text is what gets encoded below
    return [text]
  }
}

/** True for a parameter that would climb to, or collapse into, another resource's route. */
const isUnsafeSegment = (value: string | number) =>
  spellings(value).some(candidate => candidate === '' || candidate === '.' || candidate === '..')

/**
 * A path with every interpolated value encoded as one segment. An empty or dot segment is refused, never sent; so is
 * an organisation id that reads as `by-reference` (it would reach the by-reference route instead).
 */
function path(strings: TemplateStringsArray, ...values: (string | number)[]): Route {
  if (values.some(isUnsafeSegment)) return configError('A resource id must not be empty, "." or "..".')

  const byReference = values.some(
    (value, i) => strings[i]!.endsWith('/v1/orgs/') && spellings(value).includes('by-reference')
  )

  if (byReference) return configError('An organisation id must not be "by-reference".')

  return strings.reduce((out, part, i) => out + part + (i < values.length ? encodeURIComponent(values[i]!) : ''), '')
}

/**
 * Hides an issued `api_key` from inspection and logging: `util.inspect`, `console.log` (Node, Bun) and Deno's console
 * show `'[redacted]'`. Through non-enumerable symbol members only, so the field stays a plain value: `JSON.stringify`,
 * `%j`, a spread and JSON loggers (pino, winston) keep the key, on purpose.
 */
function redactKey<T>(result: Result<T>): Result<T> {
  const data = result.data as Record<string, unknown> | null

  if (typeof data?.api_key !== 'string') return result
  const shown = () => ({ ...data, api_key: '[redacted]' })

  Object.defineProperties(data, {
    [Symbol.for('nodejs.util.inspect.custom')]: { value: shown },
    [Symbol.for('Deno.customInspect')]: {
      value: (inspect: (value: unknown, options?: unknown) => string, options?: unknown) => inspect(shown(), options)
    }
  })

  return result
}

function createAdminApi(transport: Transport): AdminClient {
  // [1] One call: the reply loses any price or cost field before the caller sees it
  const send = async <T>(call: Omit<Call, 'path'> & { path: Route }, o: RequestOptions = {}): Promise<Result<T>> => {
    if (typeof call.path !== 'string') return fail(call.path)

    const result = await transport.json<T>({ ...call, path: call.path, signal: o.signal })

    return result.error ? result : ok(withoutPrices(result.data) as T)
  }

  // [2] The transport decides what may be repeated (mayRepeat): reads and deletes; writes only after a rate limit,
  //     except an organisation create with a reference, which the engine replays
  const read = <T>(url: Route, o?: RequestOptions, query?: Call['query']) =>
    send<T>({ method: 'GET', path: url, query }, o)

  const write = <T>(method: Call['method'], url: Route, body: unknown, o?: RequestOptions, repeatable = false) =>
    send<T>({ method, path: url, body, repeatable }, o)

  const remove = (url: Route, o?: RequestOptions) => send<null>({ method: 'DELETE', path: url }, o)

  return {
    orgs: {
      create: (body, o) =>
        write(
          'POST',
          '/v1/orgs',
          body,
          o,
          typeof body.external_reference === 'string' && body.external_reference.trim() !== ''
        ),
      get: (org, o) => read(path`/v1/orgs/${org}`, o),
      getByReference: (reference, o) => read(path`/v1/orgs/by-reference/${reference}`, o),
      list: o => read('/v1/orgs', o)
    },
    projects: {
      create: (org, body, o) => write('POST', path`/v1/orgs/${org}/projects`, body, o),
      get: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}`, o),
      list: (org, o) => read(path`/v1/orgs/${org}/projects`, o),
      update: (org, project, body, o) => write('PATCH', path`/v1/orgs/${org}/projects/${project}`, body, o),
      delete: (org, project, o) => remove(path`/v1/orgs/${org}/projects/${project}`, o)
    },
    keys: {
      create: async (org, project, body, o) =>
        redactKey(await write('POST', path`/v1/orgs/${org}/projects/${project}/keys`, body ?? {}, o)),
      list: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}/keys`, o),
      revoke: (org, project, key, o) => remove(path`/v1/orgs/${org}/projects/${project}/keys/${key}`, o)
    },
    providerCredentials: {
      list: (org, o) => read(path`/v1/orgs/${org}/provider-credentials`, o),
      put: (org, provider, body, o) => write('PUT', path`/v1/orgs/${org}/provider-credentials/${provider}`, body, o),
      delete: (org, provider, o) => remove(path`/v1/orgs/${org}/provider-credentials/${provider}`, o)
    },
    byokProviders: { list: o => read('/v1/byok/providers', o) },
    byokPolicy: {
      get: (org, o) => read(path`/v1/orgs/${org}/byok-policy`, o),
      put: (org, body, o) => write('PUT', path`/v1/orgs/${org}/byok-policy`, body, o)
    },
    projectByokPolicy: {
      get: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}/byok-policy`, o),
      put: (org, project, body, o) => write('PUT', path`/v1/orgs/${org}/projects/${project}/byok-policy`, body, o)
    },
    providerEndpoints: {
      list: (org, o) => read(path`/v1/orgs/${org}/provider-endpoints`, o),
      put: (org, name, body, o) => write('PUT', path`/v1/orgs/${org}/provider-endpoints/${name}`, body, o),
      check: (org, name, o) => write('POST', path`/v1/orgs/${org}/provider-endpoints/${name}/check`, undefined, o),
      delete: (org, name, o) => remove(path`/v1/orgs/${org}/provider-endpoints/${name}`, o)
    },
    projectModels: {
      get: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}/models`, o),
      put: (org, project, body, o) => write('PUT', path`/v1/orgs/${org}/projects/${project}/models`, body, o)
    },
    models: {
      list: o => read('/v1/catalogue/models', o),
      get: (model, o) => read(path`/v1/catalogue/models/${model}`, o)
    },
    analytics: { usage: (query, o) => read('/v1/analytics/usage', o, query) },
    logs: { list: (query, o) => read('/v1/logs', o, query) }
  }
}

/** The admin client: provisioning with a `gmi_` integrator key on the engine's admin listener. Never runs in a browser. */
export function createAdminClient(adminUrl: string, integratorKey: string, options: ClientOptions = {}): AdminClient {
  // [1] Refuse where the key would leak, or when the client cannot work at all
  const refused =
    refusal('createAdminClient', null) ??
    urlRefusal(adminUrl, 'The Meridian admin URL') ??
    (integratorKey ? null : configError('A Meridian integrator key is required.'))

  // [2] A refused client keeps its whole shape; every call answers the same error value
  return createAdminApi(
    refused
      ? refusedTransport(refused)
      : createTransport({ baseUrl: adminUrl, key: integratorKey, clientInfo: clientInfo(), ...options })
  )
}

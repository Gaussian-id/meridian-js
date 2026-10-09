import type { paths } from './generated/admin'
import { withoutPrices, type WithoutPrices } from './internal/cost-opacity'
import { configError, fail, ok, type MeridianError, type Result } from './internal/errors'
import type { OkBody, RequestBody } from './internal/openapi'
import { refusedTransport } from './internal/refused'
import { refusal, urlRefusal } from './internal/runtime'
import { createTransport, type Call, type Transport } from './internal/transport'
import type { ClientOptions, RequestOptions } from './types'

type P = paths
type Body<Op> = RequestBody<Op>
type Query<Op> = Op extends { parameters: { query: infer Q } } ? Q : never

/** The reply, minus any price or cost field (D-27). */
type Out<Op> = Promise<Result<WithoutPrices<OkBody<Op>>>>
type Done = Promise<Result<null>>

/** Provisioning with an integrator key (`gmi_`): the engine's wire shapes, snake_case. `orgs.create` is idempotent by `external_reference`; `keys.create` returns the new `api_key` once, so store it. */
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
  projectModels: {
    get(org: string, project: string, o?: RequestOptions): Out<P['/v1/orgs/{org}/projects/{project}/models']['get']>
    put(
      org: string,
      project: string,
      body: Body<P['/v1/orgs/{org}/projects/{project}/models']['put']>,
      o?: RequestOptions
    ): Out<P['/v1/orgs/{org}/projects/{project}/models']['put']>
  }
  catalogue: {
    list(o?: RequestOptions): Out<P['/v1/catalogue']['get']>
    get(version: number, o?: RequestOptions): Out<P['/v1/catalogue/{version}']['get']>
  }
  models: {
    list(o?: RequestOptions): Out<P['/v1/models']['get']>
    get(model: string, o?: RequestOptions): Out<P['/v1/models/{model}']['get']>
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

/** True for a parameter that would climb to, or collapse into, another resource's route. */
function isUnsafeSegment(value: string | number): boolean {
  const text = String(value)
  let decoded = text

  try {
    decoded = decodeURIComponent(text)
  } catch {
    // Not valid percent-encoding: the raw text is what gets encoded below
  }

  return [text, decoded].some(candidate => candidate === '' || candidate === '.' || candidate === '..')
}

/** A path with every interpolated value encoded as one segment; an empty or dot segment is refused, never sent. */
function path(strings: TemplateStringsArray, ...values: (string | number)[]): Route {
  if (values.some(isUnsafeSegment)) return configError('A resource id must not be empty, "." or "..".')

  return strings.reduce((out, part, i) => out + part + (i < values.length ? encodeURIComponent(values[i]!) : ''), '')
}

function createAdminApi(transport: Transport): AdminClient {
  // [1] One call: the reply loses any price or cost field before the caller sees it
  const send = async <T>(call: Omit<Call, 'path'> & { path: Route }, o: RequestOptions = {}): Promise<Result<T>> => {
    if (typeof call.path !== 'string') return fail(call.path)

    const result = await transport.json<T>({ ...call, path: call.path, signal: o.signal })

    return result.error ? result : ok(withoutPrices(result.data) as T)
  }

  // [2] Reads, replaces and deletes are safe to repeat; a create is not, unless the caller says otherwise
  const read = <T>(url: Route, o?: RequestOptions, query?: Call['query']) =>
    send<T>({ method: 'GET', path: url, query }, o)

  const write = <T>(method: Call['method'], url: Route, body: unknown, o?: RequestOptions, retry = false) =>
    send<T>({ method, path: url, body, retry }, o)

  const remove = (url: Route, o?: RequestOptions) => send<null>({ method: 'DELETE', path: url }, o)

  return {
    orgs: {
      create: (body, o) => write('POST', '/v1/orgs', body, o, Boolean(body.external_reference)),
      get: (org, o) => read(path`/v1/orgs/${org}`, o),
      getByReference: (reference, o) => read(path`/v1/orgs/by-reference/${reference}`, o),
      list: o => read('/v1/orgs', o)
    },
    projects: {
      create: (org, body, o) => write('POST', path`/v1/orgs/${org}/projects`, body, o),
      get: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}`, o),
      list: (org, o) => read(path`/v1/orgs/${org}/projects`, o),
      update: (org, project, body, o) => write('PATCH', path`/v1/orgs/${org}/projects/${project}`, body, o, true),
      delete: (org, project, o) => remove(path`/v1/orgs/${org}/projects/${project}`, o)
    },
    keys: {
      create: (org, project, body, o) => write('POST', path`/v1/orgs/${org}/projects/${project}/keys`, body ?? {}, o),
      list: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}/keys`, o),
      revoke: (org, project, key, o) => remove(path`/v1/orgs/${org}/projects/${project}/keys/${key}`, o)
    },
    providerCredentials: {
      list: (org, o) => read(path`/v1/orgs/${org}/provider-credentials`, o),
      put: (org, provider, body, o) =>
        write('PUT', path`/v1/orgs/${org}/provider-credentials/${provider}`, body, o, true),
      delete: (org, provider, o) => remove(path`/v1/orgs/${org}/provider-credentials/${provider}`, o)
    },
    projectModels: {
      get: (org, project, o) => read(path`/v1/orgs/${org}/projects/${project}/models`, o),
      put: (org, project, body, o) => write('PUT', path`/v1/orgs/${org}/projects/${project}/models`, body, o, true)
    },
    catalogue: {
      list: o => read('/v1/catalogue', o),
      get: (version, o) => read(path`/v1/catalogue/${version}`, o)
    },
    models: {
      list: o => read('/v1/models', o),
      get: (model, o) => read(path`/v1/models/${model}`, o)
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
    refused ? refusedTransport(refused) : createTransport({ baseUrl: adminUrl, key: integratorKey, ...options })
  )
}

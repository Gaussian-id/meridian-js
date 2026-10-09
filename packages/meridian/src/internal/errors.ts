/** The engine's 28 error codes (meridian-domain/src/error.rs:109-136). Task 9 checks this list against the spec. */
export const ENGINE_ERROR_CODES = [
  'invalid_request',
  'invalid_api_key',
  'key_revoked',
  'key_expired',
  'project_unavailable',
  'organisation_unavailable',
  'model_not_allowed',
  'byok_required',
  'project_host_mismatch',
  'model_not_found',
  'route_not_found',
  'method_not_allowed',
  'capability_unsupported',
  'body_too_large',
  'rate_limited',
  'insufficient_credit',
  'hard_limit_reached',
  'entitlement_missing',
  'idempotency_conflict',
  'upstream_unavailable',
  'upstream_error',
  'deadline_exceeded',
  'service_unavailable',
  'internal',
  'invalid_token',
  'permission_denied',
  'not_found',
  'conflict'
] as const

/**
 * Codes that mean the app's own key or account was refused. A forwarding route never shows them to a browser
 * (owner decision, 10 Oct). Shared by the core handler and the framework packages built on it.
 */
export const HIDDEN_FORWARD_CODES = [
  'invalid_api_key',
  'key_revoked',
  'key_expired',
  'project_unavailable',
  'organisation_unavailable',
  'project_host_mismatch',
  'byok_required',
  'insufficient_credit',
  'hard_limit_reached',
  'entitlement_missing'
] as const satisfies readonly (typeof ENGINE_ERROR_CODES)[number][]

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number]
export type MeridianErrorCode = EngineErrorCode | 'network_error' | 'aborted'
export type MeridianErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'rate_limit_error'
  | 'api_error'
  | 'client_error'

export interface MeridianError {
  code: MeridianErrorCode
  type: MeridianErrorType
  status: number
  message: string
  retryable: boolean
  requestId?: string
}

export type Result<T> = { data: T; error: null } | { data: null; error: MeridianError }

export interface EngineEnvelope {
  error: { message: string; type: string; code: string; request_id?: string; retryable?: boolean }
}

/** HTTP status per code (meridian-domain/src/error.rs:142-164). */
export const STATUS_BY_CODE: Record<EngineErrorCode, number> = {
  invalid_request: 400,
  capability_unsupported: 400,
  invalid_api_key: 401,
  key_revoked: 401,
  key_expired: 401,
  invalid_token: 401,
  insufficient_credit: 402,
  project_unavailable: 403,
  organisation_unavailable: 403,
  model_not_allowed: 403,
  byok_required: 403,
  project_host_mismatch: 403,
  permission_denied: 403,
  entitlement_missing: 403,
  model_not_found: 404,
  route_not_found: 404,
  not_found: 404,
  method_not_allowed: 405,
  idempotency_conflict: 409,
  conflict: 409,
  body_too_large: 413,
  rate_limited: 429,
  hard_limit_reached: 429,
  internal: 500,
  upstream_unavailable: 502,
  upstream_error: 502,
  service_unavailable: 503,
  deadline_exceeded: 504
}

const KNOWN_CODES = new Set<string>([...ENGINE_ERROR_CODES, 'network_error', 'aborted'])

const KNOWN_TYPES = new Set<string>([
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'api_error',
  'client_error'
])

const RETRYABLE = new Set<string>([
  'rate_limited',
  'upstream_unavailable',
  'service_unavailable',
  'deadline_exceeded',
  'network_error'
])

export const ok = <T>(data: T): Result<T> => ({ data, error: null })
export const fail = <T = never>(error: MeridianError): Result<T> => ({ data: null, error })

export function clientError(code: 'network_error' | 'aborted', message: string, status = 0): MeridianError {
  return { code, type: 'client_error', status, message, retryable: code === 'network_error' }
}

/** A mistake in how the SDK was set up: never sent, never retried. */
export function configError(message: string): MeridianError {
  return { code: 'invalid_request', type: 'client_error', status: 0, message, retryable: false }
}

export function parseEnvelope(text: string): EngineEnvelope | null {
  if (!text) return null

  try {
    const value = JSON.parse(text) as { error?: { code?: unknown; message?: unknown; type?: unknown } }
    const error = value?.error

    return typeof error?.code === 'string' && typeof error.message === 'string' ? (value as EngineEnvelope) : null
  } catch {
    return null
  }
}

export function errorFromEnvelope(envelope: EngineEnvelope, status?: number): MeridianError {
  // [1] A code this SDK does not know (a newer engine) is reported as internal, never dropped
  const known = KNOWN_CODES.has(envelope.error.code)
  const code = (known ? envelope.error.code : 'internal') as MeridianErrorCode
  const type = (KNOWN_TYPES.has(envelope.error.type) ? envelope.error.type : 'api_error') as MeridianErrorType

  // [2] The status comes from the response, or from the code when the error arrived in a stream frame
  const resolved = status ?? (code in STATUS_BY_CODE ? STATUS_BY_CODE[code as EngineErrorCode] : 0)

  return {
    code,
    type,
    status: resolved,
    message: envelope.error.message,

    // A forwarding route marks its generic errors retryable:false, so a browser does not hammer an app that is out of credit
    retryable: envelope.error.retryable === false ? false : RETRYABLE.has(code),
    ...(envelope.error.request_id ? { requestId: envelope.error.request_id } : {})
  }
}

export async function errorFromResponse(response: Response, aborted?: () => boolean): Promise<MeridianError> {
  // [1] Read the body once; a body that cannot be read counts as empty
  const headerId = response.headers.get('x-request-id') ?? undefined
  let text = ''

  try {
    text = await response.text()
  } catch {
    if (aborted?.()) return clientError('aborted', 'The request was aborted.')
  }

  const envelope = parseEnvelope(text)

  // [2] Meridian's own envelope
  if (envelope) {
    const error = errorFromEnvelope(envelope, response.status)

    return error.requestId || !headerId ? error : { ...error, requestId: headerId }
  }

  // [3] Anything else (a proxy page, an empty body) is a transport failure with the real status
  return {
    ...clientError(
      'network_error',
      `Unexpected ${response.status} response that is not a Meridian error.`,
      response.status
    ),
    retryable: response.status === 429 || response.status >= 500,
    ...(headerId ? { requestId: headerId } : {})
  }
}

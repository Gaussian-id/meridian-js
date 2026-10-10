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

  /** The engine's own code when this SDK does not recognise it (`code` is then `internal`); absent otherwise. */
  engineCode?: string

  /** The response's `Retry-After`, when it was valid (delta-seconds or an HTTP date), as sent but trimmed. */
  retryAfter?: string
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

const REQUEST_ID = /^[!-~](?:[ -~]{0,253}[!-~])?$/

/**
 * A request id fit for a header and a body: 1-255 printable ASCII characters, never a line break, and never a space
 * first or last (a server strips those from a header, which would change the id). Anything else is undefined.
 */
export function validRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
const TIME = '\\d{2}:\\d{2}:\\d{2}'

// The three HTTP date forms (RFC 9110 5.6.7): IMF-fixdate, RFC 850 and asctime
const HTTP_DATE = new RegExp(
  `^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \\d{2} ${MONTH} \\d{4} ${TIME} GMT` +
    `|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \\d{2}-${MONTH}-\\d{2} ${TIME} GMT` +
    `|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ${MONTH} [ \\d]\\d ${TIME} \\d{4})$`
)

/** A `Retry-After` worth handing on, trimmed: delta-seconds or an HTTP date. Anything else is undefined; never throws. */
export function validRetryAfter(value: string | null | undefined): string | undefined {
  const text = (value ?? '').trim()

  if (/^\d+$/.test(text) && text.length <= 255) return text

  return HTTP_DATE.test(text) && Number.isFinite(Date.parse(text)) ? text : undefined
}

/** What error_member gives for an error member that cannot be read. */
export const MALFORMED = Symbol('malformed')

// The members the SDK reads by name: at the top level of a reply, an envelope or a frame, and inside its error object.
// A member spelled in another letter case would be read by a case-insensitive decoder (Go's encoding/json) as the
// real one, so a body holding one can be read two ways and is never judged
const TOP_LEVEL = ['error', 'choices']
const INSIDE_ERROR = ['message', 'type', 'code', 'request_id']

// Upper then lower folds what Go's EqualFold folds (the long s and the Kelvin sign too) and a little more (ß, the
// dotless i): reading more keys as variants can only fail closed
const fold = (key: string) => key.toUpperCase().toLowerCase()

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasCaseVariant = (fields: Record<string, unknown>, names: string[]) =>
  Object.keys(fields).some(key => !names.includes(key) && names.includes(fold(key)))

/**
 * What a decoded reply or frame says through its top-level `error` member: null when it has none (absent or null),
 * the error object when it is one, and MALFORMED when it is anything else or a member the SDK reads comes in a case
 * variant (`Error`, `CHOICES`, or `Code` inside the error object). Nested content is never inspected.
 */
export function errorMember(value: unknown): Record<string, unknown> | typeof MALFORMED | null {
  // [1] Only an object has members; a case variant at the top level fails closed whatever the error member holds
  if (!isObject(value)) return null
  if (hasCaseVariant(value, TOP_LEVEL)) return MALFORMED

  // [2] No error, a readable error object, or something that cannot be read as one
  const error = value.error

  if (error === null || error === undefined) return null

  return isObject(error) && !hasCaseVariant(error, INSIDE_ERROR) ? error : MALFORMED
}

/** The engine's envelope in a text: an error object with a non-empty string code and a string message; else null. */
export function parseEnvelope(text: string): EngineEnvelope | null {
  if (!text) return null
  let member: ReturnType<typeof errorMember>

  try {
    member = errorMember(JSON.parse(text))
  } catch {
    return null
  }

  if (member === null || member === MALFORMED) return null

  return typeof member.code === 'string' && member.code !== '' && typeof member.message === 'string'
    ? ({ error: member } as unknown as EngineEnvelope)
    : null
}

export function errorFromEnvelope(envelope: EngineEnvelope, status?: number): MeridianError {
  // [1] A code this SDK does not know (a newer engine) is reported as internal, its own code kept apart
  const known = Object.hasOwn(STATUS_BY_CODE, envelope.error.code)
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
    ...(envelope.error.request_id ? { requestId: envelope.error.request_id } : {}),
    ...(known ? {} : { engineCode: envelope.error.code })
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

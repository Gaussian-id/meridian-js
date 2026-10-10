import {
  clientError,
  configError,
  errorFromResponse,
  errorMember,
  fail,
  MALFORMED,
  NOT_JSON,
  ok,
  readCapped,
  strictJson,
  validRequestId,
  validRetryAfter,
  type MeridianError,
  type Result
} from './errors'

export interface TransportConfig {
  baseUrl: string
  key?: string
  fetch?: typeof fetch
  timeout?: number
  maxRetries?: number
}

export interface Call {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string

  /** Query parameters, encoded once here; `undefined` values are left out. */
  query?: Record<string, string | number | undefined>
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>

  /** True: repeating the call is harmless although it is a write with no idempotency key (see mayRepeat). */
  repeatable?: boolean

  /** This call's own default wait for response headers, in ms; a caller's `timeout` option overrides it. */
  defaultTimeout?: number
}

export interface Opened {
  response: Response

  /** Stop listening to the caller's signal once the body is finished. */
  release: () => void

  /** Cancel the request upstream. */
  abort: () => void
}

export interface Transport {
  json<T>(call: Call): Promise<Result<T>>
  open(call: Call): Promise<Result<Opened>>
}

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_RETRIES = 2
const BASE_DELAY_MS = 500
const MAX_JITTER_MS = 250
const MAX_RETRY_AFTER_MS = 30_000

/** A buffered reply is read this far; a body over its cap is refused, never truncated (meridian-go's limit). */
const MAX_REPLY_BYTES = 64 * 1024 * 1024

/**
 * Whether a call that may have reached the server may be sent again. The one place this is decided: a read or a
 * delete can be repeated; so can a call that carries an idempotency key (the engine replays it) or is marked
 * `repeatable`. Every other call (a write the engine would run twice) is repeated only after a rate limit, which
 * means the engine did not run it.
 */
function mayRepeat(call: Call): boolean {
  return (
    call.repeatable === true ||
    call.headers?.['idempotency-key'] !== undefined ||
    call.method === 'GET' ||
    call.method === 'DELETE'
  )
}

/** Waits `ms`; false when the caller aborted first. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false)

    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

type Attempt =
  { kind: 'response'; opened: Opened } | { kind: 'error'; error: MeridianError; retryAfterMs: number | null }

/** A reply the SDK cannot use: a network error with its status and its header's request id (when valid). */
function unusable(response: Response, message: string): MeridianError {
  const requestId = validRequestId(response.headers.get('x-request-id'))

  return { ...clientError('network_error', message, response.status), ...(requestId ? { requestId } : {}) }
}

export function createTransport(config: TransportConfig): Transport {
  // The caller's timeout applies to every call; without one, each call has its own default
  const givenTimeout = Number.isFinite(config.timeout) && config.timeout! > 0 ? config.timeout! : null
  const base = config.baseUrl.replace(/\/+$/, '')

  const maxRetries = Number.isFinite(config.maxRetries)
    ? Math.max(0, Math.floor(config.maxRetries!))
    : DEFAULT_MAX_RETRIES

  function urlFor(call: Call): string {
    const query = new URLSearchParams()

    for (const [name, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined) query.set(name, String(value))
    }

    const text = query.toString()

    return `${base}${call.path}${text ? `?${text}` : ''}`
  }

  function headersFor(call: Call): Headers {
    const headers = new Headers({ accept: 'application/json, text/event-stream', ...call.headers })

    if (call.body !== undefined) headers.set('content-type', 'application/json')
    if (config.key) headers.set('authorization', `Bearer ${config.key}`)

    return headers
  }

  async function attempt(call: Call): Promise<Attempt> {
    // [0] Resolve fetch at call time, so a missing fetch is an error value and never a throw
    const send = config.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)

    if (!send) {
      return {
        kind: 'error',
        error: configError('No fetch is available in this runtime. Pass one with the `fetch` option.'),
        retryAfterMs: null
      }
    }

    // [1] A deadline for this attempt, joined to the caller's signal
    const timeout = givenTimeout ?? call.defaultTimeout ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)

    const onAbort = () => controller.abort()

    call.signal?.addEventListener('abort', onAbort, { once: true })

    const release = () => {
      clearTimeout(timer)
      call.signal?.removeEventListener('abort', onAbort)
    }

    if (call.signal?.aborted) {
      release()

      return { kind: 'error', error: clientError('aborted', 'The request was aborted.'), retryAfterMs: null }
    }

    try {
      // [2] Send the request
      const response = await send(urlFor(call), {
        method: call.method,
        headers: headersFor(call),
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
        signal: controller.signal
      })

      // [3] Headers arrived: the deadline no longer applies; the caller's signal still does
      clearTimeout(timer)

      if (response.ok) return { kind: 'response', opened: { response, release, abort: () => controller.abort() } }
      const error = await errorFromResponse(response, () => call.signal?.aborted === true || controller.signal.aborted)

      release()
      const retryAfter = response.headers.get('retry-after')
      const valid = validRetryAfter(retryAfter)

      return {
        kind: 'error',
        error: valid ? { ...error, retryAfter: valid } : error,
        retryAfterMs: retryAfterMs(retryAfter)
      }
    } catch {
      // [4] No response: aborted by the caller, timed out, or the network failed
      release()
      if (call.signal?.aborted)
        return { kind: 'error', error: clientError('aborted', 'The request was aborted.'), retryAfterMs: null }
      const message = timedOut ? `No response within ${timeout} ms.` : 'The network request failed.'

      return { kind: 'error', error: clientError('network_error', message), retryAfterMs: null }
    }
  }

  async function run(call: Call): Promise<Attempt> {
    let previous: MeridianError | null = null

    for (let tried = 0; ; tried++) {
      const outcome = await attempt(call)

      if (outcome.kind === 'response') return outcome

      // [1] A retry that finds its own key in use: the attempt before it reached the engine, which still holds the
      //     key, and failed; that failure is the answer. Not after a rate limit: the engine releases a key it refused
      //     before running the attempt, so a conflict then is a real one
      const before: MeridianError | null = previous

      previous = outcome.error

      if (
        before !== null &&
        call.headers?.['idempotency-key'] !== undefined &&
        outcome.error.code === 'idempotency_conflict' &&
        before.code !== 'rate_limited'
      ) {
        return { ...outcome, error: before }
      }

      // [2] A final error, a spent budget, or a call unsafe to repeat (unless the server refused it before running it)
      if (!outcome.error.retryable || tried >= maxRetries) return outcome
      if (!mayRepeat(call) && outcome.error.code !== 'rate_limited') return outcome

      // [3] A server asking for a long wait gets its answer now, not after the wait
      if (outcome.retryAfterMs !== null && outcome.retryAfterMs > MAX_RETRY_AFTER_MS) return outcome

      // [4] Wait as asked, or back off with jitter; an abort ends the wait
      const delay = outcome.retryAfterMs ?? BASE_DELAY_MS * 2 ** tried + Math.floor(Math.random() * MAX_JITTER_MS)

      if (!(await sleep(delay, call.signal))) {
        return { kind: 'error', error: clientError('aborted', 'The request was aborted.'), retryAfterMs: null }
      }
    }
  }

  return {
    async json<T>(call: Call): Promise<Result<T>> {
      const outcome = await run(call)

      if (outcome.kind === 'error') return fail(outcome.error)
      const { response, release } = outcome.opened

      // [1] No content: null for a DELETE, which expects it; a failure for every other call
      if (response.status === 204) {
        release()

        return call.method === 'DELETE'
          ? ok(null as T)
          : fail(unusable(response, 'The engine answered with no content, which this call does not expect.'))
      }

      // [2] Read the body up to its cap; a body that drops mid-read or is too large is a transport failure
      let raw: Uint8Array | null

      try {
        raw = await readCapped(response.body, MAX_REPLY_BYTES)
      } catch {
        release()

        return fail(
          call.signal?.aborted
            ? clientError('aborted', 'The request was aborted.')
            : unusable(response, 'The connection dropped while reading the response body.')
        )
      }

      release()
      if (raw === null) return fail(unusable(response, 'The reply was larger than the SDK accepts.'))

      // [3] Strict JSON (no NaN, Infinity or 1e999), never a literal null
      const data = strictJson(new TextDecoder().decode(raw))

      if (data === NOT_JSON) return fail(unusable(response, 'The response was not valid JSON.'))
      if (data === null) return fail(unusable(response, 'The response was empty (JSON null).'))

      // [4] A reply that says `error` is no result, whatever else it holds (a case variant of a member the SDK reads
      //     included). The error's own request id is kept when it is fit to show, else the response's
      const member = errorMember(data)

      if (member !== null) {
        const own = member === MALFORMED ? undefined : validRequestId(member.request_id)
        const error = unusable(response, "The engine's reply carried an error instead of a result.")

        return fail(own ? { ...error, requestId: own } : error)
      }

      return ok((call.method === 'DELETE' ? null : data) as T)
    },

    async open(call: Call): Promise<Result<Opened>> {
      const outcome = await run(call)

      return outcome.kind === 'error' ? fail(outcome.error) : ok(outcome.opened)
    }
  }
}

/** `Retry-After` as delta-seconds or an HTTP date, in milliseconds; null when absent or unreadable. Never throws. */
export function retryAfterMs(value: string | null): number | null {
  const text = (value ?? '').trim()

  // Plain decimal seconds (a number too large is Infinity: a wait too long to take)
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000
  if (validRetryAfter(text) === undefined) return null

  return Math.max(0, Date.parse(text) - Date.now())
}

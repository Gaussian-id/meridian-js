import { clientError, configError, errorFromResponse, fail, ok, type MeridianError, type Result } from './errors'

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

  /**
   * False for a call that is not safe to repeat once it may have reached the server: it is then retried only when the
   * server rejected it before running it (`rate_limited`). Default true.
   */
  retry?: boolean
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

export function createTransport(config: TransportConfig): Transport {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS
  const base = config.baseUrl.replace(/\/+$/, '')
  const maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES)

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

      return { kind: 'error', error, retryAfterMs: retryAfterMs(response.headers.get('retry-after')) }
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
    for (let tried = 0; ; tried++) {
      const outcome = await attempt(call)

      // [1] A response, a final error, or a spent budget ends the loop
      if (outcome.kind === 'response' || !outcome.error.retryable || tried >= maxRetries) return outcome

      // A call that is unsafe to repeat is retried only when the server refused it before running it
      if (call.retry === false && outcome.error.code !== 'rate_limited') return outcome

      // [2] A server asking for a long wait gets its answer now, not after the wait
      if (outcome.retryAfterMs !== null && outcome.retryAfterMs > MAX_RETRY_AFTER_MS) return outcome

      // [3] Wait as asked, or back off with jitter; an abort ends the wait
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

      // [1] No content is null data
      if (response.status === 204) {
        release()

        return ok(null as T)
      }

      // [2] Parse the body; a body that is not JSON is a transport failure
      let text: string

      try {
        text = await response.text()
      } catch {
        release()

        return fail(
          call.signal?.aborted
            ? clientError('aborted', 'The request was aborted.')
            : clientError('network_error', 'The connection dropped while reading the response body.', response.status)
        )
      }

      release()

      try {
        return ok(JSON.parse(text) as T)
      } catch {
        return fail(clientError('network_error', 'The response was not valid JSON.', response.status))
      }
    },

    async open(call: Call): Promise<Result<Opened>> {
      const outcome = await run(call)

      return outcome.kind === 'error' ? fail(outcome.error) : ok(outcome.opened)
    }
  }
}

/** `Retry-After` in seconds or as an HTTP date, in milliseconds; null when absent or unreadable. */
export function retryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)

  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)

  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

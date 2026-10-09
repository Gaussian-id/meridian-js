import { configError, HIDDEN_FORWARD_CODES, parseEnvelope, type MeridianError } from './internal/errors'
import type { ChatApi, ChatParams } from './types'

export const DEFAULT_MAX_TOKENS_CAP = 4096

/** What the browser may set. `model`: true for any, a list for only these, default none (Meridian decides). */
export interface AllowRule {
  model?: boolean | readonly string[]

  /** Upper bound for max_tokens from the browser; default 4096. */
  maxTokensCap?: number

  /** Further chat options the browser may set, beyond temperature and max_tokens. */
  options?: readonly string[]
}

/** What the handler needs from a server client: only chat. A `client` option may be this, or a function returning it (called once per request, never at creation). */
export type ForwardClient = { chat: ChatApi }

export interface ForwardHandlerOptions {
  client: ForwardClient | (() => ForwardClient)
  authorize: (request: Request) => boolean | Response | Promise<boolean | Response>
  allow?: AllowRule
}

/** Meridian's error envelope as a response, so the browser client decodes it like an engine error. */
export function errorResponse(error: MeridianError): Response {
  const body = {
    error: {
      message: error.message,
      type: error.type === 'client_error' ? 'api_error' : error.type,
      code: error.code,
      ...(error.requestId ? { request_id: error.requestId } : {})
    }
  }

  const headers = new Headers({ 'content-type': 'application/json' })

  if (error.requestId) headers.set('x-request-id', error.requestId)

  return new Response(JSON.stringify(body), { status: error.status > 0 ? error.status : 502, headers })
}

const HIDDEN = new Set<string>(HIDDEN_FORWARD_CODES)

/** What the browser gets instead of an app key or billing refusal: nothing about the app's key or credit. */
function genericEnvelope(requestId?: string) {
  return {
    error: {
      message: 'The service is temporarily unavailable.',
      type: 'api_error',
      code: 'service_unavailable',
      ...(requestId ? { request_id: requestId } : {})
    }
  }
}

/** The error response for the browser: the app's own key and billing refusals become a generic 503. */
function browserError(error: MeridianError): Response {
  if (!HIDDEN.has(error.code)) return errorResponse(error)

  const headers = new Headers({ 'content-type': 'application/json' })

  if (error.requestId) headers.set('x-request-id', error.requestId)

  return new Response(JSON.stringify(genericEnvelope(error.requestId)), { status: 503, headers })
}

/** The blank line that ends an SSE event, in either line-ending style. */
const EVENT_END = /\r?\n\r?\n/

/** One SSE event (without its blank line), rewritten when it is a hidden error frame; otherwise null. */
function hiddenFrame(event: string): string | null {
  const data = event
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(line.startsWith('data: ') ? 6 : 5))
    .join('\n')

  const envelope = parseEnvelope(data)

  return envelope && HIDDEN.has(envelope.error.code)
    ? `data: ${JSON.stringify(genericEnvelope(envelope.error.request_id))}`
    : null
}

/** The stream response with a hidden mid-stream error frame rewritten; every other byte passes through. */
function hideStreamErrors(response: Response): Response {
  if (!response.body) return response

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let searched = 0

  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        // [1] Decode (a split character waits for its next bytes) and cut complete events
        buffer += decoder.decode(bytes, { stream: true })

        for (;;) {
          // Search only the new text (plus 3 characters a split line ending may straddle), so a long event stays linear
          const found = EVENT_END.exec(buffer.slice(searched))

          if (!found) break

          const start = searched + found.index
          const end = start + found[0].length

          // [2] A hidden error frame is replaced; any other event is re-emitted as it came
          const rewritten = hiddenFrame(buffer.slice(0, start))

          controller.enqueue(encoder.encode(rewritten === null ? buffer.slice(0, end) : `${rewritten}\n\n`))
          buffer = buffer.slice(end)
          searched = 0
        }

        // The buffer is never flushed uninspected: a security filter must not fail open on size
        searched = Math.max(0, buffer.length - 3)
      },
      flush(controller) {
        // [3] An event the engine left without its blank line is checked the same way
        const rest = buffer + decoder.decode()

        if (rest) controller.enqueue(encoder.encode(hiddenFrame(rest) ?? rest))
      }
    })
  )

  return new Response(body, { status: response.status, headers: response.headers })
}

const refuse = (
  code: 'invalid_request' | 'permission_denied' | 'method_not_allowed',
  status: number,
  message: string,
  headers?: Record<string, string>
) => {
  const response = errorResponse({
    ...configError(message),
    code,
    status,
    type: code === 'permission_denied' ? 'permission_error' : 'invalid_request_error'
  })

  for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value)

  return response
}

/** Fields the dedicated logic owns: `options` can never copy them raw. */
const NEVER_RAW = ['model', 'stream', 'stream_options', 'messages', 'max_tokens', 'temperature']

/** The browser's idempotency key, only when it is 1 to 255 printable ASCII characters. */
function browserKey(request: Request): string | undefined {
  const key = request.headers.get('idempotency-key')

  return key && key.length <= 255 && /^[ -~]+$/.test(key) ? key : undefined
}

const isJson = (request: Request) => /^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')

function allowedParams(body: Record<string, unknown>, allow: AllowRule): ChatParams {
  // [1] Messages always; temperature and a clamped max_tokens by default
  const cap =
    Number.isInteger(allow.maxTokensCap) && allow.maxTokensCap! > 0 ? allow.maxTokensCap! : DEFAULT_MAX_TOKENS_CAP

  const params: Record<string, unknown> = { messages: body.messages }

  if (typeof body.temperature === 'number') params.temperature = body.temperature
  params.max_tokens =
    typeof body.max_tokens === 'number' ? Math.min(Math.max(1, Math.floor(body.max_tokens)), cap) : cap

  // [2] A model only when the app allows it
  const model = body.model

  if (
    typeof model === 'string' &&
    (allow.model === true || (Array.isArray(allow.model) && allow.model.includes(model)))
  ) {
    params.model = model
  }

  // [3] Further options only by name
  for (const name of allow.options ?? []) {
    if (Object.hasOwn(body, name) && !NEVER_RAW.includes(name)) params[name] = body[name]
  }

  return params as unknown as ChatParams
}

/** The server route a browser client calls: it adds the key, never the browser. */
export function createForwardHandler(options: ForwardHandlerOptions): (request: Request) => Promise<Response> {
  if (typeof options?.authorize !== 'function') {
    throw new TypeError(
      'createForwardHandler() needs an authorize(request) function: it decides who may spend your credit.'
    )
  }

  const allow = options.allow ?? {}

  return async request => {
    // [1] Only POST, and only for callers the app allows
    if (request.method !== 'POST') return refuse('method_not_allowed', 405, 'Use POST.', { allow: 'POST' })
    if (!isJson(request)) return refuse('invalid_request', 415, 'The content-type must be application/json.')

    // A throwing authorize is a refusal, never a crash and never a way through
    let verdict: boolean | Response

    try {
      verdict = await options.authorize(request)
    } catch {
      verdict = false
    }

    if (verdict instanceof Response) return verdict
    if (verdict !== true) return refuse('permission_denied', 403, 'Not allowed to use this route.')

    // [2] A JSON body with a non-empty message list
    let body: Record<string, unknown>

    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return refuse('invalid_request', 400, 'The body must be JSON.')
    }

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return refuse('invalid_request', 400, 'messages must be a non-empty list.')
    }

    // [3] Only the allowed fields reach the engine
    const params = allowedParams(body, allow)
    const callOptions = { signal: request.signal, idempotencyKey: browserKey(request) }

    // [4] A lazy client is built now, once for this request; a factory that throws is an error response
    let client: ForwardClient

    try {
      client = typeof options.client === 'function' ? options.client() : options.client
    } catch {
      return errorResponse(configError('The Meridian client could not be created.'))
    }

    if (body.stream === true) {
      const { data, error } = await client.chat.stream(params, callOptions)

      return error ? browserError(error) : hideStreamErrors(data.toResponse())
    }

    const { data, error } = await client.chat.create(params, callOptions)

    return error ? browserError(error) : Response.json(data)
  }
}

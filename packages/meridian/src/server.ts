import { validIdempotencyKey } from './internal/chat'
import {
  configError,
  errorMember,
  HIDDEN_FORWARD_CODES,
  MALFORMED,
  STATUS_BY_CODE,
  validRequestId,
  type MeridianError
} from './internal/errors'
import type { ChatApi, ChatParams, ChatStream } from './types'

export const DEFAULT_MAX_TOKENS_CAP = 4096

/** A browser's request body may be this many bytes (the engine's own request limit, and meridian-go's). */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/** A browser's JSON may nest containers this deep (the body itself is level 1). */
const MAX_BODY_DEPTH = 64

/** One streamed event may be this many bytes before the stream is failed closed. */
const MAX_EVENT_BYTES = 16 * 1024 * 1024

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

/** A JSON response; the request id is added (header and body) only when it is fit for a header. */
function jsonResponse(status: number, body: unknown, requestId?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  const id = validRequestId(requestId)

  if (id) headers.set('x-request-id', id)

  return new Response(JSON.stringify(body), { status, headers })
}

/** Meridian's error envelope as a response, so the browser client decodes it like an engine error. */
export function errorResponse(error: MeridianError): Response {
  const id = validRequestId(error.requestId)

  const body = {
    error: {
      message: error.message,
      type: error.type === 'client_error' ? 'api_error' : error.type,
      code: error.code,
      ...(id ? { request_id: id } : {})
    }
  }

  return jsonResponse(error.status > 0 ? error.status : 502, body, id)
}

const HIDDEN = new Set<string>(HIDDEN_FORWARD_CODES)

/**
 * The one decision about what a browser may not learn: a code this SDK does not recognise (a newer engine's code
 * could be about the app's account), or the app's own key, account or credit.
 */
const hides = (code: string) => !Object.hasOwn(STATUS_BY_CODE, code) || HIDDEN.has(code)

/** What the browser gets instead: nothing about the app's key, credit or setup. */
function genericEnvelope(requestId?: string) {
  const id = validRequestId(requestId)

  return {
    error: {
      message: 'The service is temporarily unavailable.',
      type: 'api_error',
      code: 'service_unavailable',
      retryable: false,
      ...(id ? { request_id: id } : {})
    }
  }
}

const generic503 = (requestId?: string) => jsonResponse(503, genericEnvelope(requestId), requestId)
const genericFrame = (requestId?: string) => `data: ${JSON.stringify(genericEnvelope(requestId))}\n\n`

/**
 * The error response for the browser: the app's own key and billing refusals, unrecognised codes and every setup or
 * transport error (client_error) become a generic 503, never with a Retry-After. A rate limit keeps the engine's valid
 * Retry-After, so the browser waits as long as the engine asked.
 */
function browserError(error: MeridianError): Response {
  if (error.type === 'client_error' || error.engineCode !== undefined || hides(error.code)) {
    return generic503(error.requestId)
  }

  const response = errorResponse(error)

  if (error.code === 'rate_limited' && error.retryAfter) response.headers.set('retry-after', error.retryAfter)

  return response
}

// --- The stream guard ------------------------------------------------------------------------------------------------
// Events are cut and passed on as bytes ("binary" strings: one character per byte), so a pass-through event leaves
// exactly as it came.

/** A blank line in any SSE line ending. A CR counts alone only when no LF follows, so a CRLF is never read as two. */
const BLANK_LINE = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/g

function toBinary(bytes: Uint8Array): string {
  let text = ''

  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192))

  return text
}

function fromBinary(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)

  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at)

  return bytes
}

type Judgement = 'pass' | 'hide' | 'terminal' | 'no_data' | 'unjudgeable'

/** The request id an `error` value carries (only an object can), if it is fit to be shown. */
function carriedId(value: Record<string, unknown>): string | undefined {
  const error = value.error

  return typeof error === 'object' && error !== null
    ? validRequestId((error as { request_id?: unknown }).request_id)
    : undefined
}

/** One event, as a browser would read it: passable, hidden or terminal (each with its request id), without data, or unjudgeable. */
function judge(event: string, first: boolean): [Judgement, string?] {
  // [1] Too large to read; otherwise the lines in any line ending, the stream's byte order mark ignored
  if (event.length > MAX_EVENT_BYTES) return ['unjudgeable']
  let text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(fromBinary(event))

  if (first && text.startsWith('﻿')) text = text.slice(1)

  // [2] Only SSE fields the guard understands: data, a message event, id, retry and comments. Anything else (another
  //     event name, an unknown field, a body that is not SSE at all) cannot be judged
  const data: string[] = []

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const name = colon < 0 ? line : line.slice(0, colon)
    const raw = colon < 0 ? '' : line.slice(colon + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw

    if (name === 'data') data.push(value)
    else if (name === 'event') {
      if (value !== '' && value !== 'message') return ['terminal']
    } else if (name !== 'id' && name !== 'retry') return ['terminal']
  }

  if (data.length === 0) return ['no_data']
  if (data.length === 1 && data[0] === '[DONE]') return ['pass']

  // [3] The data must be a JSON object (not JSON, NaN or Infinity is terminal)
  let parsed: unknown

  try {
    parsed = JSON.parse(data.join('\n'))
  } catch {
    return ['terminal']
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ['terminal']

  // [4] An error key decides: ordinary, hidden, or terminal (set, but no object with a non-empty string code, or a
  //     member in a case variant)
  const member = errorMember(parsed)
  const carried = carriedId(parsed as Record<string, unknown>)

  if (member === null) return ['pass']
  if (member === MALFORMED || typeof member.code !== 'string' || member.code === '') return ['terminal', carried]

  return hides(member.code) ? ['hide', carried] : ['pass']
}

/**
 * Judges the engine's events before any byte reaches the browser. Only whole events go out: as they came, or the
 * generic frame for a hidden code. An event that cannot be judged, or whose `error` is no envelope with a code, ends
 * the stream closed instead (`closed` is set); so does a body that ends with content holding no data line.
 */
class Guard {
  #buffer = ''
  #searched = 0
  #first = true
  closed = false

  constructor(private readonly requestId?: string) {}

  feed(bytes: Uint8Array): string {
    // [1] Cut every complete event, searching only what is new (plus the few bytes a blank line may straddle)
    this.#buffer += toBinary(bytes)
    let out = ''
    let begin = 0

    BLANK_LINE.lastIndex = this.#searched

    for (let match = BLANK_LINE.exec(this.#buffer); match; match = BLANK_LINE.exec(this.#buffer)) {
      const end = match.index + match[0].length

      // A CR that ends what has arrived may be the first half of a CRLF: wait for the next bytes
      if (end === this.#buffer.length && this.#buffer.endsWith('\r')) break
      const event = this.#buffer.slice(begin, end)

      begin = end

      // [2] Each one judged whole: an unjudgeable or terminal one fails the stream closed
      const [verdict, id] = judge(event, this.#first)

      this.#first = false
      if (verdict === 'unjudgeable' || verdict === 'terminal') return out + this.fail(id)
      out += verdict === 'hide' ? genericFrame(id ?? this.requestId) : event
    }

    // [3] What is left is one unfinished event: held back unjudged, and never past the cap
    this.#buffer = this.#buffer.slice(begin)
    if (this.#buffer.length > MAX_EVENT_BYTES) return out + this.fail()
    this.#searched = Math.max(0, this.#buffer.length - 3)

    return out
  }

  end(): string {
    // [1] The engine finished: a last event without its blank line is judged as it is
    const rest = this.#buffer

    this.#buffer = ''
    if (!rest.replace(/[\r\n]/g, '')) return rest
    const [verdict, id] = judge(rest, this.#first)

    if (verdict === 'pass') return rest

    // [2] A hidden one is replaced; anything else (no data line, terminal, unjudgeable) fails closed
    return verdict === 'hide' ? genericFrame(id ?? this.requestId) : this.fail(id)
  }

  /** Drops the unjudged bytes and ends the stream with the generic frame, after a blank line closing any event. */
  fail(requestId?: string): string {
    this.#buffer = ''
    this.closed = true

    return '\n\n' + genericFrame(requestId ?? this.requestId)
  }
}

/** The stream's body through the guard. Upstream is closed on every exit but a clean end: failed closed, broken, or cancelled by the browser. */
function guardedBody(stream: ChatStream): ReadableStream<Uint8Array> {
  const guard = new Guard(stream.requestId ?? undefined)
  const reader = stream.toResponse().body!.getReader()

  const close = () => {
    reader.cancel().catch(() => {})
    stream.cancel()
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        let out: string

        try {
          const { value, done } = await reader.read()

          if (done) {
            out = guard.end()
            if (guard.closed) close()
            if (out) controller.enqueue(fromBinary(out))
            controller.close()

            return
          }

          out = guard.feed(value)
        } catch {
          // A body that broke mid-stream ends with the generic frame, so no client takes the cut for a success
          out = guard.fail()
        }

        if (guard.closed) {
          close()
          if (out) controller.enqueue(fromBinary(out))
          controller.close()

          return
        }

        if (out) return controller.enqueue(fromBinary(out))
      }
    },
    cancel() {
      close()
    }
  })
}

function streamResponse(stream: ChatStream): Response {
  // The route's own headers: the engine's content-encoding and content-length never describe these bytes
  const headers = new Headers({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })

  if (stream.requestId) headers.set('x-request-id', stream.requestId)

  return new Response(guardedBody(stream), { status: 200, headers })
}

// --- The request -----------------------------------------------------------------------------------------------------

const refuse = (
  code: 'invalid_request' | 'permission_denied' | 'method_not_allowed' | 'body_too_large',
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

/** Fields the dedicated logic owns: `options` can never copy them raw (max_completion_tokens would state a second limit, n would multiply the output). */
const NEVER_RAW = [
  'model',
  'stream',
  'stream_options',
  'messages',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'n'
]

/** The browser's idempotency key when the engine would accept it (the client's own rule); otherwise the client makes one. */
function browserKey(request: Request): string | undefined {
  const key = request.headers.get('idempotency-key')

  return validIdempotencyKey(key) ? key : undefined
}

const isJson = (request: Request) => /^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')

/** The body, read only until the cap is passed (the rest is cancelled, never buffered); a refusal otherwise. */
async function readBody(request: Request): Promise<Uint8Array | Response> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0

  try {
    for (;;) {
      const { value, done } = await reader.read()

      if (done) break
      size += value.byteLength

      if (size > MAX_BODY_BYTES) {
        reader.cancel().catch(() => {})

        return refuse('body_too_large', 413, 'The request body is too large.')
      }

      parts.push(value)
    }
  } catch {
    return refuse('invalid_request', 400, 'The body could not be read.')
  }

  const body = new Uint8Array(size)
  let at = 0

  for (const part of parts) {
    body.set(part, at)
    at += part.byteLength
  }

  return body
}

/**
 * The deepest level of arrays and objects in a JSON text, counted without recursion so a hostile body cannot cost
 * stack. Brackets inside strings do not count; the count is exact for valid JSON, and anything else is refused by the
 * parser afterwards.
 */
function nestingDepth(text: string): number {
  let depth = 0
  let deepest = 0
  let inString = false
  let escaped = false

  for (let at = 0; at < text.length; at++) {
    const char = text[at]

    if (escaped) escaped = false
    else if (inString) {
      if (char === '\\') escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{' || char === '[') deepest = Math.max(deepest, ++depth)
    else if (char === '}' || char === ']') depth--
  }

  return deepest
}

/** Strict UTF-8 JSON (no byte order mark, no other encoding), nested no deeper than a chat body ever is. */
function parseBody(bytes: Uint8Array): Record<string, unknown> | Response {
  // [1] UTF-8 only: a byte order mark or an invalid byte is no JSON body
  let text: string

  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('BOM')
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return refuse('invalid_request', 400, 'The body must be JSON.')
  }

  // [2] Counted before parsing, so a deep body never reaches the parser
  if (nestingDepth(text) > MAX_BODY_DEPTH) return refuse('invalid_request', 400, 'The body is nested too deeply.')
  let body: unknown

  try {
    body = JSON.parse(text)
  } catch {
    return refuse('invalid_request', 400, 'The body must be JSON.')
  }

  // [3] An object with a non-empty message list
  const fields = body as Record<string, unknown> | null

  if (!fields || typeof fields !== 'object' || !Array.isArray(fields.messages) || fields.messages.length === 0) {
    return refuse('invalid_request', 400, 'messages must be a non-empty list.')
  }

  return fields
}

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

    // [2] The body, capped while it is read, then strict JSON with a non-empty message list
    const bytes = await readBody(request)

    if (bytes instanceof Response) return bytes
    const body = parseBody(bytes)

    if (body instanceof Response) return body

    // [3] Only the allowed fields reach the engine
    const params = allowedParams(body, allow)
    const callOptions = { signal: request.signal, idempotencyKey: browserKey(request) }

    // [4] A lazy client is built now, once for this request; a factory that throws is an error response
    let client: ForwardClient

    try {
      client = typeof options.client === 'function' ? options.client() : options.client
    } catch {
      return browserError(configError('The Meridian client could not be created.'))
    }

    if (body.stream === true) {
      const { data, error } = await client.chat.stream(params, callOptions)

      return error ? browserError(error) : streamResponse(data)
    }

    // [5] A 2xx that carries an error member (or a case variant of a member the SDK reads) is no result
    const { data, error } = await client.chat.create(params, callOptions)

    if (error) return browserError(error)

    return errorMember(data) === null ? Response.json(data) : generic503()
  }
}

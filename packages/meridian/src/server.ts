import { configError, type MeridianError } from './internal/errors'
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

export interface ForwardHandlerOptions {
  client: { chat: ChatApi }
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

const refuse = (
  code: 'invalid_request' | 'permission_denied' | 'method_not_allowed',
  status: number,
  message: string
) =>
  errorResponse({
    ...configError(message),
    code,
    status,
    type: code === 'permission_denied' ? 'permission_error' : 'invalid_request_error'
  })

function allowedParams(body: Record<string, unknown>, allow: AllowRule): ChatParams {
  // [1] Messages always; temperature and a clamped max_tokens by default
  const cap = allow.maxTokensCap ?? DEFAULT_MAX_TOKENS_CAP
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
    if (name in body && !['model', 'stream', 'stream_options', 'messages'].includes(name)) params[name] = body[name]
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
    if (request.method !== 'POST') return refuse('method_not_allowed', 405, 'Use POST.')
    const verdict = await options.authorize(request)

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
    const signal = request.signal

    if (body.stream === true) {
      const { data, error } = await options.client.chat.stream(params, { signal })

      return error ? errorResponse(error) : data.toResponse()
    }

    const { data, error } = await options.client.chat.create(params, { signal })

    return error ? errorResponse(error) : Response.json(data)
  }
}

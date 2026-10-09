/** An in-memory Meridian engine reached through `fetch`. It speaks the engine's wire shapes (encode.rs, error.rs). */

export interface Scripted {
  status?: number
  headers?: Record<string, string>
  json?: unknown
  text?: string
  chunks?: (string | Uint8Array)[]
  hang?: boolean
  delayMs?: number
  networkError?: boolean
}

export interface FakeEngine {
  fetch: typeof fetch
  publicUrl: string
  adminUrl: string
  projectKey: string
  integratorKey: string
  requests: Request[]
  next: (...answers: Scripted[]) => void
}

export const FAKE_PROJECT_KEY = `gmr_${'0'.repeat(64)}`
export const FAKE_INTEGRATOR_KEY = `gmi_${'1'.repeat(64)}`

const STATUS: Record<string, number> = {
  invalid_api_key: 401,
  invalid_request: 400,
  upstream_unavailable: 502,
  rate_limited: 429,
  service_unavailable: 503,
  not_found: 404,
  method_not_allowed: 405,
  permission_denied: 403
}

const TYPE: Record<string, string> = {
  permission_denied: 'permission_error',
  invalid_api_key: 'authentication_error',
  invalid_request: 'invalid_request_error',
  upstream_unavailable: 'api_error',
  rate_limited: 'rate_limit_error',
  service_unavailable: 'api_error',
  not_found: 'invalid_request_error',
  method_not_allowed: 'invalid_request_error'
}

let sequence = 0

export function envelope(code: string, requestId = `req_fake_${++sequence}`) {
  return { error: { message: `fake ${code}`, type: TYPE[code] ?? 'api_error', code, request_id: requestId } }
}

export function engineError(code: string, extraHeaders: Record<string, string> = {}): Scripted {
  const body = envelope(code)

  return {
    status: STATUS[code] ?? 500,
    headers: { 'x-request-id': body.error.request_id, ...extraHeaders },
    json: body
  }
}

export function frame(value: unknown): string {
  return `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`
}

export function chunk(content: string, model = 'gemini-3.8-flash') {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }]
  }
}

export function finish(model = 'gemini-3.8-flash') {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
  }
}

export function usageChunk(prompt = 3, completion = 2) {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gemini-3.8-flash',
    choices: [],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(resolve, ms)

    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    })
  })
}

function body(answer: Scripted, signal: AbortSignal | null | undefined): BodyInit | null {
  const encoder = new TextEncoder()

  if (answer.chunks || answer.hang) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of answer.chunks ?? []) {
          controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece)
        }

        if (!answer.hang) return controller.close()
        signal?.addEventListener('abort', () => controller.error(abortError()))
      }
    })
  }

  if (answer.json !== undefined) return JSON.stringify(answer.json)

  return answer.text ?? null
}

async function answer(scripted: Scripted, signal: AbortSignal | null | undefined): Promise<Response> {
  // [1] Simulate latency and network failure first
  if (scripted.delayMs) await wait(scripted.delayMs, signal)
  if (scripted.networkError) throw new TypeError('fetch failed')

  // [2] Build the response the engine would send
  const headers = new Headers(scripted.headers)

  if (scripted.json !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (scripted.chunks && !headers.has('content-type')) headers.set('content-type', 'text/event-stream')

  return new Response(body(scripted, signal), { status: scripted.status ?? 200, headers })
}

function defaultPublic(request: Request, payload: Record<string, unknown> | null): Scripted {
  // [1] Every public route needs the project key
  if (request.headers.get('authorization') !== `Bearer ${FAKE_PROJECT_KEY}`) return engineError('invalid_api_key')

  const url = new URL(request.url)

  // [2] The model list
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    return { json: { object: 'list', data: [{ id: 'gemini-3.8-flash', object: 'model', owned_by: 'gemini' }] } }
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return engineError('not_found')
  if (!payload || !Array.isArray(payload.messages)) return engineError('invalid_request')
  if (payload.model === 'sim-fail') return engineError('upstream_unavailable')

  // [3] A streamed reply, with the usage chunk only when asked for
  if (payload.stream === true) {
    const includeUsage = (payload.stream_options as { include_usage?: boolean } | undefined)?.include_usage === true

    return {
      headers: { 'x-request-id': 'req_fake_stream' },
      chunks: [
        frame(chunk('Hello')),
        frame(chunk(' world')),
        frame(finish()),
        ...(includeUsage ? [frame(usageChunk())] : []),
        frame('[DONE]')
      ]
    }
  }

  // [4] A buffered reply
  return {
    headers: { 'x-request-id': 'req_fake_create' },
    json: {
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 0,
      model: 'gemini-3.8-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
    }
  }
}

export type AdminRouter = (request: Request, payload: Record<string, unknown> | null) => Scripted

export function createFakeEngine(adminRouter?: AdminRouter): FakeEngine {
  const queue: Scripted[] = []
  const requests: Request[] = []
  const publicUrl = 'http://engine.test'
  const adminUrl = 'http://admin.test'

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // [1] Record the request exactly as the SDK sent it
    const request = new Request(input, init)

    requests.push(request.clone())
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text()
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : null

    // [2] A scripted answer wins; otherwise the default routes answer
    const scripted = queue.shift()

    if (scripted) return answer(scripted, init?.signal)
    const isAdmin = request.url.startsWith(adminUrl)

    const fallback = isAdmin
      ? (adminRouter?.(request, payload) ?? engineError('not_found'))
      : defaultPublic(request, payload)

    return answer(fallback, init?.signal)
  }

  return {
    fetch: fetchImpl as typeof fetch,
    publicUrl,
    adminUrl,
    projectKey: FAKE_PROJECT_KEY,
    integratorKey: FAKE_INTEGRATOR_KEY,
    requests,
    next: (...answers) => void queue.push(...answers)
  }
}

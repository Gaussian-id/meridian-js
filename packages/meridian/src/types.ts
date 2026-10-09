import type { components, paths } from './generated/public'
import type { MeridianError, Result } from './internal/errors'
import type { OkBody, OkEvent, OmitKnown, RequestBody } from './internal/openapi'

export type { MeridianError, MeridianErrorCode, MeridianErrorType, Result } from './internal/errors'

type ChatOperation = paths['/v1/chat/completions']['post']
type GeneratedParams = RequestBody<ChatOperation>
type GeneratedCompletion = OkBody<ChatOperation>
type Schemas = components['schemas']

/**
 * The request, minus `stream` and `stream_options`: `chat.create` and `chat.stream` own those.
 * `role` is the generated enum for autocomplete; the engine forwards any role as sent.
 */
export type ChatParams = OmitKnown<GeneratedParams, 'stream' | 'stream_options'>
export type ChatMessage = ChatParams['messages'][number]

/** The three token counts; the SDK drops every other usage field (details, and anything the engine adds). */
export type Usage = Pick<Schemas['Usage'], 'prompt_tokens' | 'completion_tokens' | 'total_tokens'>
export type ChatCompletion = Omit<GeneratedCompletion, 'usage'> & { usage: Usage }
export type Model = OkBody<paths['/v1/models']['get']> extends { data: (infer M)[] } ? M : never

type ChunkEvent = OkEvent<ChatOperation>

/** A raw chunk, as the generated schema types it (the delta is `ChunkDelta`: content, role, reasoning, refusal, tool_calls). */
export type ChatChunkRaw = ChunkEvent

export interface ClientOptions {
  fetch?: typeof fetch

  /** Milliseconds to wait for response headers; default 60000. */
  timeout?: number

  /** Retries for retryable errors before the first byte; default 2. */
  maxRetries?: number
}

export interface RequestOptions {
  signal?: AbortSignal
  idempotencyKey?: string
}

export interface ChatChunk {
  delta: string
  raw: ChatChunkRaw
}

export interface ChatStream extends AsyncIterable<ChatChunk> {
  readonly error: MeridianError | null
  readonly usage: Usage | null
  readonly requestId: string | null
  text(): Promise<Result<string>>
  toResponse(init?: ResponseInit): Response
  cancel(): void
}

export interface ChatApi {
  create(params: ChatParams, options?: RequestOptions): Promise<Result<ChatCompletion>>
  stream(params: ChatParams, options?: RequestOptions): Promise<Result<ChatStream>>
}

export interface MeridianClient {
  chat: ChatApi
  models: { list(options?: RequestOptions): Promise<Result<Model[]>> }
}

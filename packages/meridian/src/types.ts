import type { components, paths } from './generated/public'
import type { MeridianError, Result } from './internal/errors'
import type { OkBody, OkEvent, RequestBody } from './internal/openapi'

export type { MeridianError, MeridianErrorCode, MeridianErrorType, Result } from './internal/errors'

type ChatOperation = paths['/v1/chat/completions']['post']
type GeneratedParams = RequestBody<ChatOperation>
type GeneratedCompletion = OkBody<ChatOperation>
type Schemas = components['schemas']

// STOPGAP: remove when the engine schema lists these (engine follow-up)
type ForwardedMessageFields = { name?: string; tool_call_id?: string; tool_calls?: Schemas['ToolCall'][] }

/** The request, minus `stream` and `stream_options`: `chat.create` and `chat.stream` own those. */
export type ChatParams = Omit<GeneratedParams, 'stream' | 'stream_options' | 'messages'> & {
  messages: (GeneratedParams['messages'][number] & ForwardedMessageFields)[]

  // STOPGAP: remove when the engine schema lists these (engine follow-up)
  user?: string
}
export type ChatMessage = ChatParams['messages'][number]

/** The three token counts; the SDK drops every other usage field (details, and anything the engine adds). */
export type Usage = Pick<Schemas['Usage'], 'prompt_tokens' | 'completion_tokens' | 'total_tokens'>
export type ChatCompletion = Omit<GeneratedCompletion, 'usage'> & { usage: Usage }
export type Model = OkBody<paths['/v1/models']['get']> extends { data: (infer M)[] } ? M : never

type ChunkEvent = OkEvent<ChatOperation>

/** A raw chunk. The spec types the provider delta as an open object (`Record<string, unknown>`), so it is narrowed here to the fields the SDK reads. */
export type ChatChunkRaw = Omit<ChunkEvent, 'choices'> & {
  choices: (Omit<ChunkEvent['choices'][number], 'delta'> & {
    delta: { content?: string | null; role?: string; [key: string]: unknown }
  })[]
}

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

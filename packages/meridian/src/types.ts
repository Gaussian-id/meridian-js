import type { paths } from './generated/public'
import type { MeridianError, Result } from './internal/errors'
import type { OkBody, OkEvent, RequestBody } from './internal/openapi'

export type { MeridianError, MeridianErrorCode, MeridianErrorType, Result } from './internal/errors'

type ChatOperation = paths['/v1/chat/completions']['post']

/** The request, minus `stream` and `stream_options`: `chat.create` and `chat.stream` own those. */
export type ChatParams = Omit<RequestBody<ChatOperation>, 'stream' | 'stream_options'>
export type ChatMessage = ChatParams['messages'][number]
export type ChatCompletion = OkBody<ChatOperation>
export type Usage = ChatCompletion['usage']
export type Model = OkBody<paths['/v1/models']['get']> extends { data: (infer M)[] } ? M : never

type ChunkEvent = OkEvent<ChatOperation>

/** A raw chunk. The spec leaves the provider delta open, so the delta is typed by what the SDK reads from it. */
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

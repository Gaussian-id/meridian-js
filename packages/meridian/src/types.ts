// HAND-WRITTEN until Task 9 replaces the request and response types with ones derived from generated/public.ts.
import type { MeridianError, Result } from './internal/errors'

export type { MeridianError, MeridianErrorCode, MeridianErrorType, Result } from './internal/errors'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
}

export interface ChatParams {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  stop?: string | string[]
  tools?: unknown[]
  tool_choice?: unknown
  response_format?: unknown
  user?: string
}

export interface Usage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
}

export interface ChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: { index: number; message: { role: 'assistant'; content: string | null }; finish_reason: string | null }[]
  usage?: Usage
}

export interface ChatChunkRaw {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: { index: number; delta: { content?: string | null; role?: string }; finish_reason: string | null }[]
  usage?: Usage
}

export interface Model {
  id: string
  object: 'model'
  owned_by: string
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

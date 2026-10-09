import type { ChatChunk, ChatChunkRaw, ChatStream, Usage } from '../types'

import { clientError, errorFromEnvelope, fail, ok, parseEnvelope, type MeridianError, type Result } from './errors'
import type { Opened } from './transport'

/** The data of one SSE block, or null when it has none. Comment lines and other fields are ignored. */
function dataOf(block: string): string | null {
  const lines = block.split('\n').filter(line => line.startsWith('data:'))

  return lines.length === 0 ? null : lines.map(line => line.slice(line.startsWith('data: ') ? 6 : 5)).join('\n')
}

/** Normalises line endings, holding back a trailing CR that may start a CRLF split across reads. */
function normalise(buffer: string): string {
  const held = buffer.endsWith('\r') ? '\r' : ''

  return (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n') + held
}

async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      // [1] Decode bytes, keeping a split UTF-8 character for the next read
      const { value, done } = await reader.read()

      if (done) break
      buffer = normalise(buffer + decoder.decode(value, { stream: true }))

      // [2] Emit every complete event
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const data = dataOf(buffer.slice(0, end))

        buffer = buffer.slice(end + 2)
        if (data !== null) yield data
      }
    }

    // [3] A final event without its blank line still counts
    const tail = dataOf(
      normalise(buffer + decoder.decode())
        .replace(/\r$/, '')
        .trim()
    )

    if (tail !== null) yield tail
  } finally {
    reader.releaseLock()
  }
}

class ChatStreamImpl implements ChatStream {
  #error: MeridianError | null = null
  #usage: Usage | null = null
  #consumed = false

  constructor(
    private readonly opened: Opened,
    private readonly signal: AbortSignal | undefined
  ) {}

  get error() {
    return this.#error
  }

  get usage() {
    return this.#usage
  }

  get requestId() {
    return this.opened.response.headers.get('x-request-id')
  }

  cancel() {
    this.opened.abort()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<ChatChunk> {
    // [1] A stream is read once
    if (this.#consumed || !this.opened.response.body) {
      this.#error ??= clientError('aborted', 'This stream was already read.')

      return
    }

    this.#consumed = true
    let ended: 'done' | 'failed' | 'eof' | null = null

    try {
      // [2] Each event is [DONE], an error frame, the usage chunk, or a text chunk
      for await (const data of events(this.opened.response.body)) {
        if (data === '[DONE]') {
          ended = 'done'
          break
        }

        const envelope = parseEnvelope(data)

        if (envelope) {
          this.#error = errorFromEnvelope(envelope)
          ended = 'failed'
          break
        }

        const raw = JSON.parse(data) as ChatChunkRaw

        if (raw.choices.length === 0) {
          if (raw.usage) this.#usage = raw.usage
          continue
        }

        yield { delta: raw.choices[0]?.delta.content ?? '', raw }
      }

      ended ??= 'eof'
    } catch {
      // [3] The body broke: the caller aborted, or the connection failed
      ended = 'failed'
      this.#error = this.signal?.aborted
        ? clientError('aborted', 'The stream was aborted.')
        : clientError('network_error', 'The stream connection failed.')
    } finally {
      // [4] A body that ended without [DONE] lost its connection; a consumer that stopped early cancels upstream
      if (ended === 'eof') this.#error = clientError('network_error', 'The stream ended before it finished.')
      if (ended === null) this.opened.abort()
      this.opened.release()
    }
  }

  async text(): Promise<Result<string>> {
    let text = ''

    for await (const piece of this) text += piece.delta

    return this.#error ? fail(this.#error) : ok(text)
  }

  toResponse(init: ResponseInit = {}): Response {
    // [1] Re-emit the engine's events byte for byte, once
    const headers = new Headers(init.headers)

    headers.set('content-type', 'text/event-stream; charset=utf-8')
    headers.set('cache-control', 'no-cache')
    if (this.requestId) headers.set('x-request-id', this.requestId)

    if (this.#consumed || !this.opened.response.body) {
      const frame = `data: ${JSON.stringify({ error: { message: 'This stream was already read.', type: 'api_error', code: 'internal' } })}\n\n`

      return new Response(frame, { ...init, status: 200, headers })
    }

    // [2] Release the caller's signal when the body is finished
    this.#consumed = true
    const release = this.opened.release

    const body = this.opened.response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({ flush: () => release() })
    )

    return new Response(body, { ...init, status: 200, headers })
  }
}

export function createChatStream(opened: Opened, signal?: AbortSignal): ChatStream {
  return new ChatStreamImpl(opened, signal)
}

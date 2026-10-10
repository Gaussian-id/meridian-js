import type { ChatApi, ChatCompletion, ChatParams, RequestOptions } from '../types'

import { ok } from './errors'
import { createChatStream, tokenCounts } from './stream'
import type { Transport } from './transport'

/** A fresh key per logical call, so a retry before the first chunk can never run the request twice (chat.rs R19). */
function newKey(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID

  return random
    ? random.call(globalThis.crypto)
    : `mrd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * The engine's rule for an idempotency key (meridian-domain ids.rs): 1-255 characters, each visible ASCII 0x21-0x7E.
 * The one rule for the caller's key and a browser's key at the forwarding route.
 */
export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[!-~]{1,255}$/.test(value)
}

/** Chat completions are the only route that honours `idempotency-key`; admin calls never send it. */
export function idempotency(options: RequestOptions): Record<string, string> {
  return { 'idempotency-key': options.idempotencyKey ?? newKey() }
}

export function createChatApi(transport: Transport, path: string): ChatApi {
  return {
    create: async (params: ChatParams, options: RequestOptions = {}) => {
      const result = await transport.json<ChatCompletion>({
        method: 'POST',
        path,
        body: { ...params, stream: false },
        signal: options.signal,
        headers: idempotency(options)
      })

      // Same three token counts as stream.usage, nothing else
      return result.error ? result : ok({ ...result.data, usage: tokenCounts(result.data.usage ?? {}) })
    },
    stream: async (params: ChatParams, options: RequestOptions = {}) => {
      // [1] Ask for the usage chunk so stream.usage is filled (encode.rs: usage only on include_usage)
      const opened = await transport.open({
        method: 'POST',
        path,
        body: { ...params, stream: true, stream_options: { include_usage: true } },
        signal: options.signal,
        headers: idempotency(options)
      })

      // [2] A refusal before any byte is an error value; otherwise the stream
      return opened.error ? opened : ok(createChatStream(opened.data, options.signal))
    }
  }
}

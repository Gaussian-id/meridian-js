import type { ChatApi, ChatCompletion, ChatParams, RequestOptions } from '../types'

import { configError, fail } from './errors'
import type { Transport } from './transport'

/** A fresh key per logical call, so a retry before the first chunk can never run the request twice (chat.rs R19). */
function newKey(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID

  return random
    ? random.call(globalThis.crypto)
    : `mrd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Chat completions are the only route that honours `idempotency-key`; admin calls never send it. */
export function idempotency(options: RequestOptions): Record<string, string> {
  return { 'idempotency-key': options.idempotencyKey ?? newKey() }
}

export function createChatApi(transport: Transport, path: string): ChatApi {
  return {
    create: (params: ChatParams, options: RequestOptions = {}) =>
      transport.json<ChatCompletion>({
        method: 'POST',
        path,
        body: { ...params, stream: false },
        signal: options.signal,
        headers: idempotency(options)
      }),
    stream: async () => fail(configError('chat.stream() is not available yet.'))
  }
}

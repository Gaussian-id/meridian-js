import { createChatApi } from './internal/chat'
import { createTransport } from './internal/transport'
import type { ChatApi } from './types'

export type * from './types'

export const DEFAULT_ROUTE = '/api/meridian/chat'

export interface BrowserClientOptions {
  fetch?: typeof fetch
  timeout?: number
  maxRetries?: number

  /** The app's own forwarding route; default /api/meridian/chat. */
  route?: string
}

export interface BrowserClient {
  chat: ChatApi
}

/** The browser client: the same chat API, sent to the app's route, never with a key. */
export function createBrowserClient(options: BrowserClientOptions = {}): BrowserClient {
  // [1] No key is ever passed: the transport only adds Authorization when one is set
  const transport = createTransport({
    baseUrl: options.route ?? DEFAULT_ROUTE,
    fetch: options.fetch,
    timeout: options.timeout,
    maxRetries: options.maxRetries
  })

  // [2] The route itself is the endpoint, so the chat path is empty
  return { chat: createChatApi(transport, '') }
}

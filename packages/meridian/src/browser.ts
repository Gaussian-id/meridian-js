import { createChatApi } from './internal/chat'
import { configError } from './internal/errors'
import { refusedClient } from './internal/refused'
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

const RELATIVE_ROUTE_MESSAGE =
  'This runtime has no page origin, so route must be an absolute http(s) URL of your backend route, e.g. https://example.com/api/meridian/chat.'

const isAbsoluteUrl = (route: string) => /^https?:\/\//i.test(route)

/** The browser client: the same chat API, sent to the app's route, never with a key. */
export function createBrowserClient(options: BrowserClientOptions = {}): BrowserClient {
  const route = options.route ?? DEFAULT_ROUTE

  // [1] A relative route needs a page origin; runtimes without one (React Native) need an absolute route
  if (!isAbsoluteUrl(route) && (globalThis as { location?: unknown }).location === undefined) {
    return { chat: refusedClient(configError(RELATIVE_ROUTE_MESSAGE)).chat }
  }

  // [2] No key is ever passed: the transport only adds Authorization when one is set
  const transport = createTransport({
    baseUrl: route,
    fetch: options.fetch,
    timeout: options.timeout,
    maxRetries: options.maxRetries
  })

  // [3] The route itself is the endpoint, so the chat path is empty
  return { chat: createChatApi(transport, '') }
}

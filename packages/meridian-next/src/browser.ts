import {
  createBrowserClient as createCoreBrowserClient,
  DEFAULT_ROUTE,
  type BrowserClientOptions
} from '@gaussian/meridian/browser'

export type { BrowserClient, BrowserClientOptions } from '@gaussian/meridian/browser'

/** The browser client, preset to the route createRouteHandler serves. */
export function createBrowserClient(options: BrowserClientOptions = {}) {
  return createCoreBrowserClient({ route: DEFAULT_ROUTE, ...options })
}

import {
  createBrowserClient,
  DEFAULT_ROUTE,
  type BrowserClient,
  type BrowserClientOptions
} from '@gaussian-id/meridian/browser'

/** The browser client for Vue components, preset to the route defineMeridianHandler serves. */
export function useMeridian(options: BrowserClientOptions = {}): BrowserClient {
  return createBrowserClient({ route: DEFAULT_ROUTE, ...options })
}

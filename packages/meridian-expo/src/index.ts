import { fetch as expoFetch } from 'expo/fetch'

import {
  createBrowserClient as createCoreBrowserClient,
  type BrowserClient,
  type BrowserClientOptions
} from '@gaussian/meridian/browser'

export type { BrowserClient } from '@gaussian/meridian/browser'

/** `route` is the absolute URL of your backend's forwarding route; the app never holds a Meridian key. */
export interface ExpoClientOptions extends Omit<BrowserClientOptions, 'route'> {
  route: string
}

/** The mobile client: the browser client over Expo's streaming fetch, aimed at your backend. */
export function createBrowserClient(options: ExpoClientOptions): BrowserClient {
  // [1] Expo's fetch streams response bodies; the core client refuses a relative route (no page origin here)
  const fetch = options.fetch ?? (expoFetch as unknown as typeof globalThis.fetch)

  return createCoreBrowserClient({ ...options, fetch })
}

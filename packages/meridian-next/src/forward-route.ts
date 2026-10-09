import 'server-only'

import { createClient, type ClientOptions, type MeridianClient } from 'meridian'
import { createForwardHandler, type AllowRule, type ForwardHandlerOptions } from 'meridian/server'

// Internal: shared by index.ts and pages.ts, not part of the public entry.

export interface ServerClientOptions extends ClientOptions {
  url?: string
  key?: string
}

export interface RouteHandlerOptions {
  authorize: ForwardHandlerOptions['authorize']
  allow?: AllowRule
  client?: ForwardHandlerOptions['client']
}

/** The server client for route handlers and server actions, from MERIDIAN_URL and MERIDIAN_KEY. */
export function createServerClient(options: ServerClientOptions = {}): MeridianClient {
  const { url = process.env.MERIDIAN_URL ?? '', key = process.env.MERIDIAN_KEY ?? '', ...clientOptions } = options

  return createClient(url, key, clientOptions)
}

/** The web-standard forwarding handler, with a server client built per request unless one is given. */
export function createForwardRoute(options: RouteHandlerOptions): (request: Request) => Promise<Response> {
  return createForwardHandler({
    client: options.client ?? (() => createServerClient()),
    authorize: options.authorize,
    allow: options.allow
  })
}

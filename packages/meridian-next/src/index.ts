import 'server-only'

import { createClient, type ClientOptions, type MeridianClient } from 'meridian'
import { createForwardHandler, type AllowRule, type ForwardHandlerOptions } from 'meridian/server'

export type { AllowRule } from 'meridian/server'

export interface ServerClientOptions extends ClientOptions {
  url?: string
  key?: string
}

/** The server client for route handlers and server actions, from MERIDIAN_URL and MERIDIAN_KEY. */
export function createServerClient(options: ServerClientOptions = {}): MeridianClient {
  const { url = process.env.MERIDIAN_URL ?? '', key = process.env.MERIDIAN_KEY ?? '', ...clientOptions } = options

  return createClient(url, key, clientOptions)
}

export interface RouteHandlerOptions {
  authorize: ForwardHandlerOptions['authorize']
  allow?: AllowRule
  client?: ForwardHandlerOptions['client']
}

/** The web-standard forwarding handler, with a server client built per request unless one is given. */
export function createForwardRoute(options: RouteHandlerOptions): (request: Request) => Promise<Response> {
  return createForwardHandler({
    client: options.client ?? (() => createServerClient()),
    authorize: options.authorize,
    allow: options.allow
  })
}

/** `export const { POST } = createRouteHandler({ authorize })` in app/api/meridian/chat/route.ts. */
export function createRouteHandler(options: RouteHandlerOptions): { POST: (request: Request) => Promise<Response> } {
  return { POST: createForwardRoute(options) }
}

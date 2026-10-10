import 'server-only'

import { createForwardRoute, type RouteHandlerOptions } from './forward-route'

export type { AllowRule } from '@gaussian-id/meridian/server'
export { createServerClient, type RouteHandlerOptions, type ServerClientOptions } from './forward-route'

/** `export const { POST } = createRouteHandler({ authorize })` in app/api/meridian/chat/route.ts. */
export function createRouteHandler(options: RouteHandlerOptions): { POST: (request: Request) => Promise<Response> } {
  return { POST: createForwardRoute(options) }
}

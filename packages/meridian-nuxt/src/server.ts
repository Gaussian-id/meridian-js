import { defineEventHandler, toWebRequest } from 'h3'

import { createClient, type ClientOptions, type MeridianClient } from 'meridian'
import { createForwardHandler, type AllowRule, type ForwardHandlerOptions } from 'meridian/server'

import { useRuntimeConfig } from '#imports'

const SERVER_CLIENT_MARKER =
  'meridian-nuxt: set runtimeConfig.meridian.url and .key (NUXT_MERIDIAN_URL, NUXT_MERIDIAN_KEY)'

/** The server client from runtimeConfig.meridian, for Nitro server routes. */
export function useMeridianServerClient(options: ClientOptions = {}): MeridianClient {
  const { url, key } = (useRuntimeConfig() as { meridian: { url: string; key: string } }).meridian

  // The message doubles as the marker scripts/check-framework-builds.mjs looks for in client bundles
  if (!url || !key) throw new Error(SERVER_CLIENT_MARKER)

  return createClient(url, key, options)
}

export interface MeridianHandlerOptions {
  authorize: ForwardHandlerOptions['authorize']
  allow?: AllowRule
  client?: ForwardHandlerOptions['client']
}

/** `export default defineMeridianHandler({ authorize })` in server/api/meridian/chat.post.ts. */
export function defineMeridianHandler(options: MeridianHandlerOptions) {
  // [1] Fail at start-up without authorize, as the core does; the default client is built per request
  const forward = createForwardHandler({
    client: options.client ?? (() => useMeridianServerClient()),
    authorize: options.authorize,
    allow: options.allow
  })

  // [2] Nitro passes an event; the core speaks web Requests
  return defineEventHandler(event => forward(toWebRequest(event)))
}

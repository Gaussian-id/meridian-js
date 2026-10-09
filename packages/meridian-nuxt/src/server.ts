import { defineEventHandler, toWebRequest } from 'h3'

import { createClient, type ClientOptions, type MeridianClient, type Result } from 'meridian'
import { createForwardHandler, type AllowRule, type ForwardHandlerOptions } from 'meridian/server'

import { useRuntimeConfig } from '#imports'

// Also the marker scripts/check-framework-builds.mjs looks for in client bundles
const MISSING_CONFIG_HINT =
  'meridian-nuxt: set runtimeConfig.meridian.url and .key (NUXT_MERIDIAN_URL, NUXT_MERIDIAN_KEY)'

/** Adds the hint to a configuration error the core returned; other results pass through. */
async function withHint<T>(result: Promise<Result<T>>): Promise<Result<T>> {
  const settled = await result

  return settled.error
    ? { data: null, error: { ...settled.error, message: `${settled.error.message} ${MISSING_CONFIG_HINT}` } }
    : settled
}

/** The server client from runtimeConfig.meridian, for Nitro server routes. Never throws: a missing url or key gives a client whose calls return an error. */
export function useMeridianServerClient(options: ClientOptions = {}): MeridianClient {
  const { url, key } = (useRuntimeConfig() as { meridian: { url: string; key: string } }).meridian
  const client = createClient(url, key, options)

  if (url && key) return client

  return {
    chat: {
      create: (...args) => withHint(client.chat.create(...args)),
      stream: (...args) => withHint(client.chat.stream(...args))
    },
    models: { list: (...args) => withHint(client.models.list(...args)) }
  }
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

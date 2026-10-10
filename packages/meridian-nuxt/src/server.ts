import { Readable } from 'node:stream'

import { defineEventHandler, getRequestURL, toWebRequest, type H3Event } from 'h3'

import { createClient, type ClientOptions, type MeridianClient, type Result } from '@gaussian-id/meridian'
import { createForwardHandler, type AllowRule, type ForwardHandlerOptions } from '@gaussian-id/meridian/server'

import { useRuntimeConfig } from '#imports'

// Also the marker scripts/check-framework-builds.mjs looks for in client bundles
const MISSING_CONFIG_HINT =
  '@gaussian-id/meridian-nuxt: set runtimeConfig.meridian.url and .key (NUXT_MERIDIAN_URL, NUXT_MERIDIAN_KEY)'

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
  return defineEventHandler(event => forward(event.web?.request ?? nodeRequest(event)))
}

/** h3 marks a Node request whose body something already read; h3's own reader replays it. */
const READ_BODY = [Symbol.for('h3RawBody'), 'rawBody', 'body', '__unenv__'] as const

/**
 * The web Request for an event on a Node server. Its body pulls from the Node request (backpressure; the core's cancel
 * at the 8 MiB cap stops reading instead of crashing h3's push stream), and its signal aborts when the response closes
 * before it finished, so a browser that leaves closes the engine stream.
 */
function nodeRequest(event: H3Event): Request {
  const { req, res } = event.node
  const controller = new AbortController()

  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  // A body something already read (or none, for GET and the like) goes through h3's own reader
  if (event.method !== 'POST' || READ_BODY.some(mark => mark in req)) {
    return new Request(toWebRequest(event), { signal: controller.signal })
  }

  // Node's fetch needs duplex for a streamed body; lib.dom does not know it yet
  const init: RequestInit & { duplex: 'half' } = {
    method: event.method,
    headers: event.headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    signal: controller.signal,
    duplex: 'half'
  }

  return new Request(getRequestURL(event), init)
}

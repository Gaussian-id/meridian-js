import type { IncomingMessage, ServerResponse } from 'node:http'

import { createForwardRoute, type RouteHandlerOptions } from './forward-route'

type PagesRequest = IncomingMessage & { body?: unknown }

/** `export default createPagesHandler({ authorize })` in pages/api/meridian/chat.ts. */
export function createPagesHandler(
  options: RouteHandlerOptions
): (req: PagesRequest, res: ServerResponse) => Promise<void> {
  const handle = createForwardRoute(options)

  return async (req, res) => {
    // [1] Rebuild a web Request; Next has already parsed the JSON body
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const headers = new Headers()

    for (const [name, value] of Object.entries(req.headers)) {
      if (name === 'content-length' || value === undefined) continue
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }

    const body =
      req.method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)) : undefined

    // [2] A response closed before it finished cancels the upstream call (req 'close' fires after the body is read)
    const controller = new AbortController()

    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })

    const response = await handle(new Request(url, { method: req.method, headers, body, signal: controller.signal }))

    // [3] Write status, headers and the streamed body back to Node
    res.statusCode = response.status
    response.headers.forEach((value, name) => res.setHeader(name, value))

    if (!response.body) {
      res.end()

      return
    }

    const reader = response.body.getReader()

    try {
      for (;;) {
        const { value, done } = await reader.read()

        if (done) break
        res.write(value)
      }
    } catch {
      // Aborted mid-stream: the client is gone, nothing is left to report
    } finally {
      res.end()
    }
  }
}

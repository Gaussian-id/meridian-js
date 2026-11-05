<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-light.svg">
    <img alt="Gauss Meridian" src="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-dark.svg" width="360">
  </picture>
</p>

# @gaussian-id/meridian-next

Gauss Meridian for Next.js: a server-side client, App Router and Pages Router forwarding handlers, and a keyless browser client. It builds on [`@gaussian-id/meridian`](https://www.npmjs.com/package/@gaussian-id/meridian).

> **Status:** Public preview, v0.2.0. Node 22 or later. Peer dependencies: `next >= 14`, `react >= 18`, `react-dom >= 18`.

## Install

```bash
pnpm add @gaussian-id/meridian @gaussian-id/meridian-next
```

## Usage

Set `MERIDIAN_URL` and `MERIDIAN_KEY` (a `gmr_` project key) on the server. The server client is built per request from them. The key never goes to the browser.

```ts
// app/api/meridian/chat/route.ts (App Router)
import { createRouteHandler } from '@gaussian-id/meridian-next'

export const { POST } = createRouteHandler({ authorize: async request => (await getSession(request)) !== null })
```

```ts
// pages/api/meridian/chat.ts (Pages Router)
import { createPagesHandler } from '@gaussian-id/meridian-next/pages'

export default createPagesHandler({ authorize: async request => (await getSession(request)) !== null })
```

In Client Components (files with `'use client'`), use `createBrowserClient()` from `@gaussian-id/meridian-next/browser`; it is preset to `/api/meridian/chat`, holds no key, and supports `chat.stream`. `createServerClient()` (from `@gaussian-id/meridian-next`) gives a server client for Server Components, Server Actions and Route Handlers. Each entry is guarded at build time: the server entry imports `server-only` and the browser entry imports `client-only`, so importing either on the wrong side fails `next build`.

## Entry points

| Entry                                | Main export                                |
| ------------------------------------ | ------------------------------------------ |
| `@gaussian-id/meridian-next`         | `createRouteHandler`, `createServerClient` |
| `@gaussian-id/meridian-next/pages`   | `createPagesHandler`                       |
| `@gaussian-id/meridian-next/browser` | `createBrowserClient`                      |

## Documentation

The response contract, error codes, streaming and the forwarding rules are in the [full documentation](https://github.com/Gaussian-id/meridian-js/blob/main/README.md).

## Licence

Apache-2.0. The Meridian logo is a Gaussian trademark; the Apache-2.0 licence covers the code, not the logo.

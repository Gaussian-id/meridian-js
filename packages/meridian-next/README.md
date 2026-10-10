<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-light.svg">
    <img alt="Gauss Meridian" src="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-dark.svg" width="360">
  </picture>
</p>

# @gaussian/meridian-next

Gauss Meridian for Next.js: a server-side client, App Router and Pages Router forwarding handlers, and a keyless browser client. It builds on [`@gaussian/meridian`](https://www.npmjs.com/package/@gaussian/meridian).

> **Status:** Public preview, v0.1.0. Peer dependencies: `next >= 14`, `react >= 18`, `react-dom >= 18`.

## Install

```bash
pnpm add @gaussian/meridian @gaussian/meridian-next
```

## Usage

Set `MERIDIAN_URL` and `MERIDIAN_KEY` (a `gmr_` project key) on the server. The server client is built per request from them. The key never goes to the browser.

```ts
// app/api/meridian/chat/route.ts (App Router)
import { createRouteHandler } from '@gaussian/meridian-next'

export const { POST } = createRouteHandler({ authorize: async request => (await getSession(request)) !== null })
```

```ts
// pages/api/meridian/chat.ts (Pages Router)
import { createPagesHandler } from '@gaussian/meridian-next/pages'

export default createPagesHandler({ authorize: async request => (await getSession(request)) !== null })
```

In components, use `createBrowserClient()` from `@gaussian/meridian-next/browser`; it is preset to `/api/meridian/chat`. `createServerClient()` (from `@gaussian/meridian-next`) gives a server client for route handlers and server actions.

## Entry points

| Entry                             | Main export                                |
| --------------------------------- | ------------------------------------------ |
| `@gaussian/meridian-next`         | `createRouteHandler`, `createServerClient` |
| `@gaussian/meridian-next/pages`   | `createPagesHandler`                       |
| `@gaussian/meridian-next/browser` | `createBrowserClient`                      |

## Documentation

The response contract, error codes, streaming and the forwarding rules are in the [full documentation](https://github.com/Gaussian-id/meridian-js/blob/main/README.md).

## Licence

Apache-2.0. The Meridian logo is a Gaussian trademark; the Apache-2.0 licence covers the code, not the logo.

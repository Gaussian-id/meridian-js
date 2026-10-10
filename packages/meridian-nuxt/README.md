<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-light.svg">
    <img alt="Gauss Meridian" src="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-dark.svg" width="360">
  </picture>
</p>

# @gaussian/meridian-nuxt

Gauss Meridian for Nuxt: a Nuxt module with a server client, a forwarding handler and a keyless composable. It builds on [`@gaussian/meridian`](https://www.npmjs.com/package/@gaussian/meridian).

> **Status:** Public preview, v0.1.0. Peer dependencies: `nuxt >= 3.13`, `h3 >= 1.12 < 2`.

## Install

```bash
pnpm add @gaussian/meridian @gaussian/meridian-nuxt
```

## Usage

Add the module and set the private runtime config `NUXT_MERIDIAN_URL` and `NUXT_MERIDIAN_KEY` (`runtimeConfig.meridian.url` and `.key`). They are never sent to the browser.

```ts
// nuxt.config.ts
export default defineNuxtConfig({ modules: ['@gaussian/meridian-nuxt'] })

// server/api/meridian/chat.post.ts
import { defineMeridianHandler } from '@gaussian/meridian-nuxt/server'

export default defineMeridianHandler({ authorize: async request => (await getSession(request)) !== null })
```

In components, call `useMeridian()`; it is preset to `/api/meridian/chat` and is auto-imported by the module. In Nitro server routes, `useMeridianServerClient()` (from `@gaussian/meridian-nuxt/server`) gives a server client built from the runtime config.

## Entry points

| Entry                                 | Main export                                        |
| ------------------------------------- | -------------------------------------------------- |
| `@gaussian/meridian-nuxt`             | the Nuxt module                                    |
| `@gaussian/meridian-nuxt/server`      | `defineMeridianHandler`, `useMeridianServerClient` |
| `@gaussian/meridian-nuxt/composables` | `useMeridian`                                      |

## Documentation

The response contract, error codes, streaming and the forwarding rules are in the [full documentation](https://github.com/Gaussian-id/meridian-js/blob/main/README.md).

## Licence

Apache-2.0. The Meridian logo is a Gaussian trademark; the Apache-2.0 licence covers the code, not the logo.

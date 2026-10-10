<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-light.svg">
    <img alt="Gauss Meridian" src="https://raw.githubusercontent.com/Gaussian-id/meridian-js/main/assets/brand/meridian-lockup-dark.svg" width="360">
  </picture>
</p>

# @gaussian-id/meridian-expo

Gauss Meridian for Expo and React Native: a keyless client that calls your own server route. It builds on [`@gaussian-id/meridian`](https://www.npmjs.com/package/@gaussian-id/meridian).

> **Status:** Public preview, v0.1.0. Peer dependency: `expo >= 52`.

## Install

```bash
pnpm add @gaussian-id/meridian @gaussian-id/meridian-expo
```

## Usage

A mobile app has no page origin and never holds a key. Pass the **absolute** URL of your backend's forwarding route (a relative one is refused):

```ts
import { createBrowserClient } from '@gaussian-id/meridian-expo'

const meridian = createBrowserClient({ route: 'https://api.example.com/api/meridian/chat' })
```

It streams over Expo's fetch. The backend route is any `@gaussian-id/meridian/server` forwarding handler (`createForwardHandler`), which holds the `gmr_` key on your server.

## Documentation

The response contract, error codes, streaming and the forwarding rules are in the [full documentation](https://github.com/Gaussian-id/meridian-js/blob/main/README.md).

## Licence

Apache-2.0. The Meridian logo is a Gaussian trademark; the Apache-2.0 licence covers the code, not the logo.

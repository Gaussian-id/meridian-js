# meridian-js

TypeScript client SDK for the Meridian engine. Zero runtime dependencies. Runs on Node 18+, Bun, Deno and edge runtimes.

> The package names (`meridian`, `meridian-next`, `meridian-nuxt`, `meridian-expo`) are working names (O47). All packages are `"private": true` until the names, scope and public date are decided, so none of them can be installed from a registry yet.

## Install

After the first release (O47):

```bash
npm install meridian
pnpm add meridian
yarn add meridian
bun add meridian
```

```ts
// Deno
import { createClient } from 'npm:meridian'
```

## Entry points

Every public call returns `{ data, error }`. API errors are never thrown.

| Entry              | Runs in                 | Holds a key  |
| ------------------ | ----------------------- | ------------ |
| `meridian`         | server code only        | yes          |
| `meridian/browser` | the browser             | never        |
| `meridian/server`  | your app server (route) | no           |
| `meridian/admin`   | server code only        | yes (`gmi_`) |

Keys never go in the browser. `createClient` refuses to run in a browser or React Native.

### `meridian`: the server client

```ts
import { createClient } from 'meridian'

const meridian = createClient('https://YOUR-MERIDIAN-URL', process.env.MERIDIAN_KEY!)
const { data, error } = await meridian.chat.create({ messages: [{ role: 'user', content: 'hello' }] })
if (error) console.error(error.code, error.message, error.requestId)
else console.log(data.choices[0]?.message.content)
```

Streaming: `const { data: stream } = await meridian.chat.stream({ messages })`, then `await stream.text()`. List models with `meridian.models.list()`.

### `meridian/browser`: the browser client

```ts
import { createBrowserClient } from 'meridian/browser'

const meridian = createBrowserClient() // calls /api/meridian/chat
const { data: stream, error } = await meridian.chat.stream({ messages: [{ role: 'user', content: 'hi' }] })
if (!error) console.log((await stream.text()).data)
```

It calls your own route and never sends a key.

### `meridian/server`: the forwarding route

```ts
import { createClient } from 'meridian'
import { createForwardHandler } from 'meridian/server'

const client = createClient('https://YOUR-MERIDIAN-URL', process.env.MERIDIAN_KEY!)

export const POST = createForwardHandler({
  client,
  authorize: async request => (await getSession(request)) !== null // required
})
```

`authorize` is required. Without it `createForwardHandler` throws a `TypeError` when it is created. It is the only throw in the SDK.

Forwarding notes:

- `authorize` must `request.clone()` before reading the body; the handler reads the body afterwards.
- The handler accepts `POST` with `application/json` only (415 otherwise).
- By default the browser may set `messages`, `temperature` and `max_tokens`. `max_tokens` is capped at 4096. `model` and every other field are dropped unless `allow` permits them.
- `messages` are forwarded as sent. A browser can send a `system` message. If your app needs a fixed system prompt, add it server-side.
- When the engine refuses the app's own key or account (for example `invalid_api_key`, `key_revoked`, `insufficient_credit`, `hard_limit_reached`), the browser gets a generic 503 `service_unavailable` with the request id, in a stream frame too. A setup or configuration error (for example a missing key or a bad engine URL) becomes the same generic 503. This generic envelope is non-retryable, so the browser client does not retry it. Your server-side client still sees the real error.
- The handler sets no body-size limit. Apply one in your app server.
- The browser client's default route is relative, so it needs a browser. Use an absolute `route` anywhere else.
- Cookies are sent for same-origin routes by default. A cross-origin route needs a custom `fetch`.
- The `idempotency-key` header triggers a CORS preflight on cross-origin routes.

> `ChatParams` accepts extra keys because the engine forwards unknown request fields. A typo such as `temprature` is therefore not a compile error.

### `meridian/admin`: the admin client

Provisioning with an integrator key (`gmi_`). Server-only: like `createClient`, it refuses to run in a browser or React Native.

```ts
import { createAdminClient } from 'meridian/admin'

const admin = createAdminClient('https://YOUR-MERIDIAN-ADMIN-URL', process.env.MERIDIAN_ADMIN_KEY!)
const { data: org, error } = await admin.orgs.create({ name: 'Acme', external_reference: 'acme-1' })
```

The 21 operations at a glance (every call returns `{ data, error }`):

| Group                 | Operations                                  |
| --------------------- | ------------------------------------------- |
| `orgs`                | `create`, `get`, `getByReference`, `list`   |
| `projects`            | `create`, `get`, `list`, `update`, `delete` |
| `keys`                | `create`, `list`, `revoke`                  |
| `providerCredentials` | `list`, `put`, `delete`                     |
| `projectModels`       | `get`, `put`                                |
| `models`              | `list`, `get`                               |
| `analytics`           | `usage`                                     |
| `logs`                | `list`                                      |

`keys.create` returns the new `api_key` once, so store it.
Prices are never exposed (D-27). The client wraps the engine's integrator-key operations except the two supplier-catalogue price operations (`GET /v1/catalogue` and `GET /v1/catalogue/{version}`), so there are no `catalogue` methods. Every reply also loses any `cost`, `price`, `per_million`, `recovery_rate` or `write_off_rate` field, in the types and in the data; `rate_limit_*` fields stay. A billing service reads supplier prices from the engine's admin API directly.

## Framework packages

All are private working names until O47. The browser never holds a key in any of them.

### `meridian-next`

Set `MERIDIAN_URL` and `MERIDIAN_KEY` on the server. The server client is built per request from them.

```ts
// app/api/meridian/chat/route.ts (App Router)
import { createRouteHandler } from 'meridian-next'

export const { POST } = createRouteHandler({ authorize: async request => (await getSession(request)) !== null })
```

```ts
// pages/api/meridian/chat.ts (Pages Router)
import { createPagesHandler } from 'meridian-next/pages'

export default createPagesHandler({ authorize: async request => (await getSession(request)) !== null })
```

In components, use `createBrowserClient()` from `meridian-next/browser`; it is preset to `/api/meridian/chat`. `createServerClient()` gives a server client for route handlers and server actions.

### `meridian-nuxt`

Add the module and set the private runtime config `NUXT_MERIDIAN_URL` and `NUXT_MERIDIAN_KEY` (`runtimeConfig.meridian.url` and `.key`). They are never sent to the browser.

```ts
// nuxt.config.ts
export default defineNuxtConfig({ modules: ['meridian-nuxt'] })

// server/api/meridian/chat.post.ts
import { defineMeridianHandler } from 'meridian-nuxt/server'

export default defineMeridianHandler({ authorize: async request => (await getSession(request)) !== null })
```

In components, call `useMeridian()`; it is preset to `/api/meridian/chat`.

### `meridian-expo`

A mobile app has no page origin and never holds a key. Pass the **absolute** URL of your backend's forwarding route:

```ts
import { createBrowserClient } from 'meridian-expo'

const meridian = createBrowserClient({ route: 'https://api.example.com/api/meridian/chat' })
```

It streams over Expo's fetch. The backend route is any `meridian/server` forwarding handler.

## Direct API

No SDK needed. Use the engine's chat endpoint:

```bash
curl -sN https://YOUR-MERIDIAN-URL/v1/chat/completions \
  -H "Authorization: Bearer $MERIDIAN_KEY" -H 'content-type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"hello"}]}'
```

To generate your own client, use `spec/meridian-public.json` and `spec/meridian-admin.json`.

## Contract run

The suite normally runs against an in-memory fake engine. `node scripts/contract.mjs` runs it against the real local engine instead. That run is deferred by the owner and has not been made. The script refuses (naming variables only, never values) unless all of these hold:

- no paid provider key (`GAUSSMERIDIAN_GEMINI_API_KEY`, `GAUSSMERIDIAN_OPENROUTER_API_KEY`) is set in the process environment (any letter case) or in any engine env file: the canonical `meridian-engine.env` in the runtime folder, the one in `MERIDIAN_RUNTIME_DIR`, and the `GAUSSMERIDIAN_ENV_FILE` target are all read. Any character outside printable ASCII and tab anywhere in the file (after one leading byte order mark), a lone CR included, is refused: the file cannot be checked. The files are not parsed: any line that names a paid key, in any letter case, sets it unless the line is exactly an empty assignment (`NAME=` or `NAME=""`, optionally after `export ` or `set `), so a whitespace-only value counts as set and so does `NAME=''` (both local-up readers keep the two quotes, which turns simulator mode off). A test compares this with the three readers that matter, each when its tool is installed: `docker compose config`, a copy of local-up.ps1's `Get-EnvValue` under `pwsh` and a copy of local-up.sh's `env_value` under `bash`;
- every path it reads stays inside the local runtime folder (`%LOCALAPPDATA%\Gaussian\MeridianEngine`, else `${XDG_STATE_HOME:-~/.local/state}/gaussian/meridian-engine`) after symlinks, junctions and `..`;
- every engine URL is loopback. `localhost` is accepted, but it is resolved by the system resolver (hosts file, DNS), which the guard does not control; prefer `http://127.0.0.1:8180` or `http://[::1]:8180`;
- no `http`, `https` or `all` proxy is set in the environment (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, any letter case) and, on Windows, no proxy server entry of any kind (SOCKS and FTP included) is in the registry (read even when `NO_PROXY` is set; a registry that cannot be read counts as a proxy). A PAC file, WPAD and the WinHTTP proxy are not detected; the suite runs with `NO_PROXY=*` so its own traffic ignores them.

The suite runs as `node node_modules/vitest/vitest.mjs run --passWithNoTests`, not through pnpm: nothing is installed or resolved, nothing is fetched, and no `.env` file adds variables (`envDir` is off in `vitest.config.ts`; `NODE_OPTIONS` is dropped). In contract mode `describeFake` suites are not registered at all, so no option makes them run against the real engine; `describeEngine` suites run against both engines, and a test outside either fails as soon as it asks for an engine. A direct `MERIDIAN_CONTRACT=1` run meets the same guard before it reads a key.

What the guard does not cover: it reads files and its own environment, not the running engine. The environment of the process that runs `docker compose` (a bare `NAME` line inherits from it), a runtime folder made elsewhere through `LOCALAPPDATA`, and other variables that reach the network (`GAUSSMERIDIAN_DECISION_*`, `GAUSSMERIDIAN_USAGE_RECEIVER_URL`) are outside the two-key rule. Whether a contract run must require simulator mode or inspect the running engine container's environment (by name only) is an open owner decision; it is settled before any contract run.

Engine-side carry (not changed here): `Get-EnvValue` in the engine's `scripts/local-common.ps1` uses a culture-sensitive `StartsWith`, which skips control characters, marks and some letters inside a name; it should use `StartsWith("$Name=", [StringComparison]::Ordinal)`. Both local-up readers (`Get-EnvValue` and `env_value` in `scripts/local-common.sh`) strip double quotes only, so `NAME=''` turns simulator mode off; both should strip single quotes too. Until then the guard refuses what those readers would read differently.

## Development

`pnpm gate` runs lint, format check, typecheck, tests, spec drift, build, the browser-bundle check, the runtime smoke test and `check:frameworks` (builds the Next and Nuxt fixtures and proves no key reaches a client bundle). The smoke script also runs on Bun (`bun scripts/runtime-smoke.mjs`) and Deno (`deno run --allow-read scripts/runtime-smoke.mjs`).

Licence: Apache-2.0.

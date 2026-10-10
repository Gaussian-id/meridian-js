<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/meridian-lockup-light.svg">
    <img alt="Gauss Meridian" src="assets/brand/meridian-lockup-dark.svg" width="360">
  </picture>
</p>

# meridian-js

The official TypeScript SDK for Gauss Meridian: one API for many AI models, routed by Meridian.

> **Status:** private and unpublished. Every package is `"private": true` at version `0.0.0`; the names (`meridian`, `meridian-next`, `meridian-nuxt`, `meridian-expo`) are working names (O47), so none can be installed from a registry yet. Runtime floor: Node 18 (`engines.node >= 18`). The core package has zero runtime dependencies and also runs on Bun, Deno and edge runtimes.

## Contents

- [Packages](#packages)
- [Install](#install)
- [Quick start](#quick-start)
- [Three ways to connect](#three-ways-to-connect)
- [Response contract](#response-contract)
- [Streaming](#streaming)
- [Forwarding route](#forwarding-route)
- [Admin client](#admin-client)
- [Retries, timeouts and idempotency](#retries-timeouts-and-idempotency)
- [Configuration](#configuration)
- [Contract run (simulator only)](#contract-run-simulator-only)
- [Development](#development)

## Packages

| Package         | Entry points                                                                  | Holds a key                      |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| `meridian`      | `meridian`, `meridian/browser`, `meridian/server`, `meridian/admin`           | depends on the entry (see below) |
| `meridian-next` | `meridian-next`, `meridian-next/pages`, `meridian-next/browser`               | server side only                 |
| `meridian-nuxt` | `meridian-nuxt` (module), `meridian-nuxt/server`, `meridian-nuxt/composables` | server side only                 |
| `meridian-expo` | `meridian-expo`                                                               | never                            |

| Core entry         | Runs in                 | Holds a key  | Main export                                   |
| ------------------ | ----------------------- | ------------ | --------------------------------------------- |
| `meridian`         | server code only        | yes (`gmr_`) | `createClient(url, key, options?)`            |
| `meridian/browser` | the browser             | never        | `createBrowserClient(options?)`               |
| `meridian/server`  | your app server (route) | no           | `createForwardHandler({ client, authorize })` |
| `meridian/admin`   | server code only        | yes (`gmi_`) | `createAdminClient(adminUrl, key, options?)`  |

Keys never go in the browser. `createClient` and `createAdminClient` refuse to run in a browser or React Native.

## Install

Until the first release (O47) nothing is on a registry. Install from a checkout:

```bash
git clone <this repository> meridian-js
cd meridian-js
pnpm install
pnpm build
```

Then point your app at the built package folder (the packages ship `dist` only, so build first):

```bash
pnpm add link:/path/to/meridian-js/packages/meridian
```

After the first release the package names will be:

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

The framework packages (`meridian-next`, `meridian-nuxt`, `meridian-expo`) depend on `meridian` and install the same way.

## Quick start

Set `MERIDIAN_KEY` (a `gmr_` project key) in your server environment. Never write the key in code.

A buffered chat call:

```ts
import { createClient } from 'meridian'

const meridian = createClient('https://YOUR-MERIDIAN-URL', process.env.MERIDIAN_KEY!)

const { data, error } = await meridian.chat.create({
  messages: [{ role: 'user', content: 'hello' }]
})

if (error) console.error(error.code, error.message, error.requestId)
else console.log(data.choices[0]?.message.content)
```

A streaming call:

```ts
const { data: stream, error } = await meridian.chat.stream({
  messages: [{ role: 'user', content: 'hello' }]
})

if (error) {
  console.error(error.code, error.message)
} else {
  for await (const chunk of stream) process.stdout.write(chunk.delta)

  if (stream.error)
    console.error(stream.error.code) // the stream ended with an error
  else console.log(stream.usage) // { prompt_tokens, completion_tokens, total_tokens }
}
```

List the models: `const { data: models } = await meridian.models.list()`.

## Three ways to connect

### 1. Server client

`createClient` (above) runs on your server and holds the key.

### 2. Forwarding route, for browsers and mobile apps

A browser or mobile app never holds a key. It calls a route on your own backend, and that route holds the key. The core pieces:

```ts
// Your server: the route
import { createClient } from 'meridian'
import { createForwardHandler } from 'meridian/server'

const client = createClient('https://YOUR-MERIDIAN-URL', process.env.MERIDIAN_KEY!)

export const POST = createForwardHandler({
  client,
  authorize: async request => (await getSession(request)) !== null // required
})
```

```ts
// Your browser code: the client
import { createBrowserClient } from 'meridian/browser'

const meridian = createBrowserClient() // calls /api/meridian/chat
const { data: stream, error } = await meridian.chat.stream({ messages: [{ role: 'user', content: 'hi' }] })
if (!error) console.log((await stream.text()).data)
```

`createBrowserClient` sends no key. Its default `route` is `/api/meridian/chat` and it is relative, so it needs a browser; use an absolute `route` anywhere else.

The framework packages preset both sides:

| Framework | Server route                                                                         | Client                                             |
| --------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Next.js   | `createRouteHandler` (`meridian-next`), `createPagesHandler` (`meridian-next/pages`) | `createBrowserClient()` (`meridian-next/browser`)  |
| Nuxt      | `defineMeridianHandler` (`meridian-nuxt/server`)                                     | `useMeridian()` (auto-imported by the module)      |
| Expo      | any `meridian/server` handler on your backend                                        | `createBrowserClient({ route })` (`meridian-expo`) |

**Next.js.** Set `MERIDIAN_URL` and `MERIDIAN_KEY` on the server. The server client is built per request from them.

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

In components, use `createBrowserClient()` from `meridian-next/browser`; it is preset to `/api/meridian/chat`. `createServerClient()` (from `meridian-next`) gives a server client for route handlers and server actions.

**Nuxt.** Add the module and set the private runtime config `NUXT_MERIDIAN_URL` and `NUXT_MERIDIAN_KEY` (`runtimeConfig.meridian.url` and `.key`). They are never sent to the browser.

```ts
// nuxt.config.ts
export default defineNuxtConfig({ modules: ['meridian-nuxt'] })

// server/api/meridian/chat.post.ts
import { defineMeridianHandler } from 'meridian-nuxt/server'

export default defineMeridianHandler({ authorize: async request => (await getSession(request)) !== null })
```

In components, call `useMeridian()`; it is preset to `/api/meridian/chat`. In Nitro server routes, `useMeridianServerClient()` (from `meridian-nuxt/server`) gives a server client built from the runtime config.

**Expo.** A mobile app has no page origin and never holds a key. Pass the **absolute** URL of your backend's forwarding route (a relative one is refused):

```ts
import { createBrowserClient } from 'meridian-expo'

const meridian = createBrowserClient({ route: 'https://api.example.com/api/meridian/chat' })
```

It streams over Expo's fetch. The backend route is any `meridian/server` forwarding handler.

### 3. Direct HTTP API

No SDK needed:

```bash
curl -sN https://YOUR-MERIDIAN-URL/v1/chat/completions \
  -H "Authorization: Bearer $MERIDIAN_KEY" -H 'content-type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"hello"}]}'
```

To generate your own client, use `spec/meridian-public.json` and `spec/meridian-admin.json`.

## Response contract

### The result

Every public call resolves to a `Result<T>` and never rejects:

```ts
type Result<T> = { data: T; error: null } | { data: null; error: MeridianError }
```

API errors are values, never thrown. **The one exception:** `createForwardHandler` throws a `TypeError` when it is created without an `authorize` function (the Next, Nuxt and Expo wrappers inherit it). Misconfiguration of a client (an empty key, a bad URL, a browser runtime) is not a throw: the client is still returned and every call resolves to an `invalid_request` error with `type: 'client_error'` and `status: 0`.

### Chat completion (`chat.create`)

`ChatCompletion` follows the engine's OpenAPI schema (`spec/meridian-public.json`):

| Field     | Meaning                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `id`      | `chatcmpl-<request id>`                                                                                    |
| `object`  | the completion object tag                                                                                  |
| `created` | Unix seconds when the request started                                                                      |
| `model`   | the model that served, after any routing and fallback                                                      |
| `choices` | exactly one choice: `index`, `finish_reason` (`stop`, `length`, `tool_calls`, `content_filter`), `message` |
| `usage`   | `{ prompt_tokens, completion_tokens, total_tokens }`, only those present                                   |

`message` holds `role` (`assistant`) and `content`, plus `reasoning`, `reasoning_content`, `refusal` and `tool_calls` when the reply had them.

`ChatParams` is the engine's request body without `stream` and `stream_options` (the SDK owns those). `model` is optional: absent means `meridian/auto`. It accepts extra keys because the engine forwards unknown request fields, so a typo such as `temprature` is not a compile error.

### Stream chunk

Each iteration of a `ChatStream` yields `{ delta, raw }`: `delta` is the text piece (`''` when the chunk has none) and `raw` is the full chunk (`choices[0].delta` can also carry `role`, `reasoning`, `refusal` and `tool_calls`).

### Usage

Three token counts and nothing else: `prompt_tokens`, `completion_tokens`, `total_tokens`. The SDK drops every other usage field, and exposes no cost or price field anywhere.

### The error object

```ts
interface MeridianError {
  code: MeridianErrorCode
  type: MeridianErrorType
  status: number // HTTP status; 0 for an error that never reached the engine
  message: string
  retryable: boolean
  requestId?: string // from the envelope or the x-request-id header, when valid
  engineCode?: string // the engine's own code when this SDK does not know it (code is then 'internal')
  retryAfter?: string // the response's Retry-After when valid, trimmed (delta-seconds or an HTTP date)
}
```

`type` is one of `invalid_request_error`, `authentication_error`, `permission_error`, `rate_limit_error`, `api_error` (from the engine) or `client_error` (the SDK's own: `network_error`, `aborted` and configuration errors). An unknown `type` from the engine arrives as `api_error`.

### Error codes

The 28 engine codes and the SDK's two own codes. Status is the HTTP status the engine uses; a code is retryable by the SDK as listed.

| Code                       | Status                | Retryable                                                    |
| -------------------------- | --------------------- | ------------------------------------------------------------ |
| `invalid_request`          | 400                   | no                                                           |
| `capability_unsupported`   | 400                   | no                                                           |
| `invalid_api_key`          | 401                   | no                                                           |
| `key_revoked`              | 401                   | no                                                           |
| `key_expired`              | 401                   | no                                                           |
| `invalid_token`            | 401                   | no                                                           |
| `insufficient_credit`      | 402                   | no                                                           |
| `project_unavailable`      | 403                   | no                                                           |
| `organisation_unavailable` | 403                   | no                                                           |
| `model_not_allowed`        | 403                   | no                                                           |
| `byok_required`            | 403                   | no                                                           |
| `project_host_mismatch`    | 403                   | no                                                           |
| `permission_denied`        | 403                   | no                                                           |
| `entitlement_missing`      | 403                   | no                                                           |
| `model_not_found`          | 404                   | no                                                           |
| `route_not_found`          | 404                   | no                                                           |
| `not_found`                | 404                   | no                                                           |
| `method_not_allowed`       | 405                   | no                                                           |
| `idempotency_conflict`     | 409                   | no                                                           |
| `conflict`                 | 409                   | no                                                           |
| `body_too_large`           | 413                   | no                                                           |
| `rate_limited`             | 429                   | yes                                                          |
| `hard_limit_reached`       | 429                   | no                                                           |
| `internal`                 | 500                   | no                                                           |
| `upstream_unavailable`     | 502                   | yes                                                          |
| `upstream_error`           | 502                   | no                                                           |
| `service_unavailable`      | 503                   | yes                                                          |
| `deadline_exceeded`        | 504                   | yes                                                          |
| `network_error` (SDK)      | the real status, or 0 | yes (a non-envelope reply is retryable only for 429 and 5xx) |
| `aborted` (SDK)            | 0                     | no                                                           |

Notes:

- A code this SDK does not know (a newer engine) arrives as `internal`, not retryable, with the engine's own code in `error.engineCode`.
- A forwarding route marks the generic errors it builds `retryable: false`, and the SDK honours that.
- Replies the SDK cannot use are `network_error` with the real status: a body that is not Meridian's envelope (a proxy page, an HTML 404, a plain 429), a 2xx whose top level carries a non-null `error` (or a case variant such as `Error` or `CHOICES`), a literal `null`, a 204 for anything but a delete, JSON with a number JSON cannot hold (`1e999`), an error body over 1 MiB or a reply over 64 MiB (refused, never truncated).

## Streaming

```ts
const { data: stream, error } = await meridian.chat.stream({ messages })
if (error) return // refused before any byte: an ordinary error value

for await (const chunk of stream) process.stdout.write(chunk.delta)

stream.error // MeridianError | null: how the stream ended
stream.usage // Usage | null: filled from the final usage chunk
stream.requestId // string | null: the x-request-id header, when valid
```

| Member                 | What it does                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `for await (... of s)` | yields `{ delta, raw }` per chunk and ends at `[DONE]` or on an error                    |
| `text()`               | reads the whole stream; resolves to `Result<string>` (the error, if the stream failed)   |
| `cancel()`             | stops the request upstream; the stream ends with `aborted` ("The stream was cancelled.") |
| `toResponse(init?)`    | re-emits the engine's events byte for byte as an SSE `Response` (what a route returns)   |
| `usage`                | the three token counts, set when the engine's usage chunk arrived                        |
| `error`                | `null` after a clean end                                                                 |

- **Cancel:** call `stream.cancel()`, or pass a `signal` in the call options and abort it. Both end the stream with `aborted`. Breaking out of the loop early also cancels the engine's stream.
- **Mid-stream error:** an error frame from the engine, a body that breaks, a frame that is not valid JSON, or a body that ends without `[DONE]` stops the iteration without throwing. `stream.error` holds it (`network_error` for a broken or truncated body, the engine's code for an error frame) and `text()` returns it. Chunks already yielded stay valid; `usage` may be `null`.
- **Second read:** a stream is read once. A second `for await`, `text()` or `toResponse()` ends at once with `aborted` ("This stream was already read.").
- `chat.stream` always asks the engine for the usage chunk, so `usage` is filled without any option.

## Forwarding route

`createForwardHandler({ client, authorize, allow? })` returns `(request: Request) => Promise<Response>`.

```ts
createForwardHandler({
  client, // a client with `chat`, or a function returning one (called once per request)
  authorize: async request => true, // required
  allow: { model: ['meridian/auto'], maxTokensCap: 2048, options: ['top_p'] } // optional
})
```

### `authorize`

| It returns                  | The handler                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `true`                      | continues                                                         |
| a `Response`                | returns that response as is (your own 401, a login redirect, ...) |
| anything else, or it throws | 403 `permission_denied`                                           |

`authorize` is required: without it `createForwardHandler` throws a `TypeError` when it is created. It must `request.clone()` before reading the body; the handler reads the body afterwards.

### Request rules

| Rule         | Value                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Method       | `POST` only (405 `method_not_allowed`)                                                             |
| Content type | `application/json` only (415)                                                                      |
| Body         | UTF-8 JSON, no byte order mark; an object with a non-empty `messages` list (400 `invalid_request`) |
| Size         | 8 MiB, read chunk by chunk and refused past it (413 `body_too_large`); the rest is never read      |
| Depth        | nested no deeper than 64 levels (400 `invalid_request`)                                            |

A client that is still uploading when the 413 is sent can see a connection reset instead of the 413, because the rest of the body is never read.

### Fields the browser may set

| Field         | Rule                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `messages`    | always forwarded as sent (a browser can send a `system` message; add a fixed one server side) |
| `temperature` | forwarded when it is a number                                                                 |
| `max_tokens`  | capped at `allow.maxTokensCap` (default 4096); when absent, the cap is used                   |
| `model`       | dropped unless `allow.model` is `true` (any) or a list that contains it                       |
| others        | dropped unless named in `allow.options`                                                       |

`allow.options` can never copy `model`, `stream`, `stream_options`, `messages`, `max_tokens`, `max_completion_tokens`, `temperature` or `n` raw. `stream` is read only to choose between a buffered and a streamed reply; the engine call is always made by the SDK.

### Idempotency keys

The browser's `idempotency-key` header is forwarded only when it follows the engine's rule (1 to 255 visible ASCII characters, 0x21 to 0x7E); otherwise the server client makes one.

### What the browser sees on errors

The handler fails closed. The browser gets a generic, non-retryable 503 `service_unavailable` ("The service is temporarily unavailable.", with the request id, in a stream frame too, and never a `Retry-After`) when:

- the engine refuses the app's own key or account: `invalid_api_key`, `key_revoked`, `key_expired`, `project_unavailable`, `organisation_unavailable`, `project_host_mismatch`, `byok_required`, `insufficient_credit`, `hard_limit_reached`, `entitlement_missing`;
- the code is one this SDK does not recognise;
- an error has no usable code (missing, empty, not a string, or a case variant of a member such as `Error` or `Code`);
- a 2xx reply carries an `error`;
- any setup or transport error occurs (a missing key, a bad engine URL, a network failure).

Your server-side client still sees the real error. Any other engine error passes with its status. A `rate_limited` keeps the engine's valid `Retry-After`.

### Streams through the route

- A stream is judged event by event before any byte reaches the browser. Events with a known code pass byte for byte; an event with a hidden code becomes the generic frame.
- Content the guard cannot judge (an `event:` other than `message`, a field other than `data`, `id`, `retry` or a comment, `data` that is not a JSON object or `[DONE]`, an `error` that is no object with a non-empty string code, a body that ends without a `data` line, a broken body) ends the stream with the generic frame and closes the engine's stream.
- The engine's stream is closed on every exit: a clean end, a fail-closed end, a broken body, a browser that goes away mid-stream, and a request that aborts before the first byte or while a custom `fetch` ignores the abort.
- **Direct connection assumed.** The guard assumes the SDK talks to the engine directly. A proxy that adds `event:` lines or other fields makes every stream fail closed.

### Other notes

- A request id reaches a response header or a body the SDK builds only when it is 1 to 255 printable ASCII characters with no space first or last; otherwise it is left out.
- Cookies are sent for same-origin routes by default. A cross-origin route needs a custom `fetch`, and the `idempotency-key` header triggers a CORS preflight.

## Admin client

Provisioning with an integrator key (`gmi_`) on the engine's admin listener. Server-only.

```ts
import { createAdminClient } from 'meridian/admin'

const admin = createAdminClient('https://YOUR-MERIDIAN-ADMIN-URL', process.env.MERIDIAN_ADMIN_KEY!)
const { data: org, error } = await admin.orgs.create({ name: 'Acme', external_reference: 'acme-1' })
```

Request and reply shapes are the engine's own (snake_case), typed from `spec/meridian-admin.json`. The 21 operations:

| Method                                         | What it does                                                |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `orgs.create(body)`                            | create an organisation (idempotent by `external_reference`) |
| `orgs.get(org)`                                | read an organisation                                        |
| `orgs.getByReference(reference)`               | read an organisation by your reference                      |
| `orgs.list()`                                  | list organisations                                          |
| `projects.create(org, body)`                   | create a project                                            |
| `projects.get(org, project)`                   | read a project                                              |
| `projects.list(org)`                           | list an organisation's projects                             |
| `projects.update(org, project, body)`          | update a project                                            |
| `projects.delete(org, project)`                | delete a project                                            |
| `keys.create(org, project, body?)`             | issue a project key (`gmr_`); returns `api_key` once        |
| `keys.list(org, project)`                      | list a project's keys                                       |
| `keys.revoke(org, project, key)`               | revoke a key                                                |
| `providerCredentials.list(org)`                | list provider credentials                                   |
| `providerCredentials.put(org, provider, body)` | set a provider credential                                   |
| `providerCredentials.delete(org, provider)`    | delete a provider credential                                |
| `projectModels.get(org, project)`              | read a project's model settings                             |
| `projectModels.put(org, project, body)`        | replace a project's model settings                          |
| `models.list()`                                | list the models                                             |
| `models.get(model)`                            | read one model                                              |
| `analytics.usage(query)`                       | usage analytics                                             |
| `logs.list(query)`                             | request logs                                                |

Every call returns `Result<T>`. A delete or revoke resolves to `{ data: null, error: null }` on success.

- **Retries.** Reads and deletes are retried like any call. Writes (`POST`, `PUT`, `PATCH`) are retried only after `rate_limited`, which means the engine did not run them. `orgs.create` is also retried normally when it has a non-blank `external_reference`, by which the engine replays it.
- **Refused ids.** A resource id that is empty, `.` or `..` (also after one percent-decode), or an organisation id that reads as `by-reference`, is refused as a configuration error and nothing is sent.
- **Issued-key redaction.** `keys.create` returns the new `api_key` once, so store it. Inspection and logging hide it: `util.inspect`, `console.log` (Node, Bun) and Deno's console show `'[redacted]'`. It is still a plain field, so `JSON.stringify`, `%j` (`console.log('%j', data)`, `util.format`), a spread (`{ ...data }`, which drops the redaction) and JSON loggers such as pino or winston carry the key, on purpose (it has to reach your store). Keep the result out of logs.
- **No prices.** The client wraps the engine's integrator-key operations except the two supplier-catalogue price operations (`GET /v1/catalogue` and `GET /v1/catalogue/{version}`), so there are no `catalogue` methods. Every reply also loses any `cost`, `price`, `per_million`, `recovery_rate` or `write_off_rate` field, in the types and in the data; `rate_limit_*` fields stay (D-27). A billing service reads supplier prices from the engine's admin API directly.

## Retries, timeouts and idempotency

| Setting          | Rule                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxRetries`     | default 2; negative or fractional values are floored to a whole number of at least 0                                                                                                                                                       |
| Retried errors   | `rate_limited`, `upstream_unavailable`, `service_unavailable`, `deadline_exceeded`, `network_error`; only before the first byte                                                                                                            |
| Back-off         | 500 ms x 2^attempt plus up to 250 ms of jitter                                                                                                                                                                                             |
| `Retry-After`    | honoured as delta-seconds or an HTTP date up to 30 s; a longer one is returned at once, without waiting                                                                                                                                    |
| `timeout`        | the wait for response headers: 300 s for `chat.create` (a buffered reply may take minutes), 60 s for streams, models and admin calls. A `timeout` you pass applies to every call; values over 2^31 - 1 ms are clamped to that              |
| Repeatable calls | reads, deletes, chat calls (they carry an idempotency key) and an `orgs.create` with a reference; any other write only after `rate_limited`                                                                                                |
| Chat idempotency | one key per call, kept across its retries. If a retry is answered with `idempotency_conflict`, the previous attempt's error is returned (unless that was `rate_limited`, after which the engine has released the key)                      |
| `idempotencyKey` | `RequestOptions.idempotencyKey` must be 1 to 255 visible ASCII characters (0x21 to 0x7E), the engine's rule; anything else is a configuration error and nothing is sent. An empty key, or none, makes a fresh one. Only chat calls send it |

A `signal` in `RequestOptions` aborts a call, including a wait between retries; the result is `aborted`.

## Configuration

Client options (`createClient`, `createAdminClient`, `createBrowserClient`):

| Option       | Default              | Meaning                                                                                |
| ------------ | -------------------- | -------------------------------------------------------------------------------------- |
| `fetch`      | global `fetch`       | a custom `fetch`; with none available, calls return a configuration error              |
| `timeout`    | see above            | milliseconds to wait for response headers                                              |
| `maxRetries` | `2`                  | retries for retryable errors before the first byte                                     |
| `route`      | `/api/meridian/chat` | `createBrowserClient` only: your forwarding route (absolute for Expo and React Native) |

Per call (`RequestOptions`): `signal`, and `idempotencyKey` (chat calls).

Forwarding (`allow`): `model` (`true` or a list), `maxTokensCap` (default 4096), `options` (extra field names).

Environment and runtime config:

| Variable                                 | Used by         | Meaning                                                                                      |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `MERIDIAN_URL`, `MERIDIAN_KEY`           | `meridian-next` | engine URL and `gmr_` key, read per request by `createServerClient()` and the route handlers |
| `NUXT_MERIDIAN_URL`, `NUXT_MERIDIAN_KEY` | `meridian-nuxt` | private `runtimeConfig.meridian.url` and `.key`                                              |

The core package reads no environment variable itself. `ENGINE_API_VERSION` and `ENGINE_SPEC_COMMIT` (exported by `meridian`) name the engine API version and the commit the SDK was generated from.

## Contract run (simulator only)

The suite normally runs against an in-memory fake engine. `pnpm test:contract` (that is, `node scripts/contract.mjs`) runs it against the real local engine instead, and only in **simulator mode**: the engine's fake provider answers, so the run makes no paid call.

**Setup.** Start the engine with both provider keys empty (local-up then adds the simulator override), with `LOCALAPPDATA` pointing at the runtime folder the engine was started from (a throwaway one is fine), then run the command with the same `LOCALAPPDATA`. Set `GAUSSMERIDIAN_LOCAL_PROJECT` only if the engine's compose project is not `meridian-engine`, and `MERIDIAN_PUBLIC_URL` / `MERIDIAN_ADMIN_URL` only if the engine does not publish 8180 / 8181.

**The guard.** The script refuses (naming variables only, never values) unless all of these hold:

- no paid provider key (`GAUSSMERIDIAN_GEMINI_API_KEY`, `GAUSSMERIDIAN_OPENROUTER_API_KEY`) is set in the process environment (any letter case) or in any engine env file: the canonical `meridian-engine.env` in the runtime folder, the one in `MERIDIAN_RUNTIME_DIR`, and the `GAUSSMERIDIAN_ENV_FILE` target are all read. Any character outside printable ASCII and tab anywhere in the file (after one leading byte order mark), a lone CR included, is refused: the file cannot be checked. The files are not parsed: any line that names a paid key, in any letter case, sets it unless the line is exactly an empty assignment (`NAME=` or `NAME=""`, optionally after `export ` or `set `), so a whitespace-only value counts as set and so does `NAME=''` (both local-up readers keep the two quotes, which turns simulator mode off). A test compares this with the three readers that matter, each when its tool is installed: `docker compose config`, a copy of local-up.ps1's `Get-EnvValue` under `pwsh` and a copy of local-up.sh's `env_value` under `bash`;
- every path it reads stays inside the local runtime folder (`%LOCALAPPDATA%\Gaussian\MeridianEngine`, else `${XDG_STATE_HOME:-~/.local/state}/gaussian/meridian-engine`) after symlinks, junctions and `..`;
- every engine URL is loopback. `localhost` is accepted, but it is resolved by the system resolver (hosts file, DNS), which the guard does not control; prefer `http://127.0.0.1:8180` or `http://[::1]:8180`;
- no `http`, `https` or `all` proxy is set in the environment (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, any letter case) and, on Windows, no proxy server entry of any kind (SOCKS and FTP included) is in the registry (read even when `NO_PROXY` is set; a registry that cannot be read counts as a proxy). Only the current user's Internet Settings (`HKCU`) are read, not machine-wide policy (`HKLM`). A PAC file, WPAD and the WinHTTP proxy are not detected; the suite runs with `NO_PROXY=*` so its own traffic ignores them;
- the running engine is proven to be the simulator, by asking the local `docker` with a fixed argv (no shell) and printing only match tokens, never a value, never raw `docker inspect`, the environment or logs: (S1) exactly one `provider-sim` container runs in the compose project; (S2) exactly one `engine` container runs and owns host ports 8180 and 8181 on `127.0.0.1`, as the URLs say; (S3) its environment holds, by exact comparison inside the docker template, the simulator base URLs (`provider-sim:8184`), `GAUSSMERIDIAN_PROVIDER_SIMULATOR=true` and the public dummy `sim-local-key` for both paid keys (and nothing else is read); (S4) its compose `environment_file` label is the env file of the runtime folder the guard resolved. If docker is missing, fails, or any of this differs, the run is refused. Without the label, a marker file `.sim-started-<container id>` in the runtime folder, holding the engine container id, is accepted instead.

**The matrix.** Once the guard and `/ready` pass, `simulator.contract.ts` (picked up only in contract mode, never by `pnpm test`) runs the contract matrix. It starts with a canary: the reply must be the simulator's fixed `sim token 1` to `sim token 10` with 10 completion tokens, or the whole run stops. Then: chat create, an invalid key (`invalid_api_key`), a stream of exactly ten text pieces plus usage, admin provisioning (organisation, project, key issue, list, revoke), a revoked key used directly (refused), forwarding through the core handler against the real engine (buffered and streamed), forwarding with the revoked key (the generic 503), and the `sim-fail` model's fallback (the reply shape only). Each run creates its own organisation, so the seeded keys are never revoked. Mid-stream errors cannot be produced by the simulator, so they stay fake-only.

**How it runs.** The suite runs as `node node_modules/vitest/vitest.mjs run --passWithNoTests`, not through pnpm: nothing is installed or resolved, nothing is fetched, and no `.env` file adds variables (`envDir` is off in `vitest.config.ts`; `NODE_OPTIONS` is dropped). In contract mode `describeFake` suites are not registered at all, so no option makes them run against the real engine; `describeEngine` suites run against both engines, and a test outside either fails as soon as it asks for an engine. A direct `MERIDIAN_CONTRACT=1` run meets the same guard before it reads a key.

**What the guard does not cover.** Other variables that reach the network (`GAUSSMERIDIAN_DECISION_*`, `GAUSSMERIDIAN_USAGE_RECEIVER_URL`) are outside the two-key rule, and the environment of the process that starts `docker compose` should be scrubbed of `GAUSSMERIDIAN_*`, `COMPOSE_*` and proxy variables by whoever starts the engine. A throwaway `LOCALAPPDATA` is honoured only because (S1) to (S4) prove the live engine is the simulator and was started from that folder; a real-mode engine fails S1 to S3, and an engine started from another folder fails S4. The tests use a fake docker runner and never call the real one.

**Engine-side carry (not changed here).** `Get-EnvValue` in the engine's `scripts/local-common.ps1` uses a culture-sensitive `StartsWith`, which skips control characters, marks and some letters inside a name; it should use `StartsWith("$Name=", [StringComparison]::Ordinal)`. Both local-up readers (`Get-EnvValue` and `env_value` in `scripts/local-common.sh`) strip double quotes only, so `NAME=''` turns simulator mode off; both should strip single quotes too. Until then the guard refuses what those readers would read differently.

## Development

`pnpm gate` runs lint, format check, typecheck, tests, `test:oracles`, spec drift, build, the browser-bundle check, the runtime smoke test and `check:frameworks` (builds the Next and Nuxt fixtures and proves no key reaches a client bundle). The smoke script also runs on Bun (`bun scripts/runtime-smoke.mjs`) and Deno (`deno run --allow-read scripts/runtime-smoke.mjs`).

`pnpm test` is the fast suite. `pnpm test:oracles` holds the slow guard checks: the contract-guard differential against `docker compose config`, `pwsh` and `bash` (each skipped, with the reason, when its tool is missing) and vitest run in and out of contract mode over sample files. It is part of `pnpm gate`, so it runs before every release. On Windows run it from Git Bash: from PowerShell, `bash` resolves to the WSL launcher and the bash oracle is skipped.

The brand assets live in `assets/brand/` and are not part of any published package (no package lists them in `files`).

## Licence

Apache-2.0. The Meridian logo is a Gaussian trademark; the Apache-2.0 licence covers the code, not the logo.

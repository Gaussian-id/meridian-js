# meridian-js

TypeScript client SDK for the Meridian engine. Zero runtime dependencies. Runs on Node 18+, Bun, Deno and edge runtimes.

> The package names (`meridian`, `meridian-react` and so on) are working names (O47). All packages are `"private": true` until the names, scope and public date are decided.

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

| Entry              | Runs in                 | Holds a key |
| ------------------ | ----------------------- | ----------- |
| `meridian`         | server code only        | yes         |
| `meridian/browser` | the browser             | never       |
| `meridian/server`  | your app server (route) | no          |

Keys never go in the browser. `createClient` refuses to run in a browser or React Native.

### `meridian`: the server client

```ts
import { createClient } from 'meridian'

const meridian = createClient('https://YOUR-MERIDIAN-URL', process.env.MERIDIAN_KEY!)
const { data, error } = await meridian.chat.create({ messages: [{ role: 'user', content: 'hello' }] })
if (error) console.error(error.code, error.message, error.requestId)
else console.log(data.choices[0].message.content)
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
- The handler sets no body-size limit. Apply one in your app server.
- The browser client's default route is relative, so it needs a browser. Use an absolute `route` anywhere else.
- Cookies are sent for same-origin routes by default. A cross-origin route needs a custom `fetch`.
- The `idempotency-key` header triggers a CORS preflight on cross-origin routes.

## Direct API

No SDK needed. Use the engine's chat endpoint:

```bash
curl -sN https://YOUR-MERIDIAN-URL/v1/chat/completions \
  -H "Authorization: Bearer $MERIDIAN_KEY" -H 'content-type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"hello"}]}'
```

To generate your own client, use `spec/meridian-public.json` and `spec/meridian-admin.json`.

## Development

`pnpm gate` runs lint, format check, typecheck, tests, spec drift, build, the browser-bundle check and the runtime smoke test. The smoke script also runs on Bun (`bun scripts/runtime-smoke.mjs`) and Deno (`deno run --allow-read scripts/runtime-smoke.mjs`).

Licence: Apache-2.0.

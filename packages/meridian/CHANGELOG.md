# @gaussian-id/meridian

## 0.4.0

### Minor Changes

- `admin.projectByokPolicy.get(org, project)` and `.put(org, project, { policy })`: a Project's routing policy over the organisation default (`{ policy: null }` inherits), answered as `{ policy, effective, organisation_default }`. `byokPolicy` takes the new `self_hosted_only`, which serves only `self/<endpoint>/<model>`. Synced to engine 7b08da98 (OP. SIGIL slice 6).

### Fixed

- Nothing: this release only adds API.

### Why minor, not patch

New public API (`projectByokPolicy`) and a new accepted value (`self_hosted_only`). Code written for 0.4.0 doesn't run on 0.3.x, so a patch was not possible.

## 0.3.0

### Minor Changes

- Admin client: `byokProviders.list()` (the providers the engine takes a key for, with display names, key hints and docs links), `byokPolicy` (`get`, `put`) and `providerEndpoints` (`list`, `put`, `check`, `delete`) for an organisation's self-hosted servers (`api_format` openai or anthropic, `auth` none, bearer or a custom header, `allow_http`, and `warnings` such as `unencrypted_http` on put and check), and the engine's `provider_key_rejected`, `endpoint_address_refused` and `limit_reached` codes. Synced to engine 027350b9 (OP. SIGIL): provider credentials carry `status`, `verified_at` and `updated_by`, and `models.list`/`models.get` read `/v1/catalogue/models` (the engine's one-port admin path).

### Fixed

- Admin `models.list()` / `models.get()` now reach the admin catalogue on current engines. 0.2.0 called `/v1/models`, which became the public, key-scoped route when the engine moved to one port (`e3c766a1`).
- `provider_key_rejected`, `endpoint_address_refused` and `limit_reached` are known codes. 0.2.0 reported them as `internal`, with the engine's code only in `engineCode`.

### Why minor, not patch

New public API: three admin namespaces, new fields and new error codes. Code written for 0.3.0 doesn't run on 0.2.x, so a patch was not possible. Below 1.0, a minor may also carry the breaking `models` path change.

## 0.2.0

Published to npm as `@gaussian-id/meridian`, `-next`, `-expo` and `-nuxt` **0.2.0**. Synced to engine `20244c92`.

### Added

- The server and admin clients send an `X-Client-Info` header in supabase-js's format (`meridian-js/0.2.0; runtime=node; runtime-version=…`), so the engine can tell which SDK and runtime made a call. The browser client sends none, to avoid a CORS preflight on cross-origin routes.
- A `headers` option on every client. It never replaces `Authorization` or `Content-Type`.
- A known error code `price_unavailable` (503, not retryable).
- Types regenerated from the engine: `default_effort` on projects, the model directory, inventory, routing-record and runtime admin schemas.
- The README documents the effort suffixes on model names (`:low` … `:max`).

### Changed

- **Node.js 22 or newer is required** (`engines.node >=22`; 0.1.0 allowed 18). This matches supabase-js.
- Importing `@gaussian-id/meridian-next/browser` in a React Server Component now fails `next build`, the same way `server-only` guards the server entry.
- The engine's new `supplier_cost_*` fields are hidden from admin replies, the same way `cost_charged` already was.

### Fixed

- **`price_unavailable` was reported as `internal`.** 0.1.0 didn't know the code, so the engine's "no price for this model" answer looked like an engine fault.
- **A misleading runtime error in Next.js.** Before, using the browser client in a Server Component failed at runtime with a "no page origin" error meant for React Native. Now the build catches it.

### Why a minor release, not a patch

0.2.0 adds public API (the `headers` option, `X-Client-Info`, a new error code, new admin types) and raises the minimum Node.js version from 18 to 22. Dropping a supported runtime is a breaking change, so it can never go in a patch. Below 1.0, breaking changes go in the minor number.

## 0.1.0

First public preview, published to npm as `@gaussian-id/meridian`, `-next`, `-expo` and `-nuxt` **0.1.0**.

### Added

- **`@gaussian-id/meridian`:**
  - Server client: `chat.create`, `chat.stream` (SSE with usage, mid-stream errors, cancel, `toResponse`), `models.list`.
  - Every call returns `{ data, error }` with the engine's error codes.
  - Retries happen only before the first byte, honour `Retry-After`, and reuse one idempotency key.
  - Browser client that calls your own route without a key.
  - Forwarding handler with a required `authorize`, a model allowlist and a token cap.
  - Admin client for `gmi_` integrators. It never exposes supplier prices.
- **`@gaussian-id/meridian-next`:** server client plus App Router and Pages Router handlers, and the browser client.
- **`@gaussian-id/meridian-nuxt`:** server client from runtime config, a Nitro forwarding handler and `useMeridian`.
- **`@gaussian-id/meridian-expo`:** client over Expo's streaming fetch.
- **Packaging:** ESM and CJS builds with subpath exports. Types are generated from the engine's OpenAPI with a drift check. A browser-bundle check keeps keys out of client bundles.

### Fixed

No earlier release to fix. Before publishing, the code was hardened in review:

- strict JSON
- body caps
- stream cancel and abort handling
- a CSRF guard on the forwarding route
- setup errors hidden from the browser
- contract tests against a local engine and provider simulator that never spend money

### Why 0.1.0

This is the first published version. It starts at 0.1.0, not 1.0.0, because the API is a public preview and may still change between minor versions.

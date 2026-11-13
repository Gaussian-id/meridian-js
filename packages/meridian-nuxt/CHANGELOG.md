# @gaussian-id/meridian-nuxt

## 0.4.0

### Minor Changes

- `admin.projectByokPolicy.get(org, project)` and `.put(org, project, { policy })`: a Project's routing policy over the organisation default (`{ policy: null }` inherits), answered as `{ policy, effective, organisation_default }`. `byokPolicy` takes the new `self_hosted_only`, which serves only `self/<endpoint>/<model>`. Synced to engine 7b08da98 (OP. SIGIL slice 6).

### Patch Changes

- Updated dependencies
  - @gaussian-id/meridian@0.4.0

### Why minor, not patch

The version follows `@gaussian-id/meridian`, whose 0.4.0 adds public API. All four packages share one version (changesets `fixed` group).

## 0.3.0

### Minor Changes

- Admin client: `byokProviders.list()` (the providers the engine takes a key for, with display names, key hints and docs links), `byokPolicy` (`get`, `put`) and `providerEndpoints` (`list`, `put`, `check`, `delete`) for an organisation's self-hosted servers (`api_format` openai or anthropic, `auth` none, bearer or a custom header, `allow_http`, and `warnings` such as `unencrypted_http` on put and check), and the engine's `provider_key_rejected`, `endpoint_address_refused` and `limit_reached` codes. Synced to engine 027350b9 (OP. SIGIL): provider credentials carry `status`, `verified_at` and `updated_by`, and `models.list`/`models.get` read `/v1/catalogue/models` (the engine's one-port admin path).

### Patch Changes

- Updated dependencies
  - @gaussian-id/meridian@0.3.0

### Why minor, not patch

The version follows `@gaussian-id/meridian`, whose 0.3.0 adds public API. All four packages share one version (changesets `fixed` group). See the core changelog for the full list.

## 0.2.0

### Minor Changes

- Node.js 22 or newer is required (was 18). Dropping a runtime is breaking, so this is a minor below 1.0, never a patch.
- Server clients send `X-Client-Info`; every client takes a `headers` option.

### Patch Changes

- `@gaussian-id/meridian@0.2.0`: `price_unavailable` is a known error code (0.1.0 reported it as `internal`).

## 0.1.0

First public preview of the Nuxt package, on `@gaussian-id/meridian` 0.1.0.

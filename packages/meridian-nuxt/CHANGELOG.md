# @gaussian-id/meridian-nuxt

## 0.3.0

### Minor Changes

- Admin client: `byokProviders.list()` (the providers the engine takes a key for, with display names, key hints and docs links), `byokPolicy` (`get`, `put`) and `providerEndpoints` (`list`, `put`, `check`, `delete`) for an organisation's self-hosted servers (`api_format` openai or anthropic, `auth` none, bearer or a custom header, `allow_http`, and `warnings` such as `unencrypted_http` on put and check), and the engine's `provider_key_rejected`, `endpoint_address_refused` and `limit_reached` codes. Synced to engine 8aec3359 (OP. SIGIL): provider credentials carry `status`, `verified_at` and `updated_by`, and `models.list`/`models.get` read `/v1/catalogue/models` (the engine's one-port admin path).

### Patch Changes

- Updated dependencies
  - @gaussian-id/meridian@0.3.0

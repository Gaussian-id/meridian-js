# @gaussian-id/meridian-expo

## 0.3.0

### Minor Changes

- Admin client: `byokPolicy` (`get`, `put`) and `providerEndpoints` (`list`, `put`, `check`, `delete`) for an organisation's self-hosted OpenAI-compatible servers, and the engine's `provider_key_rejected`, `endpoint_address_refused` and `limit_reached` codes. Synced to engine 7930239f (OP. SIGIL): provider credentials carry `status`, `verified_at` and `updated_by`, and `models.list`/`models.get` read `/v1/catalogue/models` (the engine's one-port admin path).

### Patch Changes

- Updated dependencies
  - @gaussian-id/meridian@0.3.0

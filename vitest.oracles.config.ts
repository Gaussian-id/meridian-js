import { defineConfig } from 'vitest/config'

import base from './vitest.config'

// `pnpm test:oracles` (part of `pnpm gate`): the slow guard checks kept out of `pnpm test`. The contract guard against
// compose and both local-up readers, and vitest itself run in contract mode. Run it from Git Bash on Windows: the
// `bash` that PowerShell finds is the WSL launcher, and the bash oracle is skipped.
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['packages/*/test/**/*.oracles.ts'] }
})

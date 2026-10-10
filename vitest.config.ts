import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const next = (path: string) => fileURLToPath(new URL(`./packages/meridian-next/${path}`, import.meta.url))
const nuxt = (path: string) => fileURLToPath(new URL(`./packages/meridian-nuxt/${path}`, import.meta.url))
const expo = (path: string) => fileURLToPath(new URL(`./packages/meridian-expo/${path}`, import.meta.url))
const src = (path: string) => fileURLToPath(new URL(`./packages/meridian/src/${path}`, import.meta.url))

export default defineConfig({
  // No .env file reaches the suite (a contract run must see only the environment the guard checked)
  envDir: false,
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: next('test/support/server-only-stub.ts') },
      { find: /^@gaussian-id\/meridian-next\/pages$/, replacement: next('src/pages.ts') },
      { find: /^@gaussian-id\/meridian-next\/browser$/, replacement: next('src/browser.ts') },
      { find: /^@gaussian-id\/meridian-next$/, replacement: next('src/index.ts') },
      { find: /^#imports$/, replacement: nuxt('test/support/imports-stub.ts') },
      { find: /^@gaussian-id\/meridian-nuxt\/server$/, replacement: nuxt('src/server.ts') },
      { find: /^@gaussian-id\/meridian-nuxt\/composables$/, replacement: nuxt('src/composables.ts') },
      { find: /^expo\/fetch$/, replacement: expo('test/support/expo-fetch-stub.ts') },
      { find: /^@gaussian-id\/meridian-expo$/, replacement: expo('src/index.ts') },
      { find: /^@gaussian-id\/meridian\/browser$/, replacement: src('browser.ts') },
      { find: /^@gaussian-id\/meridian\/admin$/, replacement: src('admin.ts') },
      { find: /^@gaussian-id\/meridian\/server$/, replacement: src('server.ts') },
      { find: /^@gaussian-id\/meridian$/, replacement: src('index.ts') }
    ]
  },
  test: {
    environment: 'node',

    // The simulator suite (*.contract.ts) is picked up only in contract mode, never by `pnpm test`
    include: [
      'packages/*/test/**/*.test.ts',
      ...(process.env.MERIDIAN_CONTRACT === '1' ? ['packages/*/test/**/*.contract.ts'] : [])
    ],
    exclude: ['**/node_modules/**', 'packages/*/test/fixtures/**'],

    // packages/meridian/test/support/engine.ts: describeFake and describeEngine
    tags: [
      { name: 'fake', description: 'needs the in-memory engine; not registered in contract mode' },
      { name: 'contract', description: 'runs against the fake engine, and the real local engine in contract mode' }
    ]
  }
})

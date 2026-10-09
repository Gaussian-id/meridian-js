import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const next = (path: string) => fileURLToPath(new URL(`./packages/meridian-next/${path}`, import.meta.url))
const nuxt = (path: string) => fileURLToPath(new URL(`./packages/meridian-nuxt/${path}`, import.meta.url))
const src = (path: string) => fileURLToPath(new URL(`./packages/meridian/src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: next('test/support/server-only-stub.ts') },
      { find: /^meridian-next\/pages$/, replacement: next('src/pages.ts') },
      { find: /^meridian-next\/browser$/, replacement: next('src/browser.ts') },
      { find: /^meridian-next$/, replacement: next('src/index.ts') },
      { find: /^#imports$/, replacement: nuxt('test/support/imports-stub.ts') },
      { find: /^meridian-nuxt\/server$/, replacement: nuxt('src/server.ts') },
      { find: /^meridian-nuxt\/composables$/, replacement: nuxt('src/composables.ts') },
      { find: /^meridian\/browser$/, replacement: src('browser.ts') },
      { find: /^meridian\/admin$/, replacement: src('admin.ts') },
      { find: /^meridian\/server$/, replacement: src('server.ts') },
      { find: /^meridian$/, replacement: src('index.ts') }
    ]
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'packages/*/test/fixtures/**']
  }
})

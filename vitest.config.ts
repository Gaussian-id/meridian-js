import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const src = (path: string) => fileURLToPath(new URL(`./packages/meridian/src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
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

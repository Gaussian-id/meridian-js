import { defineConfig } from 'tsup'

export default defineConfig({
  // Task 10 adds `admin: 'src/admin.ts'` here and its "./admin" entry in package.json exports.
  entry: { index: 'src/index.ts', browser: 'src/browser.ts', server: 'src/server.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  metafile: true,
  target: 'es2022'
})

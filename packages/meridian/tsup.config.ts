import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', browser: 'src/browser.ts', server: 'src/server.ts', admin: 'src/admin.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  metafile: true,
  target: 'es2022'
})

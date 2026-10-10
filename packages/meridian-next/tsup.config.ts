import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', pages: 'src/pages.ts', browser: 'src/browser.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  metafile: true,
  target: 'es2022',
  external: ['@gaussian-id/meridian', 'server-only', 'next']
})

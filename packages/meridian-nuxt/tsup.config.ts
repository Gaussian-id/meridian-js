import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { module: 'src/module.ts', server: 'src/server.ts', composables: 'src/composables.ts' },
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
  external: ['@gaussian-id/meridian', 'nuxt', 'h3', '#imports']
})

import { defineConfig } from 'tsup'

export default defineConfig({
  // Task 1 ships only the core entry; later tasks add browser, admin and server.
  entry: ['src/index.ts', 'src/server.ts', 'src/browser.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true
})

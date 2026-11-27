import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Inline the shared wire types so the published d.ts is self-contained.
  // Keep src/types.ts importing the defining shared modules, not the barrel.
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  noExternal: ['@ateam/shared'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  }
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/client.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 62,
        lines: 80
      }
    }
  }
})

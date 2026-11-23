import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/cli/**/*.ts', 'src/server/**/*.ts', 'src/acp/**/*.ts'],
      exclude: ['**/*.test.ts']
    }
  }
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/runtime/**/*.ts',
        'src/tools.ts',
        'src/tools/**/*.ts',
        'src/sessions/**/*.ts',
        'src/config/**/*.ts',
        'src/integrations/**/*.ts',
        'src/providers.ts',
        'src/errors.ts',
        'src/message-history.ts',
        'src/atomic-json.ts'
      ],
      exclude: ['**/*.test.ts', 'src/test/**'],
      thresholds: {
        statements: 82,
        branches: 74,
        functions: 80,
        lines: 87
      }
    }
  }
})

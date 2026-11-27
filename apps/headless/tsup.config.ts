import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli/main.ts',
    server: 'src/server/main.ts',
    acp: 'src/acp/main.ts'
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: ['@ateam/agent-core', '@ateam/shared'],
  external: [
    'ai',
    /^@ai-sdk\//,
    'zod',
    'diff',
    'unpdf',
    'turndown',
    'gpt-tokenizer',
    '@anthropic-ai/tokenizer',
    '@vscode/ripgrep'
  ]
})

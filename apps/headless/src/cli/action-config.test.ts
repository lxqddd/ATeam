import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const action = fs.readFileSync(path.join(process.cwd(), '..', '..', 'action.yml'), 'utf8')

describe('GitHub Action configuration', () => {
  it('declares the required composite action inputs', () => {
    expect(action).toContain('using: composite')
    for (const input of [
      'prompt:',
      'api-key:',
      'model:',
      'provider:',
      'permission:',
      'workspace:'
    ]) {
      expect(action).toContain(`  ${input}`)
    }
  })

  it('builds the headless CLI and runs the built artifact with safe argument handling', () => {
    expect(action).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(action).toContain('pnpm rebuild esbuild')
    expect(action).toContain('pnpm --filter @ateam/headless build')
    expect(action).toContain(
      'printf \'%s\' "$INPUT_PROMPT" | node "${{ github.action_path }}/apps/headless/dist/cli.js" "${args[@]}"'
    )
    expect(action).toContain('working-directory: ${{ github.action_path }}')
  })
})

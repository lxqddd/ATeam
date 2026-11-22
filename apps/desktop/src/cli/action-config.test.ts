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

  it('installs only what the CLI needs and runs it with safe argument handling', () => {
    expect(action).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(action).toContain('pnpm rebuild esbuild')
    expect(action).toContain('pnpm cli -- "${args[@]}" "$INPUT_PROMPT"')
    expect(action).toContain('working-directory: ${{ github.action_path }}')
  })
})

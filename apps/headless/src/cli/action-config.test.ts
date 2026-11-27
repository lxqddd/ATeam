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
      'workspace:',
      'github-token:',
      'github-issue:',
      'github-comment:'
    ]) {
      expect(action).toContain(`  ${input}`)
    }
  })

  it('allows an issue-only run without a prompt', () => {
    expect(action).toMatch(/prompt:\n {4}description: [^\n]*\n {4}required: false/)
    expect(action).toContain('INPUT_GITHUB_ISSUE: ${{ inputs.github-issue }}')
    expect(action).toContain('INPUT_GITHUB_COMMENT: ${{ inputs.github-comment }}')
    expect(action).toContain('GITHUB_TOKEN: ${{ inputs.github-token || github.token }}')
    expect(action).toContain('args+=(--github-issue "$INPUT_GITHUB_ISSUE")')
    expect(action).toContain('args+=(--github-comment "$INPUT_GITHUB_COMMENT")')
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

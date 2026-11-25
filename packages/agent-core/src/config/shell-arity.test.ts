import { describe, expect, it } from 'vitest'
import { shellCommandPrefix } from './shell-arity'

describe('shellCommandPrefix', () => {
  it('uses command arity to build a reusable prefix', () => {
    expect(shellCommandPrefix('git status -sb')).toBe('git status')
    expect(shellCommandPrefix('npm run dev --host')).toBe('npm run dev')
    expect(shellCommandPrefix('bun test')).toBe('bun test')
    expect(shellCommandPrefix('kubectl get pods')).toBe('kubectl get')
    expect(shellCommandPrefix('gh pr view 1')).toBe('gh pr view')
    expect(shellCommandPrefix('docker compose up -d')).toBe('docker compose up')
    expect(shellCommandPrefix('go mod tidy')).toBe('go mod tidy')
    expect(shellCommandPrefix('terraform state list')).toBe('terraform state list')
    expect(shellCommandPrefix('systemctl restart nginx')).toBe('systemctl restart')
  })

  it('skips known global options before the subcommand', () => {
    expect(shellCommandPrefix('git -C repo status')).toBe('git status')
    expect(shellCommandPrefix('git --no-pager status')).toBe('git status')
    expect(shellCommandPrefix('kubectl --context prod get pods')).toBe('kubectl get')
    expect(shellCommandPrefix('npm --prefix ./pkg run build')).toBe('npm run build')
    expect(shellCommandPrefix('pnpm --filter web test')).toBe('pnpm test')
    expect(shellCommandPrefix('docker --context prod compose up')).toBe('docker compose up')
  })

  it('keeps quoted arguments usable in a rule', () => {
    expect(shellCommandPrefix('npm run "build all"')).toBe('npm run "build all"')
  })

  it('keeps short commands at their base command', () => {
    expect(shellCommandPrefix('rm -rf node_modules')).toBe('rm')
    expect(shellCommandPrefix('ls -la')).toBeNull()
  })

  it('refuses to broaden compound, dynamic or unknown-option commands', () => {
    expect(shellCommandPrefix('git status && rm -rf build')).toBeNull()
    expect(shellCommandPrefix('git status | head')).toBeNull()
    expect(shellCommandPrefix('FOO=bar git status')).toBeNull()
    expect(shellCommandPrefix('git --unknown status')).toBeNull()
  })
})

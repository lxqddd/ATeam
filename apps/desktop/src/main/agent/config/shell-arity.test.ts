import { describe, expect, it } from 'vitest'
import { shellCommandPrefix } from './shell-arity'

describe('shellCommandPrefix', () => {
  it('uses command arity to build a reusable prefix', () => {
    expect(shellCommandPrefix('git status -sb')).toBe('git status')
    expect(shellCommandPrefix('npm run dev --host')).toBe('npm run dev')
    expect(shellCommandPrefix('bun test')).toBe('bun test')
    expect(shellCommandPrefix('kubectl get pods')).toBe('kubectl get')
  })

  it('keeps short commands at their base command', () => {
    expect(shellCommandPrefix('rm -rf node_modules')).toBe('rm')
    expect(shellCommandPrefix('ls -la')).toBeNull()
  })

  it('refuses to broaden compound or dynamic commands', () => {
    expect(shellCommandPrefix('git status && rm -rf build')).toBeNull()
    expect(shellCommandPrefix('git status | head')).toBeNull()
    expect(shellCommandPrefix('FOO=bar git status')).toBeNull()
    expect(shellCommandPrefix('git -C repo status')).toBeNull()
  })
})

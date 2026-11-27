import { describe, expect, it } from 'vitest'
import {
  agentConfigPatchSchema,
  globalConfigEditSchema,
  globalConfigUpdateSchema,
  projectConfigEditSchema
} from './config-schema'

describe('agentConfigPatchSchema', () => {
  it('keeps formatter overrides', () => {
    expect(
      agentConfigPatchSchema.parse({
        formatters: true,
        formatterOverrides: { '.ts': 'none', '.go': 'gofmt' }
      })
    ).toEqual({
      formatters: true,
      formatterOverrides: { '.ts': 'none', '.go': 'gofmt' }
    })
  })

  it('keeps references', () => {
    const parsed = agentConfigPatchSchema.parse({
      references: [
        { alias: 'docs', path: '../docs', description: 'Product docs' },
        { alias: 'sdk', repository: 'owner/repo', branch: 'main', hidden: true }
      ]
    })

    expect(parsed.references).toHaveLength(2)
  })

  it('keeps retry settings', () => {
    expect(
      agentConfigPatchSchema.parse({
        retry: { maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 30_000 }
      })
    ).toEqual({ retry: { maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 30_000 } })
  })

  it('keeps environment settings', () => {
    expect(
      agentConfigPatchSchema.parse({
        environment: { timezone: 'Asia/Shanghai', notes: 'Use bun.' }
      })
    ).toEqual({ environment: { timezone: 'Asia/Shanghai', notes: 'Use bun.' } })
  })

  it('keeps a system prompt override', () => {
    expect(agentConfigPatchSchema.parse({ systemPrompt: 'You are a reviewer.' })).toEqual({
      systemPrompt: 'You are a reviewer.'
    })
    expect(() => agentConfigPatchSchema.parse({ systemPrompt: 'x'.repeat(20_001) })).toThrow()
  })

  it('rejects environment notes that are too long', () => {
    expect(() =>
      agentConfigPatchSchema.parse({ environment: { notes: 'x'.repeat(4_001) } })
    ).toThrow()
  })

  it('rejects retry settings outside their bounds', () => {
    expect(() => agentConfigPatchSchema.parse({ retry: { maxRetries: 11 } })).toThrow()
    expect(() => agentConfigPatchSchema.parse({ retry: { maxDelayMs: -1 } })).toThrow()
    expect(() => agentConfigPatchSchema.parse({ retry: { timeoutMs: 1.5 } })).toThrow()
  })

  it('rejects overly broad overrides', () => {
    expect(() =>
      agentConfigPatchSchema.parse({ formatterOverrides: { ['.x'.repeat(20)]: 'prettier' } })
    ).toThrow()
    expect(() =>
      agentConfigPatchSchema.parse({ formatterOverrides: { '.ts': 'x'.repeat(41) } })
    ).toThrow()
  })
})

describe('projectConfigEditSchema', () => {
  it('accepts edits to form-managed top-level fields', () => {
    expect(
      projectConfigEditSchema.parse({
        edits: [
          { path: ['providers', 'local', 'models', 'm'], value: { name: 'M' } },
          { path: ['skills'], value: ['a'] },
          { path: ['lsp', 'servers', 'ts'] }
        ]
      }).edits
    ).toHaveLength(3)
  })

  it('rejects fields the structured editors do not own', () => {
    expect(() => projectConfigEditSchema.parse({ edits: [{ path: ['mcp'], value: [] }] })).toThrow()
    expect(() =>
      projectConfigEditSchema.parse({ edits: [{ path: ['systemPrompt'], value: 'x' }] })
    ).toThrow()
    expect(() =>
      projectConfigEditSchema.parse({ edits: [{ path: ['permissions'], value: [] }] })
    ).toThrow()
  })

  it('rejects unsafe or oversized paths', () => {
    expect(() =>
      projectConfigEditSchema.parse({ edits: [{ path: ['providers', '__proto__'], value: {} }] })
    ).toThrow()
    expect(() =>
      projectConfigEditSchema.parse({
        edits: [{ path: ['providers', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], value: 1 }]
      })
    ).toThrow()
    expect(() =>
      projectConfigEditSchema.parse({
        edits: Array.from({ length: 101 }, () => ({ path: ['skills'], value: [] }))
      })
    ).toThrow()
  })

  it('rejects payloads over the size limit', () => {
    expect(() =>
      projectConfigEditSchema.parse({
        edits: [{ path: ['commands', 'review'], value: { template: 'x'.repeat(200_001) } }]
      })
    ).toThrow()
  })
})

describe('globalConfigEditSchema', () => {
  it('accepts edits to the global form-managed fields', () => {
    expect(
      globalConfigEditSchema.parse({
        edits: [
          { path: ['lsp'], value: { ts: { command: ['ts-ls'] } } },
          { path: ['lspEnabled'], value: false },
          { path: ['formatters'], value: true },
          { path: ['formattersEnabled'] },
          { path: ['commands'], value: { review: { template: 'Review' } } },
          { path: ['skills'], value: ['a'] }
        ]
      }).edits
    ).toHaveLength(6)
  })

  it('rejects fields the global structured editors do not own', () => {
    expect(() =>
      globalConfigEditSchema.parse({ edits: [{ path: ['providers'], value: {} }] })
    ).toThrow()
    expect(() =>
      globalConfigEditSchema.parse({ edits: [{ path: ['lspInstall'], value: true }] })
    ).toThrow()
    expect(() => globalConfigEditSchema.parse({ edits: [{ path: ['mcp'], value: {} }] })).toThrow()
  })

  it('rejects unsafe or oversized paths', () => {
    expect(() =>
      globalConfigEditSchema.parse({ edits: [{ path: ['lsp', '__proto__'], value: {} }] })
    ).toThrow()
    expect(() =>
      globalConfigEditSchema.parse({
        edits: [{ path: ['lsp', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], value: 1 }]
      })
    ).toThrow()
    expect(() => globalConfigEditSchema.parse({ edits: [] })).toThrow()
  })

  it('rejects payloads over the size limit', () => {
    expect(() =>
      globalConfigEditSchema.parse({
        edits: [{ path: ['commands', 'review'], value: { template: 'x'.repeat(200_001) } }]
      })
    ).toThrow()
  })
})

describe('globalConfigUpdateSchema', () => {
  it('accepts file content up to the limit', () => {
    expect(globalConfigUpdateSchema.parse({ content: '{}' })).toEqual({ content: '{}' })
  })

  it('rejects content over the limit', () => {
    expect(() =>
      globalConfigUpdateSchema.parse({ content: `"${'x'.repeat(1_000_000)}"` })
    ).toThrow()
  })
})

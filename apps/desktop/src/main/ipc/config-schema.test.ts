import { describe, expect, it } from 'vitest'
import { agentConfigPatchSchema } from './config-schema'

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

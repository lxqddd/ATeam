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

  it('rejects overly broad overrides', () => {
    expect(() =>
      agentConfigPatchSchema.parse({ formatterOverrides: { ['.x'.repeat(20)]: 'prettier' } })
    ).toThrow()
    expect(() =>
      agentConfigPatchSchema.parse({ formatterOverrides: { '.ts': 'x'.repeat(41) } })
    ).toThrow()
  })
})

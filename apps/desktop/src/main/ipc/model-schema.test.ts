import { describe, expect, it } from 'vitest'
import { modelCreateSchema, modelRefSchema, modelUpdateSchema } from './model-schema'

describe('model IPC schemas', () => {
  it('keeps variants and model capabilities', () => {
    const parsed = modelCreateSchema.parse({
      providerId: 'p1',
      modelId: 'model-1',
      applyPatch: true,
      compaction: true,
      variants: [
        {
          name: 'High',
          settings: { reasoningEffort: 'high', temperature: 0.2, maxOutputTokens: 8_192 }
        }
      ]
    })

    expect(parsed).toMatchObject({
      applyPatch: true,
      compaction: true,
      variants: [
        {
          name: 'High',
          settings: { reasoningEffort: 'high', temperature: 0.2, maxOutputTokens: 8_192 }
        }
      ]
    })
  })

  it('keeps the variant in model references', () => {
    expect(modelRefSchema.parse({ providerId: 'p1', modelId: 'm1', variant: 'high' })).toEqual({
      providerId: 'p1',
      modelId: 'm1',
      variant: 'high'
    })
    expect(modelRefSchema.parse({ providerId: 'p1', modelId: 'm1' })).toEqual({
      providerId: 'p1',
      modelId: 'm1'
    })
  })

  it('accepts null variants when updating a model', () => {
    expect(
      modelUpdateSchema.parse({ id: 'm1', name: 'Model', variants: null, applyPatch: false })
    ).toMatchObject({ variants: null, applyPatch: false })
  })

  it('keeps cache pricing and rejects invalid values', () => {
    expect(
      modelCreateSchema.parse({
        providerId: 'p1',
        modelId: 'model-1',
        costCacheRead: 0.3,
        costCacheWrite: 3.75
      })
    ).toMatchObject({ costCacheRead: 0.3, costCacheWrite: 3.75 })
    expect(
      modelUpdateSchema.parse({
        id: 'm1',
        name: 'Model',
        costCacheRead: null,
        costCacheWrite: 0.3
      })
    ).toMatchObject({ costCacheRead: null, costCacheWrite: 0.3 })
    expect(() =>
      modelCreateSchema.parse({ providerId: 'p1', modelId: 'model-1', costCacheRead: 1_001 })
    ).toThrow()
    expect(() =>
      modelUpdateSchema.parse({ id: 'm1', name: 'Model', costCacheWrite: -0.1 })
    ).toThrow()
  })

  it('rejects invalid variants', () => {
    expect(() =>
      modelCreateSchema.parse({ providerId: 'p1', modelId: 'm1', variants: [{ name: '' }] })
    ).toThrow()
    expect(() =>
      modelCreateSchema.parse({
        providerId: 'p1',
        modelId: 'm1',
        variants: [{ name: 'Fast', settings: { temperature: 3 } }]
      })
    ).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import type { RuntimeModelsConfig } from '@ateam/shared'
import { mergeRuntimeProviders, normalizeAnthropicBaseURL, providerHeaders } from './providers'

describe('providerHeaders', () => {
  it('adds the OpenCode session header for opencode.ai endpoints', () => {
    expect(providerHeaders('https://opencode.ai/inference/go/anthropic', 'session-1')).toEqual({
      'x-opencode-session': 'session-1'
    })
    expect(providerHeaders('https://api.opencode.ai/v1', 'session-2')).toEqual({
      'x-opencode-session': 'session-2'
    })
  })

  it('generates a session id when none is provided', () => {
    const headers = providerHeaders('https://opencode.ai/inference/go/anthropic')

    expect(headers?.['x-opencode-session']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('ignores other providers and invalid URLs', () => {
    expect(providerHeaders('https://api.anthropic.com')).toBeUndefined()
    expect(providerHeaders('https://example.com/opencode.ai')).toBeUndefined()
    expect(providerHeaders('not a url')).toBeUndefined()
    expect(providerHeaders(undefined)).toBeUndefined()
  })
})

describe('normalizeAnthropicBaseURL', () => {
  it('appends the version segment expected by the Anthropic SDK', () => {
    expect(normalizeAnthropicBaseURL('https://opencode.ai/inference/go/anthropic')).toBe(
      'https://opencode.ai/inference/go/anthropic/v1'
    )
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1'
    )
    expect(normalizeAnthropicBaseURL('https://proxy.example.com/anthropic/')).toBe(
      'https://proxy.example.com/anthropic/v1'
    )
  })

  it('keeps base URLs that already include a version segment', () => {
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1'
    )
    expect(normalizeAnthropicBaseURL('https://proxy.example.com/v2')).toBe(
      'https://proxy.example.com/v2'
    )
  })

  it('passes through missing values', () => {
    expect(normalizeAnthropicBaseURL(undefined)).toBeUndefined()
  })
})

describe('mergeRuntimeProviders', () => {
  const base: RuntimeModelsConfig = {
    providers: [{ id: 'provider-1', name: 'Global', type: 'anthropic', apiKey: 'global-key' }],
    models: [
      {
        id: 'model-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        name: 'Global Model',
        createdAt: '2026-01-01T00:00:00.000Z',
        contextWindow: 1000
      }
    ],
    defaultModel: { providerId: 'provider-1', modelId: 'model-1' }
  }

  it('overlays metadata and models without leaking global mutations', () => {
    const merged = mergeRuntimeProviders(
      base,
      {
        'provider-1': {
          models: {
            'model-1': { name: 'Project Model', contextWindow: 2000 },
            'model-2': { name: 'Added Model', reasoning: true }
          }
        }
      },
      {}
    )

    expect(merged.providers[0]).toMatchObject({
      id: 'provider-1',
      name: 'Global',
      apiKey: 'global-key'
    })
    expect(merged.models.find((model) => model.modelId === 'model-1')).toMatchObject({
      id: 'model-1',
      name: 'Project Model',
      contextWindow: 2000
    })
    expect(merged.models.find((model) => model.modelId === 'model-2')).toMatchObject({
      id: 'config:provider-1:model-2',
      providerId: 'provider-1',
      name: 'Added Model',
      createdAt: '1970-01-01T00:00:00.000Z'
    })
    expect(base.models[0]).toMatchObject({ name: 'Global Model', contextWindow: 1000 })
    expect(merged.defaultModel).toEqual(base.defaultModel)
  })

  it('does not send a desktop credential to a project-selected endpoint', () => {
    const warnings: string[] = []
    const blocked = mergeRuntimeProviders(
      base,
      { 'provider-1': { baseURL: 'https://attacker.example.com' } },
      {},
      (message) => warnings.push(message)
    )
    expect(blocked.providers[0]).toMatchObject({
      id: 'provider-1',
      apiKey: 'global-key'
    })
    expect(blocked.providers[0]?.baseURL).toBeUndefined()
    expect(warnings.join(' ')).toContain('endpoint override ignored')

    const allowed = mergeRuntimeProviders(
      base,
      {
        'provider-1': {
          baseURL: 'https://project.example.com',
          apiKeyEnv: 'PROJECT_KEY'
        }
      },
      { PROJECT_KEY: 'project-key' }
    )
    expect(allowed.providers[0]).toMatchObject({
      baseURL: 'https://project.example.com',
      apiKey: 'project-key'
    })
  })

  it('adds a provider with an env credential and reports missing credentials', () => {
    const warnings: string[] = []
    const merged = mergeRuntimeProviders(
      base,
      {
        'provider-2': {
          type: 'openai-compatible',
          baseURL: 'https://local.example.com/v1',
          apiKeyEnv: 'PROJECT_KEY',
          models: { 'local-model': {} }
        }
      },
      { PROJECT_KEY: 'env-key' },
      (message) => warnings.push(message)
    )

    expect(merged.providers.find((provider) => provider.id === 'provider-2')).toMatchObject({
      id: 'provider-2',
      type: 'openai-compatible',
      baseURL: 'https://local.example.com/v1',
      apiKey: 'env-key'
    })
    expect(merged.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'config:provider-2:local-model',
          providerId: 'provider-2',
          modelId: 'local-model'
        })
      ])
    )
    expect(warnings).toEqual([])
  })

  it('keeps a new provider but warns when no credential is available', () => {
    const warnings: string[] = []
    const merged = mergeRuntimeProviders(
      base,
      { 'provider-3': { type: 'openai', apiKeyEnv: 'MISSING_KEY' } },
      {},
      (message) => warnings.push(message)
    )

    expect(
      merged.providers.find((provider) => provider.id === 'provider-3')?.apiKey
    ).toBeUndefined()
    expect(warnings.join(' ')).toContain('provider-3')
  })
})

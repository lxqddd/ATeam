import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeProvider } from '@ateam/shared'
import { listProviderModels } from './available'

function provider(overrides: Partial<RuntimeProvider> = {}): RuntimeProvider {
  return {
    id: 'provider-1',
    name: 'Test',
    type: 'anthropic',
    apiKey: 'sk-test',
    ...overrides
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listProviderModels', () => {
  it('reads Anthropic-compatible model lists', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({
        data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }, { id: 'claude-opus-5' }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels(provider({ baseURL: 'https://proxy.example.com/anthropic' }))
    ).resolves.toEqual([
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      { id: 'claude-opus-5', name: undefined }
    ])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.example.com/anthropic/v1/models')
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01'
    })
  })

  it('adds the OpenCode session header for opencode.ai endpoints', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ data: [] })
    )
    vi.stubGlobal('fetch', fetchMock)

    await listProviderModels(provider({ baseURL: 'https://opencode.ai/inference/go/anthropic' }))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://opencode.ai/inference/go/anthropic/v1/models')
    expect(init.headers).toMatchObject({ 'x-opencode-session': expect.any(String) })
  })

  it('reads OpenAI-compatible model lists with a bearer token', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ data: [{ id: 'gpt-5', name: 'GPT-5' }] })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels(
        provider({ type: 'openai-compatible', baseURL: 'http://localhost:1234/v1/' })
      )
    ).resolves.toEqual([{ id: 'gpt-5', name: 'GPT-5' }])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:1234/v1/models')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
  })

  it('reads Google model lists and strips the models/ prefix', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({
        models: [{ name: 'models/gemini-4-pro', displayName: 'Gemini 4 Pro' }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listProviderModels(provider({ type: 'google' }))).resolves.toEqual([
      { id: 'gemini-4-pro', name: 'Gemini 4 Pro' }
    ])

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models')
    expect(url).toContain('key=sk-test')
  })

  it('throws when the provider responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 401))
    )

    await expect(listProviderModels(provider())).rejects.toThrow('HTTP 401')
  })
})

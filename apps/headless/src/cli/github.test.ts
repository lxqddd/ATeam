import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  githubTokenFromEnv,
  loadGitHubPrompt,
  parseGitHubCliRef,
  postGitHubComment
} from './github'

const API = 'https://api.github.com'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

function routeFetch(
  routes: Record<string, () => Response | Promise<Response>>
): Mock<typeof fetch> {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input).replace(API, '')
    const handler = routes[url]
    if (!handler) throw new Error(`unexpected request: ${url}`)
    return handler()
  })
}

function issue(number = 7): Record<string, unknown> {
  return {
    number,
    title: 'Fix login',
    html_url: `https://github.com/octo/repo/issues/${number}`,
    state: 'open',
    user: { login: 'octocat' },
    labels: [{ name: 'bug' }],
    comments: 2,
    updated_at: '2026-01-01T00:00:00.000Z',
    body: 'Issue body'
  }
}

describe('githubTokenFromEnv', () => {
  it('reads GITHUB_TOKEN first and falls back to GH_TOKEN', () => {
    expect(githubTokenFromEnv({ GITHUB_TOKEN: ' primary ', GH_TOKEN: 'secondary' })).toBe('primary')
    expect(githubTokenFromEnv({ GH_TOKEN: 'secondary' })).toBe('secondary')
    expect(githubTokenFromEnv({ GITHUB_TOKEN: '   ' })).toBeNull()
    expect(githubTokenFromEnv({})).toBeNull()
  })
})

describe('parseGitHubCliRef', () => {
  it('parses URLs and short references and rejects garbage', () => {
    expect(parseGitHubCliRef('octo/repo#12')).toMatchObject({
      owner: 'octo',
      repo: 'repo',
      number: 12
    })
    expect(parseGitHubCliRef('https://github.com/octo/repo/pull/3')).toMatchObject({
      kind: 'pull',
      number: 3
    })
    expect(() => parseGitHubCliRef('nope')).toThrow('GITHUB_INVALID_REF')
  })
})

describe('loadGitHubPrompt', () => {
  it('loads issue context and renders the prompt', async () => {
    const fetchMock = routeFetch({
      '/repos/octo/repo/issues/7': () => jsonResponse(issue())
    })

    const context = await loadGitHubPrompt('octo/repo#7', {
      env: { GITHUB_TOKEN: 'token' },
      fetch: fetchMock
    })

    expect(context.label).toBe('octo/repo#7')
    expect(context.ref).toMatchObject({ kind: 'issue', number: 7 })
    expect(context.prompt).toContain('## GitHub issue octo/repo#7: Fix login')
    expect(context.prompt).toContain('Issue body')
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API}/repos/octo/repo/issues/7`)
  })

  it('rejects when no token is configured, without calling GitHub', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(
      loadGitHubPrompt('octo/repo#7', { env: {}, fetch: fetchMock })
    ).rejects.toMatchObject({ code: 'GITHUB_TOKEN_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces HTTP failures as stable codes', async () => {
    const fetchMock = routeFetch({
      '/repos/octo/repo/issues/7': () => new Response('', { status: 404 })
    })
    await expect(
      loadGitHubPrompt('octo/repo#7', { env: { GITHUB_TOKEN: 't' }, fetch: fetchMock })
    ).rejects.toMatchObject({ code: 'GITHUB_NOT_FOUND' })
  })
})

describe('postGitHubComment', () => {
  it('posts the trimmed assistant text to the item', async () => {
    const fetchMock = routeFetch({
      '/repos/octo/repo/issues/7/comments': () =>
        jsonResponse({ html_url: 'https://github.com/octo/repo/issues/7#issuecomment-1' })
    })

    const result = await postGitHubComment('octo/repo#7', '  Done.  ', {
      env: { GITHUB_TOKEN: 't' },
      fetch: fetchMock
    })

    expect(result).toEqual({ url: 'https://github.com/octo/repo/issues/7#issuecomment-1' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ body: 'Done.' })
  })

  it('rejects empty text and missing tokens locally', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      postGitHubComment('octo/repo#7', '   ', { env: { GITHUB_TOKEN: 't' }, fetch: fetchMock })
    ).rejects.toThrow('No assistant text')
    await expect(
      postGitHubComment('octo/repo#7', 'Done.', { env: {}, fetch: fetchMock })
    ).rejects.toMatchObject({ code: 'GITHUB_TOKEN_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

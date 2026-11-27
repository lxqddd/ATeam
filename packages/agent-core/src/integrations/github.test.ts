import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  buildGitHubPrompt,
  createGitHubClient,
  loadGitHubContext,
  parseGitHubItemRef,
  parseGitHubRemote,
  parseGitHubRepo
} from './github'

const API = 'https://api.test'

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
    const path = String(input).replace(API, '')
    const handler = routes[path]
    if (!handler) throw new Error(`unexpected request: ${path}`)
    return handler()
  })
}

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'Fix login',
    html_url: 'https://github.com/octo/repo/issues/7',
    state: 'open',
    user: { login: 'octocat' },
    labels: [{ name: 'bug' }, 'help wanted'],
    comments: 3,
    updated_at: '2026-01-01T00:00:00.000Z',
    body: 'Issue body',
    ...overrides
  }
}

function pull(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'Fix login',
    html_url: 'https://github.com/octo/repo/pull/7',
    state: 'open',
    user: { login: 'octocat' },
    labels: [],
    comments: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    body: 'Pull body',
    draft: false,
    merged: false,
    base: { ref: 'main' },
    head: { ref: 'feature/login' },
    additions: 12,
    deletions: 3,
    changed_files: 2,
    commits: 4,
    ...overrides
  }
}

describe('GitHub reference parsing', () => {
  it('parses repository names, URLs and remotes', () => {
    expect(parseGitHubRepo('octo/repo')).toEqual({ owner: 'octo', repo: 'repo' })
    expect(parseGitHubRepo('https://github.com/octo/repo.git')).toEqual({
      owner: 'octo',
      repo: 'repo'
    })
    expect(parseGitHubRepo('gitlab.com/octo/repo')).toBeNull()
    expect(parseGitHubRepo('..')).toBeNull()

    expect(parseGitHubRemote('git@github.com:octo/repo.git')).toEqual({
      owner: 'octo',
      repo: 'repo'
    })
    expect(parseGitHubRemote('ssh://git@github.com/octo/repo.git')).toEqual({
      owner: 'octo',
      repo: 'repo'
    })
    expect(parseGitHubRemote('https://user:token@github.com/octo/repo.git')).toEqual({
      owner: 'octo',
      repo: 'repo'
    })
    expect(parseGitHubRemote('https://gitlab.com/octo/repo.git')).toBeNull()
  })

  it('parses issue and pull request references', () => {
    expect(parseGitHubItemRef('https://github.com/octo/repo/pull/12')).toMatchObject({
      owner: 'octo',
      repo: 'repo',
      kind: 'pull',
      number: 12
    })
    expect(parseGitHubItemRef('octo/repo#9')).toMatchObject({ kind: 'issue', number: 9 })
    expect(parseGitHubItemRef('octo/repo/issues/4')).toMatchObject({ kind: 'issue', number: 4 })
    expect(parseGitHubItemRef('not a reference')).toBeNull()
  })
})

describe('createGitHubClient', () => {
  it('requires a token before calling the API', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = createGitHubClient({ apiBaseUrl: API, fetch: fetchMock })

    await expect(client.getViewer()).rejects.toMatchObject({ code: 'GITHUB_TOKEN_MISSING' })
    await expect(client.getViewer()).rejects.toThrow(/GITHUB_TOKEN/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends GitHub REST headers and maps an issue', async () => {
    const fetchMock = routeFetch({ '/repos/octo/repo/issues/7': () => jsonResponse(issue()) })
    const client = createGitHubClient({ token: 'secret-token', apiBaseUrl: API, fetch: fetchMock })

    const result = await client.getIssue({ owner: 'octo', repo: 'repo' }, 7)

    expect(result).toMatchObject({
      number: 7,
      title: 'Fix login',
      author: 'octocat',
      labels: ['bug', 'help wanted'],
      comments: 3,
      body: 'Issue body',
      isPullRequest: false
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/repos/octo/repo/issues/7`)
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    })
  })

  it('filters open items by kind', async () => {
    const payload = [issue(), issue({ number: 8, pull_request: { url: 'x' } })]
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(payload))
    const client = createGitHubClient({ token: 't', apiBaseUrl: API, fetch: fetchMock })
    const repo = { owner: 'octo', repo: 'repo' }

    const issues = await client.listOpenItems(repo, 'issue')
    const pulls = await client.listOpenItems(repo, 'pull')

    expect(issues.map((item) => item.number)).toEqual([7])
    expect(pulls.map((item) => item.number)).toEqual([8])
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/repos/octo/repo/issues?state=open&sort=updated&direction=desc&per_page=30'
    )
  })

  it('posts comments and pull requests', async () => {
    const fetchMock = routeFetch({
      '/repos/octo/repo/issues/7/comments': () =>
        jsonResponse({ html_url: 'https://github.com/octo/repo/issues/7#issuecomment-1' }),
      '/repos/octo/repo/pulls': () =>
        jsonResponse({ number: 9, html_url: 'https://github.com/octo/repo/pull/9' })
    })
    const client = createGitHubClient({ token: 't', apiBaseUrl: API, fetch: fetchMock })

    await expect(
      client.createComment({ owner: 'octo', repo: 'repo' }, 7, '  Thanks!  ')
    ).resolves.toEqual({ url: 'https://github.com/octo/repo/issues/7#issuecomment-1' })
    await expect(
      client.createPull({
        repo: 'octo/repo',
        title: 'Fix login',
        body: 'Body',
        base: 'main',
        head: 'feature/login',
        draft: true
      })
    ).resolves.toEqual({ number: 9, url: 'https://github.com/octo/repo/pull/9' })

    const commentInit = fetchMock.mock.calls[0][1]
    expect(JSON.parse(String(commentInit?.body))).toEqual({ body: 'Thanks!' })
    const pullInit = fetchMock.mock.calls[1][1]
    expect(JSON.parse(String(pullInit?.body))).toEqual({
      title: 'Fix login',
      body: 'Body',
      base: 'main',
      head: 'feature/login',
      draft: true
    })
  })

  it('maps HTTP failures to stable codes without leaking the token', async () => {
    const cases: Array<[Response, string]> = [
      [new Response('', { status: 401 }), 'GITHUB_UNAUTHORIZED'],
      [new Response('', { status: 403 }), 'GITHUB_FORBIDDEN'],
      [
        new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
        'GITHUB_RATE_LIMITED'
      ],
      [new Response('', { status: 429 }), 'GITHUB_RATE_LIMITED'],
      [new Response('', { status: 404 }), 'GITHUB_NOT_FOUND'],
      [new Response('', { status: 422 }), 'GITHUB_UNPROCESSABLE'],
      [new Response('', { status: 500 }), 'GITHUB_API_ERROR']
    ]

    for (const [response, code] of cases) {
      const client = createGitHubClient({
        token: 'super-secret',
        apiBaseUrl: API,
        fetch: vi.fn<typeof fetch>(async () => response)
      })
      const error = await client.getViewer().catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code })
      expect(String((error as Error).message)).not.toContain('super-secret')
    }
  })

  it('maps network and invalid responses', async () => {
    const offline = createGitHubClient({
      token: 't',
      apiBaseUrl: API,
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('offline')
      })
    })
    await expect(offline.getViewer()).rejects.toMatchObject({ code: 'GITHUB_NETWORK_ERROR' })

    const invalid = createGitHubClient({
      token: 't',
      apiBaseUrl: API,
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({ nope: true }))
    })
    await expect(invalid.getViewer()).rejects.toMatchObject({ code: 'GITHUB_INVALID_RESPONSE' })
  })

  it('rejects empty comments and malformed pull requests locally', async () => {
    const client = createGitHubClient({
      token: 't',
      apiBaseUrl: API,
      fetch: vi.fn<typeof fetch>()
    })

    await expect(client.createComment({ owner: 'o', repo: 'r' }, 1, '   ')).rejects.toMatchObject({
      code: 'GITHUB_INVALID_REF'
    })
    await expect(
      client.createPull({
        repo: 'not a repo',
        title: 't',
        body: '',
        base: 'main',
        head: 'x',
        draft: false
      })
    ).rejects.toMatchObject({ code: 'GITHUB_INVALID_REF' })
  })
})

describe('loadGitHubContext', () => {
  it('loads an issue and truncates oversized bodies', async () => {
    const body = 'x'.repeat(20_001)
    const fetchMock = routeFetch({
      '/repos/octo/repo/issues/7': () => jsonResponse(issue({ body }))
    })
    const client = createGitHubClient({ token: 't', apiBaseUrl: API, fetch: fetchMock })

    const context = await loadGitHubContext(client, {
      owner: 'octo',
      repo: 'repo',
      kind: 'issue',
      number: 7
    })

    expect(context).toMatchObject({
      kind: 'issue',
      title: 'Fix login',
      bodyTruncated: true,
      pull: null
    })
    expect(context.body).toHaveLength(20_000)
  })

  it('loads pull request details and caps the file list', async () => {
    const files = Array.from({ length: 51 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: 'modified',
      additions: index,
      deletions: 1
    }))
    const fetchMock = routeFetch({
      '/repos/octo/repo/issues/7': () => jsonResponse(issue({ pull_request: { url: 'x' } })),
      '/repos/octo/repo/pulls/7': () => jsonResponse(pull()),
      '/repos/octo/repo/pulls/7/files?per_page=100': () => jsonResponse(files)
    })
    const client = createGitHubClient({ token: 't', apiBaseUrl: API, fetch: fetchMock })

    const context = await loadGitHubContext(client, {
      owner: 'octo',
      repo: 'repo',
      kind: 'pull',
      number: 7
    })

    expect(context.kind).toBe('pull')
    expect(context.pull).toMatchObject({
      baseBranch: 'main',
      headBranch: 'feature/login',
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      commits: 4,
      filesTruncated: true
    })
    expect(context.pull?.files).toHaveLength(50)
  })
})

describe('buildGitHubPrompt', () => {
  it('renders issue and pull request context as Markdown', async () => {
    const issueClient = createGitHubClient({
      token: 't',
      apiBaseUrl: API,
      fetch: routeFetch({ '/repos/octo/repo/issues/7': () => jsonResponse(issue()) })
    })
    const issueContext = await loadGitHubContext(issueClient, {
      owner: 'octo',
      repo: 'repo',
      kind: 'issue',
      number: 7
    })
    const issuePrompt = buildGitHubPrompt(issueContext)

    expect(issuePrompt).toContain('## GitHub issue octo/repo#7: Fix login')
    expect(issuePrompt).toContain('- Author: @octocat')
    expect(issuePrompt).toContain('- State: open')
    expect(issuePrompt).toContain('### Description')
    expect(issuePrompt).toContain('Issue body')

    const pullClient = createGitHubClient({
      token: 't',
      apiBaseUrl: API,
      fetch: routeFetch({
        '/repos/octo/repo/issues/7': () => jsonResponse(issue({ pull_request: { url: 'x' } })),
        '/repos/octo/repo/pulls/7': () => jsonResponse(pull()),
        '/repos/octo/repo/pulls/7/files?per_page=100': () =>
          jsonResponse([{ filename: 'src/app.ts', status: 'modified', additions: 2, deletions: 1 }])
      })
    })
    const pullContext = await loadGitHubContext(pullClient, {
      owner: 'octo',
      repo: 'repo',
      kind: 'pull',
      number: 7
    })
    const pullPrompt = buildGitHubPrompt(pullContext)

    expect(pullPrompt).toContain('## GitHub pull request octo/repo#7: Fix login')
    expect(pullPrompt).toContain('- Base: `main` ← `feature/login`')
    expect(pullPrompt).toContain('- Commits: 4')
    expect(pullPrompt).toContain('+12 −3 across 2 files')
    expect(pullPrompt).toContain('### Changed files')
    expect(pullPrompt).toContain('- `src/app.ts` (modified) +2 −1')
  })
})

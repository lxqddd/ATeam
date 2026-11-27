import { describe, expect, it, vi } from 'vitest'
import type { VcsService } from '@ateam/agent-core'
import type { VcsInfo } from '@ateam/shared'
import type { GitHubTokenStore } from './token-store'
import { GitHubService } from './service'

function storeWithToken(token: string | null): GitHubTokenStore {
  return { runtimeToken: () => token } as unknown as GitHubTokenStore
}

function vcsWithInfo(info: Partial<VcsInfo> | Error): (root: string) => VcsService {
  return () =>
    ({
      info: () =>
        info instanceof Error ? Promise.reject(info) : Promise.resolve({ ...EMPTY_INFO, ...info })
    }) as unknown as VcsService
}

const EMPTY_INFO: VcsInfo = {
  isRepository: false,
  root: null,
  branch: null,
  defaultBranch: null,
  remoteUrl: null
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

function issue(number: number): Record<string, unknown> {
  return {
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/octo/repo/issues/${number}`,
    state: 'open',
    user: { login: 'octocat' },
    labels: [],
    comments: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    body: 'Body'
  }
}

describe('GitHubService', () => {
  describe('repo detection', () => {
    it('reports the GitHub repository, branch and default branch', async () => {
      const service = new GitHubService({
        store: storeWithToken(null),
        workspacePath: '/workspace',
        createVcsImpl: vcsWithInfo({
          isRepository: true,
          root: '/workspace',
          branch: 'feature',
          defaultBranch: 'main',
          remoteUrl: 'git@github.com:octo/repo.git'
        })
      })

      await expect(service.repo()).resolves.toEqual({
        owner: 'octo',
        repo: 'repo',
        remoteUrl: 'git@github.com:octo/repo.git',
        branch: 'feature',
        defaultBranch: 'main'
      })
    })

    it('returns null for non-repositories, non-GitHub remotes and failures', async () => {
      const nonRepo = new GitHubService({
        store: storeWithToken(null),
        workspacePath: '/workspace',
        createVcsImpl: vcsWithInfo({})
      })
      await expect(nonRepo.repo()).resolves.toBeNull()

      const otherRemote = new GitHubService({
        store: storeWithToken(null),
        workspacePath: '/workspace',
        createVcsImpl: vcsWithInfo({ isRepository: true, remoteUrl: 'git@gitlab.com:o/r.git' })
      })
      await expect(otherRemote.repo()).resolves.toBeNull()

      const failing = new GitHubService({
        store: storeWithToken(null),
        workspacePath: '/workspace',
        createVcsImpl: vcsWithInfo(new Error('git missing'))
      })
      await expect(failing.repo()).resolves.toBeNull()
    })

    it('rejects a relative directory', async () => {
      const service = new GitHubService({
        store: storeWithToken(null),
        workspacePath: '/workspace'
      })
      await expect(service.repo('relative/path')).rejects.toMatchObject({
        code: 'GITHUB_INVALID_REF'
      })
    })
  })

  it('requires a token before talking to GitHub', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const service = new GitHubService({
      store: storeWithToken(null),
      workspacePath: '/workspace',
      fetch: fetchMock
    })

    await expect(service.list('octo/repo')).rejects.toMatchObject({ code: 'GITHUB_TOKEN_MISSING' })
    await expect(service.context('octo/repo#1')).rejects.toThrow(/Settings → GitHub|GITHUB_TOKEN/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates repository and item references locally', async () => {
    const service = new GitHubService({
      store: storeWithToken('t'),
      workspacePath: '/workspace',
      fetch: vi.fn<typeof fetch>()
    })

    await expect(service.list('not a repo')).rejects.toMatchObject({ code: 'GITHUB_INVALID_REF' })
    await expect(service.context('not a ref')).rejects.toMatchObject({ code: 'GITHUB_INVALID_REF' })
    await expect(service.comment({ ref: 'nope', body: 'hi' })).rejects.toMatchObject({
      code: 'GITHUB_INVALID_REF'
    })
    await expect(service.comment({ ref: 'octo/repo#1', body: '  ' })).rejects.toMatchObject({
      code: 'GITHUB_INVALID_REF'
    })
  })

  it('lists open issues and pull requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([issue(1), { ...issue(2), pull_request: { url: 'x' } }])
    )
    const service = new GitHubService({
      store: storeWithToken('t'),
      workspacePath: '/workspace',
      fetch: fetchMock
    })

    const issues = await service.list('octo/repo')
    const pulls = await service.list('https://github.com/octo/repo', 'pull')

    expect(issues.map((item) => item.number)).toEqual([1])
    expect(pulls.map((item) => item.number)).toEqual([2])
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/octo/repo/issues?state=open')
  })

  it('loads issue context together with a prefilled prompt', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(issue(7)))
    const service = new GitHubService({
      store: storeWithToken('t'),
      workspacePath: '/workspace',
      fetch: fetchMock
    })

    const result = await service.context('https://github.com/octo/repo/issues/7')

    expect(result.context).toMatchObject({ number: 7, kind: 'issue', title: 'Issue 7' })
    expect(result.prompt).toContain('## GitHub issue octo/repo#7: Issue 7')
  })

  it('posts a trimmed comment to the referenced item', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ html_url: 'https://github.com/octo/repo/issues/7#issuecomment-1' })
    )
    const service = new GitHubService({
      store: storeWithToken('t'),
      workspacePath: '/workspace',
      fetch: fetchMock
    })

    await expect(service.comment({ ref: 'octo/repo#7', body: '  Thanks!  ' })).resolves.toEqual({
      url: 'https://github.com/octo/repo/issues/7#issuecomment-1'
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ body: 'Thanks!' })
  })

  it('creates a pull request through the shared client', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ number: 9, html_url: 'https://github.com/octo/repo/pull/9' })
    )
    const service = new GitHubService({
      store: storeWithToken('t'),
      workspacePath: '/workspace',
      fetch: fetchMock
    })

    await expect(
      service.createPull({
        repo: 'octo/repo',
        title: 'Fix',
        body: 'Body',
        base: 'main',
        head: 'feature',
        draft: false
      })
    ).resolves.toEqual({ number: 9, url: 'https://github.com/octo/repo/pull/9' })
  })
})

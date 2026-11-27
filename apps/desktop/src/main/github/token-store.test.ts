import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { GitHubTokenStore } from './token-store'

const API = 'https://api.test'

function viewerFetch(login = 'octocat'): Mock<typeof fetch> {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ login }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  )
}

function rejectFetch(status: number): typeof fetch {
  return vi.fn<typeof fetch>(async () => new Response('', { status }))
}

let directory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-github-token-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function createStore(
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}
): GitHubTokenStore {
  return new GitHubTokenStore(directory, {
    env: options.env ?? {},
    fetch: options.fetch,
    apiBaseUrl: API
  })
}

describe('GitHubTokenStore', () => {
  it('starts unconfigured when neither store nor environment has a token', async () => {
    const store = createStore()
    await store.init()

    expect(store.get()).toEqual({ hasToken: false, source: 'none', login: null, updatedAt: null })
    expect(store.runtimeToken()).toBeNull()
  })

  it('falls back to GITHUB_TOKEN and GH_TOKEN from the environment', async () => {
    const primary = createStore({ env: { GITHUB_TOKEN: ' from-env ' } })
    await primary.init()
    expect(primary.get()).toEqual({ hasToken: true, source: 'env', login: null, updatedAt: null })
    expect(primary.runtimeToken()).toBe('from-env')

    const secondary = createStore({ env: { GH_TOKEN: 'gh-env' } })
    await secondary.init()
    expect(secondary.runtimeToken()).toBe('gh-env')
  })

  it('verifies a token against /user and persists it with 0600 permissions', async () => {
    const fetchMock = viewerFetch('octocat')
    const store = createStore({ fetch: fetchMock })

    const status = await store.update(' secret-token ')

    expect(status).toMatchObject({ hasToken: true, source: 'store', login: 'octocat' })
    expect(status.updatedAt).toEqual(expect.any(String))
    expect(store.runtimeToken()).toBe('secret-token')

    const file = path.join(directory, 'agent', 'github.json')
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as {
      version: number
      token: string
      login: string
    }
    expect(raw).toMatchObject({ version: 1, token: 'secret-token', login: 'octocat' })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${API}/user`)
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-token' })
  })

  it('reloads a persisted token on a new instance and prefers it over the environment', async () => {
    const first = createStore({ fetch: viewerFetch() })
    await first.update('stored-token')

    const reloaded = createStore({
      env: { GITHUB_TOKEN: 'env-token' },
      fetch: viewerFetch()
    })
    await reloaded.init()

    expect(reloaded.get()).toMatchObject({ hasToken: true, source: 'store', login: 'octocat' })
    expect(reloaded.runtimeToken()).toBe('stored-token')
  })

  it('keeps the previous token when verification fails', async () => {
    const store = createStore({ fetch: viewerFetch('octocat') })
    await store.update('good-token')

    const rejecting = new GitHubTokenStore(directory, {
      env: {},
      fetch: rejectFetch(401),
      apiBaseUrl: API
    })
    await rejecting.init()
    await expect(rejecting.update('bad-token')).rejects.toMatchObject({
      code: 'GITHUB_UNAUTHORIZED'
    })

    expect(rejecting.runtimeToken()).toBe('good-token')
    expect(rejecting.get()).toMatchObject({ login: 'octocat' })
  })

  it('rejects an empty token without calling the API', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const store = createStore({ fetch: fetchMock })

    await expect(store.update('   ')).rejects.toMatchObject({ code: 'GITHUB_TOKEN_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the stored token and falls back to the environment', async () => {
    const store = createStore({ env: { GITHUB_TOKEN: 'env-token' }, fetch: viewerFetch() })
    await store.update('stored-token')

    const afterClear = await store.clear()

    expect(afterClear).toEqual({ hasToken: true, source: 'env', login: null, updatedAt: null })
    expect(store.runtimeToken()).toBe('env-token')

    const raw = JSON.parse(
      await fs.readFile(path.join(directory, 'agent', 'github.json'), 'utf8')
    ) as { token: string | null }
    expect(raw.token).toBeNull()
  })

  it('ignores malformed persisted data', async () => {
    await fs.mkdir(path.join(directory, 'agent'), { recursive: true })
    await fs.writeFile(path.join(directory, 'agent', 'github.json'), '{"token": 42}')
    const store = createStore()
    await store.init()

    expect(store.get()).toEqual({ hasToken: false, source: 'none', login: null, updatedAt: null })
  })
})

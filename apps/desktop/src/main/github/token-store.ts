import fs from 'node:fs/promises'
import path from 'node:path'
import type { GitHubTokenStatus } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '@ateam/agent-core'
import { GitHubError, createGitHubClient } from '@ateam/agent-core/integrations'

const STORAGE_VERSION = 1

interface StoredGitHubToken {
  version: 1
  token: string | null
  login: string | null
  updatedAt: string | null
}

export interface GitHubTokenStoreOptions {
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  apiBaseUrl?: string
  userAgent?: string
}

/**
 * Stores the desktop GitHub token outside `auth.json`: entries there are injected
 * into the agent worker, and the GitHub token must never reach it.
 */
export class GitHubTokenStore {
  private config: StoredGitHubToken = {
    version: STORAGE_VERSION,
    token: null,
    login: null,
    updatedAt: null
  }

  private readonly env: NodeJS.ProcessEnv
  private readonly fetchImpl: typeof fetch | undefined
  private readonly apiBaseUrl: string | undefined
  private readonly userAgent: string | undefined

  constructor(
    private readonly userDataPath: string,
    options: GitHubTokenStoreOptions = {}
  ) {
    this.env = options.env ?? process.env
    this.fetchImpl = options.fetch
    this.apiBaseUrl = options.apiBaseUrl
    this.userAgent = options.userAgent
  }

  private file(): string {
    return path.join(this.userDataPath, 'agent', 'github.json')
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<unknown>(this.file())
    if (!stored || typeof stored !== 'object') return
    const raw = stored as Partial<StoredGitHubToken>
    this.config = {
      version: STORAGE_VERSION,
      token: typeof raw.token === 'string' && raw.token.trim() ? raw.token.trim() : null,
      login: typeof raw.login === 'string' && raw.login.trim() ? raw.login.trim() : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    }
  }

  private envToken(): string | null {
    return this.env.GITHUB_TOKEN?.trim() || this.env.GH_TOKEN?.trim() || null
  }

  get(): GitHubTokenStatus {
    if (this.config.token) {
      return {
        hasToken: true,
        source: 'store',
        login: this.config.login,
        updatedAt: this.config.updatedAt
      }
    }
    if (this.envToken()) {
      return { hasToken: true, source: 'env', login: null, updatedAt: null }
    }
    return { hasToken: false, source: 'none', login: null, updatedAt: null }
  }

  /** Saved token takes precedence; environment variables are the fallback. */
  runtimeToken(): string | null {
    return this.config.token ?? this.envToken()
  }

  /** Verifies the token against `/user` before replacing a saved one. */
  async update(token: string): Promise<GitHubTokenStatus> {
    const trimmed = token.trim()
    if (!trimmed) throw new GitHubError('GITHUB_TOKEN_MISSING', 'GitHub token is required')
    const client = createGitHubClient({
      token: trimmed,
      fetch: this.fetchImpl,
      apiBaseUrl: this.apiBaseUrl,
      userAgent: this.userAgent
    })
    const viewer = await client.getViewer()
    this.config = {
      version: STORAGE_VERSION,
      token: trimmed,
      login: viewer.login,
      updatedAt: new Date().toISOString()
    }
    await this.persist()
    return this.get()
  }

  async clear(): Promise<GitHubTokenStatus> {
    this.config = { version: STORAGE_VERSION, token: null, login: null, updatedAt: null }
    await this.persist()
    return this.get()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), this.config)
  }
}

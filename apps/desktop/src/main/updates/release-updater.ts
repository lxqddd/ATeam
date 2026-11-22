import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import type { UpdateAsset, UpdateDownloadResult, UpdateInfo, UpdateProgress } from '@ateam/shared'

export const DEFAULT_RELEASE_REPO = 'lxqddd/ATeam'
const CHECK_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000
const MAX_ASSET_BYTES = 1024 * 1024 * 1024
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

const ReleaseSchema = z.object({
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string().min(1),
  published_at: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z
    .array(
      z.object({
        name: z.string().min(1),
        browser_download_url: z.string().min(1),
        size: z.number().nonnegative(),
        content_type: z.string().nullable().optional(),
        digest: z.string().nullable().optional()
      })
    )
    .default([])
})

type GithubRelease = z.infer<typeof ReleaseSchema>

interface VersionParts {
  numbers: number[]
  prerelease: string[]
}

function parseVersion(value: string): VersionParts {
  const trimmed = value.trim().replace(/^v/i, '').split('+')[0]
  const [core, prerelease = ''] = trimmed.split('-', 2)
  return {
    numbers: core.split('.').map((part) => {
      const number = Number.parseInt(part, 10)
      return Number.isInteger(number) && number >= 0 ? number : 0
    }),
    prerelease: prerelease ? prerelease.split('.') : []
  }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const length = Math.max(a.numbers.length, b.numbers.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  const prereleaseLength = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

const PLATFORM_EXTENSIONS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['.dmg', '.zip'],
  win32: ['.exe', '.msi'],
  linux: ['.AppImage', '.deb']
}

const ARCH_TOKENS: Record<string, string[]> = {
  arm64: ['arm64', 'aarch64'],
  x64: ['x64', 'x86_64', 'amd64'],
  ia32: ['ia32', 'x86'],
  arm: ['armv7l', 'armhf']
}

function assetFor(
  assets: GithubRelease['assets'],
  platform: NodeJS.Platform,
  arch: string
): UpdateAsset | null {
  const extensions = PLATFORM_EXTENSIONS[platform]
  if (!extensions) return null
  const archTokens = ARCH_TOKENS[arch] ?? []
  const otherArch = /arm64|aarch64|x64|x86_64|amd64|ia32|armv7l|universal/i
  for (const extension of extensions) {
    const matching = assets.filter((asset) =>
      asset.name.toLowerCase().endsWith(extension.toLowerCase())
    )
    if (matching.length === 0) continue
    const exact = matching.find((asset) => {
      const name = asset.name.toLowerCase()
      return archTokens.some((token) => name.includes(token))
    })
    const universal = matching.find((asset) => /universal/i.test(asset.name))
    const neutral = matching.find((asset) => !otherArch.test(asset.name))
    const chosen = exact ?? universal ?? neutral
    if (!chosen) continue
    return {
      name: chosen.name,
      url: chosen.browser_download_url,
      size: chosen.size,
      contentType: chosen.content_type ?? null,
      digest: chosen.digest ?? null
    }
  }
  return null
}

export interface ReleaseUpdaterOptions {
  currentVersion: string
  downloadsPath: string
  repo?: string
  platform?: NodeJS.Platform
  arch?: string
  fetchImpl?: typeof fetch
  token?: string | null
  apiBaseUrl?: string
  onProgress?: (progress: UpdateProgress) => void
  openInstaller?: (filePath: string) => Promise<boolean>
}

export class ReleaseUpdater {
  private readonly currentVersion: string
  private readonly downloadsPath: string
  private readonly repo: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly fetchImpl: typeof fetch
  private readonly token: string | null
  private readonly apiBaseUrl: string
  private readonly onProgress?: (progress: UpdateProgress) => void
  private readonly openInstaller?: (filePath: string) => Promise<boolean>

  constructor(options: ReleaseUpdaterOptions) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo ?? DEFAULT_RELEASE_REPO)) {
      throw new Error('INVALID_UPDATE_REPOSITORY')
    }
    this.currentVersion = options.currentVersion
    this.downloadsPath = options.downloadsPath
    this.repo = options.repo ?? DEFAULT_RELEASE_REPO
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.fetchImpl = options.fetchImpl ?? fetch
    this.token = options.token ?? null
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
    this.onProgress = options.onProgress
    this.openInstaller = options.openInstaller
  }

  async check(): Promise<UpdateInfo> {
    const release = await this.fetchRelease()
    return this.infoFor(release)
  }

  async download(version: string): Promise<UpdateDownloadResult> {
    const release = await this.fetchRelease()
    const info = this.infoFor(release)
    if (info.latestVersion !== version) throw new Error('UPDATE_VERSION_CHANGED')
    if (!info.asset) throw new Error('UPDATE_ASSET_NOT_FOUND')

    const asset = info.asset
    const url = new URL(asset.url)
    if (url.protocol !== 'https:') throw new Error('UPDATE_ASSET_UNTRUSTED')
    if (!ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) throw new Error('UPDATE_ASSET_UNTRUSTED')
    if (
      url.hostname.endsWith('github.com') &&
      !url.pathname.startsWith(`/${this.repo}/releases/download/`)
    ) {
      throw new Error('UPDATE_ASSET_UNTRUSTED')
    }
    if (asset.size > MAX_ASSET_BYTES) throw new Error('UPDATE_ASSET_TOO_LARGE')

    let response: Response
    try {
      response = await this.fetchImpl(asset.url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      })
    } catch (error) {
      throw new Error(
        `UPDATE_DOWNLOAD_FAILED: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (!response.ok) throw new Error(`UPDATE_DOWNLOAD_FAILED: HTTP ${response.status}`)
    if (response.url) {
      const finalUrl = new URL(response.url)
      if (!ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
        throw new Error('UPDATE_ASSET_UNTRUSTED')
      }
    }
    if (!response.body) throw new Error('UPDATE_DOWNLOAD_FAILED: empty response')

    await fs.mkdir(this.downloadsPath, { recursive: true })
    const target = await this.uniquePath(asset.name)
    const temporary = path.join(
      this.downloadsPath,
      `.${path.basename(target)}.${randomUUID()}.part`
    )
    const hash = createHash('sha256')
    const totalBytes = asset.size || Number(response.headers.get('content-length') ?? 0)
    let downloaded = 0
    let lastProgressAt = 0
    const reportProgress = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastProgressAt < 200) return
      lastProgressAt = now
      try {
        this.onProgress?.({
          version: info.latestVersion,
          downloadedBytes: downloaded,
          totalBytes
        })
      } catch {
        /* progress is best effort */
      }
    }
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloaded += chunk.length
        if (downloaded > MAX_ASSET_BYTES) {
          callback(new Error('UPDATE_ASSET_TOO_LARGE'))
          return
        }
        hash.update(chunk)
        reportProgress()
        callback(null, chunk)
      }
    })

    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
        limiter,
        createWriteStream(temporary)
      )
      if (asset.size > 0 && downloaded !== asset.size) {
        throw new Error('UPDATE_ASSET_INCOMPLETE')
      }
      const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]
      if (digest && hash.digest('hex').toLowerCase() !== digest.toLowerCase()) {
        throw new Error('UPDATE_ASSET_DIGEST_MISMATCH')
      }
      await fs.rename(temporary, target)
      reportProgress(true)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }

    let opened = false
    if (this.openInstaller) {
      try {
        opened = await this.openInstaller(target)
      } catch {
        opened = false
      }
    }
    return { version: info.latestVersion, path: target, assetName: asset.name, opened }
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'User-Agent': `ATeam/${this.currentVersion}`,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    }
  }

  private async fetchRelease(): Promise<GithubRelease> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/repos/${this.repo}/releases/latest`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })
    if (response.status === 404) throw new Error('UPDATE_NOT_FOUND')
    if (response.status === 403 || response.status === 429) throw new Error('UPDATE_RATE_LIMITED')
    if (!response.ok) throw new Error(`UPDATE_CHECK_FAILED: HTTP ${response.status}`)
    const parsed = ReleaseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success || parsed.data.draft) throw new Error('UPDATE_INVALID_RESPONSE')
    return parsed.data
  }

  private infoFor(release: GithubRelease): UpdateInfo {
    const latestVersion = release.tag_name.trim().replace(/^v/i, '')
    return {
      currentVersion: this.currentVersion,
      latestVersion,
      available: compareVersions(latestVersion, this.currentVersion) > 0,
      releaseName: release.name?.trim() || release.tag_name,
      releaseNotes: release.body?.trim() || '',
      releaseUrl: release.html_url,
      publishedAt: release.published_at ?? null,
      asset: assetFor(release.assets, this.platform, this.arch)
    }
  }

  private async uniquePath(assetName: string): Promise<string> {
    const base =
      path
        .basename(assetName.replace(/\\/g, '/'))
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .slice(0, 180) || 'ATeam-update'
    const extension = path.extname(base)
    const stem = base.slice(0, base.length - extension.length)
    let candidate = path.join(this.downloadsPath, base)
    for (let index = 1; index < 1000; index += 1) {
      if (!(await fs.stat(candidate).catch(() => null))) return candidate
      candidate = path.join(this.downloadsPath, `${stem}-${index}${extension}`)
    }
    throw new Error('UPDATE_DOWNLOAD_PATH_UNAVAILABLE')
  }
}

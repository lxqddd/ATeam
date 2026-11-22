import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleaseUpdater, compareVersions } from './release-updater'

let directory: string

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-updater-'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function release(
  assets: Array<{ name: string; url: string; size: number; digest?: string }>
): unknown {
  return {
    tag_name: 'v0.2.0',
    name: 'ATeam 0.2.0',
    body: 'Fixes and improvements.',
    html_url: 'https://github.com/lxqddd/ATeam/releases/tag/v0.2.0',
    published_at: '2026-11-22T00:00:00.000Z',
    draft: false,
    prerelease: false,
    assets: assets.map((asset) => ({
      name: asset.name,
      browser_download_url: asset.url,
      size: asset.size,
      content_type: 'application/octet-stream',
      digest: asset.digest ?? null
    }))
  }
}

function updater(fetchImpl: typeof fetch, platform: NodeJS.Platform = 'darwin'): ReleaseUpdater {
  return new ReleaseUpdater({
    currentVersion: '0.1.0',
    downloadsPath: directory,
    platform,
    arch: 'arm64',
    fetchImpl,
    openInstaller: async () => true
  })
}

describe('compareVersions', () => {
  it('orders releases and prereleases', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBeGreaterThan(0)
  })
})

describe('ReleaseUpdater', () => {
  it('checks the latest release and selects a platform asset', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        release([
          {
            name: 'ATeam-0.2.0-arm64.dmg',
            url: 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0-arm64.dmg',
            size: 10
          },
          {
            name: 'ATeam-0.2.0-setup.exe',
            url: 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0-setup.exe',
            size: 10
          }
        ])
      )
    )

    const info = await updater(fetchMock).check()

    expect(info).toMatchObject({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      available: true,
      releaseName: 'ATeam 0.2.0',
      releaseNotes: 'Fixes and improvements.'
    })
    expect(info.asset?.name).toBe('ATeam-0.2.0-arm64.dmg')
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/lxqddd/ATeam/releases/latest')
  })

  it('reports no asset when the release has no matching file', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(release([{ name: 'notes.txt', url: 'https://github.com/x', size: 1 }]))
    )

    const info = await updater(fetchMock).check()

    expect(info.available).toBe(true)
    expect(info.asset).toBeNull()
  })

  it('does not select an installer for another architecture', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        release([
          {
            name: 'ATeam-0.2.0-x64.dmg',
            url: 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0-x64.dmg',
            size: 10
          }
        ])
      )
    )

    const info = await updater(fetchMock).check()

    expect(info.asset).toBeNull()
  })

  it('downloads and verifies a release asset', async () => {
    const content = Buffer.from('installer bytes')
    const digest = createHash('sha256').update(content).digest('hex')
    const assetUrl = 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0.dmg'
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('api.github.com')) {
        return Response.json(
          release([
            {
              name: 'ATeam-0.2.0.dmg',
              url: assetUrl,
              size: content.length,
              digest: `sha256:${digest}`
            }
          ])
        )
      }
      return new Response(content, { status: 200 })
    })
    const openInstaller = vi.fn(async () => true)
    const progress: Array<{ downloadedBytes: number; totalBytes: number }> = []
    const instance = new ReleaseUpdater({
      currentVersion: '0.1.0',
      downloadsPath: directory,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchMock,
      onProgress: (next) => progress.push(next),
      openInstaller
    })

    const result = await instance.download('0.2.0')

    expect(result).toMatchObject({ version: '0.2.0', assetName: 'ATeam-0.2.0.dmg', opened: true })
    await expect(fs.readFile(result.path)).resolves.toEqual(content)
    expect(openInstaller).toHaveBeenCalledWith(result.path)
    expect(progress.at(-1)).toMatchObject({
      downloadedBytes: content.length,
      totalBytes: content.length
    })
  })

  it('rejects untrusted asset hosts and changed versions', async () => {
    const untrusted = vi.fn<typeof fetch>(async () =>
      Response.json(
        release([{ name: 'ATeam-0.2.0.dmg', url: 'https://evil.example/ATeam.dmg', size: 1 }])
      )
    )
    await expect(updater(untrusted).download('0.2.0')).rejects.toThrow('UPDATE_ASSET_UNTRUSTED')

    const stale = vi.fn<typeof fetch>(async () =>
      Response.json(
        release([
          {
            name: 'ATeam-0.2.0.dmg',
            url: 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0.dmg',
            size: 1
          }
        ])
      )
    )
    await expect(updater(stale).download('0.1.0')).rejects.toThrow('UPDATE_VERSION_CHANGED')
  })

  it('maps network failures to a stable error', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(updater(fetchMock).check()).rejects.toThrow('UPDATE_CHECK_FAILED')
  })

  it('maps GitHub rate limits to a stable error', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('rate limited', { status: 403 }))
    await expect(updater(fetchMock).check()).rejects.toThrow('UPDATE_RATE_LIMITED')
  })
})

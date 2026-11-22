import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateSettings from './UpdateSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let api: ApiMock

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

describe('UpdateSettings', () => {
  it('shows an available release and downloads its installer', async () => {
    vi.mocked(api.api.updates.check).mockResolvedValue({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      available: true,
      releaseName: 'ATeam 0.2.0',
      releaseNotes: 'Fixes and improvements.',
      releaseUrl: 'https://github.com/lxqddd/ATeam/releases/tag/v0.2.0',
      publishedAt: '2026-11-22T00:00:00.000Z',
      asset: {
        name: 'ATeam-0.2.0.dmg',
        url: 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0.dmg',
        size: 1024,
        contentType: null,
        digest: null
      }
    })
    vi.mocked(api.api.updates.download).mockResolvedValue({
      version: '0.2.0',
      path: '/tmp/ATeam-0.2.0.dmg',
      assetName: 'ATeam-0.2.0.dmg',
      opened: true
    })
    const user = userEvent.setup()
    render(<UpdateSettings />)

    expect(await screen.findByText('Version 0.2.0 is available.')).toBeInTheDocument()
    expect(screen.getByText('Fixes and improvements.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download and install' }))

    await waitFor(() => expect(api.api.updates.download).toHaveBeenCalledWith('0.2.0'))
    expect(
      await screen.findByText('Installer downloaded and opened: /tmp/ATeam-0.2.0.dmg')
    ).toBeInTheDocument()
  })

  it('shows download progress for the selected asset', async () => {
    vi.mocked(api.api.updates.check).mockResolvedValue({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      available: true,
      releaseName: 'ATeam 0.2.0',
      releaseNotes: '',
      releaseUrl: 'https://github.com/lxqddd/ATeam/releases/tag/v0.2.0',
      publishedAt: null,
      asset: {
        name: 'ATeam-0.2.0.dmg',
        url: 'https://github.com/lxqddd/ATeam/releases/download/v0.2.0/ATeam-0.2.0.dmg',
        size: 1024,
        contentType: null,
        digest: null
      }
    })
    let listener:
      | ((progress: { version: string; downloadedBytes: number; totalBytes: number }) => void)
      | null = null
    vi.mocked(api.api.updates.onProgress).mockImplementation((callback) => {
      listener = callback
      return () => undefined
    })
    let resolveDownload: (result: {
      version: string
      path: string
      assetName: string
      opened: boolean
    }) => void = () => undefined
    vi.mocked(api.api.updates.download).mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve
      })
    )
    const user = userEvent.setup()
    render(<UpdateSettings />)

    await screen.findByText('Version 0.2.0 is available.')
    await user.click(screen.getByRole('button', { name: 'Download and install' }))
    act(() => {
      listener?.({ version: '0.2.0', downloadedBytes: 512, totalBytes: 1024 })
    })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('button', { name: 'Downloading 50%' })).toBeDisabled()

    act(() => {
      resolveDownload({
        version: '0.2.0',
        path: '/tmp/ATeam-0.2.0.dmg',
        assetName: 'ATeam-0.2.0.dmg',
        opened: true
      })
    })
    await screen.findByText('Installer downloaded and opened: /tmp/ATeam-0.2.0.dmg')

    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  })

  it('reports the latest version and rechecks', async () => {
    const user = userEvent.setup()
    render(<UpdateSettings />)

    expect(await screen.findByText('You are on the latest version.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() => expect(api.api.updates.check).toHaveBeenCalledTimes(2))
  })

  it('maps GitHub rate limits and recovers on retry', async () => {
    vi.mocked(api.api.updates.check)
      .mockRejectedValueOnce(
        new Error("Error invoking remote method 'ateam:updates:check': Error: UPDATE_RATE_LIMITED")
      )
      .mockResolvedValueOnce({
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
        available: false,
        releaseName: 'ATeam 0.1.0',
        releaseNotes: '',
        releaseUrl: 'https://github.com/lxqddd/ATeam/releases',
        publishedAt: null,
        asset: null
      })
    const user = userEvent.setup()
    render(<UpdateSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub rate limit reached')
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))

    expect(await screen.findByText('You are on the latest version.')).toBeInTheDocument()
  })
})

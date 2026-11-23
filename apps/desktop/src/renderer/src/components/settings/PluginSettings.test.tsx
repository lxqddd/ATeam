import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginEntry } from '@ateam/shared'
import PluginSettings from './PluginSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

function plugin(overrides: Partial<PluginEntry> = {}): PluginEntry {
  return {
    id: 'plugin-1',
    spec: './plugins/demo',
    name: '@acme/demo',
    version: '1.0.0',
    source: 'local',
    enabled: true,
    compatibility: 'compatible',
    requiredVersion: '^0.1.0',
    error: null,
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

let api: ApiMock

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

describe('PluginSettings', () => {
  it('installs a plugin from a local spec', async () => {
    const user = userEvent.setup()
    api.api.agent.plugins.install = vi.fn(async () => [plugin()])
    render(<PluginSettings defaultDirectory="/tmp/workspace" />)

    expect(await screen.findByText('No plugins installed.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Plugin spec'), './plugins/demo')
    await user.click(screen.getByRole('button', { name: 'Add plugin' }))

    expect(await screen.findByText('@acme/demo')).toBeInTheDocument()
    expect(api.api.agent.plugins.install).toHaveBeenCalledWith({
      spec: './plugins/demo',
      directory: '/tmp/workspace'
    })
  })

  it('toggles and removes an installed plugin', async () => {
    const user = userEvent.setup()
    const entry = plugin()
    api.api.agent.plugins.list = vi.fn(async () => [entry])
    api.api.agent.plugins.update = vi.fn(async () => [{ ...entry, enabled: false }])
    api.api.agent.plugins.remove = vi.fn(async () => [])
    render(<PluginSettings />)

    await screen.findByText('@acme/demo')
    await user.click(screen.getByRole('checkbox', { name: 'Enabled: @acme/demo' }))
    await waitFor(() => {
      expect(api.api.agent.plugins.update).toHaveBeenCalledWith('plugin-1', { enabled: false })
    })

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(api.api.agent.plugins.remove).toHaveBeenCalledWith('plugin-1')
    })
    expect(await screen.findByText('No plugins installed.')).toBeInTheDocument()
  })
})

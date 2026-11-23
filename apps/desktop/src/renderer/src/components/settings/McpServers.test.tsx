import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig, McpServerStatus } from '@ateam/shared'
import McpServers from './McpServers'
import { createApiMock, type ApiMock } from '../../test/api-mock'

const SERVER: McpServerConfig = {
  id: 'server-1',
  name: 'demo',
  type: 'local',
  command: 'node',
  args: ['server.js'],
  url: null,
  headers: {},
  env: {},
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const STATUS: McpServerStatus = {
  id: 'server-1',
  name: 'demo',
  state: 'connected',
  toolCount: 2,
  promptCount: 0,
  resourceCount: 0,
  error: null,
  updatedAt: '2026-01-01T00:00:00.000Z'
}

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('McpServers', () => {
  it('lists servers with their connection status', async () => {
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [STATUS]
    })

    render(<McpServers />)

    expect(await screen.findByText('demo')).toBeInTheDocument()
    expect(screen.getByText('Connected · 2 tools')).toBeInTheDocument()
  })

  it('shows prompt and resource counts for connected servers', async () => {
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [{ ...STATUS, promptCount: 1, resourceCount: 3 }]
    })

    render(<McpServers />)

    expect(
      await screen.findByText('Connected · 2 tools · 1 prompts · 3 resources')
    ).toBeInTheDocument()
  })

  it('shows failed connections with the error message', async () => {
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [{ ...STATUS, state: 'failed', toolCount: 0, error: 'spawn failed' }]
    })

    render(<McpServers />)

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('spawn failed')).toBeInTheDocument()
  })

  it('adds a local server', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({ servers: [], statuses: [] })
    vi.mocked(mock.api.agent.mcp.add).mockResolvedValue({ ...SERVER, id: 'new-server' })

    render(<McpServers />)
    await user.type(await screen.findByLabelText('Name'), 'demo')
    await user.type(screen.getByLabelText('Command'), 'node')
    await user.type(screen.getByLabelText('Arguments'), 'server.js')
    await user.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.add).toHaveBeenCalledWith({
        name: 'demo',
        type: 'local',
        command: 'node',
        args: ['server.js'],
        url: null,
        headers: {},
        env: {},
        enabled: true,
        oauthClientId: null,
        oauthScope: null,
        oauthRedirectUri: null
      })
    )
    expect(mock.api.agent.mcp.list).toHaveBeenCalledTimes(2)
  })

  it('adds a remote server with headers', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({ servers: [], statuses: [] })
    vi.mocked(mock.api.agent.mcp.add).mockResolvedValue({
      ...SERVER,
      id: 'remote-1',
      name: 'docs',
      type: 'remote',
      command: null,
      args: [],
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer token' }
    })

    render(<McpServers />)
    await user.type(await screen.findByLabelText('Name'), 'docs')
    await user.selectOptions(screen.getByLabelText('Type'), 'remote')
    await user.type(screen.getByLabelText('URL'), 'https://mcp.example.com')
    await user.type(screen.getByLabelText('Headers'), 'Authorization: Bearer token')
    await user.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.add).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'docs',
          type: 'remote',
          url: 'https://mcp.example.com',
          headers: { Authorization: 'Bearer token' }
        })
      )
    )
  })

  it('submits OAuth client settings for remote servers', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({ servers: [], statuses: [] })
    vi.mocked(mock.api.agent.mcp.add).mockResolvedValue({
      ...SERVER,
      id: 'remote-1',
      name: 'docs',
      type: 'remote',
      command: null,
      args: [],
      url: 'https://mcp.example.com'
    })

    render(<McpServers />)
    await user.type(await screen.findByLabelText('Name'), 'docs')
    await user.selectOptions(screen.getByLabelText('Type'), 'remote')
    await user.type(screen.getByLabelText('URL'), 'https://mcp.example.com')
    await user.type(screen.getByLabelText('OAuth client ID'), 'client-1')
    await user.type(screen.getByLabelText('OAuth scope'), 'files')
    await user.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.add).toHaveBeenCalledWith(
        expect.objectContaining({
          oauthClientId: 'client-1',
          oauthScope: 'files',
          oauthRedirectUri: null
        })
      )
    )
  })

  it('marks servers that need authorization and starts the flow', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [
        { ...SERVER, type: 'remote', command: null, args: [], url: 'https://mcp.example.com' }
      ],
      statuses: [{ ...STATUS, state: 'auth-required', toolCount: 0 }]
    })
    vi.mocked(mock.api.agent.mcp.authStatuses).mockResolvedValue([
      { serverId: 'server-1', serverName: 'demo', authorized: false, expiresAt: null }
    ])
    vi.mocked(mock.api.agent.mcp.authorize).mockResolvedValue([
      { serverId: 'server-1', serverName: 'demo', authorized: true, expiresAt: null }
    ])

    render(<McpServers />)
    expect(await screen.findByText('Needs authorization')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Authorize' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.authorize).toHaveBeenCalledWith('server-1', undefined)
    )
  })

  it('signs out an authorized server', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [
        { ...SERVER, type: 'remote', command: null, args: [], url: 'https://mcp.example.com' }
      ],
      statuses: [STATUS]
    })
    vi.mocked(mock.api.agent.mcp.authStatuses).mockResolvedValue([
      { serverId: 'server-1', serverName: 'demo', authorized: true, expiresAt: null }
    ])
    vi.mocked(mock.api.agent.mcp.logout).mockResolvedValue([
      { serverId: 'server-1', serverName: 'demo', authorized: false, expiresAt: null }
    ])

    render(<McpServers />)
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.logout).toHaveBeenCalledWith('server-1', undefined)
    )
  })

  it('toggles a server and keeps the returned state', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [STATUS]
    })
    vi.mocked(mock.api.agent.mcp.update).mockResolvedValue({ ...SERVER, enabled: false })

    render(<McpServers />)
    await user.click(await screen.findByRole('checkbox', { name: 'Enabled: demo' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.update).toHaveBeenCalledWith('server-1', { enabled: false })
    )
    expect(screen.getByRole('checkbox', { name: 'Enabled: demo' })).not.toBeChecked()
  })

  it('edits an existing server', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [STATUS]
    })
    vi.mocked(mock.api.agent.mcp.update).mockResolvedValue({ ...SERVER, name: 'renamed' })

    render(<McpServers />)
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('demo')
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'renamed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(mock.api.agent.mcp.update).toHaveBeenCalledWith(
        'server-1',
        expect.objectContaining({ name: 'renamed', command: 'node' })
      )
    )
    expect(await screen.findByText('renamed')).toBeInTheDocument()
  })

  it('removes a server', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [STATUS]
    })

    render(<McpServers />)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mock.api.agent.mcp.remove).toHaveBeenCalledWith('server-1'))
    expect(screen.queryByText('demo')).not.toBeInTheDocument()
  })

  it('probes connections when refreshing statuses', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [SERVER],
      statuses: [{ ...STATUS, state: 'idle', toolCount: 0 }]
    })
    vi.mocked(mock.api.agent.mcp.statuses).mockResolvedValue([
      { ...STATUS, state: 'failed', toolCount: 0, error: 'offline' }
    ])

    render(<McpServers />)
    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh status' }))

    await waitFor(() => expect(mock.api.agent.mcp.statuses).toHaveBeenCalledWith({ probe: true }))
    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('shows API errors', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({ servers: [], statuses: [] })
    vi.mocked(mock.api.agent.mcp.add).mockRejectedValue(
      new Error('Local MCP servers require a command')
    )

    render(<McpServers />)
    await user.type(await screen.findByLabelText('Name'), 'demo')
    await user.type(screen.getByLabelText('Command'), 'node')
    await user.click(screen.getByRole('button', { name: 'Add server' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Local MCP servers require a command'
    )
  })
  it('marks project-managed servers read-only while keeping authorization available', async () => {
    const projectServer = {
      ...SERVER,
      source: 'project' as const,
      type: 'remote' as const,
      url: 'https://mcp.example.com/mcp'
    }
    vi.mocked(mock.api.agent.mcp.list).mockResolvedValue({
      servers: [projectServer],
      statuses: [STATUS]
    })

    render(<McpServers />)

    expect(await screen.findByText('Project')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enabled: demo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeInTheDocument()
  })
})

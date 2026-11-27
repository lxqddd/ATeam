import { app, shell } from 'electron'
import {
  AGENT_CHANNELS,
  type McpAuthStatus,
  type McpServerConfig,
  type McpServerStatus
} from '@ateam/shared'
import { authorizeMcpServer, mcpFilePath } from '@ateam/agent-core/integrations'
import type { AgentIpcContext } from './context'
import {
  authPayloadSchema,
  directoryPayloadSchema,
  idPayloadSchema,
  mcpPromptSchema,
  mcpServerInputSchema,
  mcpStatusesSchema,
  mcpUpdateSchema
} from './schemas'

/** Registers MCP server CRUD, prompt resolution and auth channels. */
export function registerMcpHandlers(ctx: AgentIpcContext): void {
  const { manager, mcpAuthStore, handle, requestedDirectory } = ctx

  handle(
    AGENT_CHANNELS.mcpList,
    (payload): Promise<{ servers: McpServerConfig[]; statuses: McpServerStatus[] }> => {
      const { directory } = directoryPayloadSchema.parse(payload ?? {})
      return manager.request('mcp.list', { workspace: requestedDirectory(directory) })
    }
  )

  handle(AGENT_CHANNELS.mcpStatuses, (payload): Promise<McpServerStatus[]> => {
    const { probe, directory } = mcpStatusesSchema.parse(payload ?? {})
    return manager.request('mcp.statuses', {
      probe,
      workspace: requestedDirectory(directory)
    })
  })

  handle(AGENT_CHANNELS.mcpAdd, async (payload): Promise<McpServerConfig> => {
    const input = mcpServerInputSchema.parse(payload)
    const server = await manager.request<McpServerConfig>('mcp.add', input)
    ctx.configWatcher?.noteSelfWrite(mcpFilePath(app.getPath('userData')))
    return server
  })

  handle(AGENT_CHANNELS.mcpUpdate, async (payload): Promise<McpServerConfig> => {
    const { id, input } = mcpUpdateSchema.parse(payload)
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list')
    const previous = servers.find((server) => server.id === id)
    const updated = await manager.request<McpServerConfig>('mcp.update', { id, input })
    ctx.configWatcher?.noteSelfWrite(mcpFilePath(app.getPath('userData')))
    const credentialsChanged =
      !previous ||
      previous.url !== updated.url ||
      previous.type !== updated.type ||
      (previous.oauthClientId ?? null) !== (updated.oauthClientId ?? null) ||
      (previous.oauthRedirectUri ?? null) !== (updated.oauthRedirectUri ?? null)
    if (credentialsChanged) {
      await mcpAuthStore.remove(updated.id)
      await manager.setMcpAuth(mcpAuthStore.list())
    }
    return updated
  })

  handle(AGENT_CHANNELS.mcpPrompt, (payload): Promise<string> => {
    const { server, prompt, arguments: args, directory } = mcpPromptSchema.parse(payload)
    return manager.request('mcp.prompt', {
      server,
      prompt,
      arguments: args,
      workspace: requestedDirectory(directory)
    })
  })

  handle(AGENT_CHANNELS.mcpRemove, async (payload): Promise<boolean> => {
    const { id } = idPayloadSchema.parse(payload)
    const removed = await manager.request<boolean>('mcp.remove', { id })
    if (removed) {
      ctx.configWatcher?.noteSelfWrite(mcpFilePath(app.getPath('userData')))
      await mcpAuthStore.remove(id)
      await manager.setMcpAuth(mcpAuthStore.list())
    }
    return removed
  })

  handle(AGENT_CHANNELS.mcpAuthStatuses, async (payload): Promise<McpAuthStatus[]> => {
    const { directory } = directoryPayloadSchema.parse(payload ?? {})
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list', {
      workspace: requestedDirectory(directory)
    })
    return mcpAuthStore.statuses(servers)
  })

  handle(AGENT_CHANNELS.mcpAuthorize, async (payload): Promise<McpAuthStatus[]> => {
    const { id, directory } = authPayloadSchema.parse(payload)
    const workspace = requestedDirectory(directory)
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list', {
      workspace
    })
    const server = servers.find((candidate) => candidate.id === id)
    if (!server) throw new Error('MCP server not found')
    await authorizeMcpServer({
      server,
      authStore: mcpAuthStore,
      openExternal: (url) => shell.openExternal(url)
    })
    await manager.setMcpAuth(mcpAuthStore.list())
    await manager.request('mcp.statuses', { probe: true, workspace }).catch(() => undefined)
    return mcpAuthStore.statuses(servers)
  })

  handle(AGENT_CHANNELS.mcpLogout, async (payload): Promise<McpAuthStatus[]> => {
    const { id, directory } = authPayloadSchema.parse(payload)
    const workspace = requestedDirectory(directory)
    await mcpAuthStore.remove(id)
    await manager.setMcpAuth(mcpAuthStore.list())
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list', {
      workspace
    })
    await manager.request('mcp.statuses', { probe: true, workspace }).catch(() => undefined)
    return mcpAuthStore.statuses(servers)
  })
}

import { registerAttachmentHandlers } from './attachments-files'
import { registerChatHandlers } from './chat'
import { registerConfigHandlers } from './config'
import { createAgentIpcContext, type AgentIpcOptions } from './context'
import { registerInfoHandlers } from './info'
import { registerMcpHandlers } from './mcp'
import { registerPermissionHandlers } from './permissions'
import { registerPluginHandlers } from './plugins'
import { registerSessionHandlers } from './sessions'
import { registerWebSearchHandlers } from './websearch'
import { registerWorkspaceHandlers } from './workspace'

/**
 * Registers every agent IPC channel.
 *
 * Each domain module receives the same context so `handle` stays the single
 * trusted-sender gate and shared state (config store, token refresh, reference
 * cache) keeps its registration-time lifetime.
 */
export function registerAgentIpc(options: AgentIpcOptions): void {
  const ctx = createAgentIpcContext(options)
  registerInfoHandlers(ctx)
  registerSessionHandlers(ctx)
  registerChatHandlers(ctx)
  registerAttachmentHandlers(ctx)
  registerPermissionHandlers(ctx)
  registerConfigHandlers(ctx)
  registerPluginHandlers(ctx)
  registerMcpHandlers(ctx)
  registerWebSearchHandlers(ctx)
  registerWorkspaceHandlers(ctx)
}

import { AGENT_CHANNELS, type VcsDiffResult, type VcsStatus } from '@ateam/shared'
import type { AgentIpcContext } from './context'
import { vcsDiffSchema, vcsStatusSchema } from './schemas'

/** Registers the read-only Git inspection channels. */
export function registerVcsHandlers(ctx: AgentIpcContext): void {
  const { manager, handle } = ctx

  handle(AGENT_CHANNELS.vcsStatus, (payload): Promise<VcsStatus> => {
    const { sessionId } = vcsStatusSchema.parse(payload)
    return manager.request('vcs.status', { sessionId })
  })

  handle(AGENT_CHANNELS.vcsDiff, (payload): Promise<VcsDiffResult> => {
    const { sessionId, mode, base, path } = vcsDiffSchema.parse(payload)
    return manager.request('vcs.diff', { sessionId, mode, base, path })
  })
}

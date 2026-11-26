import { AgentRuntime } from '@ateam/agent-core'
import type { AgentEventEnvelope, RuntimeModelsConfig } from '@ateam/shared'

export interface HeadlessRuntimeOptions {
  dataDir: string
  workspace: string
  models: RuntimeModelsConfig
  send: (envelope: AgentEventEnvelope) => void
}

/**
 * Single construction point for the headless entries (CLI, HTTP server, ACP).
 * Keep runtime wiring here so the three entries cannot drift apart.
 */
export function createHeadlessRuntime(options: HeadlessRuntimeOptions): AgentRuntime {
  return new AgentRuntime({
    userDataPath: options.dataDir,
    workspacePath: options.workspace,
    models: options.models,
    send: options.send
  })
}

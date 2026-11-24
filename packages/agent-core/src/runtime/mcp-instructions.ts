import type { AgentDefinition, PermissionMode, PermissionRule } from '@ateam/shared'
import { evaluatePermissionRules } from '../config/permissions'

export interface McpInstructionEntry {
  server: string
  instructions: string
  tools: Array<{ name: string; resource: string }>
}

function agentRules(agent: AgentDefinition | null): PermissionRule[] {
  return (agent?.permissions ?? []).map((rule, index) => ({
    ...rule,
    id: `agent-mcp-${index}`,
    sessionId: null,
    createdAt: ''
  }))
}

function denied(rules: PermissionRule[], resource: string): boolean {
  return (
    evaluatePermissionRules(rules, {
      action: 'mcp',
      resources: [resource],
      sessionId: null
    }) === 'deny'
  )
}

/** Keep server instructions only for servers the agent can actually use. */
export function filterMcpInstructions(input: {
  instructions: McpInstructionEntry[]
  availableTools: Set<string>
  permissionMode: PermissionMode
  agent: AgentDefinition | null
}): Array<{ server: string; instructions: string }> {
  if (input.permissionMode === 'plan') return []
  const rules = agentRules(input.agent)
  return input.instructions
    .filter((item) => {
      if (item.tools.length > 0) {
        return item.tools.some(
          (tool) => input.availableTools.has(tool.name) && !denied(rules, tool.resource)
        )
      }
      const helpers = ['mcp_prompt', 'mcp_resource'].some((name) => input.availableTools.has(name))
      if (!helpers) return false
      return [`${item.server}/prompts/*`, `${item.server}/resources/*`].some(
        (resource) => !denied(rules, resource)
      )
    })
    .map((item) => ({ server: item.server, instructions: item.instructions }))
}

import type {
  AgentDefinition,
  EffectiveAgentConfig,
  OrgPolicyInfo,
  PermissionRule,
  PermissionRuleGroupView,
  PermissionRuleInput,
  PermissionRuleView,
  PermissionRulesOverview
} from '@ateam/shared'

export interface PermissionOverviewInput {
  workspace: string
  /** Rules saved by the permission store, both global and session scoped. */
  storedRules: PermissionRule[]
  effective: Pick<
    EffectiveAgentConfig,
    'sources' | 'globalPermissionRules' | 'projectPermissionRules'
  >
  agents: AgentDefinition[]
  policy: Pick<OrgPolicyInfo, 'path' | 'rules'>
}

function persistedView(rule: PermissionRule): PermissionRuleView {
  return {
    id: rule.id,
    action: rule.action,
    resource: rule.resource,
    effect: rule.effect,
    sessionId: rule.sessionId
  }
}

function configViews(
  rules: PermissionRuleInput[] | undefined,
  prefix: string
): PermissionRuleView[] {
  return (rules ?? []).map((rule, index) => ({
    id: `${prefix}-${index}`,
    action: rule.action,
    resource: rule.resource,
    effect: rule.effect
  }))
}

/**
 * Derives the six permission layers in evaluation order (later layers override
 * earlier ones). Mode rules and plan-file rules are runtime policy, not
 * configuration, so they stay out of the overview.
 */
export function buildPermissionOverview(input: PermissionOverviewInput): PermissionRulesOverview {
  const globalPersisted = input.storedRules.filter((rule) => rule.sessionId === null)
  const sessionPersisted = input.storedRules.filter((rule) => rule.sessionId !== null)

  const agentGroups: PermissionRuleGroupView[] = input.agents
    .filter((agent) => agent.permissions.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((agent) => ({
      source: 'agent',
      editable: false,
      agentId: agent.id,
      agentName: agent.name,
      agentSource: agent.source,
      rules: agent.permissions.map((rule, index) => ({
        id: `agent-${agent.id}-${index}`,
        action: rule.action,
        resource: rule.resource,
        effect: rule.effect
      }))
    }))
  // Keep the layer visible even when no agent declares rules.
  if (agentGroups.length === 0) {
    agentGroups.push({ source: 'agent', editable: false, rules: [] })
  }

  return {
    workspace: input.workspace,
    groups: [
      {
        source: 'global-persisted',
        editable: true,
        rules: globalPersisted.map(persistedView)
      },
      {
        source: 'global-config',
        editable: false,
        path: input.effective.sources.globalConfigPath,
        rules: configViews(input.effective.globalPermissionRules, 'global-config')
      },
      {
        source: 'project-config',
        editable: false,
        ...(input.effective.sources.projectConfigPath
          ? { path: input.effective.sources.projectConfigPath }
          : {}),
        rules: configViews(input.effective.projectPermissionRules, 'project-config')
      },
      ...agentGroups,
      {
        source: 'session-persisted',
        editable: true,
        rules: sessionPersisted.map(persistedView)
      },
      {
        source: 'policy',
        editable: false,
        ...(input.policy.path ? { path: input.policy.path } : {}),
        rules: input.policy.rules.map((rule, index) => ({
          id: `policy-${index}`,
          action: rule.action,
          resource: rule.resource,
          effect: rule.effect
        }))
      }
    ]
  }
}

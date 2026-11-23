import type { TFunction } from 'i18next'
import type { AgentDefinition, PermissionMode, ReasoningEffort } from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import type { ComposerChoiceOption } from '../ComposerChoiceChip'

export const REASONING_LABEL_KEYS: Record<ReasoningEffort, string> = {
  minimal: 'chat.reasoningMinimal',
  low: 'chat.reasoningLow',
  medium: 'chat.reasoningMedium',
  high: 'chat.reasoningHigh'
}

export const PERMISSION_LABEL_KEYS: Record<PermissionMode, string> = {
  plan: 'chat.permissionPlan',
  ask: 'chat.permissionAsk',
  acceptEdits: 'chat.permissionAcceptEdits',
  auto: 'chat.permissionAuto'
}

export const PERMISSION_HINT_KEYS: Record<PermissionMode, string> = {
  plan: 'chat.permissionPlanHint',
  ask: 'chat.permissionAskHint',
  acceptEdits: 'chat.permissionAcceptEditsHint',
  auto: 'chat.permissionAutoHint'
}

const AGENT_DESCRIPTION_KEYS: Record<string, string> = {
  build: 'chat.agentBuildDescription',
  plan: 'chat.agentPlanDescription'
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function displayAgentName(agent: AgentDefinition): string {
  return agent.name ? agent.name.charAt(0).toUpperCase() + agent.name.slice(1) : agent.id
}

export function displayReasoningLabel(t: TFunction, effort: ReasoningEffort | null): string {
  return effort ? t(REASONING_LABEL_KEYS[effort]) : t('chat.reasoningDefault')
}

export function buildReasoningOptions(t: TFunction): ComposerChoiceOption[] {
  return [
    { value: 'default', label: t('chat.reasoningDefault') },
    ...REASONING_EFFORTS.map((effort) => ({
      value: effort,
      label: t(REASONING_LABEL_KEYS[effort])
    }))
  ]
}

export function buildPermissionOptions(t: TFunction): ComposerChoiceOption[] {
  return PERMISSION_MODES.map((mode) => ({
    value: mode,
    label: t(PERMISSION_LABEL_KEYS[mode]),
    description: t(PERMISSION_HINT_KEYS[mode])
  }))
}

export function buildAgentOptions(agents: AgentDefinition[], t: TFunction): ComposerChoiceOption[] {
  return agents.map((agent) => ({
    value: agent.id,
    label: displayAgentName(agent),
    description:
      agent.source === 'builtin' && AGENT_DESCRIPTION_KEYS[agent.id]
        ? t(AGENT_DESCRIPTION_KEYS[agent.id])
        : agent.description
  }))
}

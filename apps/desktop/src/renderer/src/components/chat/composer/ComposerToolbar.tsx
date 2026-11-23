import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentDefinition,
  ModelRef,
  ModelVariant,
  ModelsConfigPublic,
  PermissionMode,
  ReasoningEffort
} from '@ateam/shared'
import ComposerChoiceChip from '../ComposerChoiceChip'
import ModelPicker from '../ModelPicker'
import {
  buildAgentOptions,
  buildPermissionOptions,
  buildReasoningOptions,
  displayReasoningLabel,
  PERMISSION_LABEL_KEYS
} from './constants'
import { AgentIcon, AttachIcon, ReasoningIcon, ShieldIcon } from './icons'

interface ComposerToolbarProps {
  models: ModelsConfigPublic | null
  model: ModelRef | null
  onModelChange: (model: ModelRef) => void
  modelVariants: ModelVariant[]
  activeVariant: string | null
  agents: AgentDefinition[]
  activeAgentId: string
  reasoningEffort: ReasoningEffort | null
  showReasoning: boolean
  permissionMode: PermissionMode
  ready: boolean
  running: boolean
  sending: boolean
  attaching: boolean
  attachmentsDisabled: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onFilesSelected: (files: File[]) => void
  onSettingsChange: (patch: {
    reasoningEffort?: ReasoningEffort | null
    permissionMode?: PermissionMode
  }) => void
  onAgentChange: (agentId: string) => void
}

function ComposerToolbar({
  models,
  model,
  onModelChange,
  modelVariants,
  activeVariant,
  agents,
  activeAgentId,
  reasoningEffort,
  showReasoning,
  permissionMode,
  ready,
  running,
  sending,
  attaching,
  attachmentsDisabled,
  fileInputRef,
  onFilesSelected,
  onSettingsChange,
  onAgentChange
}: ComposerToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  const variantLabel = activeVariant
    ? (modelVariants.find((variant) => variant.id === activeVariant)?.name ?? activeVariant)
    : t('chat.variantDefault')
  const agentOptions = buildAgentOptions(agents, t)
  const agentLabel =
    agentOptions.find((option) => option.value === activeAgentId)?.label ?? t('chat.agentDefault')
  const reasoningOptions = buildReasoningOptions(t)
  const reasoningLabel = displayReasoningLabel(t, reasoningEffort)
  const permissionOptions = buildPermissionOptions(t)

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        aria-label={t('chat.chooseFiles')}
        className="sr-only"
        disabled={attachmentsDisabled}
        onChange={(event) => {
          onFilesSelected(Array.from(event.target.files ?? []))
        }}
      />
      <button
        type="button"
        aria-label={t('chat.attachFiles')}
        title={t('chat.attachFiles')}
        disabled={!ready || sending || attaching || attachmentsDisabled}
        onClick={() => fileInputRef.current?.click()}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55"
      >
        <AttachIcon />
      </button>
      <ModelPicker
        models={models}
        value={model}
        onChange={onModelChange}
        disabled={!ready || running || sending}
      />
      {modelVariants.length > 0 && (
        <ComposerChoiceChip
          ariaLabel={t('chat.modelVariant')}
          accessibleLabel={`${t('chat.modelVariant')}: ${variantLabel}`}
          label={`${t('chat.variantShort')} · ${variantLabel}`}
          value={activeVariant ?? 'default'}
          options={[
            { value: 'default', label: t('chat.variantDefault') },
            ...modelVariants.map((variant) => ({ value: variant.id, label: variant.name }))
          ]}
          onChange={(value) => {
            if (!model) return
            onModelChange({
              ...model,
              variant: value === 'default' ? null : value
            })
          }}
          disabled={!ready || running || sending}
        />
      )}
      {agentOptions.length > 0 && (
        <ComposerChoiceChip
          ariaLabel={t('chat.agent')}
          accessibleLabel={`${t('chat.agent')}: ${agentLabel}`}
          label={agentLabel}
          value={activeAgentId}
          options={agentOptions}
          onChange={onAgentChange}
          disabled={!ready || sending}
          icon={<AgentIcon />}
        />
      )}
      {showReasoning && (
        <ComposerChoiceChip
          ariaLabel={t('chat.reasoning')}
          accessibleLabel={`${t('chat.reasoning')}: ${reasoningLabel}`}
          label={`${t('chat.reasoningShort')} · ${reasoningLabel}`}
          value={reasoningEffort ?? 'default'}
          options={reasoningOptions}
          onChange={(value) => {
            onSettingsChange({
              reasoningEffort: value === 'default' ? null : (value as ReasoningEffort)
            })
          }}
          disabled={!ready || sending}
          icon={<ReasoningIcon />}
        />
      )}
      <ComposerChoiceChip
        ariaLabel={t('chat.permissionMode')}
        label={t(PERMISSION_LABEL_KEYS[permissionMode])}
        value={permissionMode}
        options={permissionOptions}
        onChange={(value) => {
          onSettingsChange({ permissionMode: value as PermissionMode })
        }}
        disabled={!ready || sending}
        icon={<ShieldIcon />}
      />
    </div>
  )
}

export default ComposerToolbar

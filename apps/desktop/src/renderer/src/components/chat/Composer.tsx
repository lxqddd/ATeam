import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type {
  AgentDefinition,
  CommandDefinition,
  MessageAttachment,
  ModelRef,
  PermissionMode,
  ReasoningEffort,
  SessionSettings
} from '@ateam/shared'
import { expandCommand } from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import { chatStore, useChatStore } from '../../chat/store'
import ComposerChoiceChip from './ComposerChoiceChip'
import ModelPicker from './ModelPicker'

const REASONING_LABEL_KEYS: Record<ReasoningEffort, string> = {
  minimal: 'chat.reasoningMinimal',
  low: 'chat.reasoningLow',
  medium: 'chat.reasoningMedium',
  high: 'chat.reasoningHigh'
}

const PERMISSION_LABEL_KEYS: Record<PermissionMode, string> = {
  plan: 'chat.permissionPlan',
  ask: 'chat.permissionAsk',
  acceptEdits: 'chat.permissionAcceptEdits',
  auto: 'chat.permissionAuto'
}

const PERMISSION_HINT_KEYS: Record<PermissionMode, string> = {
  plan: 'chat.permissionPlanHint',
  ask: 'chat.permissionAskHint',
  acceptEdits: 'chat.permissionAcceptEditsHint',
  auto: 'chat.permissionAutoHint'
}

function ReasoningIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 13.6 9l5.4 1.7-5.4 1.7L12 18l-1.6-5.6L5 10.7 10.4 9 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 16.5 19.2 19l2.3.8-2.3.7-.7 2.5-.7-2.5-2.3-.7 2.3-.8.7-2.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ShieldIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 19 6v5.3c0 4.4-2.8 7.8-7 9.2-4.2-1.4-7-4.8-7-9.2V6l7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m8.8 12 2.2 2.2 4.2-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const AGENT_DESCRIPTION_KEYS: Record<string, string> = {
  build: 'chat.agentBuildDescription',
  plan: 'chat.agentPlanDescription'
}

function displayAgentName(agent: AgentDefinition): string {
  return agent.name ? agent.name.charAt(0).toUpperCase() + agent.name.slice(1) : agent.id
}

function AgentIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7V4M9 12h.01M15 12h.01M9 16h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Composer(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, models, agents, commands, status, revertPrompt } =
    useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [mention, setMention] = useState<{
    query: string
    start: number
    items: string[]
  } | null>(null)
  const [commandQuery, setCommandQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const hasModels = (models?.models.length ?? 0) > 0
  const effectiveModel = session?.model ?? models?.defaultModel ?? null
  const effectiveModelInfo = models?.models.find(
    (model) =>
      model.providerId === effectiveModel?.providerId && model.modelId === effectiveModel?.modelId
  )
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const ready = status.status === 'ready'
  const reasoningEffort = session?.reasoningEffort ?? null
  const permissionMode = session?.permissionMode ?? 'ask'
  const reasoningLabel = reasoningEffort
    ? t(REASONING_LABEL_KEYS[reasoningEffort])
    : t('chat.reasoningDefault')

  const reasoningOptions = [
    { value: 'default', label: t('chat.reasoningDefault') },
    ...REASONING_EFFORTS.map((effort) => ({
      value: effort,
      label: t(REASONING_LABEL_KEYS[effort])
    }))
  ]
  const permissionOptions = PERMISSION_MODES.map((mode) => ({
    value: mode,
    label: t(PERMISSION_LABEL_KEYS[mode]),
    description: t(PERMISSION_HINT_KEYS[mode])
  }))

  const primaryAgents = agents.filter((agent) => agent.mode !== 'subagent')
  const activeAgent =
    primaryAgents.find((agent) => agent.id === session?.agent) ??
    primaryAgents.find((agent) => agent.id === 'build') ??
    primaryAgents[0] ??
    null
  const agentLabel = activeAgent ? displayAgentName(activeAgent) : t('chat.agentDefault')
  const agentOptions = primaryAgents.map((agent) => ({
    value: agent.id,
    label: displayAgentName(agent),
    description:
      agent.source === 'builtin' && AGENT_DESCRIPTION_KEYS[agent.id]
        ? t(AGENT_DESCRIPTION_KEYS[agent.id])
        : agent.description
  }))

  const attachmentsDisabled = effectiveModelInfo?.attachment === false
  const commandItems: CommandDefinition[] =
    commandQuery === null
      ? []
      : commands.filter((command) => {
          const needle = commandQuery.toLowerCase()
          return (
            command.name.toLowerCase().includes(needle) ||
            command.description.toLowerCase().includes(needle)
          )
        })

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(200, Math.max(44, element.scrollHeight))}px`
  }, [text])

  useEffect(() => {
    if (revertPrompt === null) return
    // An undo result arrives from the store; seed the local draft once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(revertPrompt)
    chatStore.clearRevertPrompt()
    textareaRef.current?.focus()
  }, [revertPrompt])

  async function addFiles(files: File[]): Promise<void> {
    if (files.length === 0) return
    setAttaching(true)
    setError(null)
    try {
      const target = await chatStore.ensureSession()
      const added: MessageAttachment[] = []
      for (const file of files) {
        const data = new Uint8Array(await file.arrayBuffer())
        added.push(
          await window.api.agent.attachments.import(target.id, {
            name: file.name,
            mimeType: file.type,
            data
          })
        )
      }
      setAttachments((current) => [...current, ...added])
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setAttaching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function removeAttachment(attachment: MessageAttachment): Promise<void> {
    setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))
    const sessionId = session?.id ?? selectedSessionId
    if (!sessionId) return
    await window.api.agent.attachments.remove(sessionId, attachment.id).catch(() => undefined)
  }

  function detectMention(value: string, cursor: number): void {
    const slash = /^\/([^\s]*)$/.exec(value.slice(0, cursor))
    setCommandQuery(slash ? slash[1] : null)
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, cursor))
    if (!match || match[2].length === 0) {
      setMention(null)
      return
    }
    const query = match[2]
    const start = cursor - query.length - 1
    window.api.agent.files
      .search(query)
      .then((items) => {
        setMention(items.length > 0 ? { query, start, items } : null)
      })
      .catch(() => setMention(null))
  }

  function applyCommand(command: CommandDefinition): void {
    setText(`/${command.name} `)
    setCommandQuery(null)
    textareaRef.current?.focus()
  }

  function expandSlashCommand(value: string): string {
    const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(value)
    if (!match) return value
    const command = commands.find(
      (candidate) => candidate.name.toLowerCase() === match[1].toLowerCase()
    )
    return command ? expandCommand(command.template, match[2] ?? '') : value
  }

  function applyMention(filePath: string): void {
    if (!mention) return
    const after = text.slice(mention.start + mention.query.length + 1)
    const next = `${text.slice(0, mention.start)}@${filePath} ${after.replace(/^\s*/, '')}`
    setText(next)
    setMention(null)
    textareaRef.current?.focus()
  }

  async function submit(): Promise<void> {
    const content = text.trim()
    if ((!content && attachments.length === 0) || sending || running) return
    if (!ready) {
      setError(t('chat.agentStoppedHint'))
      return
    }
    if (!hasModels) {
      setError(t('chat.noModel'))
      return
    }
    if (!effectiveModel) {
      setError(t('chat.selectModelFirst'))
      return
    }

    setSending(true)
    setError(null)
    try {
      await chatStore.send(expandSlashCommand(content), attachments)
      setText('')
      setAttachments([])
      setMention(null)
      setCommandQuery(null)
    } catch (caught) {
      const message = errorMessage(caught)
      setError(
        message === 'AGENT_NOT_READY'
          ? t('chat.agentStoppedHint')
          : message === 'SESSION_BUSY'
            ? t('chat.sessionBusy')
            : message
      )
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  async function stop(): Promise<void> {
    setError(null)
    try {
      await chatStore.stop()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function changeModel(model: ModelRef): Promise<void> {
    setError(null)
    try {
      const target = await chatStore.ensureSession()
      await chatStore.setSessionModel(target.id, model)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function changeSettings(patch: Partial<SessionSettings>): Promise<void> {
    setError(null)
    try {
      const target = await chatStore.ensureSession()
      await chatStore.setSessionSettings(target.id, {
        reasoningEffort: target.reasoningEffort ?? null,
        permissionMode: target.permissionMode ?? 'ask',
        ...patch
      })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function changeAgent(agentId: string): Promise<void> {
    setError(null)
    try {
      const target = await chatStore.ensureSession()
      await chatStore.setSessionAgent(target.id, agentId)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const placeholder = !ready
    ? status.status === 'starting'
      ? t('chat.agentStarting')
      : t('chat.agentStoppedHint')
    : t('chat.placeholder')

  const sendDisabled =
    (!text.trim() && attachments.length === 0) || sending || running || !ready || !hasModels

  return (
    <div className="mx-auto w-full max-w-[768px] flex-none px-4 pb-4">
      {!hasModels && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
          <span>{t('chat.noModel')}</span>
          <Link to="/models" className="font-medium text-warning underline underline-offset-2">
            {t('chat.configureModel')}
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
          {error}
        </div>
      )}

      <div
        data-testid="composer"
        className="rounded-[20px] border border-border bg-surface-raised p-3 shadow-sm transition-colors focus-within:border-border-strong"
        onDragOver={(event) => {
          event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          void addFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {commandItems.length > 0 && (
          <div
            role="listbox"
            aria-label={t('chat.commands')}
            className="mb-2 max-h-48 overflow-y-auto rounded-md border border-border bg-surface p-1"
          >
            {commandItems.map((command) => (
              <button
                key={command.id}
                type="button"
                role="option"
                onClick={() => applyCommand(command)}
                className="block w-full rounded px-2 py-1 text-left transition-colors hover:bg-hover"
              >
                <span className="block truncate text-label text-foreground">
                  <span aria-hidden className="text-muted">
                    /
                  </span>
                  {command.name}
                </span>
                {command.description && (
                  <span className="mt-0.5 block truncate text-caption text-muted">
                    {command.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {mention && (
          <div
            role="listbox"
            aria-label={t('chat.mentionFiles')}
            className="mb-2 max-h-48 overflow-y-auto rounded-md border border-border bg-surface p-1"
          >
            {mention.items.map((filePath) => (
              <button
                key={filePath}
                type="button"
                role="option"
                onClick={() => applyMention(filePath)}
                className="block w-full truncate rounded px-2 py-1 text-left font-mono text-caption text-foreground transition-colors hover:bg-hover"
              >
                {filePath}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-2 py-1 text-caption text-muted"
              >
                <span className="max-w-[200px] truncate text-foreground">{attachment.name}</span>
                <span className="flex-none">{formatFileSize(attachment.size)}</span>
                <button
                  type="button"
                  aria-label={`${t('chat.removeAttachment')}: ${attachment.name}`}
                  onClick={() => {
                    void removeAttachment(attachment)
                  }}
                  className="flex-none rounded px-1 text-subtle transition-colors hover:text-danger"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            detectMention(event.target.value, event.target.selectionStart ?? 0)
          }}
          onKeyDown={(event) => {
            if (commandItems.length > 0) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setCommandQuery(null)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                applyCommand(commandItems[0])
                return
              }
            }
            if (mention && mention.items.length > 0) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setMention(null)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                applyMention(mention.items[0])
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              void addFiles(files)
            }
          }}
          rows={1}
          disabled={!ready}
          placeholder={placeholder}
          aria-label={t('chat.placeholder')}
          className="block max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-0.5 text-body leading-[1.6] text-foreground outline-none placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-55"
        />

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              aria-label={t('chat.chooseFiles')}
              className="sr-only"
              disabled={attachmentsDisabled}
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []))
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="m20 11.5-8.2 8.2a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <ModelPicker
              models={models}
              value={effectiveModel}
              onChange={(model) => {
                void changeModel(model)
              }}
              disabled={!ready || running || sending}
            />
            {agentOptions.length > 0 && (
              <ComposerChoiceChip
                ariaLabel={t('chat.agent')}
                accessibleLabel={`${t('chat.agent')}: ${agentLabel}`}
                label={agentLabel}
                value={activeAgent?.id ?? ''}
                options={agentOptions}
                onChange={(value) => {
                  void changeAgent(value)
                }}
                disabled={!ready || sending}
                icon={<AgentIcon />}
              />
            )}
            {effectiveModelInfo?.reasoning !== false && (
              <ComposerChoiceChip
                ariaLabel={t('chat.reasoning')}
                accessibleLabel={`${t('chat.reasoning')}: ${reasoningLabel}`}
                label={`${t('chat.reasoningShort')} · ${reasoningLabel}`}
                value={reasoningEffort ?? 'default'}
                options={reasoningOptions}
                onChange={(value) => {
                  void changeSettings({
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
                void changeSettings({ permissionMode: value as PermissionMode })
              }}
              disabled={!ready || sending}
              icon={<ShieldIcon />}
            />
          </div>

          {running ? (
            <button
              type="button"
              onClick={() => {
                void stop()
              }}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void submit()
              }}
              disabled={sendDisabled}
              title={t('chat.send')}
              aria-label={t('chat.send')}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:bg-active disabled:text-subtle"
            >
              {sending ? (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 19V5M6.5 10.5 12 5l5.5 5.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Composer

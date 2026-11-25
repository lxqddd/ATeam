import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { QueuedMessage } from '@ateam/shared'
import { chatStore, useChatStore } from '../../chat/store'
import { errorMessage } from '../../lib/errors'
import ComposerActions from './composer/ComposerActions'
import ComposerAttachments from './composer/ComposerAttachments'
import ComposerQueue from './composer/ComposerQueue'
import ComposerShellPrompt from './composer/ComposerShellPrompt'
import ComposerSuggestions from './composer/ComposerSuggestions'
import ComposerToolbar from './composer/ComposerToolbar'
import { useComposerAttachments } from './composer/useComposerAttachments'
import { useCommandMenu } from './composer/useCommandMenu'
import { useComposerSubmit } from './composer/useComposerSubmit'
import { useMentionSearch } from './composer/useMentionSearch'

function Composer(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    sessions,
    selectedSessionId,
    models,
    agents,
    commands,
    status,
    revertPrompt,
    queuesBySession
  } = useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const queued = selectedSessionId ? (queuesBySession[selectedSessionId] ?? []) : []
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const hasModels = (models?.models.length ?? 0) > 0
  const effectiveModel = session?.model ?? models?.defaultModel ?? null
  const effectiveModelInfo = models?.models.find(
    (model) =>
      model.providerId === effectiveModel?.providerId && model.modelId === effectiveModel?.modelId
  )
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const ready = status.status === 'ready'
  const modelVariants = effectiveModelInfo?.variants ?? []
  const activeVariant =
    effectiveModel?.variant &&
    modelVariants.some((variant) => variant.id === effectiveModel.variant)
      ? effectiveModel.variant
      : null
  const reasoningEffort = session?.reasoningEffort ?? null
  const permissionMode = session?.permissionMode ?? 'ask'
  const primaryAgents = agents.filter((agent) => agent.mode !== 'subagent')
  const activeAgent =
    primaryAgents.find((agent) => agent.id === session?.agent) ??
    primaryAgents.find((agent) => agent.id === 'build') ??
    primaryAgents[0] ??
    null
  const attachmentsDisabled = effectiveModelInfo?.attachment === false

  const { attachments, setAttachments, attaching, fileInputRef, addFiles, removeAttachment } =
    useComposerAttachments({
      sessionId: session?.id ?? selectedSessionId,
      disabled: attachmentsDisabled,
      onError: setError
    })

  const {
    setCommandQuery,
    activeCommand,
    setActiveCommand,
    commandItems,
    pendingShell,
    setPendingShell,
    detectCommand,
    applyCommand,
    expandSlashCommand,
    applyCommandBindings
  } = useCommandMenu({
    commands,
    agents,
    models,
    session,
    setText,
    textareaRef
  })

  const { mention, setMention, activeMention, setActiveMention, detectMention, applyMention } =
    useMentionSearch({
      session,
      text,
      setText,
      textareaRef
    })

  const { sending, submit, runPendingShell, stop, changeModel, changeSettings, changeAgent } =
    useComposerSubmit({
      t,
      text,
      setText,
      attachments,
      setAttachments,
      setMention,
      setCommandQuery,
      session,
      running,
      ready,
      hasModels,
      effectiveModel,
      pendingShell,
      setPendingShell,
      expandSlashCommand,
      applyCommandBindings,
      setError,
      textareaRef
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

  const placeholder = !ready
    ? status.status === 'starting'
      ? t('chat.agentStarting')
      : t('chat.agentStoppedHint')
    : t('chat.placeholder')

  const sendDisabled = (!text.trim() && attachments.length === 0) || sending || !ready || !hasModels

  async function editQueued(item: QueuedMessage): Promise<void> {
    setError(null)
    try {
      await chatStore.removeQueued(item.sessionId, item.id)
      setText(item.text)
      if (item.attachments.length > 0) {
        setAttachments((current) => {
          const known = new Set(current.map((attachment) => attachment.id))
          return [...current, ...item.attachments.filter((attachment) => !known.has(attachment.id))]
        })
      }
      textareaRef.current?.focus()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function removeQueued(item: QueuedMessage): Promise<void> {
    setError(null)
    try {
      await chatStore.removeQueued(item.sessionId, item.id)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

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

      <ComposerQueue
        items={queued}
        onEdit={(item) => {
          void editQueued(item)
        }}
        onRemove={(item) => {
          void removeQueued(item)
        }}
      />

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
        <ComposerSuggestions
          commandItems={commandItems}
          activeCommand={activeCommand}
          onApplyCommand={applyCommand}
          mention={mention}
          activeMention={activeMention}
          onApplyMention={applyMention}
        />

        {pendingShell && (
          <ComposerShellPrompt
            pending={pendingShell}
            sending={sending}
            onRun={() => {
              void runPendingShell()
            }}
            onCancel={() => setPendingShell(null)}
          />
        )}

        <ComposerAttachments
          attachments={attachments}
          onRemove={(attachment) => {
            void removeAttachment(attachment)
          }}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            const value = event.target.value
            const cursor = event.target.selectionStart ?? 0
            setText(value)
            detectCommand(value, cursor)
            detectMention(value, cursor)
          }}
          onKeyDown={(event) => {
            if (commandItems.length > 0) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setCommandQuery(null)
                return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveCommand((index) => {
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  return (index + step + commandItems.length) % commandItems.length
                })
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                applyCommand(commandItems[Math.min(activeCommand, commandItems.length - 1)])
                return
              }
            }
            if (mention && mention.items.length > 0) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setMention(null)
                return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveMention((index) => {
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  return (index + step + mention.items.length) % mention.items.length
                })
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                applyMention(mention.items[Math.min(activeMention, mention.items.length - 1)])
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              const interrupt = running && (event.metaKey || event.ctrlKey)
              void submit(interrupt ? 'interrupt' : 'default')
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
          <ComposerToolbar
            models={models}
            model={effectiveModel}
            onModelChange={(model) => {
              void changeModel(model)
            }}
            modelVariants={modelVariants}
            activeVariant={activeVariant}
            agents={primaryAgents}
            activeAgentId={activeAgent?.id ?? ''}
            reasoningEffort={reasoningEffort}
            showReasoning={effectiveModelInfo?.reasoning !== false}
            permissionMode={permissionMode}
            ready={ready}
            running={running}
            sending={sending}
            attaching={attaching}
            attachmentsDisabled={attachmentsDisabled}
            fileInputRef={fileInputRef}
            onFilesSelected={(files) => {
              void addFiles(files)
            }}
            onSettingsChange={(patch) => {
              void changeSettings(patch)
            }}
            onAgentChange={(agentId) => {
              void changeAgent(agentId)
            }}
          />
          <ComposerActions
            running={running}
            sending={sending}
            sendDisabled={sendDisabled}
            onStop={() => {
              void stop()
            }}
            onSubmit={() => {
              void submit()
            }}
            onQueue={() => {
              void submit()
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default Composer

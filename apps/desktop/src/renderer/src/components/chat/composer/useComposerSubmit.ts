import { useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import type {
  CommandDefinition,
  MessageAttachment,
  ModelRef,
  SessionMeta,
  SessionSettings
} from '@ateam/shared'
import { chatStore } from '../../../chat/store'
import { errorMessage } from '../../../lib/errors'
import type { ExpandedCommand, PendingShell } from './useCommandMenu'
import type { MentionState } from './useMentionSearch'

interface UseComposerSubmitOptions {
  t: TFunction
  text: string
  setText: Dispatch<SetStateAction<string>>
  attachments: MessageAttachment[]
  setAttachments: Dispatch<SetStateAction<MessageAttachment[]>>
  setMention: Dispatch<SetStateAction<MentionState | null>>
  setCommandQuery: Dispatch<SetStateAction<string | null>>
  session: SessionMeta | undefined
  running: boolean
  ready: boolean
  hasModels: boolean
  effectiveModel: ModelRef | null
  pendingShell: PendingShell | null
  setPendingShell: Dispatch<SetStateAction<PendingShell | null>>
  expandSlashCommand: (value: string) => Promise<ExpandedCommand>
  applyCommandBindings: (command: CommandDefinition) => Promise<void>
  setError: Dispatch<SetStateAction<string | null>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export interface ComposerSubmitState {
  sending: boolean
  submit: (strategy?: 'default' | 'interrupt') => Promise<void>
  runPendingShell: () => Promise<void>
  stop: () => Promise<void>
  changeModel: (model: ModelRef) => Promise<void>
  changeSettings: (patch: Partial<SessionSettings>) => Promise<void>
  changeAgent: (agentId: string) => Promise<void>
}

function sendErrorMessage(message: string, t: TFunction): string {
  if (message === 'AGENT_NOT_READY') return t('chat.agentStoppedHint')
  if (message === 'SESSION_BUSY') return t('chat.sessionBusy')
  return message
}

export function useComposerSubmit({
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
}: UseComposerSubmitOptions): ComposerSubmitState {
  const [sending, setSending] = useState(false)

  async function submit(strategy: 'default' | 'interrupt' = 'default'): Promise<void> {
    const content = text.trim()
    if ((!content && attachments.length === 0) || sending) return
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
      const expanded = await expandSlashCommand(content)
      if (expanded.shell) {
        if (running && !expanded.subtask) {
          setError(t('chat.sessionBusy'))
          return
        }
        setPendingShell(expanded.shell)
        return
      }
      if (expanded.subtask) {
        if (attachments.length > 0) {
          setError(t('chat.subtaskNoAttachments'))
          return
        }
        await chatStore.runCommand(expanded.subtask.name, expanded.subtask.args)
        setText('')
        setAttachments([])
        setMention(null)
        setCommandQuery(null)
        return
      }
      if (expanded.command) await applyCommandBindings(expanded.command)
      if (running) {
        await chatStore.steer(
          expanded.text,
          strategy === 'interrupt' ? 'interrupt' : 'after-step',
          attachments
        )
      } else {
        // A command may have rebound the session model, so only pass the
        // composer's model for plain sends.
        await chatStore.send(expanded.text, attachments, expanded.command ? null : effectiveModel)
      }
      setText('')
      setAttachments([])
      setMention(null)
      setCommandQuery(null)
    } catch (caught) {
      setError(sendErrorMessage(errorMessage(caught), t))
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  async function runPendingShell(): Promise<void> {
    const pending = pendingShell
    if (!pending) return
    setPendingShell(null)
    setSending(true)
    setError(null)
    try {
      if (pending.subtask) {
        await chatStore.runCommand(pending.subtask.name, pending.subtask.args)
      } else {
        const expanded = await window.api.agent.commands.expand({
          template: pending.command.template,
          args: pending.args,
          directory: session?.directory ?? undefined
        })
        await applyCommandBindings(pending.command)
        await chatStore.send(expanded, attachments)
      }
      setText('')
      setAttachments([])
      setMention(null)
      setCommandQuery(null)
    } catch (caught) {
      setError(sendErrorMessage(errorMessage(caught), t))
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

  return { sending, submit, runPendingShell, stop, changeModel, changeSettings, changeAgent }
}

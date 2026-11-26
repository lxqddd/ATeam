import { useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type {
  AgentDefinition,
  CommandDefinition,
  ModelsConfigPublic,
  SessionMeta
} from '@ateam/shared'
import { commandShellSnippets, expandCommand, splitArguments } from '@ateam/shared'
import { chatStore } from '../../../chat/store'

/** A subtask command's payload, kept alongside the shell confirmation when needed. */
export interface CommandSubtask {
  name: string
  args: string
}

export interface PendingShell {
  command: CommandDefinition
  args: string
  snippets: string[]
  subtask?: CommandSubtask
}

export interface ExpandedCommand {
  text: string
  command: CommandDefinition | null
  shell?: PendingShell
  subtask?: CommandSubtask
}

interface UseCommandMenuOptions {
  commands: CommandDefinition[]
  agents: AgentDefinition[]
  models: ModelsConfigPublic | null
  session: SessionMeta | undefined
  setText: Dispatch<SetStateAction<string>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export interface CommandMenuState {
  commandQuery: string | null
  setCommandQuery: Dispatch<SetStateAction<string | null>>
  activeCommand: number
  setActiveCommand: Dispatch<SetStateAction<number>>
  commandItems: CommandDefinition[]
  pendingShell: PendingShell | null
  setPendingShell: Dispatch<SetStateAction<PendingShell | null>>
  detectCommand: (value: string, cursor: number) => void
  applyCommand: (command: CommandDefinition) => void
  expandSlashCommand: (value: string) => Promise<ExpandedCommand>
  applyCommandBindings: (command: CommandDefinition) => Promise<void>
}

export function useCommandMenu({
  commands,
  agents,
  models,
  session,
  setText,
  textareaRef
}: UseCommandMenuOptions): CommandMenuState {
  const [commandQuery, setCommandQuery] = useState<string | null>(null)
  const [activeCommand, setActiveCommand] = useState(0)
  const [pendingShell, setPendingShell] = useState<PendingShell | null>(null)

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

  function detectCommand(value: string, cursor: number): void {
    const slash = /^\/([^\s]*)$/.exec(value.slice(0, cursor))
    setCommandQuery(slash ? slash[1] : null)
    setActiveCommand(0)
  }

  function applyCommand(command: CommandDefinition): void {
    setText(`/${command.name} `)
    setCommandQuery(null)
    textareaRef.current?.focus()
  }

  async function expandSlashCommand(value: string): Promise<ExpandedCommand> {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(value)
    if (!match) return { text: value, command: null }
    const command = commands.find(
      (candidate) => candidate.name.toLowerCase() === match[1].toLowerCase()
    )
    if (!command) return { text: value, command: null }
    const args = match[2] ?? ''
    if (command.source === 'mcp' && command.mcp) {
      const tokens = splitArguments(args)
      const argumentNames = command.mcp.arguments ?? []
      const promptArgs: Record<string, string> = {}
      if (argumentNames.length > 0) {
        argumentNames.forEach((name, index) => {
          const token = tokens[index]
          if (token !== undefined) promptArgs[name] = token
        })
        if (tokens.length > argumentNames.length) {
          const last = argumentNames[argumentNames.length - 1]
          promptArgs[last] = tokens.slice(argumentNames.length - 1).join(' ')
        }
      } else if (tokens.length > 0) {
        promptArgs.input = tokens.join(' ')
      }
      return {
        text: await window.api.agent.mcp.prompt(
          command.mcp.server,
          command.mcp.prompt,
          promptArgs,
          session?.directory ?? undefined
        ),
        command
      }
    }
    const subtask = command.subtask ? { name: command.name, args } : undefined
    if (command.template.includes('!`')) {
      return {
        text: value,
        command,
        ...(subtask ? { subtask } : {}),
        shell: {
          command,
          args,
          snippets: commandShellSnippets(command.template),
          ...(subtask ? { subtask } : {})
        }
      }
    }
    if (subtask) return { text: value, command, subtask }
    return { text: expandCommand(command.template, args), command }
  }

  async function applyCommandBindings(command: CommandDefinition): Promise<void> {
    if (!command.agent && !command.model) return
    const target = await chatStore.ensureSession()
    if (command.agent && agents.some((agent) => agent.id === command.agent)) {
      await chatStore.setSessionAgent(target.id, command.agent).catch(() => undefined)
    }
    const bound = command.model
    if (
      bound &&
      models?.models.some(
        (model) => model.providerId === bound.providerId && model.modelId === bound.modelId
      )
    ) {
      await chatStore.setSessionModel(target.id, bound).catch(() => undefined)
    }
  }

  return {
    commandQuery,
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
  }
}

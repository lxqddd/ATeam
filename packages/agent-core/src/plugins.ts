import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ToolSet } from 'ai'
import type { AgentConfig, PermissionAction } from '@ateam/shared'

export interface PluginContext {
  workspace: string
  sessionId?: string
  config: AgentConfig
}

export interface PluginParams {
  temperature?: number
  maxOutputTokens?: number
  reasoning?: string | null
}

export interface PluginHooks {
  name?: string
  config?: (config: AgentConfig) => void | Promise<void>
  tool?: ToolSet | ((context: PluginContext) => ToolSet | Promise<ToolSet>)
  chatParams?: (
    input: { sessionId: string; agent: string | null; model: string },
    output: PluginParams
  ) => void | Promise<void>
  system?: (
    input: { sessionId: string; model: string },
    output: { system: string }
  ) => void | Promise<void>
  permissionAsk?: (
    input: { action: PermissionAction; resource: string; toolName: string },
    output: { status: 'allow' | 'ask' | 'deny' }
  ) => void | Promise<void>
  toolBefore?: (
    input: { tool: string; sessionId: string; callId: string; args: unknown },
    output: { args: unknown }
  ) => void | Promise<void>
  toolAfter?: (
    input: { tool: string; sessionId: string; callId: string; args: unknown },
    output: { output: unknown }
  ) => void | Promise<void>
  shellEnv?: (
    input: { cwd: string; sessionId: string },
    output: { env: Record<string, string> }
  ) => void | Promise<void>
  dispose?: () => void | Promise<void>
}

export type PluginFactory = (context: PluginContext) => PluginHooks | Promise<PluginHooks>

export class PluginRegistry {
  private readonly hooks: PluginHooks[]
  readonly errors: Array<{ spec: string; message: string }> = []

  constructor(hooks: PluginHooks[] = []) {
    this.hooks = hooks
  }

  async tools(context: PluginContext): Promise<ToolSet> {
    const result: ToolSet = {}
    for (const hook of this.hooks) {
      if (!hook.tool) continue
      const tools = typeof hook.tool === 'function' ? await hook.tool(context) : hook.tool
      Object.assign(result, tools)
    }
    return result
  }

  async transformSystem(
    input: { sessionId: string; model: string },
    output: { system: string }
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.system?.(input, output)
    }
  }

  async transformParams(
    input: { sessionId: string; agent: string | null; model: string },
    output: PluginParams
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.chatParams?.(input, output)
    }
  }

  async permissionAsk(
    input: { action: PermissionAction; resource: string; toolName: string },
    output: { status: 'allow' | 'ask' | 'deny' }
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.permissionAsk?.(input, output)
    }
  }

  async shellEnv(cwd: string, sessionId: string): Promise<Record<string, string>> {
    const output = { env: {} as Record<string, string> }
    for (const hook of this.hooks) {
      await hook.shellEnv?.({ cwd, sessionId }, output)
    }
    return output.env
  }

  async dispose(): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook.dispose?.()
      } catch {
        /* plugin cleanup is best effort */
      }
    }
  }

  wrapTools(tools: ToolSet, sessionId: string): ToolSet {
    if (this.hooks.length === 0) return tools
    const wrapped: ToolSet = {}
    for (const [name, definition] of Object.entries(tools)) {
      const candidate = definition as unknown as {
        execute?: (input: never, options: { toolCallId: string }) => unknown
      }
      if (typeof candidate.execute !== 'function') {
        wrapped[name] = definition
        continue
      }
      const execute = candidate.execute
      wrapped[name] = {
        ...(definition as object),
        execute: async (input: never, options: { toolCallId: string }) => {
          const before = { args: input as unknown }
          for (const hook of this.hooks) {
            await hook.toolBefore?.(
              { tool: name, sessionId, callId: options.toolCallId, args: before.args },
              before
            )
          }
          let output: unknown = await execute(before.args as never, options)
          const after = { output }
          for (const hook of this.hooks) {
            await hook.toolAfter?.(
              { tool: name, sessionId, callId: options.toolCallId, args: before.args },
              after
            )
          }
          output = after.output
          return output
        }
      } as unknown as (typeof wrapped)[string]
    }
    return wrapped
  }
}

function resolveSpec(spec: string, workspace: string): string {
  if (spec === '~') return pathToFileURL(os.homedir()).href
  if (spec.startsWith('~/')) return pathToFileURL(path.join(os.homedir(), spec.slice(2))).href
  if (spec.startsWith('.') || path.isAbsolute(spec)) {
    return pathToFileURL(path.resolve(workspace, spec)).href
  }
  return spec
}

export async function loadPlugins(
  specs: string[],
  context: PluginContext
): Promise<PluginRegistry> {
  if (specs.length === 0) return new PluginRegistry()
  const hooks: PluginHooks[] = []
  const errors: Array<{ spec: string; message: string }> = []
  for (const spec of [...new Set(specs)]) {
    try {
      const module = (await import(resolveSpec(spec, context.workspace))) as Record<string, unknown>
      const factory = module.default ?? module.plugin ?? module.server
      if (typeof factory !== 'function') {
        throw new Error('plugin does not export a default function')
      }
      const loaded = (await (factory as PluginFactory)(context)) as PluginHooks | undefined
      if (!loaded || typeof loaded !== 'object') throw new Error('plugin returned no hooks')
      if (loaded.config) await loaded.config(context.config)
      hooks.push(loaded)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ spec, message })
      console.warn('[plugins] failed to load', spec, message)
    }
  }
  const registry = new PluginRegistry(hooks)
  registry.errors.push(...errors)
  return registry
}

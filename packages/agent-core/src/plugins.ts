import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ToolSet } from 'ai'
import type {
  AgentConfig,
  AgentEvent,
  PermissionAction,
  PluginAuthCredentials,
  PluginAuthMethodInfo,
  PluginAuthResult,
  PluginAuthPrompt,
  RuntimeModelsConfig,
  RuntimeProvider
} from '@ateam/shared'
import { readJsonFile } from './atomic-json'

export interface PluginContext {
  workspace: string
  sessionId?: string
  config: AgentConfig
  pluginRoot?: string
}

export interface PluginParams {
  temperature?: number
  maxOutputTokens?: number
  reasoning?: string | null
}

export type PluginAuthOutcome =
  | { status: 'success'; credentials: PluginAuthCredentials }
  | { status: 'failed'; message?: string }
  | {
      status: 'pending'
      url: string
      instructions?: string
      codeRequired?: boolean
      complete: (input: { code?: string }) => PluginAuthOutcome | Promise<PluginAuthOutcome>
    }

export interface PluginAuthMethod {
  id?: string
  type: 'api' | 'oauth'
  label: string
  description?: string
  prompts?: PluginAuthPrompt[]
  authorize: (input: {
    answers: Record<string, string>
  }) => PluginAuthOutcome | Promise<PluginAuthOutcome>
}

export interface PluginAuthHook {
  provider: string
  providerName?: string
  methods: PluginAuthMethod[]
}

interface PendingAuth {
  provider: string
  complete: (input: { code?: string }) => PluginAuthOutcome | Promise<PluginAuthOutcome>
  timer: NodeJS.Timeout
}

export interface PluginHooks {
  name?: string
  config?: (config: AgentConfig) => void | Promise<void>
  tool?: ToolSet | ((context: PluginContext) => ToolSet | Promise<ToolSet>)
  chatParams?: (
    input: { sessionId: string; agent: string | null; model: string },
    output: PluginParams
  ) => void | Promise<void>
  commandExecuteBefore?: (
    input: { command: string; args: string; sessionId: string | null },
    output: { template: string; args: string }
  ) => void | Promise<void>
  event?: (input: { event: AgentEvent }) => void | Promise<void>
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
  provider?: (
    input: { workspace: string; models: RuntimeModelsConfig },
    output: { models: RuntimeModelsConfig }
  ) => void | Promise<void>
  auth?:
    | PluginAuthHook
    | ((
        input: { workspace: string; provider: RuntimeProvider },
        output: { apiKey?: string; baseURL?: string }
      ) => void | Promise<void>)
  workspaceAdapter?: {
    name: string
    description?: string
    create: (input: {
      name: string
      base?: string | null
      workspace: string
    }) => Promise<{ directory: string; details?: string }>
    remove?: (input: { directory: string; force?: boolean; workspace: string }) => Promise<void>
  }
  dispose?: () => void | Promise<void>
}

export type PluginFactory = (context: PluginContext) => PluginHooks | Promise<PluginHooks>

export class PluginRegistry {
  private readonly hooks: PluginHooks[]
  private readonly pendingAuth = new Map<string, PendingAuth>()
  readonly errors: Array<{ spec: string; message: string }> = []

  constructor(hooks: PluginHooks[] = []) {
    this.hooks = hooks
  }

  authMethods(): PluginAuthMethodInfo[] {
    return this.authEntries().map((entry) => entry.info)
  }

  async authorizeAuth(id: string, answers: Record<string, string>): Promise<PluginAuthResult> {
    const entry = this.authEntries().find((candidate) => candidate.info.id === id)
    if (!entry) throw new Error(`AUTH_METHOD_NOT_FOUND: ${id}`)
    for (const prompt of entry.info.prompts) {
      if (prompt.required === false) continue
      if (!answers[prompt.key]?.trim()) {
        return { status: 'failed', message: `Missing required value: ${prompt.key}` }
      }
    }
    try {
      return this.normalizeAuthOutcome(
        await entry.method.authorize({ answers }),
        entry.info.provider
      )
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Authorization failed.'
      }
    }
  }

  async completeAuth(requestId: string, input: { code?: string }): Promise<PluginAuthResult> {
    const pending = this.pendingAuth.get(requestId)
    if (!pending) throw new Error('AUTH_REQUEST_NOT_FOUND')
    this.pendingAuth.delete(requestId)
    clearTimeout(pending.timer)
    try {
      return this.normalizeAuthOutcome(await pending.complete(input), pending.provider, false)
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Authorization failed.'
      }
    }
  }

  private authEntries(): Array<{
    info: PluginAuthMethodInfo
    method: PluginAuthMethod
  }> {
    const entries: Array<{ info: PluginAuthMethodInfo; method: PluginAuthMethod }> = []
    this.hooks.forEach((hook, hookIndex) => {
      const auth = hook.auth
      if (!auth || typeof auth === 'function') return
      const plugin = hook.name ?? `plugin-${hookIndex + 1}`
      auth.methods.forEach((method, methodIndex) => {
        entries.push({
          method,
          info: {
            id: method.id?.trim() || `${hookIndex}:${methodIndex}`,
            plugin,
            provider: auth.provider,
            providerName: auth.providerName ?? auth.provider,
            type: method.type,
            label: method.label,
            description: method.description?.trim() || null,
            prompts: (method.prompts ?? [])
              .filter((prompt) => prompt.key.trim() && prompt.message.trim())
              .map((prompt) => ({
                type: prompt.type,
                key: prompt.key,
                message: prompt.message,
                ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
                ...(prompt.secret ? { secret: true } : {}),
                required: prompt.required !== false,
                ...(prompt.options
                  ? {
                      options: prompt.options.map((option) => ({
                        label: option.label,
                        value: option.value
                      }))
                    }
                  : {})
              }))
          }
        })
      })
    })
    return entries
  }

  private normalizeAuthOutcome(
    outcome: PluginAuthOutcome,
    provider: string,
    allowPending = true
  ): PluginAuthResult {
    if (outcome.status === 'failed') {
      return { status: 'failed', message: outcome.message?.trim() || 'Authorization failed.' }
    }
    if (outcome.status === 'success') {
      if (!validCredentials(outcome.credentials)) {
        return { status: 'failed', message: 'Authorization did not return usable credentials.' }
      }
      return { status: 'success', provider, credentials: outcome.credentials }
    }
    if (!allowPending) {
      return { status: 'failed', message: 'Nested authorization requests are not supported.' }
    }
    let url: URL
    try {
      url = new URL(outcome.url)
    } catch {
      return { status: 'failed', message: 'Auth URL must use http or https.' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'failed', message: 'Auth URL must use http or https.' }
    }
    const requestId = randomUUID()
    const timer = setTimeout(() => this.pendingAuth.delete(requestId), 15 * 60 * 1000)
    timer.unref?.()
    this.pendingAuth.set(requestId, { provider, complete: outcome.complete, timer })
    return {
      status: 'pending',
      provider,
      requestId,
      url: url.toString(),
      instructions: outcome.instructions?.trim() || null,
      codeRequired: outcome.codeRequired ?? false
    }
  }

  async tools(
    context: PluginContext,
    options: {
      askPermission?: (pluginName: string, toolName: string, toolCallId: string) => Promise<boolean>
    } = {}
  ): Promise<ToolSet> {
    const result: ToolSet = {}
    for (const hook of this.hooks) {
      if (!hook.tool) continue
      const pluginName = hook.name ?? 'plugin'
      const tools = typeof hook.tool === 'function' ? await hook.tool(context) : hook.tool
      for (const [name, definition] of Object.entries(tools)) {
        if (!options.askPermission) {
          result[name] = definition
          continue
        }
        const candidate = definition as unknown as {
          execute?: (input: never, exec: { toolCallId: string }) => unknown
        }
        if (typeof candidate.execute !== 'function') {
          result[name] = definition
          continue
        }
        const execute = candidate.execute
        result[name] = {
          ...(definition as object),
          execute: async (input: never, exec: { toolCallId: string }) => {
            const allowed = await options.askPermission?.(pluginName, name, exec.toolCallId)
            if (!allowed) return `Permission denied; plugin tool ${name} was not run.`
            return execute(input, exec)
          }
        } as unknown as (typeof result)[string]
      }
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

  async transformCommand(
    input: { command: string; args: string; sessionId: string | null },
    output: { template: string; args: string }
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.commandExecuteBefore?.(input, output)
    }
  }

  async transformProviders(
    input: { workspace: string; models: RuntimeModelsConfig },
    output: { models: RuntimeModelsConfig }
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.provider?.(input, output)
    }
  }

  async applyAuth(workspace: string, providers: RuntimeProvider[]): Promise<RuntimeProvider[]> {
    const result = providers.map((provider) => ({ ...provider }))
    for (const hook of this.hooks) {
      if (!hook.auth || typeof hook.auth !== 'function') continue
      for (const provider of result) {
        const output: { apiKey?: string; baseURL?: string } = {
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
          ...(provider.baseURL ? { baseURL: provider.baseURL } : {})
        }
        await hook.auth({ workspace, provider: { ...provider } }, output)
        if (output.apiKey) provider.apiKey = output.apiKey
        if (output.baseURL) provider.baseURL = output.baseURL
      }
    }
    return result
  }

  workspaceAdapters(): Array<{ name: string; description: string | null }> {
    return this.hooks
      .map((hook) => hook.workspaceAdapter)
      .filter((adapter): adapter is NonNullable<PluginHooks['workspaceAdapter']> =>
        Boolean(adapter)
      )
      .map((adapter) => ({
        name: adapter.name,
        description: adapter.description ?? null
      }))
  }

  async createWorkspace(
    adapterName: string,
    input: { name: string; base?: string | null; workspace: string }
  ): Promise<{ directory: string; details?: string }> {
    const adapter = this.hooks
      .map((hook) => hook.workspaceAdapter)
      .find((candidate) => candidate?.name === adapterName)
    if (!adapter) throw new Error(`WORKSPACE_ADAPTER_NOT_FOUND: ${adapterName}`)
    const result = await adapter.create(input)
    if (!path.isAbsolute(result.directory)) {
      throw new Error(`WORKSPACE_ADAPTER_INVALID_PATH: ${result.directory}`)
    }
    return result
  }

  async removeWorkspace(
    adapterName: string,
    input: { directory: string; force?: boolean; workspace: string }
  ): Promise<void> {
    const adapter = this.hooks
      .map((hook) => hook.workspaceAdapter)
      .find((candidate) => candidate?.name === adapterName)
    if (!adapter) throw new Error(`WORKSPACE_ADAPTER_NOT_FOUND: ${adapterName}`)
    if (!adapter.remove) throw new Error(`WORKSPACE_ADAPTER_REMOVE_UNSUPPORTED: ${adapterName}`)
    await adapter.remove(input)
  }

  async emitEvent(event: AgentEvent): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook.event?.({ event })
      } catch {
        /* plugin event handlers must not break the run */
      }
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
    for (const pending of this.pendingAuth.values()) clearTimeout(pending.timer)
    this.pendingAuth.clear()
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

function validCredentials(credentials: PluginAuthCredentials): boolean {
  if (credentials.type === 'api') return credentials.key.trim().length > 0
  return credentials.accessToken.trim().length > 0
}

function packageEntry(pkg: Record<string, unknown> | null): string {
  if (!pkg) return 'index.mjs'
  const exports = pkg.exports
  if (typeof exports === 'string') return exports
  if (exports && typeof exports === 'object') {
    const root = (exports as Record<string, unknown>)['.']
    if (typeof root === 'string') return root
    if (root && typeof root === 'object') {
      const value = root as Record<string, unknown>
      for (const key of ['import', 'default', 'require']) {
        if (typeof value[key] === 'string') return value[key] as string
      }
    }
  }
  for (const key of ['module', 'main']) {
    if (typeof pkg[key] === 'string') return pkg[key] as string
  }
  return 'index.mjs'
}

async function resolveSpec(spec: string, workspace: string, pluginRoot?: string): Promise<string> {
  if (spec === '~') return pathToFileURL(os.homedir()).href
  if (spec.startsWith('~/')) return pathToFileURL(path.join(os.homedir(), spec.slice(2))).href
  if (!spec.startsWith('.') && !path.isAbsolute(spec)) {
    if (pluginRoot) {
      try {
        const require = createRequire(path.join(pluginRoot, 'package.json'))
        return pathToFileURL(require.resolve(spec)).href
      } catch {
        /* fall back to Node's normal package resolution */
      }
    }
    return spec
  }
  const resolved = path.resolve(workspace, spec)
  try {
    const stat = await fs.stat(resolved)
    if (stat.isDirectory()) {
      const pkg = await readJsonFile<Record<string, unknown>>(path.join(resolved, 'package.json'))
      return pathToFileURL(path.join(resolved, packageEntry(pkg))).href
    }
  } catch {
    /* let the import report the missing file */
  }
  return pathToFileURL(resolved).href
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
      const module = (await import(
        await resolveSpec(spec, context.workspace, context.pluginRoot)
      )) as Record<string, unknown>
      const factory = module.default ?? module.plugin ?? module.server
      if (typeof factory !== 'function') {
        throw new Error('plugin does not export a default function')
      }
      const loaded = (await (factory as PluginFactory)(context)) as PluginHooks | undefined
      if (!loaded || typeof loaded !== 'object') throw new Error('plugin returned no hooks')
      loaded.name = loaded.name ?? spec
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

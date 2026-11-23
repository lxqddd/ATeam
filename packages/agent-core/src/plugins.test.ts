import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import type { RuntimeModelsConfig } from '@ateam/shared'
import { z } from 'zod'
import { loadPlugins, PluginRegistry } from './plugins'

let directory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-plugins-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('PluginRegistry', () => {
  it('merges plugin tools and wraps tool execution hooks', async () => {
    const pluginTool = tool({
      description: 'plugin tool',
      inputSchema: z.object({ value: z.string() }),
      execute: async ({ value }) => `plugin:${value}`
    })
    const registry = new PluginRegistry([
      {
        tool: { plugin_echo: pluginTool },
        toolBefore: (_input, output) => {
          output.args = { value: `${(output.args as { value: string }).value}!` }
        },
        toolAfter: (_input, output) => {
          output.output = `${String(output.output)}?`
        }
      }
    ])

    const tools = await registry.tools({
      workspace: directory,
      config: {
        snapshots: true,
        instructions: [],
        lsp: true,
        formatters: true,
        formatterOverrides: {}
      }
    })
    const wrapped = registry.wrapTools(tools, 'session-1')
    const execute = (
      wrapped.plugin_echo as unknown as {
        execute: (input: { value: string }, options: { toolCallId: string }) => Promise<string>
      }
    ).execute

    await expect(execute({ value: 'hi' }, { toolCallId: 'call-1' })).resolves.toBe('plugin:hi!?')
  })

  it('reports hook-modified tool args and results', async () => {
    const registry = new PluginRegistry([
      {
        toolBefore: (_input, output) => {
          output.args = { value: `${(output.args as { value: string }).value}!` }
        },
        toolAfter: (_input, output) => {
          output.output = `${String(output.output)}?`
        }
      }
    ])
    const tools = {
      echo: tool({
        description: 'echo',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`
      })
    }
    const updates: Array<{ kind: string; tool: string; callId: string; value: unknown }> = []
    const wrapped = registry.wrapTools(tools, 'session-1', {
      onToolInput: ({ tool: name, callId, args }) => {
        updates.push({ kind: 'input', tool: name, callId, value: args })
      },
      onToolOutput: ({ tool: name, callId, output }) => {
        updates.push({ kind: 'output', tool: name, callId, value: output })
      }
    })
    const execute = (
      wrapped.echo as unknown as {
        execute: (input: { value: string }, options: { toolCallId: string }) => Promise<string>
      }
    ).execute

    await expect(execute({ value: 'hi' }, { toolCallId: 'call-1' })).resolves.toBe('echo:hi!?')
    expect(updates).toEqual([
      { kind: 'input', tool: 'echo', callId: 'call-1', value: { value: 'hi!' } },
      { kind: 'output', tool: 'echo', callId: 'call-1', value: 'echo:hi!?' }
    ])
  })

  it('transforms command templates before execution', async () => {
    const registry = new PluginRegistry([
      {
        commandExecuteBefore: (_input, output) => {
          output.template = `${output.template}\nextra`
          output.args = `${output.args}!`
        }
      }
    ])
    const output = { template: 'review', args: 'src' }

    await registry.transformCommand({ command: 'review', args: 'src', sessionId: null }, output)

    expect(output).toEqual({ template: 'review\nextra', args: 'src!' })
  })

  it('requires permission before running plugin tools', async () => {
    const execute = vi.fn(async () => 'ran')
    const registry = new PluginRegistry([
      {
        name: '@acme/tools',
        tool: {
          dangerous: tool({
            description: 'dangerous',
            inputSchema: z.object({}),
            execute
          })
        }
      }
    ])
    const context = {
      workspace: directory,
      config: {
        snapshots: true,
        instructions: [],
        lsp: true,
        formatters: true,
        formatterOverrides: {}
      }
    }
    const askPermission = vi.fn(async () => false)
    const denied = await registry.tools(context, { askPermission })
    const deniedExecute = (
      denied.dangerous as unknown as {
        execute: (input: object, exec: { toolCallId: string }) => Promise<string>
      }
    ).execute

    await expect(deniedExecute({}, { toolCallId: 'call-1' })).resolves.toContain(
      'Permission denied'
    )
    expect(execute).not.toHaveBeenCalled()
    expect(askPermission).toHaveBeenCalledWith('@acme/tools', 'dangerous', 'call-1')

    const allowed = await registry.tools(context, {
      askPermission: async () => true
    })
    const allowedExecute = (
      allowed.dangerous as unknown as {
        execute: (input: object, exec: { toolCallId: string }) => Promise<string>
      }
    ).execute
    await expect(allowedExecute({}, { toolCallId: 'call-2' })).resolves.toBe('ran')
  })

  it('registers and runs workspace adapters', async () => {
    const create = vi.fn(async () => ({ directory: directory, details: 'remote' }))
    const remove = vi.fn(async () => undefined)
    const registry = new PluginRegistry([
      {
        workspaceAdapter: {
          name: 'remote',
          description: 'Remote workspace',
          create,
          remove
        }
      }
    ])

    expect(registry.workspaceAdapters()).toEqual([
      { name: 'remote', description: 'Remote workspace' }
    ])
    await expect(
      registry.createWorkspace('remote', { name: 'demo', workspace: directory })
    ).resolves.toEqual({ directory, details: 'remote' })
    await registry.removeWorkspace('remote', { directory, workspace: directory })
    expect(create).toHaveBeenCalled()
    expect(remove).toHaveBeenCalled()
    await expect(
      registry.createWorkspace('missing', { name: 'demo', workspace: directory })
    ).rejects.toThrow('WORKSPACE_ADAPTER_NOT_FOUND')
  })

  it('rejects relative adapter paths', async () => {
    const registry = new PluginRegistry([
      {
        workspaceAdapter: {
          name: 'bad',
          create: async () => ({ directory: 'relative/path' })
        }
      }
    ])

    await expect(
      registry.createWorkspace('bad', { name: 'demo', workspace: directory })
    ).rejects.toThrow('WORKSPACE_ADAPTER_INVALID_PATH')
  })

  it('applies provider and auth hooks', async () => {
    const registry = new PluginRegistry([
      {
        provider: (_input, output) => {
          output.models = {
            ...output.models,
            providers: [
              ...output.models.providers,
              { id: 'plugin-provider', name: 'Plugin', type: 'openai' }
            ]
          }
        },
        auth: (_input, output) => {
          output.apiKey = 'plugin-key'
        }
      }
    ])
    const models: RuntimeModelsConfig = { providers: [], models: [], defaultModel: null }
    const output = { models }

    await registry.transformProviders({ workspace: directory, models }, output)
    output.models.providers = await registry.applyAuth(directory, output.models.providers)

    expect(output.models.providers).toEqual([
      { id: 'plugin-provider', name: 'Plugin', type: 'openai', apiKey: 'plugin-key' }
    ])
  })

  it('lists declarative auth methods with serializable prompts', () => {
    const registry = new PluginRegistry([
      {
        name: '@acme/auth',
        auth: {
          provider: 'acme',
          providerName: 'Acme Cloud',
          methods: [
            {
              type: 'api',
              label: 'API key',
              description: 'Paste an account key',
              prompts: [
                {
                  type: 'text',
                  key: 'token',
                  message: 'Account token',
                  placeholder: 'acme_...'
                },
                {
                  type: 'select',
                  key: 'region',
                  message: 'Region',
                  options: [
                    { label: 'US', value: 'us' },
                    { label: 'EU', value: 'eu' }
                  ]
                }
              ],
              authorize: async () => ({
                status: 'success',
                credentials: { type: 'api', key: 'key' }
              })
            }
          ]
        }
      }
    ])

    expect(registry.authMethods()).toEqual([
      {
        id: '0:0',
        plugin: '@acme/auth',
        provider: 'acme',
        providerName: 'Acme Cloud',
        type: 'api',
        label: 'API key',
        description: 'Paste an account key',
        prompts: [
          {
            type: 'text',
            key: 'token',
            message: 'Account token',
            placeholder: 'acme_...',
            required: true
          },
          {
            type: 'select',
            key: 'region',
            message: 'Region',
            required: true,
            options: [
              { label: 'US', value: 'us' },
              { label: 'EU', value: 'eu' }
            ]
          }
        ]
      }
    ])
  })

  it('authorizes an api auth method with entered prompts', async () => {
    const authorize = vi.fn(async () => ({
      status: 'success' as const,
      credentials: { type: 'api' as const, key: 'acme-key' }
    }))
    const registry = new PluginRegistry([
      {
        auth: {
          provider: 'acme',
          methods: [
            {
              type: 'api',
              label: 'API key',
              prompts: [{ type: 'text', key: 'token', message: 'Token' }],
              authorize
            }
          ]
        }
      }
    ])

    await expect(registry.authorizeAuth('0:0', { token: 'typed' })).resolves.toEqual({
      status: 'success',
      provider: 'acme',
      credentials: { type: 'api', key: 'acme-key' }
    })
    expect(authorize).toHaveBeenCalledWith({ answers: { token: 'typed' } })
  })

  it('rejects missing auth prompt answers before calling the plugin', async () => {
    const authorize = vi.fn(async () => ({
      status: 'success' as const,
      credentials: { type: 'api' as const, key: 'acme-key' }
    }))
    const registry = new PluginRegistry([
      {
        auth: {
          provider: 'acme',
          methods: [
            {
              type: 'api',
              label: 'API key',
              prompts: [{ type: 'text', key: 'token', message: 'Token' }],
              authorize
            }
          ]
        }
      }
    ])

    await expect(registry.authorizeAuth('0:0', { token: '  ' })).resolves.toEqual({
      status: 'failed',
      message: 'Missing required value: token'
    })
    expect(authorize).not.toHaveBeenCalled()
  })

  it('supports pending oauth authorization and completion', async () => {
    const registry = new PluginRegistry([
      {
        name: '@acme/oauth',
        auth: {
          provider: 'acme',
          methods: [
            {
              type: 'oauth',
              label: 'Browser login',
              authorize: async () => ({
                status: 'pending',
                url: 'https://acme.example.com/login',
                instructions: 'Sign in and paste the code.',
                codeRequired: true,
                complete: async ({ code }) => ({
                  status: 'success',
                  credentials: {
                    type: 'oauth',
                    accessToken: `access:${code}`,
                    refreshToken: 'refresh',
                    expiresAt: 1_800_000_000_000
                  }
                })
              })
            }
          ]
        }
      }
    ])

    const pending = await registry.authorizeAuth('0:0', {})
    expect(pending).toMatchObject({
      status: 'pending',
      provider: 'acme',
      url: 'https://acme.example.com/login',
      instructions: 'Sign in and paste the code.',
      codeRequired: true
    })
    if (pending.status !== 'pending') throw new Error('expected pending authorization')

    await expect(registry.completeAuth(pending.requestId, { code: 'abc' })).resolves.toEqual({
      status: 'success',
      provider: 'acme',
      credentials: {
        type: 'oauth',
        accessToken: 'access:abc',
        refreshToken: 'refresh',
        expiresAt: 1_800_000_000_000
      }
    })
    await expect(registry.completeAuth(pending.requestId, { code: 'abc' })).rejects.toThrow(
      'AUTH_REQUEST_NOT_FOUND'
    )
  })

  it('rejects unsafe auth redirects', async () => {
    const registry = new PluginRegistry([
      {
        auth: {
          provider: 'acme',
          methods: [
            {
              type: 'oauth',
              label: 'Login',
              authorize: async () => ({
                status: 'pending',
                url: 'javascript:alert(1)',
                complete: async () => ({
                  status: 'success',
                  credentials: { type: 'api', key: 'key' }
                })
              })
            }
          ]
        }
      }
    ])

    await expect(registry.authorizeAuth('0:0', {})).resolves.toEqual({
      status: 'failed',
      message: 'Auth URL must use http or https.'
    })
  })

  it('keeps function auth hooks as credential injection', async () => {
    const registry = new PluginRegistry([
      {
        auth: (_input, output) => {
          output.apiKey = 'injected'
        }
      }
    ])

    await expect(
      registry.applyAuth(directory, [{ id: 'p', name: 'P', type: 'openai' }])
    ).resolves.toEqual([{ id: 'p', name: 'P', type: 'openai', apiKey: 'injected' }])
    expect(registry.authMethods()).toEqual([])
  })

  it('forwards runtime events to plugin hooks', async () => {
    const handler = vi.fn()
    const registry = new PluginRegistry([{ event: handler }])
    const event = {
      type: 'run.started' as const,
      sessionId: 's1',
      messageId: 'm1',
      startedAt: '2026-01-01T00:00:00.000Z'
    }

    await registry.emitEvent(event)

    expect(handler).toHaveBeenCalledWith({ event })
  })

  it('disposes plugin hooks', async () => {
    const dispose = vi.fn(async () => undefined)
    const registry = new PluginRegistry([{ dispose }])

    await registry.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('transforms params, system, permission and shell env', async () => {
    const registry = new PluginRegistry([
      {
        chatParams: (_input, output) => {
          output.temperature = 0.2
        },
        system: (_input, output) => {
          output.system += '\nplugin'
        },
        permissionAsk: (_input, output) => {
          output.status = 'deny'
        },
        shellEnv: (_input, output) => {
          output.env.PLUGIN = '1'
        }
      }
    ])

    const params = { temperature: 1 }
    await registry.transformParams({ sessionId: 's', agent: null, model: 'm' }, params)
    const system = { system: 'base' }
    await registry.transformSystem({ sessionId: 's', model: 'm' }, system)
    const permission = { status: 'ask' as const }
    await registry.permissionAsk({ action: 'shell', resource: 'ls', toolName: 'shell' }, permission)

    expect(params.temperature).toBe(0.2)
    expect(system.system).toContain('plugin')
    expect(permission.status).toBe('deny')
    await expect(registry.shellEnv(directory, 's')).resolves.toEqual({ PLUGIN: '1' })
  })

  it('loads a local plugin directory through package.json', async () => {
    const root = path.join(directory, 'pkg-plugin')
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: '@acme/pkg', version: '1.0.0', main: 'entry.mjs' })
    )
    await fs.writeFile(
      path.join(root, 'entry.mjs'),
      `export default () => ({ system: (_i, out) => { out.system += ':pkg' } })`
    )

    const registry = await loadPlugins(['./pkg-plugin'], {
      workspace: directory,
      config: {
        snapshots: true,
        instructions: [],
        lsp: true,
        formatters: true,
        formatterOverrides: {}
      }
    })
    const system = { system: 'base' }
    await registry.transformSystem({ sessionId: 's', model: 'm' }, system)

    expect(system.system).toBe('base:pkg')
  })

  it('resolves npm plugins from the plugin root', async () => {
    const root = path.join(directory, 'plugin-root')
    const packageRoot = path.join(root, 'node_modules', '@acme', 'npm-plugin')
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'ateam-installed-plugins', private: true })
    )
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@acme/npm-plugin', version: '1.0.0', main: 'index.mjs' })
    )
    await fs.writeFile(
      path.join(packageRoot, 'index.mjs'),
      `export default () => ({ system: (_i, out) => { out.system += ':npm' } })`
    )

    const registry = await loadPlugins(['@acme/npm-plugin'], {
      workspace: directory,
      pluginRoot: root,
      config: {
        snapshots: true,
        instructions: [],
        lsp: true,
        formatters: true,
        formatterOverrides: {}
      }
    })
    const system = { system: 'base' }
    await registry.transformSystem({ sessionId: 's', model: 'm' }, system)

    expect(system.system).toBe('base:npm')
    expect(registry.errors).toEqual([])
  })

  it('loads a local plugin module and reports broken specs', async () => {
    const file = path.join(directory, 'plugin.mjs')
    await fs.writeFile(
      file,
      `export default async (ctx) => ({
        name: 'local',
        system: (_input, output) => { output.system += ':' + ctx.workspace }
      })`
    )

    const registry = await loadPlugins(['./plugin.mjs', './missing.mjs'], {
      workspace: directory,
      config: {
        snapshots: true,
        instructions: [],
        lsp: true,
        formatters: true,
        formatterOverrides: {}
      }
    })
    const system = { system: 'base' }
    await registry.transformSystem({ sessionId: 's', model: 'm' }, system)

    expect(system.system).toContain(`:${directory}`)
    expect(registry.errors).toEqual([expect.objectContaining({ spec: './missing.mjs' })])
  })
})

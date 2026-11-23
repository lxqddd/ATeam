import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
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

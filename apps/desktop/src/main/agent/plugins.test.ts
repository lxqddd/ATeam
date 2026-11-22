import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

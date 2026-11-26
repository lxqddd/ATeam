import type { AgentConfig, CommandDefinition, EffectiveAgentConfig } from '@ateam/shared'
import { expandCommandTemplate, loadCommands, runWorkspaceShell } from '../commands'
import type { McpManagerLike } from '../integrations/mcp'
import type { PluginRegistry } from '../plugins'
import { loadSkills, skillCommand } from '../skills'

export interface CommandHost {
  readonly userDataPath: string
  readonly defaultWorkspacePath: string
  applyConfig(workspace: string): Promise<EffectiveAgentConfig>
  plugins(config: AgentConfig, workspace: string): Promise<PluginRegistry>
  mcp(workspace: string): McpManagerLike
}

/**
 * Slash commands offered to the UI: workspace commands, skills and MCP
 * prompts, plus template expansion with plugin transforms.
 */
export class CommandService {
  constructor(private readonly host: CommandHost) {}

  async listCommands(workspace = this.host.defaultWorkspacePath): Promise<CommandDefinition[]> {
    const effective = await this.host.applyConfig(workspace)
    const commands = await loadCommands({
      userDataPath: this.host.userDataPath,
      workspacePath: workspace,
      config: effective.config
    })
    const names = new Set(commands.map((command) => command.name.toLowerCase()))
    const skillCommands: CommandDefinition[] = []
    const skills = await loadSkills({
      userDataPath: this.host.userDataPath,
      workspacePath: workspace,
      config: effective.config
    }).catch(() => [])
    for (const skill of skills) {
      const command = skillCommand(skill)
      if (names.has(command.name.toLowerCase())) continue
      names.add(command.name.toLowerCase())
      skillCommands.push(command)
    }
    let prompts: Awaited<ReturnType<McpManagerLike['prompts']>> = []
    let timer: NodeJS.Timeout | undefined
    try {
      prompts = await Promise.race([
        this.host.mcp(workspace).prompts(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MCP prompt discovery timed out')), 3_000)
        })
      ])
    } catch {
      /* MCP prompts are best effort */
    } finally {
      if (timer) clearTimeout(timer)
    }
    const mcpCommands: CommandDefinition[] = prompts.map((prompt) => {
      let name = prompt.name
      if (names.has(name.toLowerCase())) {
        const base = `${prompt.name}-${prompt.server}`
        name = base
        let attempt = 2
        while (names.has(name.toLowerCase())) name = `${base}-${attempt++}`
      }
      names.add(name.toLowerCase())
      return {
        id: `mcp:${prompt.server}:${prompt.name}`,
        name,
        description: `MCP · ${prompt.server}${prompt.description ? ` · ${prompt.description}` : ''}`,
        template: '',
        agent: null,
        model: null,
        mcp: {
          server: prompt.server,
          prompt: prompt.name,
          arguments: prompt.arguments?.map((arg) => arg.name) ?? []
        },
        source: 'mcp'
      }
    })
    return [...commands, ...skillCommands, ...mcpCommands].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }

  async expandCommand(
    template: string,
    args: string,
    workspace = this.host.defaultWorkspacePath
  ): Promise<string> {
    const effective = await this.host.applyConfig(workspace)
    const plugins = await this.host.plugins(effective.config, workspace)
    const output = { template, args }
    await plugins.transformCommand({ command: template, args, sessionId: null }, output)
    return expandCommandTemplate(output.template, output.args, (command) =>
      runWorkspaceShell(command, workspace)
    )
  }

  async mcpPrompt(
    server: string,
    prompt: string,
    args?: Record<string, string>,
    workspace = this.host.defaultWorkspacePath
  ): Promise<string> {
    await this.host.applyConfig(workspace)
    return this.host.mcp(workspace).getPrompt(server, prompt, args)
  }
}

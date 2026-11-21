import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentDefinition } from '@ateam/shared'
import {
  BUILTIN_AGENTS,
  agentIdFor,
  filterToolsForAgent,
  loadAgents,
  parseAgentMarkdown
} from './agents'

const FRONTMATTER = [
  '---',
  'description: Review pending changes',
  'mode: subagent',
  'model: openai/gpt-5',
  'tools: read, grep',
  'steps: 12',
  '---',
  'You review code changes and report issues.',
  ''
].join('\n')

describe('builtin agents', () => {
  it('exposes build and plan primary agents', () => {
    const build = BUILTIN_AGENTS.find((agent) => agent.id === 'build')
    const plan = BUILTIN_AGENTS.find((agent) => agent.id === 'plan')

    expect(build).toMatchObject({ mode: 'primary', tools: null, source: 'builtin' })
    expect(plan).toMatchObject({ mode: 'primary', source: 'builtin' })
    expect(plan?.tools).toEqual(['read', 'list', 'grep', 'glob'])
    expect(plan?.prompt).toContain('plan')
  })

  it('exposes general and explore subagents', () => {
    const general = BUILTIN_AGENTS.find((agent) => agent.id === 'general')
    const explore = BUILTIN_AGENTS.find((agent) => agent.id === 'explore')

    expect(general).toMatchObject({ mode: 'subagent', tools: null })
    expect(explore).toMatchObject({ mode: 'subagent' })
    expect(explore?.tools).toEqual(['read', 'list', 'grep', 'glob'])
  })
})

describe('agentIdFor', () => {
  it('slugifies agent names', () => {
    expect(agentIdFor('Search Agent')).toBe('search-agent')
    expect(agentIdFor('  reviewer_v2 ')).toBe('reviewer-v2')
  })
})

describe('parseAgentMarkdown', () => {
  it('parses frontmatter and prompt body', () => {
    const agent = parseAgentMarkdown('/repo/.opencode/agent/reviewer.md', FRONTMATTER, 'project')

    expect(agent).toEqual<AgentDefinition>({
      id: 'reviewer',
      name: 'reviewer',
      description: 'Review pending changes',
      mode: 'subagent',
      model: { providerId: 'openai', modelId: 'gpt-5' },
      tools: ['read', 'grep'],
      maxSteps: 12,
      prompt: 'You review code changes and report issues.',
      source: 'project'
    })
  })

  it('defaults mode to subagent and tools to all', () => {
    const agent = parseAgentMarkdown(
      '/repo/.opencode/agent/helper.md',
      ['---', 'description: Helps with tasks', '---', 'Do the task.'].join('\n'),
      'user'
    )

    expect(agent).toMatchObject({
      id: 'helper',
      mode: 'subagent',
      tools: null,
      maxSteps: null,
      model: null,
      prompt: 'Do the task.',
      source: 'user'
    })
  })

  it('supports all mode and wildcard tools', () => {
    const agent = parseAgentMarkdown(
      '/repo/.opencode/agent/everything.md',
      ['---', 'description: Everything', 'mode: all', 'tools: *', '---', 'Do everything.'].join(
        '\n'
      ),
      'project'
    )

    expect(agent).toMatchObject({ mode: 'all', tools: null })
  })

  it('uses the frontmatter name when present', () => {
    const agent = parseAgentMarkdown(
      '/repo/.opencode/agent/file-name.md',
      ['---', 'name: Reviewer', 'description: Reviews', '---', 'Review.'].join('\n'),
      'project'
    )

    expect(agent).toMatchObject({ id: 'reviewer', name: 'Reviewer' })
  })

  it('rejects files without a description', () => {
    expect(
      parseAgentMarkdown(
        '/repo/.opencode/agent/bad.md',
        ['---', 'mode: subagent', '---', 'Body'].join('\n'),
        'project'
      )
    ).toBeNull()
  })

  it('rejects invalid modes and steps', () => {
    expect(
      parseAgentMarkdown(
        '/repo/.opencode/agent/bad.md',
        ['---', 'description: Bad', 'mode: wizard', '---', 'Body'].join('\n'),
        'project'
      )
    ).toBeNull()
    expect(
      parseAgentMarkdown(
        '/repo/.opencode/agent/bad.md',
        ['---', 'description: Bad', 'steps: 500', '---', 'Body'].join('\n'),
        'project'
      )
    ).toBeNull()
  })
})

describe('loadAgents', () => {
  let directory: string
  let workspace: string

  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-agents-')))
    workspace = path.join(directory, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  async function writeFile(relative: string, content: string): Promise<void> {
    const target = path.join(directory, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }

  it('returns builtins when no custom files exist', async () => {
    const agents = await loadAgents({ userDataPath: directory, workspacePath: workspace })
    expect(agents.map((agent) => agent.id)).toEqual(BUILTIN_AGENTS.map((agent) => agent.id))
  })

  it('loads user markdown and json agents', async () => {
    await writeFile(
      'agent/agents/reviewer.md',
      ['---', 'description: Reviews changes', '---', 'Review.'].join('\n')
    )
    await writeFile(
      'agent/agents.json',
      JSON.stringify({
        agents: [
          {
            name: 'researcher',
            description: 'Researches topics',
            mode: 'subagent',
            tools: ['read', 'grep'],
            prompt: 'Research.'
          }
        ]
      })
    )

    const agents = await loadAgents({ userDataPath: directory, workspacePath: workspace })
    const reviewer = agents.find((agent) => agent.id === 'reviewer')
    const researcher = agents.find((agent) => agent.id === 'researcher')

    expect(reviewer).toMatchObject({ description: 'Reviews changes', source: 'user' })
    expect(researcher).toMatchObject({
      name: 'researcher',
      tools: ['read', 'grep'],
      source: 'user'
    })
  })

  it('loads project agents and lets them override user and builtin agents', async () => {
    await writeFile(
      'agent/agents/plan.md',
      ['---', 'description: User plan', '---', 'User plan prompt.'].join('\n')
    )
    await writeFile(
      'workspace/.opencode/agent/plan.md',
      ['---', 'description: Project plan', 'mode: primary', '---', 'Project plan prompt.'].join(
        '\n'
      )
    )
    await writeFile(
      'workspace/.opencode/agents/reviewer.md',
      ['---', 'description: Project reviewer', '---', 'Review.'].join('\n')
    )

    const agents = await loadAgents({ userDataPath: directory, workspacePath: workspace })
    const plans = agents.filter((agent) => agent.id === 'plan')

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      description: 'Project plan',
      source: 'project',
      prompt: 'Project plan prompt.'
    })
    expect(agents.find((agent) => agent.id === 'reviewer')).toMatchObject({
      source: 'project'
    })
  })

  it('ignores invalid custom agent files', async () => {
    await writeFile('agent/agents/bad.md', 'no frontmatter at all')
    await writeFile('agent/agents.json', JSON.stringify({ agents: [{ name: '' }] }))

    const agents = await loadAgents({ userDataPath: directory, workspacePath: workspace })
    expect(agents.map((agent) => agent.id)).toEqual(BUILTIN_AGENTS.map((agent) => agent.id))
  })
})

describe('filterToolsForAgent', () => {
  const tools = {
    read: 'read',
    write: 'write',
    subagent: 'subagent',
    mcp_demo_echo: 'mcp'
  } as unknown as ToolSet

  it('keeps only the tools listed for the agent', () => {
    const plan = BUILTIN_AGENTS.find((agent) => agent.id === 'plan') as AgentDefinition
    expect(Object.keys(filterToolsForAgent(tools, plan))).toEqual(['read'])
  })

  it('drops the subagent tool for subagent runs', () => {
    const general = BUILTIN_AGENTS.find((agent) => agent.id === 'general') as AgentDefinition
    expect(Object.keys(filterToolsForAgent(tools, general))).toEqual([
      'read',
      'write',
      'mcp_demo_echo'
    ])
  })

  it('returns all tools without an agent', () => {
    expect(Object.keys(filterToolsForAgent(tools, null))).toEqual(Object.keys(tools))
  })
})

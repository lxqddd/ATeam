import { describe, expect, it } from 'vitest'
import type { AgentDefinition } from '@ateam/shared'
import { filterMcpInstructions } from './mcp-instructions'

const SERVER = {
  server: 'docs',
  instructions: 'Use the docs server.',
  tools: [
    { name: 'mcp_docs_search', resource: 'docs/search' },
    { name: 'mcp_docs_secret', resource: 'docs/secret' }
  ]
}

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'docs',
    name: 'Docs',
    description: '',
    mode: 'primary',
    model: null,
    tools: null,
    permissions: [],
    maxSteps: null,
    temperature: null,
    prompt: '',
    source: 'user',
    ...overrides
  }
}

describe('filterMcpInstructions', () => {
  it('keeps instructions for servers with an available tool', () => {
    const result = filterMcpInstructions({
      instructions: [SERVER],
      availableTools: new Set(['mcp_docs_search']),
      permissionMode: 'ask',
      agent: null
    })

    expect(result).toEqual([{ server: 'docs', instructions: 'Use the docs server.' }])
  })

  it('drops servers whose tools are all filtered out', () => {
    const result = filterMcpInstructions({
      instructions: [SERVER],
      availableTools: new Set(['read']),
      permissionMode: 'ask',
      agent: null
    })

    expect(result).toEqual([])
  })

  it('drops servers whose available tools are denied by agent rules', () => {
    const result = filterMcpInstructions({
      instructions: [SERVER],
      availableTools: new Set(['mcp_docs_search', 'mcp_docs_secret']),
      permissionMode: 'ask',
      agent: agent({
        permissions: [
          { action: 'mcp', resource: 'docs/search', effect: 'deny' },
          { action: 'mcp', resource: 'docs/secret', effect: 'deny' }
        ]
      })
    })

    expect(result).toEqual([])
  })

  it('keeps a server when at least one tool is allowed', () => {
    const result = filterMcpInstructions({
      instructions: [SERVER],
      availableTools: new Set(['mcp_docs_search', 'mcp_docs_secret']),
      permissionMode: 'ask',
      agent: agent({
        permissions: [{ action: 'mcp', resource: 'docs/secret', effect: 'deny' }]
      })
    })

    expect(result).toHaveLength(1)
  })

  it('keeps toolLess servers only when an MCP helper tool is available', () => {
    const toolLess = { server: 'prompts-only', instructions: 'Use the prompt.', tools: [] }
    expect(
      filterMcpInstructions({
        instructions: [toolLess],
        availableTools: new Set(['mcp_prompt']),
        permissionMode: 'ask',
        agent: null
      })
    ).toHaveLength(1)
    expect(
      filterMcpInstructions({
        instructions: [toolLess],
        availableTools: new Set(['read']),
        permissionMode: 'ask',
        agent: null
      })
    ).toHaveLength(0)
  })

  it('drops all MCP instructions in plan mode', () => {
    expect(
      filterMcpInstructions({
        instructions: [SERVER],
        availableTools: new Set(['mcp_docs_search']),
        permissionMode: 'plan',
        agent: null
      })
    ).toEqual([])
  })
})

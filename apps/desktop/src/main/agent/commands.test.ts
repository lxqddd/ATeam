import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expandCommand,
  expandCommandTemplate,
  loadCommands,
  parseCommandJson,
  parseCommandMarkdown
} from './commands'

const MARKDOWN = [
  '---',
  'description: Review pending changes',
  '---',
  'Review $1 and list issues. Extra context: $ARGUMENTS'
].join('\n')

describe('parseCommandMarkdown', () => {
  it('parses the description and template', () => {
    expect(parseCommandMarkdown('/repo/.opencode/command/review.md', MARKDOWN, 'project')).toEqual({
      id: 'review',
      name: 'review',
      description: 'Review pending changes',
      template: 'Review $1 and list issues. Extra context: $ARGUMENTS',
      agent: null,
      model: null,
      source: 'project'
    })
  })

  it('defaults the name from the file and allows an empty description', () => {
    expect(
      parseCommandMarkdown('/repo/.opencode/command/deploy.md', 'Deploy the app.', 'project')
    ).toMatchObject({ id: 'deploy', name: 'deploy', description: '', template: 'Deploy the app.' })
  })

  it('uses a frontmatter name when present', () => {
    const agent = parseCommandMarkdown(
      '/repo/.opencode/command/file.md',
      ['---', 'name: Code Review', 'description: Reviews', '---', 'Review.'].join('\n'),
      'user'
    )

    expect(agent).toMatchObject({ id: 'code-review', name: 'Code Review' })
  })

  it('parses agent and model bindings', () => {
    const command = parseCommandMarkdown(
      '/repo/.opencode/command/plan.md',
      ['---', 'description: Plan it', 'agent: plan', 'model: openai/gpt-5', '---', 'Plan.'].join(
        '\n'
      ),
      'project'
    )

    expect(command).toMatchObject({
      agent: 'plan',
      model: { providerId: 'openai', modelId: 'gpt-5' }
    })
  })

  it('rejects empty files', () => {
    expect(parseCommandMarkdown('/repo/.opencode/command/empty.md', '', 'project')).toBeNull()
  })
})

describe('parseCommandJson', () => {
  it('parses json command definitions', () => {
    expect(
      parseCommandJson(
        { name: 'summarize', description: 'Summarize', template: 'Summarize $1' },
        'user'
      )
    ).toMatchObject({ id: 'summarize', template: 'Summarize $1', source: 'user' })
  })

  it('parses agent and model bindings', () => {
    expect(
      parseCommandJson(
        { name: 'deploy', template: 'Deploy', agent: 'build', model: 'anthropic/claude' },
        'user'
      )
    ).toMatchObject({
      agent: 'build',
      model: { providerId: 'anthropic', modelId: 'claude' }
    })
  })

  it('rejects incomplete definitions', () => {
    expect(parseCommandJson({ name: '', template: 'x' }, 'user')).toBeNull()
    expect(parseCommandJson({ name: 'x' }, 'user')).toBeNull()
  })
})

describe('expandCommand', () => {
  it('replaces $ARGUMENTS and positional placeholders', () => {
    expect(expandCommand('Review $1 with $ARGUMENTS', 'src/a.ts extra')).toBe(
      'Review src/a.ts with src/a.ts extra'
    )
  })

  it('replaces missing positional arguments with an empty string', () => {
    expect(expandCommand('Compare $1 and $2', 'one')).toBe('Compare one and ')
  })

  it('appends arguments when the template has no placeholders', () => {
    expect(expandCommand('Run the checks.', 'now')).toBe('Run the checks.\n\nnow')
    expect(expandCommand('Run the checks.', '')).toBe('Run the checks.')
  })
})

describe('expandCommandTemplate', () => {
  it('runs shell snippets and injects their output', async () => {
    const runner = vi.fn(async () => ({ stdout: 'abc\n' }))

    await expect(expandCommandTemplate('Files:\n!`ls src`', '', runner)).resolves.toBe(
      'Files:\nabc'
    )
    expect(runner).toHaveBeenCalledWith('ls src')
  })

  it('reports failed snippets without throwing', async () => {
    const runner = vi.fn(async () => ({ stdout: '', error: 'boom' }))

    await expect(expandCommandTemplate('!`false`', '', runner)).resolves.toBe(
      '(shell command failed: boom)'
    )
  })

  it('caps the number of executed snippets', async () => {
    const runner = vi.fn(async () => ({ stdout: 'x' }))
    const template = Array.from({ length: 7 }, () => '!`echo x`').join(' ')

    const result = await expandCommandTemplate(template, '', runner)

    expect(runner).toHaveBeenCalledTimes(5)
    expect(result).toContain('(shell snippet limit reached)')
  })

  it('leaves templates without snippets untouched', async () => {
    const runner = vi.fn(async () => ({ stdout: '' }))

    await expect(expandCommandTemplate('Review $1', 'src/a.ts', runner)).resolves.toBe(
      'Review src/a.ts'
    )
    expect(runner).not.toHaveBeenCalled()
  })
})

describe('loadCommands', () => {
  let directory: string
  let workspace: string

  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-commands-')))
    workspace = path.join(directory, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  async function write(relative: string, content: string): Promise<void> {
    const target = path.join(directory, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }

  it('returns nothing when no commands exist', async () => {
    await expect(
      loadCommands({ userDataPath: directory, workspacePath: workspace })
    ).resolves.toEqual([])
  })

  it('loads user markdown and json commands', async () => {
    await write('agent/commands/review.md', MARKDOWN)
    await write(
      'agent/commands.json',
      JSON.stringify({
        commands: [{ name: 'summarize', description: 'Summarize', template: 'Summarize $1' }]
      })
    )

    const commands = await loadCommands({ userDataPath: directory, workspacePath: workspace })

    expect(commands.map((command) => command.name).sort()).toEqual(['review', 'summarize'])
  })

  it('loads project commands and lets them override user commands', async () => {
    await write('agent/commands/review.md', MARKDOWN)
    await write(
      'workspace/.opencode/command/review.md',
      ['---', 'description: Project review', '---', 'Project review template'].join('\n')
    )
    await write(
      'workspace/.claude/commands/ship.md',
      ['---', 'description: Ship it', '---', 'Ship it.'].join('\n')
    )

    const commands = await loadCommands({ userDataPath: directory, workspacePath: workspace })
    const review = commands.filter((command) => command.name === 'review')

    expect(review).toHaveLength(1)
    expect(review[0]).toMatchObject({ description: 'Project review', source: 'project' })
    expect(commands.find((command) => command.name === 'ship')).toMatchObject({ source: 'project' })
  })

  it('ignores invalid command files', async () => {
    await write('agent/commands/bad.md', '')
    await write('agent/commands.json', JSON.stringify({ commands: [{ name: '' }] }))

    await expect(
      loadCommands({ userDataPath: directory, workspacePath: workspace })
    ).resolves.toEqual([])
  })
})

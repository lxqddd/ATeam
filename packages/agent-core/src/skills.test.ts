import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSkills, parseSkillMarkdown, skillsPrompt } from './skills'

const SKILL = [
  '---',
  'name: code-review',
  'description: Review changes for bugs and style',
  '---',
  '# Code review',
  '',
  'Read the diff and report issues.'
].join('\n')

describe('parseSkillMarkdown', () => {
  it('parses frontmatter and content', () => {
    expect(parseSkillMarkdown('/repo/.opencode/skills/review/SKILL.md', SKILL, 'project')).toEqual({
      id: 'code-review',
      name: 'code-review',
      description: 'Review changes for bugs and style',
      content: '# Code review\n\nRead the diff and report issues.',
      path: '/repo/.opencode/skills/review/SKILL.md',
      resources: [],
      source: 'project'
    })
  })

  it('defaults the name from the directory', () => {
    const skill = parseSkillMarkdown(
      '/repo/.claude/skills/deploy/SKILL.md',
      ['---', 'description: Deploy safely', '---', 'Deploy steps.'].join('\n'),
      'project'
    )

    expect(skill).toMatchObject({ id: 'deploy', name: 'deploy', source: 'project' })
  })

  it('requires a description', () => {
    expect(
      parseSkillMarkdown('/repo/.opencode/skills/review/SKILL.md', 'No frontmatter.', 'project')
    ).toBeNull()
    expect(
      parseSkillMarkdown(
        '/repo/.opencode/skills/review/SKILL.md',
        ['---', 'name: review', '---', 'Body.'].join('\n'),
        'project'
      )
    ).toBeNull()
  })

  it('rejects empty skill bodies', () => {
    expect(
      parseSkillMarkdown(
        '/repo/.opencode/skills/review/SKILL.md',
        ['---', 'description: Reviews', '---'].join('\n'),
        'project'
      )
    ).toBeNull()
  })
})

describe('loadSkills', () => {
  let directory: string
  let workspace: string

  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-skills-')))
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

  it('returns nothing without skill directories', async () => {
    await expect(
      loadSkills({ userDataPath: directory, workspacePath: workspace })
    ).resolves.toEqual([])
  })

  it('discovers user, opencode and claude skills', async () => {
    await write(
      'agent/skills/user-skill/SKILL.md',
      ['---', 'description: User skill', '---', 'User body.'].join('\n')
    )
    await write(
      'workspace/.opencode/skill/opencode-one/SKILL.md',
      ['---', 'description: Singular', '---', 'Body.'].join('\n')
    )
    await write(
      'workspace/.opencode/skills/opencode-two/SKILL.md',
      ['---', 'description: Plural', '---', 'Body.'].join('\n')
    )
    await write(
      'workspace/.claude/skills/claude-one/SKILL.md',
      ['---', 'description: Claude skill', '---', 'Body.'].join('\n')
    )

    const skills = await loadSkills({ userDataPath: directory, workspacePath: workspace })

    expect(skills.map((skill) => skill.name).sort()).toEqual([
      'claude-one',
      'opencode-one',
      'opencode-two',
      'user-skill'
    ])
  })

  it('lets later sources override the same skill name', async () => {
    await write(
      'agent/skills/review/SKILL.md',
      ['---', 'description: User review', '---', 'User body.'].join('\n')
    )
    await write(
      'workspace/.claude/skills/review/SKILL.md',
      ['---', 'description: Project review', '---', 'Project body.'].join('\n')
    )

    const skills = await loadSkills({ userDataPath: directory, workspacePath: workspace })

    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      description: 'Project review',
      content: 'Project body.',
      source: 'project'
    })
  })

  it('lists adjacent resource files relative to the skill directory', async () => {
    await write(
      'workspace/.opencode/skills/review/SKILL.md',
      ['---', 'description: Review', '---', 'Body.'].join('\n')
    )
    await write('workspace/.opencode/skills/review/references/checklist.md', 'Checklist')
    await write('workspace/.opencode/skills/review/scripts/run.sh', 'echo hi')

    const skills = await loadSkills({ userDataPath: directory, workspacePath: workspace })

    expect(skills[0]?.resources).toEqual(['references/checklist.md', 'scripts/run.sh'])
  })

  it('ignores files that are not named SKILL.md', async () => {
    await write(
      'workspace/.opencode/skills/notes/README.md',
      ['---', 'description: Not a skill', '---', 'Body.'].join('\n')
    )

    await expect(
      loadSkills({ userDataPath: directory, workspacePath: workspace })
    ).resolves.toEqual([])
  })
})

describe('skillsPrompt', () => {
  it('lists skills with their descriptions', () => {
    const prompt = skillsPrompt([
      {
        id: 'code-review',
        name: 'code-review',
        description: 'Review changes',
        content: 'Body',
        path: '/x/SKILL.md',
        resources: [],
        source: 'project'
      }
    ])

    expect(prompt).toContain('Available skills')
    expect(prompt).toContain('- code-review: Review changes')
    expect(prompt).toContain('skill tool')
  })

  it('returns an empty string without skills', () => {
    expect(skillsPrompt([])).toBe('')
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyProjectConfigEdits, editProjectConfigFile } from './project-config-edit'
import { readProjectConfigFile } from './project-config'

let directory: string
let workspace: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-project-edit-')))
  workspace = path.join(directory, 'packages', 'app')
  await fs.mkdir(path.join(directory, '.git'), { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('applyProjectConfigEdits', () => {
  it('changes a leaf without touching comments or sibling fields', () => {
    const content = `{
  // keep this comment
  "snapshots": false,
  "providers": {
    // provider comment
    "openai": { "baseURL": "https://api.example.com", "models": { "m": { "name": "M" } } }
  }
}
`
    const next = applyProjectConfigEdits(content, [
      { path: ['providers', 'openai', 'models', 'm', 'name'], value: 'Renamed' }
    ])

    expect(next).toContain('// keep this comment')
    expect(next).toContain('// provider comment')
    expect(next).toContain('"snapshots": false')
    expect(next).toContain('"name": "Renamed"')
  })

  it('deletes a key and keeps its siblings', () => {
    const content = `{
  "providers": {
    "a": { "name": "A" },
    "b": { "name": "B" }
  }
}
`
    const next = applyProjectConfigEdits(content, [{ path: ['providers', 'a'] }])

    expect(next).not.toContain('"A"')
    expect(next).toContain('"B"')
  })

  it('replaces a boolean with the object form', () => {
    const next = applyProjectConfigEdits('{\n  "lsp": true\n}\n', [
      { path: ['lsp'], value: { servers: { ts: { command: ['ts-ls'] } } } }
    ])

    expect(JSON.parse(next)).toEqual({ lsp: { servers: { ts: { command: ['ts-ls'] } } } })
  })

  it('keeps CRLF, tab indentation and a BOM', () => {
    const bom = String.fromCharCode(0xfeff)
    const content = `${bom}{\r\n\t"skills": [\r\n\t\t"a"\r\n\t]\r\n}\r\n`
    const next = applyProjectConfigEdits(content, [
      { path: ['commands', 'review'], value: { template: 'Review' } }
    ])

    expect(next.startsWith(bom)).toBe(true)
    expect(next).toContain('\r\n\t"skills"')
    expect(next).toContain('\r\n\t"commands"')
  })

  it('returns the original text when nothing changes', () => {
    const content = '{\n  "snapshots": false\n}\n'

    expect(applyProjectConfigEdits(content, [{ path: ['snapshots'], value: false }])).toBe(content)
  })

  it('rejects unsafe paths and invalid JSONC', () => {
    expect(() => applyProjectConfigEdits('{}\n', [{ path: ['__proto__'], value: 1 }])).toThrow(
      'INVALID_PROJECT_CONFIG_EDIT'
    )
    expect(() => applyProjectConfigEdits('{}\n', [{ path: [], value: 1 }])).toThrow(
      'INVALID_PROJECT_CONFIG_EDIT'
    )
    expect(() =>
      applyProjectConfigEdits('{ not json', [{ path: ['skills'], value: ['a'] }])
    ).toThrow('INVALID_PROJECT_CONFIG')
  })
})

describe('editProjectConfigFile', () => {
  it('creates ateam.json when the project has no config', async () => {
    const file = await editProjectConfigFile(workspace, [
      { path: ['providers'], value: { local: { name: 'Local' } } }
    ])

    expect(file.exists).toBe(true)
    expect(file.path).toBe(path.join(directory, 'ateam.json'))
    expect(file.raw).toEqual({ providers: { local: { name: 'Local' } } })
    expect(file.document.providers).toBeDefined()
  })

  it('edits an existing jsonc file in place', async () => {
    await fs.writeFile(path.join(directory, 'ateam.jsonc'), '{\n  // keep\n  "skills": ["a"]\n}\n')

    const file = await editProjectConfigFile(workspace, [{ path: ['skills'], value: ['a', 'b'] }])

    expect(file.content).toContain('// keep')
    expect(file.raw).toEqual({ skills: ['a', 'b'] })
  })

  it('does not rewrite the file when the edit is a no-op', async () => {
    const filePath = path.join(directory, 'ateam.json')
    await fs.writeFile(filePath, '{\n  "snapshots": false\n}\n')
    const before = await fs.stat(filePath)

    await editProjectConfigFile(workspace, [{ path: ['snapshots'], value: false }])

    const after = await fs.stat(filePath)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect((await readProjectConfigFile(workspace)).raw).toEqual({ snapshots: false })
  })
})

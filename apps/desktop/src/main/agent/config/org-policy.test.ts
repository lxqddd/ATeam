import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOrgPolicy, orgPolicyPath } from './org-policy'

let directory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-policy-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('loadOrgPolicy', () => {
  it('returns no policy when the file is missing', () => {
    expect(loadOrgPolicy({ userDataPath: directory })).toEqual({
      path: null,
      rules: [],
      error: null
    })
  })

  it('loads the default policy file', async () => {
    const file = path.join(directory, 'agent', 'policy.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        permissionRules: [
          { action: 'shell', resource: 'git push *', effect: 'deny' },
          { action: 'read', resource: '*', effect: 'allow' }
        ]
      })
    )

    expect(loadOrgPolicy({ userDataPath: directory })).toEqual({
      path: file,
      rules: [
        { action: 'shell', resource: 'git push *', effect: 'deny' },
        { action: 'read', resource: '*', effect: 'allow' }
      ],
      error: null
    })
  })

  it('reads the policy file from the environment', async () => {
    const file = path.join(directory, 'managed-policy.json')
    await fs.writeFile(
      file,
      JSON.stringify({ rules: [{ action: '*', resource: '*', effect: 'ask' }] })
    )

    expect(loadOrgPolicy({ userDataPath: directory, envPolicyFile: file }).rules).toHaveLength(1)
    expect(orgPolicyPath({ userDataPath: directory, envPolicyFile: file })).toBe(file)
  })

  it('skips invalid rules and reports them', async () => {
    const file = path.join(directory, 'agent', 'policy.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        permissionRules: [
          { action: 'shell', resource: 'ls', effect: 'deny' },
          { action: 'unknown', resource: 'x', effect: 'deny' },
          { action: 'read', resource: '', effect: 'allow' },
          { action: 'write', resource: 'x', effect: 'maybe' }
        ]
      })
    )

    const policy = loadOrgPolicy({ userDataPath: directory })
    expect(policy.rules).toEqual([{ action: 'shell', resource: 'ls', effect: 'deny' }])
    expect(policy.error).toContain('3 invalid')
  })

  it('reports malformed JSON', async () => {
    const file = path.join(directory, 'agent', 'policy.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{not json')

    expect(loadOrgPolicy({ userDataPath: directory }).error).toContain('valid JSON')
  })
})

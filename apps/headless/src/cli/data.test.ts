import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage, SessionMeta } from '@ateam/shared'
import { readSessionExport, SessionsStore } from '@ateam/agent-core/sessions'
import { dataCommandOf, parseDataArgs, runDataCommand, type DataIo } from './data'

const tempDirs: string[] = []

async function tempDir(label: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `ateam-cli-${label}-`)))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

interface Captured {
  io: Partial<DataIo>
  stdout(): string
  stderr(): string
}

function captureIo(overrides: Partial<DataIo> = {}): Captured {
  let stdout = ''
  let stderr = ''
  const io: Partial<DataIo> = {
    cwd: process.cwd(),
    stdinIsTTY: false,
    readStdin: async () => '',
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    ...overrides
  }
  return { io, stdout: () => stdout, stderr: () => stderr }
}

function message(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'sessionId'>
): ChatMessage {
  const now = new Date().toISOString()
  return {
    role: 'user',
    status: 'complete',
    createdAt: now,
    updatedAt: now,
    parts: [],
    ...overrides
  }
}

/** Seeds one session with a user message and a priced assistant message. */
async function seedStore(dataDir: string, directory: string | null = null): Promise<SessionMeta> {
  const store = new SessionsStore(dataDir)
  await store.init()
  const session = await store.create({ directory })
  await store.appendMessage(
    session.id,
    message({
      id: 'msg-user',
      sessionId: session.id,
      role: 'user',
      parts: [{ type: 'text', text: 'Hello export' }]
    })
  )
  await store.appendMessage(
    session.id,
    message({
      id: 'msg-assistant',
      sessionId: session.id,
      role: 'assistant',
      model: { providerId: 'anthropic', modelId: 'claude-opus-5', variant: null },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cacheReadTokens: 30,
        cacheWriteTokens: 10
      },
      costUsd: 0.012345,
      parts: [{ type: 'text', text: 'Hi there' }]
    })
  )
  await store.close()
  return session
}

describe('dataCommandOf', () => {
  it('recognizes data commands after an optional separator', () => {
    expect(dataCommandOf(['export'])).toBe('export')
    expect(dataCommandOf(['--', 'import'])).toBe('import')
    expect(dataCommandOf(['stats', '--json'])).toBe('stats')
  })

  it('ignores chat invocations', () => {
    expect(dataCommandOf([])).toBeNull()
    expect(dataCommandOf(['--', '--model', 'test'])).toBeNull()
    expect(dataCommandOf(['--model', 'test'])).toBeNull()
  })
})

describe('parseDataArgs', () => {
  it('uses desktop-compatible defaults', () => {
    expect(parseDataArgs(['export'])).toMatchObject({
      command: 'export',
      format: 'json',
      output: null,
      sessionId: null,
      redactPaths: true,
      json: false,
      dataDir: path.join(os.homedir(), '.ateam', 'cli')
    })
    expect(parseDataArgs(['stats'])).toMatchObject({ command: 'stats', range: '7d' })
    expect(parseDataArgs(['import'])).toMatchObject({ command: 'import', file: null })
  })

  it('parses inline and separated option values', () => {
    expect(
      parseDataArgs([
        'export',
        '--format=markdown',
        '--out',
        'sessions.md',
        '--session=s1',
        '--no-redact-paths',
        '--json'
      ])
    ).toMatchObject({
      command: 'export',
      format: 'markdown',
      output: 'sessions.md',
      sessionId: 's1',
      redactPaths: false,
      json: true
    })
    expect(parseDataArgs(['import', 'export.json', '--data', 'store'])).toMatchObject({
      file: 'export.json',
      dataDir: path.resolve('store')
    })
    expect(parseDataArgs(['stats', '--range', '30d'])).toMatchObject({ range: '30d' })
  })

  it('resolves --data against the working directory', () => {
    expect(parseDataArgs(['stats', '--data', 'local'], '/tmp/work')).toMatchObject({
      dataDir: '/tmp/work/local'
    })
  })

  it('accepts files that start with a dash after the separator', () => {
    expect(parseDataArgs(['import', '--', '--weird.json'])).toMatchObject({
      file: '--weird.json'
    })
  })

  it('rejects unknown flags, invalid values and misplaced positionals', () => {
    expect(() => parseDataArgs(['export', '--range', 'all'])).toThrow(/only valid for stats/)
    expect(() => parseDataArgs(['stats', '--format', 'json'])).toThrow(/only valid for export/)
    expect(() => parseDataArgs(['export', '--format', 'yaml'])).toThrow(
      /--format must be one of: json, jsonl, markdown/
    )
    expect(() => parseDataArgs(['stats', '--range', '1d'])).toThrow(
      /--range must be one of: all, 7d, 30d/
    )
    expect(() => parseDataArgs(['export', '--nope'])).toThrow(/Unknown flag: --nope/)
    expect(() => parseDataArgs(['import', 'a.json', 'b.json'])).toThrow(/Unexpected argument/)
    expect(() => parseDataArgs(['export', 'oops'])).toThrow(/Unexpected argument/)
  })

  it('supports --help and -h', () => {
    expect(parseDataArgs(['export', '--help'])).toMatchObject({ help: true })
    expect(parseDataArgs(['stats', '-h'])).toMatchObject({ help: true })
  })
})

describe('runDataCommand help', () => {
  it('prints per-command help without touching the store', async () => {
    for (const command of ['export', 'import', 'stats']) {
      const captured = captureIo()
      expect(await runDataCommand([command, '--help'], captured.io)).toBe(0)
      expect(captured.stdout()).toContain(`Usage: pnpm cli -- ${command}`)
    }
  })

  it('returns 2 for usage errors', async () => {
    const captured = captureIo()
    expect(await runDataCommand(['export', '--format', 'yaml'], captured.io)).toBe(2)
    expect(captured.stderr()).toContain('--format must be one of')
  })
})

describe('export', () => {
  it('round-trips every format through import', async () => {
    for (const format of ['json', 'jsonl', 'markdown'] as const) {
      const source = await tempDir(`source-${format}`)
      const target = await tempDir(`target-${format}`)
      const original = await seedStore(source)

      const exported = captureIo()
      expect(
        await runDataCommand(['export', '--data', source, '--format', format], exported.io)
      ).toBe(0)
      const content = exported.stdout()
      expect(content.length).toBeGreaterThan(0)
      // The desktop app reads the CLI output with the same parser.
      expect(readSessionExport(content).sessions).toHaveLength(1)

      const imported = captureIo({ readStdin: async () => content })
      expect(await runDataCommand(['import', '--data', target, '--json'], imported.io)).toBe(0)
      const summary = JSON.parse(imported.stdout()) as {
        imported: boolean
        sessionCount: number
        messageCount: number
        sessions: Array<{ id: string; title: string }>
      }
      expect(summary).toMatchObject({ imported: true, sessionCount: 1, messageCount: 2 })
      expect(summary.sessions[0].title).toBe('Hello export')
      expect(summary.sessions[0].id).not.toBe(original.id)

      const store = new SessionsStore(target)
      await store.init()
      const records = store.allRecords()
      expect(records).toHaveLength(1)
      expect(records[0].messages).toHaveLength(2)
      expect(records[0].session.status).toBe('idle')
      await store.close()
    }
  })

  it('writes to a file relative to the working directory', async () => {
    const dataDir = await tempDir('data')
    const work = await tempDir('work')
    await seedStore(dataDir)

    const captured = captureIo({ cwd: work })
    expect(
      await runDataCommand(
        ['export', '--data', dataDir, '--out', 'session.json', '--json'],
        captured.io
      )
    ).toBe(0)
    const summary = JSON.parse(captured.stdout()) as {
      saved: boolean
      path: string
      sessionCount: number
      messageCount: number
    }
    expect(summary).toMatchObject({ saved: true, sessionCount: 1, messageCount: 2 })
    expect(summary.path).toBe(path.join(work, 'session.json'))
    const content = await fs.readFile(summary.path, 'utf8')
    expect(readSessionExport(content).sessions).toHaveLength(1)
  })

  it('exports a single session and rejects unknown ids', async () => {
    const dataDir = await tempDir('data')
    const session = await seedStore(dataDir)

    const single = captureIo()
    expect(
      await runDataCommand(['export', '--data', dataDir, '--session', session.id], single.io)
    ).toBe(0)
    expect(readSessionExport(single.stdout()).sessions).toHaveLength(1)

    const missing = captureIo()
    expect(
      await runDataCommand(['export', '--data', dataDir, '--session', 'missing'], missing.io)
    ).toBe(1)
    expect(missing.stderr()).toContain('SESSION_NOT_FOUND')
  })
})

describe('import', () => {
  it('reports invalid and missing files with a non-zero exit code', async () => {
    const dataDir = await tempDir('data')
    const work = await tempDir('work')
    await fs.writeFile(path.join(work, 'bad.json'), '{"not":"an export"}', 'utf8')

    const invalid = captureIo({ cwd: work })
    expect(await runDataCommand(['import', 'bad.json', '--data', dataDir], invalid.io)).toBe(1)
    expect(invalid.stderr()).toContain('EXPORT_')

    const missing = captureIo({ cwd: work })
    expect(await runDataCommand(['import', 'missing.json', '--data', dataDir], missing.io)).toBe(1)
    expect(missing.stderr()).toContain('ENOENT')
  })

  it('fails instead of waiting for stdin in a terminal', async () => {
    const dataDir = await tempDir('data')
    let read = false
    const captured = captureIo({
      stdinIsTTY: true,
      readStdin: async () => {
        read = true
        return ''
      }
    })
    expect(await runDataCommand(['import', '--data', dataDir], captured.io)).toBe(2)
    expect(read).toBe(false)
    expect(captured.stderr()).toContain('Provide a file path or pipe an export via stdin.')
  })
})

describe('stats', () => {
  it('prints usage statistics as JSON and as text', async () => {
    const dataDir = await tempDir('data')
    await seedStore(dataDir)

    const json = captureIo()
    expect(
      await runDataCommand(['stats', '--data', dataDir, '--range', 'all', '--json'], json.io)
    ).toBe(0)
    const stats = JSON.parse(json.stdout()) as {
      range: string
      sessionCount: number
      messageCount: number
      assistantMessageCount: number
      tokens: Record<string, number>
    }
    expect(stats).toMatchObject({
      range: 'all',
      sessionCount: 1,
      messageCount: 2,
      assistantMessageCount: 1
    })
    expect(stats.tokens).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      totalTokens: 120
    })

    const text = captureIo()
    expect(await runDataCommand(['stats', '--data', dataDir, '--range', '7d'], text.io)).toBe(0)
    expect(text.stdout()).toContain('Sessions: 1')
    expect(text.stdout()).toContain('Messages: 2')
    expect(text.stdout()).toContain('anthropic/claude-opus-5')
  })
})

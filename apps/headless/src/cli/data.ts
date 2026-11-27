import fs from 'node:fs/promises'
import path from 'node:path'
import type { SessionExportFormat, UsageStats, UsageStatsRange } from '@ateam/shared'
import { SESSION_EXPORT_FORMATS, USAGE_STATS_RANGES } from '@ateam/shared'
import {
  buildSessionExport,
  computeUsageStats,
  prepareSessionImport,
  SessionsStore
} from '@ateam/agent-core/sessions'
import { version } from '../version'
import { defaultCliDataDir } from './args'
import { createCliIo, type CliIo } from './io'

/** Data subcommands handled before the agent runtime starts. */
export const DATA_COMMANDS = ['export', 'import', 'stats'] as const

export type DataCommand = (typeof DATA_COMMANDS)[number]

interface CommonDataOptions {
  dataDir: string
  json: boolean
  help: boolean
}

export type DataCommandOptions =
  | (CommonDataOptions & {
      command: 'export'
      sessionId: string | null
      format: SessionExportFormat
      output: string | null
      redactPaths: boolean
    })
  | (CommonDataOptions & { command: 'import'; file: string | null })
  | (CommonDataOptions & { command: 'stats'; range: UsageStatsRange })

/** Injectable process boundaries so tests (and embeddings) never touch stdio. */
export type DataIo = CliIo

/** A failure whose exit code is part of the CLI contract. */
class DataCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number
  ) {
    super(message)
  }
}

function commandIndex(argv: string[]): number {
  // pnpm forwards its own separator as the first argument.
  return argv[0] === '--' ? 1 : 0
}

/** Returns the data subcommand at the front of `argv`, if there is one. */
export function dataCommandOf(argv: string[]): DataCommand | null {
  const candidate = argv[commandIndex(argv)]
  return (DATA_COMMANDS as readonly string[]).includes(candidate)
    ? (candidate as DataCommand)
    : null
}

function takeValue(argv: string[], index: number, flag: string): [string, number] {
  const next = argv[index + 1]
  if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`)
  return [next, index + 1]
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${flag} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

/**
 * Parses `ateam <export|import|stats> ...`.
 *
 * Values may be inline (`--format=json`) or the following argument. Positional
 * arguments are only accepted by `import`, where they name the export file.
 */
export function parseDataArgs(argv: string[], cwd = process.cwd()): DataCommandOptions {
  const command = dataCommandOf(argv)
  if (!command) throw new Error(`Unknown data command`)
  const args = argv.slice(commandIndex(argv) + 1)
  const common = { dataDir: defaultCliDataDir(), json: false, help: false }
  const options: DataCommandOptions =
    command === 'export'
      ? { command, ...common, sessionId: null, format: 'json', output: null, redactPaths: true }
      : command === 'import'
        ? { command, ...common, file: null }
        : { command, ...common, range: '7d' }

  const positional: string[] = []
  let optionsEnded = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (optionsEnded) {
      positional.push(argument)
      continue
    }
    if (argument === '--') {
      optionsEnded = true
      continue
    }
    if (!argument.startsWith('--') && argument !== '-h') {
      positional.push(argument)
      continue
    }
    const [flag, inline] = argument.includes('=')
      ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)]
      : [argument, null]
    const value = (): string => {
      if (inline !== null) return inline
      const [next, consumed] = takeValue(args, index, flag)
      index = consumed
      return next
    }
    switch (flag) {
      case '--data':
        options.dataDir = path.resolve(cwd, value())
        break
      case '--json':
        options.json = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--session':
        if (options.command !== 'export') throw new Error(`${flag} is only valid for export`)
        options.sessionId = value()
        break
      case '--format':
        if (options.command !== 'export') throw new Error(`${flag} is only valid for export`)
        options.format = parseEnum(value(), SESSION_EXPORT_FORMATS, flag)
        break
      case '--out':
        if (options.command !== 'export') throw new Error(`${flag} is only valid for export`)
        options.output = value()
        break
      case '--no-redact-paths':
        if (options.command !== 'export') throw new Error(`${flag} is only valid for export`)
        options.redactPaths = false
        break
      case '--file':
        if (options.command !== 'import') throw new Error(`${flag} is only valid for import`)
        options.file = value()
        break
      case '--range':
        if (options.command !== 'stats') throw new Error(`${flag} is only valid for stats`)
        options.range = parseEnum(value(), USAGE_STATS_RANGES, flag)
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }

  if (options.command === 'import') {
    if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`)
    if (positional.length === 1) options.file = positional[0]
  } else if (positional.length > 0) {
    throw new Error(`Unexpected argument: ${positional[0]}`)
  }
  return options
}

const EXPORT_HELP = `Usage: pnpm cli -- export [options]

Export stored CLI sessions in the desktop-compatible format.

Options:
  --session <id>        Export one session (default: every stored session)
  --format <format>     json | jsonl | markdown (default: json)
  --out <path>          Write to a file; "-" or omitted writes to stdout
  --no-redact-paths     Keep absolute paths (credentials are always redacted)
  --data <dir>          CLI data directory (default: ~/.ateam/cli)
  --json                Print a JSON summary instead of text (with --out)
  --help                Show this help
`

const IMPORT_HELP = `Usage: pnpm cli -- import [file] [options]

Import a session export produced by the desktop app or this CLI. The file may
be JSON, JSON Lines or Markdown. With no file and piped stdin the export is read
from stdin; without either the command fails instead of waiting for input.

Options:
  --file <path>         Export file (same as the positional argument)
  --data <dir>          CLI data directory (default: ~/.ateam/cli)
  --json                Print a JSON summary
  --help                Show this help
`

const STATS_HELP = `Usage: pnpm cli -- stats [options]

Show local usage statistics computed from stored CLI sessions.

Options:
  --range <range>       all | 7d | 30d (default: 7d)
  --data <dir>          CLI data directory (default: ~/.ateam/cli)
  --json                Print the raw UsageStats JSON
  --help                Show this help
`

function helpFor(command: DataCommand): string {
  if (command === 'export') return EXPORT_HELP
  if (command === 'import') return IMPORT_HELP
  return STATS_HELP
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withStore<T>(
  dataDir: string,
  run: (store: SessionsStore) => Promise<T>
): Promise<T> {
  const store = new SessionsStore(dataDir)
  try {
    await store.init()
    return await run(store)
  } finally {
    await store.close().catch(() => undefined)
  }
}

async function runExport(
  options: Extract<DataCommandOptions, { command: 'export' }>,
  io: DataIo
): Promise<void> {
  await withStore(options.dataDir, async (store) => {
    const records = options.sessionId ? [store.get(options.sessionId)] : store.allRecords()
    if (records.some((record) => record === undefined)) throw new Error('SESSION_NOT_FOUND')
    const payload = buildSessionExport(records as NonNullable<(typeof records)[number]>[], {
      format: options.format,
      appVersion: version,
      redactPaths: options.redactPaths
    })

    if (!options.output || options.output === '-') {
      io.stdout(payload.content)
      return
    }
    const target = path.resolve(io.cwd, options.output)
    await fs.writeFile(target, payload.content, 'utf8')
    if (options.json) {
      io.stdout(
        `${JSON.stringify({
          saved: true,
          path: target,
          format: payload.format,
          sessionCount: payload.sessionCount,
          messageCount: payload.messageCount
        })}\n`
      )
    } else {
      io.stdout(
        `Exported ${payload.sessionCount} session(s), ${payload.messageCount} message(s) to ${target}\n`
      )
    }
  })
}

async function readImportContent(
  options: Extract<DataCommandOptions, { command: 'import' }>,
  io: DataIo
): Promise<string> {
  if (options.file) {
    return fs.readFile(path.resolve(io.cwd, options.file), 'utf8')
  }
  if (io.stdinIsTTY) {
    throw new DataCommandError('Provide a file path or pipe an export via stdin.', 2)
  }
  return io.readStdin()
}

async function runImport(
  options: Extract<DataCommandOptions, { command: 'import' }>,
  io: DataIo
): Promise<void> {
  const content = await readImportContent(options, io)
  const records = prepareSessionImport(content)
  await withStore(options.dataDir, async (store) => {
    let messageCount = 0
    for (const record of records) {
      record.session.directory = await resolveImportedDirectory(record.session.directory)
      await store.importRecord(record)
      messageCount += record.messages.length
    }
    const sessions = records
      .filter((record) => !record.session.hidden)
      .map((record) => ({ id: record.session.id, title: record.session.title }))
    if (options.json) {
      io.stdout(
        `${JSON.stringify({
          imported: true,
          sessionCount: records.length,
          messageCount,
          sessions
        })}\n`
      )
      return
    }
    io.stdout(`Imported ${records.length} session(s), ${messageCount} message(s).\n`)
    for (const session of sessions) {
      io.stdout(`  ${session.id}\t${session.title || '(untitled)'}\n`)
    }
  })
}

/**
 * Imported workspaces are only reused when the exported path is absolute and
 * still exists locally; redacted placeholders and paths from another machine
 * fall back to "no workspace".
 */
async function resolveImportedDirectory(directory: string | null): Promise<string | null> {
  if (!directory || !path.isAbsolute(directory)) return null
  const stat = await fs.stat(directory).catch(() => null)
  if (!stat?.isDirectory()) return null
  return fs.realpath(directory).catch(() => path.resolve(directory))
}

async function runStats(
  options: Extract<DataCommandOptions, { command: 'stats' }>,
  io: DataIo
): Promise<void> {
  await withStore(options.dataDir, async (store) => {
    const stats = computeUsageStats(store.allRecords(), { range: options.range })
    io.stdout(options.json ? `${JSON.stringify(stats, null, 2)}\n` : formatStats(stats))
  })
}

function formatStats(stats: UsageStats): string {
  const lines = [
    `Range: ${stats.range}`,
    `Sessions: ${stats.sessionCount}`,
    `Messages: ${stats.messageCount} (assistant ${stats.assistantMessageCount}, tool calls ${stats.toolCallCount})`,
    `Tokens: input ${stats.tokens.inputTokens} · output ${stats.tokens.outputTokens} · cache read ${stats.tokens.cacheReadTokens} · cache write ${stats.tokens.cacheWriteTokens} · total ${stats.tokens.totalTokens}`,
    `Cost: $${stats.costUsd.toFixed(6)}`,
    `Assistant messages without usage: ${stats.assistantMessagesWithoutUsage} · without cost: ${stats.assistantMessagesWithoutCost}`
  ]
  if (stats.models.length > 0) {
    lines.push('', 'Models:')
    for (const model of stats.models) {
      lines.push(
        `  ${model.providerId}/${model.modelId}  messages ${model.messages} · input ${model.inputTokens} · output ${model.outputTokens} · $${model.costUsd.toFixed(6)}`
      )
    }
  }
  if (stats.tools.length > 0) {
    lines.push('', 'Tools:')
    for (const tool of stats.tools) {
      lines.push(`  ${tool.toolName}  calls ${tool.calls} · failed ${tool.failed}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Runs a data subcommand and returns the process exit code: 0 on success,
 * 2 for usage errors, 1 for runtime failures (missing file, invalid export).
 * The command never prompts, so it cannot block in a non-interactive shell.
 */
export async function runDataCommand(
  argv: string[],
  overrides: Partial<DataIo> = {}
): Promise<number> {
  const io = createCliIo(overrides)
  let options: DataCommandOptions
  try {
    options = parseDataArgs(argv, io.cwd)
  } catch (error) {
    io.stderr(`${messageOf(error)}\n`)
    return 2
  }
  if (options.help) {
    io.stdout(helpFor(options.command))
    return 0
  }

  try {
    if (options.command === 'export') await runExport(options, io)
    else if (options.command === 'import') await runImport(options, io)
    else await runStats(options, io)
    return 0
  } catch (error) {
    io.stderr(`${messageOf(error)}\n`)
    return error instanceof DataCommandError ? error.exitCode : 1
  }
}

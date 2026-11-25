import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_TOOL_OUTPUT_LIMITS,
  TOOL_OUTPUT_RETENTION_MS,
  type ToolOutputConfig,
  type ToolOutputLimitsResolved
} from '@ateam/shared'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000
const STORED_FILE = /\.(?:txt|log)$/

export interface BoundedToolOutput {
  output: string
  path?: string
}

/** Resolve the effective limits for one tool, falling back to the global values. */
export function toolOutputLimitsFor(
  config: ToolOutputConfig | undefined,
  toolName?: string
): ToolOutputLimitsResolved {
  const override = toolName ? config?.tools?.[toolName] : undefined
  return {
    maxLines: override?.maxLines ?? config?.maxLines ?? DEFAULT_TOOL_OUTPUT_LIMITS.maxLines,
    maxBytes: override?.maxBytes ?? config?.maxBytes ?? DEFAULT_TOOL_OUTPUT_LIMITS.maxBytes,
    mode: override?.mode ?? config?.mode ?? DEFAULT_TOOL_OUTPUT_LIMITS.mode
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'unknown'
}

function splitLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function countLines(value: string): number {
  if (!value) return 0
  let lines = 1
  for (let index = value.indexOf('\n'); index !== -1; index = value.indexOf('\n', index + 1)) {
    lines++
  }
  return lines
}

function utf8Head(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maxBytes) return value
  let end = Math.max(0, maxBytes)
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
  return buffer.subarray(0, end).toString('utf8')
}

function utf8Tail(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maxBytes) return value
  let start = Math.max(0, buffer.length - maxBytes)
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++
  return buffer.subarray(start).toString('utf8')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${bytes} B`
}

export class ToolOutputStore {
  private readonly root: string
  private lastCleanup = 0

  constructor(userDataPath: string) {
    this.root = path.join(userDataPath, 'agent', 'tool-output')
  }

  async pathFor(sessionId: string, toolCallId: string): Promise<string> {
    void this.cleanupIfDue()
    const directory = path.join(this.root, safeSegment(sessionId))
    await fs.mkdir(directory, { recursive: true })
    return path.join(directory, `${safeSegment(toolCallId)}.log`)
  }

  async bound(
    sessionId: string,
    toolCallId: string,
    output: string,
    limits: ToolOutputLimitsResolved = DEFAULT_TOOL_OUTPUT_LIMITS
  ): Promise<BoundedToolOutput> {
    void this.cleanupIfDue()
    const lines = splitLines(output)
    if (lines.length <= limits.maxLines && Buffer.byteLength(output, 'utf8') <= limits.maxBytes) {
      return { output }
    }

    const file = await this.write(sessionId, toolCallId, output)
    const head = limits.mode !== 'tail'
    const lineLimited = lines.length > limits.maxLines
    const selected = lineLimited
      ? head
        ? lines.slice(0, limits.maxLines)
        : lines.slice(-limits.maxLines)
      : lines
    let body = selected.join('\n')
    let byteCut = false
    if (Buffer.byteLength(body, 'utf8') > limits.maxBytes) {
      body = head ? utf8Head(body, limits.maxBytes) : utf8Tail(body, limits.maxBytes)
      byteCut = true
    }

    const shown = countLines(body)
    const range = `showing ${head ? 'first' : 'last'} ${shown} of ${lines.length} lines${
      byteCut ? ` (${formatBytes(limits.maxBytes)} limit reached)` : ''
    }`
    const marker =
      `[output truncated: ${range}; full output saved to ${file}. ` +
      'Use the read tool with offset/limit to inspect the full output.]'
    return { output: `${body}${body ? '\n' : ''}${marker}`, path: file }
  }

  /** Remove stored outputs older than the retention window; returns the removed file count. */
  async cleanup(options: { now?: number; maxAgeMs?: number } = {}): Promise<number> {
    const now = options.now ?? Date.now()
    const maxAgeMs = options.maxAgeMs ?? TOOL_OUTPUT_RETENTION_MS
    let removed = 0
    const directories = await fs.readdir(this.root, { withFileTypes: true }).catch(() => [])
    for (const entry of directories) {
      if (!entry.isDirectory()) continue
      const directory = path.join(this.root, entry.name)
      const files = await fs.readdir(directory).catch(() => [])
      for (const file of files) {
        if (!STORED_FILE.test(file)) continue
        const target = path.join(directory, file)
        const stat = await fs.stat(target).catch(() => null)
        if (!stat?.isFile() || now - stat.mtimeMs < maxAgeMs) continue
        try {
          await fs.rm(target, { force: true })
          removed++
        } catch {
          /* best effort */
        }
      }
      const remaining = await fs.readdir(directory).catch(() => null)
      if (remaining && remaining.length === 0) {
        await fs.rmdir(directory).catch(() => undefined)
      }
    }
    return removed
  }

  private async write(sessionId: string, toolCallId: string, output: string): Promise<string> {
    const directory = path.join(this.root, safeSegment(sessionId))
    await fs.mkdir(directory, { recursive: true })
    const file = path.join(directory, `${safeSegment(toolCallId)}.txt`)
    await fs.writeFile(file, output, 'utf8')
    return file
  }

  private cleanupIfDue(): Promise<void> {
    const now = Date.now()
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return Promise.resolve()
    this.lastCleanup = now
    return this.cleanup({ now })
      .then(() => undefined)
      .catch(() => undefined)
  }
}

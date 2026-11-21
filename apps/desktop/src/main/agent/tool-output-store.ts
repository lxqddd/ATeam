import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MODEL_OUTPUT_LIMIT = 30_000

export interface BoundedToolOutput {
  output: string
  path?: string
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'unknown'
}

export class ToolOutputStore {
  private readonly root: string

  constructor(userDataPath: string) {
    this.root = path.join(userDataPath, 'agent', 'tool-output')
  }

  async pathFor(sessionId: string, toolCallId: string): Promise<string> {
    const directory = path.join(this.root, safeSegment(sessionId))
    await fs.mkdir(directory, { recursive: true })
    return path.join(directory, `${safeSegment(toolCallId)}.log`)
  }

  async bound(
    sessionId: string,
    toolCallId: string,
    output: string,
    limit = DEFAULT_MODEL_OUTPUT_LIMIT
  ): Promise<BoundedToolOutput> {
    if (output.length <= limit) return { output }

    const directory = path.join(this.root, safeSegment(sessionId))
    await fs.mkdir(directory, { recursive: true })
    const file = path.join(directory, `${safeSegment(toolCallId)}.txt`)
    await fs.writeFile(file, output, 'utf8')

    return {
      output: `${output.slice(0, limit)}\n[output truncated at ${limit} characters; full output: ${file}]`,
      path: file
    }
  }
}

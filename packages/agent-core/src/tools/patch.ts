import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type Tool } from 'ai'
import { z } from 'zod'
import {
  afterWrite,
  ensureExternalAccess,
  escapesWorkspace,
  readFileText,
  resolvePath,
  safeError,
  withNotes
} from './helpers'
import type { ToolContext } from './types'

interface PatchHunk {
  oldText: string
  newText: string
}

interface PatchOperation {
  kind: 'add' | 'update' | 'delete'
  path: string
  content?: string
  hunks?: PatchHunk[]
}

function parsePatch(patchText: string): PatchOperation[] {
  const lines = patchText.split(/\r?\n/)
  if (
    lines[0]?.trim() !== '*** Begin Patch' ||
    lines[lines.length - 1]?.trim() !== '*** End Patch'
  ) {
    throw new Error('Invalid patch: missing Begin/End markers')
  }

  const operations: PatchOperation[] = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (!header) throw new Error(`Invalid patch line: ${line}`)
    const kind = header[1].toLowerCase() as PatchOperation['kind']
    const filePath = header[2]
    index += 1

    if (kind === 'add') {
      const content: string[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) throw new Error('Invalid add file line')
        content.push(lines[index].slice(1))
        index += 1
      }
      operations.push({ kind, path: filePath, content: content.join('\n') })
      continue
    }

    if (kind === 'delete') {
      operations.push({ kind, path: filePath })
      continue
    }

    const hunks: PatchHunk[] = []
    while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
      if (!lines[index].startsWith('@@')) throw new Error('Invalid update hunk header')
      index += 1
      const oldLines: string[] = []
      const newLines: string[] = []
      while (
        index < lines.length - 1 &&
        !lines[index].startsWith('@@') &&
        !lines[index].startsWith('*** ')
      ) {
        const hunkLine = lines[index]
        const marker = hunkLine[0] ?? ' '
        const text = hunkLine.slice(1)
        if (marker === ' ') {
          oldLines.push(text)
          newLines.push(text)
        } else if (marker === '-') {
          oldLines.push(text)
        } else if (marker === '+') {
          newLines.push(text)
        } else {
          throw new Error(`Invalid update line: ${hunkLine}`)
        }
        index += 1
      }
      hunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n') })
    }
    operations.push({ kind, path: filePath, hunks })
  }

  if (operations.length === 0) throw new Error('Patch contains no file operations')
  return operations
}

export function createPatchTool(context: ToolContext): Tool {
  return tool({
    description:
      'Apply one patch that can add, update, move, or delete several files. Requires approval for each file.',
    inputSchema: z.object({
      patchText: z
        .string()
        .describe('Patch text using *** Add File, *** Update File and *** Delete File sections')
    }),
    execute: async ({ patchText }, options) => {
      try {
        const operations = parsePatch(patchText)
        for (const operation of operations) {
          if (!(await ensureExternalAccess(context, operation.path, 'patch', options.toolCallId))) {
            return 'Permission denied; the patch was not applied.'
          }
          const allowed = await context.askPermission(
            'edit',
            operation.path,
            'patch',
            options.toolCallId
          )
          if (!allowed) return 'Permission denied; the patch was not applied.'
        }

        const preparedUpdates = new Map<number, string>()
        const preparedFiles = new Map<string, string>()
        for (const [index, operation] of operations.entries()) {
          if (operation.kind !== 'update') continue
          const external = escapesWorkspace(context.workspace, operation.path)
          const filePath = await resolvePath(context.workspace, operation.path, false, external)
          let text = preparedFiles.get(filePath) ?? (await readFileText(filePath))
          for (const hunk of operation.hunks ?? []) {
            if (!text.includes(hunk.oldText)) {
              return `Error: old text not found in ${operation.path}`
            }
            text = text.replace(hunk.oldText, () => hunk.newText)
          }
          preparedFiles.set(filePath, text)
          preparedUpdates.set(index, text)
        }

        const summary: string[] = []
        const changed: string[] = []
        for (const [index, operation] of operations.entries()) {
          const external = escapesWorkspace(context.workspace, operation.path)
          if (operation.kind === 'add') {
            const filePath = await resolvePath(context.workspace, operation.path, true, external)
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, operation.content ?? '', 'utf8')
            summary.push(`Added ${operation.path}`)
            changed.push(filePath)
            continue
          }
          if (operation.kind === 'delete') {
            const filePath = await resolvePath(context.workspace, operation.path, false, external)
            await fs.rm(filePath, { force: true })
            summary.push(`Deleted ${operation.path}`)
            continue
          }
          const filePath = await resolvePath(context.workspace, operation.path, false, external)
          const text = preparedUpdates.get(index)
          if (text === undefined)
            return `Error: patch update could not be prepared for ${operation.path}`
          await fs.writeFile(filePath, text, 'utf8')
          summary.push(`Updated ${operation.path}`)
          changed.push(filePath)
        }
        return withNotes(summary.join('\n'), await afterWrite(context, [...new Set(changed)]))
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

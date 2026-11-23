import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { extractPdfText } from '../attachments'
import {
  afterWrite,
  ensureExternalAccess,
  escapesWorkspace,
  listDirectory,
  readFileText,
  resolvePath,
  safeError,
  truncate,
  withNotes
} from './helpers'
import { IMAGE_MIME, MAX_READ_IMAGE_BYTES, MAX_READ_LINES, MAX_READ_PDF_BYTES } from './types'
import type { ToolContext } from './types'

export function createReadTool(context: ToolContext): Tool {
  return tool({
    description:
      'Read a file inside the workspace. Text files return numbered lines (use offset/limit); images are returned as image content and PDFs as extracted text.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the workspace'),
      offset: z.number().int().min(1).optional().describe('First line (1-based)'),
      limit: z.number().int().min(1).max(MAX_READ_LINES).optional().describe('Maximum lines')
    }),
    execute: async ({ path: inputPath, offset = 1, limit = MAX_READ_LINES }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the file was not read.'
        }
        const allowed = await context.askPermission('read', inputPath, 'read', options.toolCallId)
        if (!allowed) return 'Permission denied; the file was not read.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        const extension = path.extname(filePath).toLowerCase()
        const imageMime = IMAGE_MIME[extension]
        if (imageMime) {
          const data = await fs.readFile(filePath)
          if (data.byteLength > MAX_READ_IMAGE_BYTES) return 'Error: image exceeds 5 MB'
          return {
            summary: `Image: ${inputPath} (${data.byteLength} bytes, ${imageMime})`,
            image: { mimeType: imageMime, data: data.toString('base64') }
          }
        }
        if (extension === '.pdf') {
          const data = await fs.readFile(filePath)
          if (data.byteLength > MAX_READ_PDF_BYTES) return 'Error: PDF exceeds 10 MB'
          const extracted = await extractPdfText(new Uint8Array(data))
          if (!extracted)
            return 'Error: the PDF has no extractable text; attach it in the composer.'
          return truncate(`PDF: ${inputPath}\n\`\`\`\n${extracted}\n\`\`\``)
        }
        const text = await readFileText(filePath)
        const lines = text.split(/\r?\n/)
        const start = Math.max(0, offset - 1)
        const slice = lines.slice(start, start + limit)
        const numbered = slice
          .map((line, index) => `${String(start + index + 1).padStart(5)}  ${line}`)
          .join('\n')
        const suffix =
          start + limit < lines.length
            ? `\n[showing lines ${offset}-${start + slice.length} of ${lines.length}]`
            : ''
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        const body = truncate(`${numbered}${suffix}${nested ? `\n\n${nested}` : ''}`)
        const diagnostics = (await context.diagnoseFiles?.([filePath])) ?? ''
        return withNotes(body, diagnostics)
      } catch (error) {
        return safeError(error)
      }
    },
    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'image' in output) {
        const value = output as { summary: string; image: { mimeType: string; data: string } }
        return {
          type: 'content',
          value: [
            { type: 'text', text: value.summary },
            { type: 'image-data', data: value.image.data, mediaType: value.image.mimeType }
          ]
        }
      }
      return { type: 'text', value: typeof output === 'string' ? output : JSON.stringify(output) }
    }
  })
}

export function createListTool(context: ToolContext): Tool {
  return tool({
    description: 'List files and directories inside the workspace.',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory relative to the workspace'),
      depth: z.number().int().min(1).max(4).optional().describe('Recursion depth')
    }),
    execute: async ({ path: inputPath = '.', depth = 1 }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'list', options.toolCallId))
        ) {
          return 'Permission denied; the directory was not listed.'
        }
        const allowed = await context.askPermission('list', inputPath, 'list', options.toolCallId)
        if (!allowed) return 'Permission denied; the directory was not listed.'
        const root = await resolvePath(context.workspace, inputPath, false, external)
        const base = path.resolve(context.workspace)
        const entries: string[] = []
        await listDirectory(root, base, 1, depth, entries)
        const listed = entries.join('\n') || '(empty directory)'
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        return truncate(`${listed}${nested ? `\n\n${nested}` : ''}`)
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createWriteTool(context: ToolContext): Tool {
  return tool({
    description: 'Create or overwrite a text file inside the workspace. Requires approval.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the workspace'),
      content: z.string().describe('File content')
    }),
    execute: async ({ path: inputPath, content }, options) => {
      try {
        if (Buffer.byteLength(content, 'utf8') > 1_000_000) {
          return 'Error: file content exceeds 1 MB'
        }
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'write', options.toolCallId))
        ) {
          return 'Permission denied; the file was not written.'
        }
        const allowed = await context.askPermission('write', inputPath, 'write', options.toolCallId)
        if (!allowed) return 'Permission denied; the file was not written.'
        const filePath = await resolvePath(context.workspace, inputPath, true, external)
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf8')
        return withNotes(
          `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${inputPath}`,
          await afterWrite(context, [filePath])
        )
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createEditTool(context: ToolContext): Tool {
  return tool({
    description:
      'Edit a text file by replacing an exact string. Requires approval. Fails if the old text is not unique unless replaceAll is true.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the workspace'),
      oldText: z.string().min(1).describe('Exact text to replace'),
      newText: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional()
    }),
    execute: async ({ path: inputPath, oldText, newText, replaceAll = false }, options) => {
      try {
        if (oldText.length > 200_000) return 'Error: oldText is too large'
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'edit', options.toolCallId))
        ) {
          return 'Permission denied; the file was not edited.'
        }
        const allowed = await context.askPermission('edit', inputPath, 'edit', options.toolCallId)
        if (!allowed) return 'Permission denied; the file was not edited.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        const text = await readFileText(filePath)
        const occurrences = text.split(oldText).length - 1
        if (occurrences === 0) return 'Error: oldText was not found'
        if (occurrences > 1 && !replaceAll) {
          return `Error: oldText occurs ${occurrences} times; pass replaceAll or use a unique match`
        }
        const next = replaceAll
          ? text.split(oldText).join(newText)
          : text.replace(oldText, () => newText)
        await fs.writeFile(filePath, next, 'utf8')
        return withNotes(
          `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${inputPath}`,
          await afterWrite(context, [filePath])
        )
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

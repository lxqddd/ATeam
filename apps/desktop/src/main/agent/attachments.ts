import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { extractText } from 'unpdf'
import type { AttachmentKind, MessageAttachment } from '@ateam/shared'

export const MAX_TEXT_BYTES = 200_000
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 10 * 1024 * 1024

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.log',
  '.xml',
  '.ini',
  '.env',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.html',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.sh',
  '.sql'
])

export function classifyAttachment(name: string, mimeType: string): AttachmentKind | null {
  if (mimeType.startsWith('image/')) {
    return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)
      ? 'image'
      : null
  }
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('text/')) return 'text'
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) ? 'text' : null
}

export function maxAttachmentBytes(kind: AttachmentKind): number {
  if (kind === 'image') return MAX_IMAGE_BYTES
  if (kind === 'pdf') return MAX_PDF_BYTES
  return MAX_TEXT_BYTES
}

export function sanitizeFileName(name: string): string {
  const base = path
    .basename(name)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  return base.slice(0, 120) || 'file'
}

export function attachmentDirectory(userDataPath: string, sessionId: string): string {
  return path.join(userDataPath, 'agent', 'attachments', sessionId)
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Invalid session id')
}

export async function saveAttachment(
  userDataPath: string,
  sessionId: string,
  input: { name: string; mimeType: string; data: Uint8Array }
): Promise<MessageAttachment> {
  assertSessionId(sessionId)
  const name = sanitizeFileName(input.name)
  const kind = classifyAttachment(name, input.mimeType)
  if (!kind) throw new Error(`Unsupported attachment type: ${input.mimeType || name}`)

  const size = input.data.byteLength
  const limit = maxAttachmentBytes(kind)
  if (size > limit) {
    throw new Error(
      `Attachment is too large (max ${kind === 'text' ? '200 KB' : `${limit / (1024 * 1024)} MB`})`
    )
  }
  if (kind === 'text') {
    const text = new TextDecoder('utf-8').decode(input.data)
    if (text.includes('\u0000')) throw new Error('Binary files are not supported')
  }

  const directory = attachmentDirectory(userDataPath, sessionId)
  await fs.mkdir(directory, { recursive: true })
  const id = randomUUID()
  const filePath = path.join(directory, `${id}-${name}`)
  await fs.writeFile(filePath, input.data)
  return {
    id,
    name,
    mimeType: input.mimeType || 'application/octet-stream',
    size,
    kind,
    path: filePath
  }
}

export async function readAttachment(attachment: MessageAttachment): Promise<Buffer> {
  return fs.readFile(attachment.path)
}

export async function readTextAttachment(attachment: MessageAttachment): Promise<string> {
  return fs.readFile(attachment.path, 'utf8')
}

export async function removeAttachment(
  userDataPath: string,
  sessionId: string,
  attachmentId: string
): Promise<void> {
  assertSessionId(sessionId)
  const directory = attachmentDirectory(userDataPath, sessionId)
  const files = await fs.readdir(directory).catch(() => [] as string[])
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${attachmentId}-`))
      .map((file) => fs.rm(path.join(directory, file), { force: true }))
  )
}

export async function removeSessionAttachments(
  userDataPath: string,
  sessionId: string
): Promise<void> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return
  await fs.rm(attachmentDirectory(userDataPath, sessionId), { recursive: true, force: true })
}

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export const MAX_PDF_TEXT_CHARS = 100_000

/** Best-effort text extraction for PDF attachments; empty when the file cannot be parsed. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  try {
    const result = await extractText(data, { mergePages: true })
    const text = Array.isArray(result.text) ? result.text.join('\n\n') : result.text
    return text.trim().slice(0, MAX_PDF_TEXT_CHARS)
  } catch {
    return ''
  }
}

export async function attachmentDataUrl(
  userDataPath: string,
  sessionId: string,
  attachmentPath: string
): Promise<string | null> {
  assertSessionId(sessionId)
  const directory = path.resolve(attachmentDirectory(userDataPath, sessionId))
  const resolved = path.resolve(attachmentPath)
  if (!resolved.startsWith(`${directory}${path.sep}`)) return null
  const mimeType = IMAGE_MIME[path.extname(resolved).toLowerCase()]
  if (!mimeType) return null
  const stats = await fs.stat(resolved).catch(() => null)
  if (!stats?.isFile() || stats.size > MAX_PREVIEW_BYTES) return null
  const data = await fs.readFile(resolved).catch(() => null)
  if (!data) return null
  return `data:${mimeType};base64,${data.toString('base64')}`
}

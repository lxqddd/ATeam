import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  attachmentDataUrl,
  attachmentDirectory,
  classifyAttachment,
  extractPdfText,
  isPathInsideDirectory,
  maxAttachmentBytes,
  readAttachment,
  readTextAttachment,
  removeAttachment,
  removeSessionAttachments,
  saveAttachment
} from './attachments'

let directory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-attach-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('classifyAttachment', () => {
  it('classifies images, PDFs and text', () => {
    expect(classifyAttachment('a.png', 'image/png')).toBe('image')
    expect(classifyAttachment('a.pdf', 'application/pdf')).toBe('pdf')
    expect(classifyAttachment('notes.txt', 'text/plain')).toBe('text')
    expect(classifyAttachment('README.md', 'application/octet-stream')).toBe('text')
    expect(classifyAttachment('app.ts', '')).toBe('text')
  })

  it('rejects unsupported types', () => {
    expect(classifyAttachment('archive.zip', 'application/zip')).toBeNull()
    expect(classifyAttachment('video.mp4', 'video/mp4')).toBeNull()
    expect(classifyAttachment('image.bmp', 'image/bmp')).toBeNull()
  })

  it('exposes size limits', () => {
    expect(maxAttachmentBytes('text')).toBe(MAX_TEXT_BYTES)
    expect(maxAttachmentBytes('image')).toBe(MAX_IMAGE_BYTES)
    expect(maxAttachmentBytes('pdf')).toBe(MAX_PDF_BYTES)
  })
})

describe('isPathInsideDirectory', () => {
  const sessionId = 'session-1'

  it('accepts files inside the attachment directory', async () => {
    const target = path.join(attachmentDirectory(directory, sessionId), 'note.txt')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, 'hello')

    await expect(isPathInsideDirectory(path.dirname(target), target)).resolves.toBe(true)
  })

  it('rejects traversal and symlink escapes', async () => {
    const attachmentDir = attachmentDirectory(directory, sessionId)
    const outside = path.join(directory, 'secret.txt')
    await fs.writeFile(outside, 'secret')
    const traversal = path.join(attachmentDir, '..', '..', '..', 'secret.txt')

    await expect(isPathInsideDirectory(attachmentDir, traversal)).resolves.toBe(false)

    await fs.mkdir(attachmentDir, { recursive: true })
    const link = path.join(attachmentDir, 'link.txt')
    await fs.symlink(outside, link)
    await expect(isPathInsideDirectory(attachmentDir, link)).resolves.toBe(false)
  })
})

describe('saveAttachment', () => {
  const sessionId = 'session-1'

  it('stores text files with metadata', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello world', 'utf8')
    })

    expect(attachment).toMatchObject({
      name: 'notes.txt',
      mimeType: 'text/plain',
      kind: 'text',
      size: 11
    })
    expect(attachment.path.startsWith(attachmentDirectory(directory, sessionId))).toBe(true)
    await expect(fs.readFile(attachment.path, 'utf8')).resolves.toBe('hello world')
    await expect(readTextAttachment(attachment)).resolves.toBe('hello world')
  })

  it('stores image and PDF bytes', async () => {
    const image = await saveAttachment(directory, sessionId, {
      name: 'shot.png',
      mimeType: 'image/png',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47])
    })
    const pdf = await saveAttachment(directory, sessionId, {
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('%PDF-1.4')
    })

    expect(image.kind).toBe('image')
    expect(pdf.kind).toBe('pdf')
    expect((await readAttachment(image)).length).toBe(4)
  })

  it('rejects oversized and unsupported files', async () => {
    await expect(
      saveAttachment(directory, sessionId, {
        name: 'big.txt',
        mimeType: 'text/plain',
        data: Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61)
      })
    ).rejects.toThrow('too large')

    await expect(
      saveAttachment(directory, sessionId, {
        name: 'archive.zip',
        mimeType: 'application/zip',
        data: Buffer.from('zip')
      })
    ).rejects.toThrow('Unsupported attachment type')
  })

  it('rejects binary text content', async () => {
    await expect(
      saveAttachment(directory, sessionId, {
        name: 'data.txt',
        mimeType: 'text/plain',
        data: Buffer.from([0x61, 0x00, 0x62])
      })
    ).rejects.toThrow('Binary files are not supported')
  })

  it('sanitizes file names and validates session ids', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: '../../evil.txt',
      mimeType: 'text/plain',
      data: Buffer.from('x')
    })
    expect(attachment.name).toBe('evil.txt')
    expect(path.dirname(attachment.path)).toBe(attachmentDirectory(directory, sessionId))

    await expect(
      saveAttachment(directory, '../escape', {
        name: 'a.txt',
        mimeType: 'text/plain',
        data: Buffer.from('x')
      })
    ).rejects.toThrow('Invalid session id')
  })

  it('removes individual attachments and whole sessions', async () => {
    const first = await saveAttachment(directory, sessionId, {
      name: 'a.txt',
      mimeType: 'text/plain',
      data: Buffer.from('a')
    })
    const second = await saveAttachment(directory, sessionId, {
      name: 'b.txt',
      mimeType: 'text/plain',
      data: Buffer.from('b')
    })

    await removeAttachment(directory, sessionId, first.id)
    await expect(fs.stat(first.path)).rejects.toThrow()
    await expect(fs.stat(second.path)).resolves.toBeDefined()

    await removeSessionAttachments(directory, sessionId)
    await expect(fs.stat(attachmentDirectory(directory, sessionId))).rejects.toThrow()
  })
})

function makePdf(text: string): Uint8Array {
  const objects: Array<string | null> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('extractPdfText', () => {
  it('extracts text from a PDF document', async () => {
    await expect(extractPdfText(makePdf('Hello PDF world'))).resolves.toContain('Hello PDF world')
  })

  it('returns an empty string for unreadable documents', async () => {
    await expect(extractPdfText(new Uint8Array([1, 2, 3]))).resolves.toBe('')
  })
})

describe('attachmentDataUrl', () => {
  const sessionId = 'session-1'

  it('returns a data URL for stored images', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: 'pixel.png',
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3])
    })

    await expect(attachmentDataUrl(directory, sessionId, attachment.path)).resolves.toBe(
      'data:image/png;base64,AQID'
    )
  })

  it('rejects paths outside the session attachment directory', async () => {
    await expect(
      attachmentDataUrl(directory, sessionId, path.join(directory, '..', 'secret.png'))
    ).resolves.toBeNull()
  })

  it('returns null for missing files', async () => {
    await expect(
      attachmentDataUrl(
        directory,
        sessionId,
        path.join(attachmentDirectory(directory, sessionId), 'missing.png')
      )
    ).resolves.toBeNull()
  })
})

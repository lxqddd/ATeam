import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  attachmentDirectory,
  classifyAttachment,
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

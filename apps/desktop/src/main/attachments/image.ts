import { nativeImage } from 'electron'

export const MAX_IMAGE_EDGE = 1568

export interface ImageAttachmentInput {
  name: string
  mimeType: string
  data: Uint8Array
}

export function shouldResizeImage(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE
): boolean {
  return width > maxEdge || height > maxEdge
}

export function normalizeImageAttachment(input: ImageAttachmentInput): ImageAttachmentInput {
  if (!input.mimeType.startsWith('image/')) return input

  const image = nativeImage.createFromBuffer(Buffer.from(input.data))
  if (image.isEmpty()) return input

  const { width, height } = image.getSize()
  if (!shouldResizeImage(width, height)) return input

  const scale = MAX_IMAGE_EDGE / Math.max(width, height)
  const resized = image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  })
  const baseName = input.name.replace(/\.[^.]+$/, '') || 'image'
  return {
    name: `${baseName}.png`,
    mimeType: 'image/png',
    data: resized.toPNG()
  }
}

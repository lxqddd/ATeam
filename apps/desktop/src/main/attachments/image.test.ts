import { describe, expect, it, vi } from 'vitest'
import { MAX_IMAGE_EDGE, normalizeImageAttachment, shouldResizeImage } from './image'

const nativeImage = vi.hoisted(() => ({ createFromBuffer: vi.fn() }))

vi.mock('electron', () => ({ nativeImage }))

function fakeImage(
  width: number,
  height: number
): {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  resize: ReturnType<typeof vi.fn>
} {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: vi.fn(() => ({ toPNG: () => Buffer.from('resized') }))
  }
}

describe('shouldResizeImage', () => {
  it('only resizes when an edge exceeds the limit', () => {
    expect(shouldResizeImage(800, 600)).toBe(false)
    expect(shouldResizeImage(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE)).toBe(false)
    expect(shouldResizeImage(2000, 1000)).toBe(true)
    expect(shouldResizeImage(1000, 3000)).toBe(true)
  })
})

describe('normalizeImageAttachment', () => {
  it('passes through non-image and small images', () => {
    const text = { name: 'a.txt', mimeType: 'text/plain', data: Buffer.from('x') }
    expect(normalizeImageAttachment(text)).toBe(text)

    nativeImage.createFromBuffer.mockReturnValue(fakeImage(800, 600))
    const small = { name: 'a.png', mimeType: 'image/png', data: Buffer.from('png') }
    expect(normalizeImageAttachment(small)).toBe(small)
  })

  it('resizes large images and converts them to PNG', () => {
    const image = fakeImage(3136, 1568)
    nativeImage.createFromBuffer.mockReturnValue(image)

    const result = normalizeImageAttachment({
      name: 'shot.jpg',
      mimeType: 'image/jpeg',
      data: Buffer.from('jpeg')
    })

    expect(image.resize).toHaveBeenCalledWith({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE / 2,
      quality: 'good'
    })
    expect(result.mimeType).toBe('image/png')
    expect(result.name).toBe('shot.png')
    expect(result.data.toString()).toBe('resized')
  })

  it('keeps the original bytes when the image cannot be decoded', () => {
    nativeImage.createFromBuffer.mockReturnValue({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: vi.fn()
    })
    const input = { name: 'broken.png', mimeType: 'image/png', data: Buffer.from('bad') }

    expect(normalizeImageAttachment(input)).toBe(input)
  })
})

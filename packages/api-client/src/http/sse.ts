import { HttpClient } from './client'
import { ApiError } from './error'

export interface SseHandlers {
  onMessage: (event: SseMessage) => void
  onError?: (error: Error) => void
  onOpen?: () => void
  onClose?: () => void
}

export interface SseMessage {
  event: string
  data: string
  id: string
  retry?: number
}

export interface SseHandle {
  close: () => void
  readonly closed: boolean
}

/**
 * Server-Sent Events cannot go through axios: its XHR adapter buffers the
 * whole response. This uses fetch + ReadableStream and parses the SSE wire
 * format incrementally.
 */
export function openSse(path: string, handlers: SseHandlers): SseHandle {
  const url = HttpClient.resolveUrl(path)
  const controller = new AbortController()
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    controller.abort()
    handlers.onClose?.()
  }

  void (async () => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok || !response.body) {
        throw new ApiError(
          `SSE request failed: HTTP ${response.status}`,
          response.status,
          await response.text().catch(() => ''),
        )
      }

      handlers.onOpen?.()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = findEventBoundary(buffer)
        while (boundary >= 0) {
          const raw = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + boundaryLength(buffer, boundary))
          const message = parseSseBlock(raw)
          if (message) {
            handlers.onMessage(message)
          }
          boundary = findEventBoundary(buffer)
        }
      }
      close()
    } catch (error) {
      if (closed || (error instanceof DOMException && error.name === 'AbortError')) {
        return
      }
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      close()
    }
  })()

  return {
    close,
    get closed() {
      return closed
    },
  }
}

function findEventBoundary(buffer: string): number {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf < 0) return lf
  if (lf < 0) return crlf
  return Math.min(crlf, lf)
}

function boundaryLength(buffer: string, index: number): number {
  return buffer.startsWith('\r\n\r\n', index) ? 4 : 2
}

function parseSseBlock(block: string): SseMessage | null {
  const message: SseMessage = { event: 'message', data: '', id: '' }
  const dataLines: string[] = []
  let hasField = false

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    hasField = true
    switch (field) {
      case 'event':
        message.event = value
        break
      case 'data':
        dataLines.push(value)
        break
      case 'id':
        message.id = value
        break
      case 'retry': {
        const retry = Number(value)
        if (Number.isFinite(retry)) message.retry = retry
        break
      }
      default:
        break
    }
  }

  if (!hasField) return null
  message.data = dataLines.join('\n')
  return message
}

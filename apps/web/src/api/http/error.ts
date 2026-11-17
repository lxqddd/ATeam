export class ApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export function normalizeBody(data: unknown): string {
  if (data == null) {
    return ''
  }
  if (typeof data === 'string') {
    return data
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

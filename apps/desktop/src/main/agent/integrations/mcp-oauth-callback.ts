import { createServer, type Server } from 'node:http'

export const DEFAULT_OAUTH_CALLBACK_PORT = 19_876
export const OAUTH_CALLBACK_PATH = '/mcp/oauth/callback'
const CALLBACK_TIMEOUT_MS = 5 * 60_000

const SUCCESS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>ATeam authorized</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center;">
<h1>Authorization complete</h1><p>You can close this tab and return to ATeam.</p></body></html>`

function errorPage(message: string): string {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html><html><head><meta charset="utf-8"><title>ATeam authorization failed</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center;">
<h1>Authorization failed</h1><p>${escaped}</p></body></html>`
}

interface PendingCallback {
  state: string
  resolve: (code: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class McpOAuthCallbackServer {
  private server: Server | null = null
  private pending: PendingCallback | null = null
  private port = 0
  private readonly path: string
  private readonly preferredPort: number | null
  private readonly timeoutMs: number

  constructor(options: { port?: number | null; path?: string; timeoutMs?: number } = {}) {
    this.preferredPort = options.port ?? null
    this.path = options.path ?? OAUTH_CALLBACK_PATH
    this.timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS
  }

  get redirectUri(): string {
    return `http://127.0.0.1:${this.port}${this.path}`
  }

  async start(): Promise<string> {
    if (this.server) return this.redirectUri
    const server = createServer((request, response) => {
      this.handleRequest(request.url ?? '/', response)
    })
    const listen = (port: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException): void => {
          server.removeListener('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })

    const preferred = this.preferredPort ?? DEFAULT_OAUTH_CALLBACK_PORT
    try {
      await listen(preferred)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || this.preferredPort) {
        server.close()
        throw error
      }
      await listen(0)
    }
    const address = server.address()
    this.port = typeof address === 'object' && address ? address.port : preferred
    this.server = server
    return this.redirectUri
  }

  waitForCode(state: string): Promise<string> {
    if (this.pending) {
      return Promise.reject(new Error('Another OAuth authorization is already in progress'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error('OAuth callback timed out'))
        void this.close()
      }, this.timeoutMs)
      this.pending = { state, resolve, reject, timer }
    })
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    const pending = this.pending
    this.pending = null
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('OAuth callback server stopped'))
    }
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private handleRequest(url: string, response: import('node:http').ServerResponse): void {
    const parsed = new URL(url, `http://127.0.0.1:${this.port || 80}`)
    if (parsed.pathname !== this.path) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }
    const state = parsed.searchParams.get('state')
    const code = parsed.searchParams.get('code')
    const error = parsed.searchParams.get('error')
    const description = parsed.searchParams.get('error_description')

    if (!state) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(errorPage('Missing state parameter'))
      return
    }
    const pending = this.pending
    if (!pending || pending.state !== state) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(errorPage('Invalid or expired state parameter'))
      return
    }
    this.pending = null
    clearTimeout(pending.timer)

    if (error) {
      const message = description || error
      pending.reject(new Error(message))
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(errorPage(message))
      void this.close()
      return
    }
    if (!code) {
      pending.reject(new Error('No authorization code provided'))
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(errorPage('No authorization code provided'))
      void this.close()
      return
    }
    pending.resolve(code)
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(SUCCESS_PAGE)
    void this.close()
  }
}

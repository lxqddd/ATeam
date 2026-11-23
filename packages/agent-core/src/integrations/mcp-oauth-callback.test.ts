import { describe, expect, it } from 'vitest'
import { McpOAuthCallbackServer } from './mcp-oauth-callback'

function withState(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

describe('McpOAuthCallbackServer', () => {
  it('resolves the authorization code for a matching state', async () => {
    const server = new McpOAuthCallbackServer({ port: 0 })
    const redirectUri = await server.start()
    const pending = server.waitForCode('state-1')

    const response = await fetch(withState(redirectUri, { code: 'code-1', state: 'state-1' }))

    expect(response.status).toBe(200)
    await expect(pending).resolves.toBe('code-1')
    await server.close()
  })

  it('rejects provider errors', async () => {
    const server = new McpOAuthCallbackServer({ port: 0 })
    const redirectUri = await server.start()
    const pending = server.waitForCode('state-1')
    const expectation = expect(pending).rejects.toThrow('user cancelled')

    await fetch(
      withState(redirectUri, {
        error: 'access_denied',
        error_description: 'user cancelled',
        state: 'state-1'
      })
    )

    await expectation
    await server.close()
  })

  it('rejects mismatched state without resolving', async () => {
    const server = new McpOAuthCallbackServer({ port: 0 })
    const redirectUri = await server.start()
    const pending = server.waitForCode('state-1')
    const expectation = expect(pending).rejects.toThrow('callback server stopped')

    const response = await fetch(withState(redirectUri, { code: 'code-1', state: 'state-2' }))

    expect(response.status).toBe(400)
    await server.close()
    await expectation
  })
})

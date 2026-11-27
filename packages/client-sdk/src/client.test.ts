import { describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope } from '@ateam/shared'
import { AteamApiError, AteamClient } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('AteamClient', () => {
  it('sends authorization and parses JSON responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' })
      return jsonResponse([{ id: 's1' }])
    })
    const client = new AteamClient({
      baseUrl: 'http://api.test',
      token: 'secret',
      fetch: fetchMock
    })

    await expect(client.listSessions()).resolves.toEqual([{ id: 's1' }])
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/sessions', expect.anything())
  })

  it('creates sessions and sends messages with JSON bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body))
      if (url.endsWith('/sessions') && init?.method === 'POST') {
        expect(body).toMatchObject({ title: 'API' })
        return jsonResponse({ id: 's1', title: 'API' }, 201)
      }
      expect(url).toBe('http://api.test/sessions/s1/messages')
      expect(body).toEqual({ text: 'hello', wait: true })
      return jsonResponse({ sessionId: 's1', status: 'completed', messages: {} })
    })
    const client = new AteamClient({ baseUrl: 'http://api.test', fetch: fetchMock })

    await expect(client.createSession({ title: 'API' })).resolves.toMatchObject({ id: 's1' })
    await expect(client.sendMessage('s1', { text: 'hello', wait: true })).resolves.toMatchObject({
      status: 'completed'
    })
  })

  it('exposes workspace file routes with query parameters', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/files/content')) {
        return jsonResponse({
          sessionId: 's1',
          path: 'src/a.ts',
          content: 'x',
          size: 1,
          truncated: false
        })
      }
      if (url.includes('/files/find')) {
        return jsonResponse({
          sessionId: 's1',
          root: 'src',
          pattern: '*.ts',
          matches: ['src/a.ts'],
          truncated: false
        })
      }
      if (url.includes('/files/grep')) {
        return jsonResponse({
          sessionId: 's1',
          root: '',
          pattern: 'todo',
          matches: [],
          truncated: false
        })
      }
      return jsonResponse({ sessionId: 's1', path: '', entries: [], truncated: false })
    })
    const client = new AteamClient({ baseUrl: 'http://api.test', fetch: fetchMock })

    await expect(client.listFiles('s1', { path: 'src', depth: 2 })).resolves.toMatchObject({
      sessionId: 's1'
    })
    await expect(client.readFile('s1', 'src/a.ts')).resolves.toMatchObject({ content: 'x' })
    await expect(client.findFiles('s1', { pattern: '*.ts' })).resolves.toMatchObject({
      matches: ['src/a.ts']
    })
    await expect(
      client.grepFiles('s1', {
        pattern: 'todo',
        include: '*.ts',
        literal: true,
        caseSensitive: true,
        limit: 5
      })
    ).resolves.toMatchObject({ pattern: 'todo' })

    expect(calls[0]).toBe('http://api.test/sessions/s1/files?path=src&depth=2')
    expect(calls[1]).toBe('http://api.test/sessions/s1/files/content?path=src%2Fa.ts')
    expect(calls[2]).toBe('http://api.test/sessions/s1/files/find?pattern=*.ts')
    expect(calls[3]).toBe(
      'http://api.test/sessions/s1/files/grep?pattern=todo&include=*.ts&literal=true&caseSensitive=true&limit=5'
    )
    expect(() => client.readFile('s1', '')).toThrow('path is required')
  })

  it('exposes configuration and extension resource routes', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/config')) {
        return jsonResponse({
          workspace: '/w',
          config: {},
          sources: {},
          diagnostics: [],
          provenance: {}
        })
      }
      return jsonResponse([])
    })
    const client = new AteamClient({ baseUrl: 'http://api.test', fetch: fetchMock })

    await expect(client.listAgents({ sessionId: 's1' })).resolves.toEqual([])
    await expect(client.listCommands()).resolves.toEqual([])
    await expect(client.getConfig({ sessionId: 's1' })).resolves.toMatchObject({
      workspace: '/w'
    })
    await expect(client.listProviders({ sessionId: 's1' })).resolves.toEqual([])
    await expect(client.listMcpServers()).resolves.toEqual([])
    await expect(client.listLspServers({ sessionId: 's1' })).resolves.toEqual([])

    expect(calls).toEqual([
      'http://api.test/agents?sessionId=s1',
      'http://api.test/commands',
      'http://api.test/config?sessionId=s1',
      'http://api.test/providers?sessionId=s1',
      'http://api.test/mcp',
      'http://api.test/lsp?sessionId=s1'
    ])
  })

  it('throws typed errors', async () => {
    const client = new AteamClient({
      baseUrl: 'http://api.test',
      fetch: async () => jsonResponse({ error: 'SESSION_NOT_FOUND' }, 404)
    })

    await expect(client.getSession('missing')).rejects.toMatchObject({
      name: 'AteamApiError',
      status: 404,
      message: 'SESSION_NOT_FOUND'
    })
    await expect(client.getSession('missing')).rejects.toBeInstanceOf(AteamApiError)
  })

  it('streams SSE events across chunk boundaries', async () => {
    const encoder = new TextEncoder()
    const events: AgentEventEnvelope[] = [
      {
        seq: 1,
        at: '2026-01-01T00:00:00.000Z',
        event: { type: 'run.started', sessionId: 's1', messageId: 'm1', startedAt: 'x' }
      },
      {
        seq: 2,
        at: '2026-01-01T00:00:00.000Z',
        event: { type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'completed' }
      }
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': connected\n\n'))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[0]).slice(0, 20)}`))
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify(events[0]).slice(20)}\n\ndata: ${JSON.stringify(events[1])}\n\n`
          )
        )
        controller.close()
      }
    })
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
    )
    const client = new AteamClient({ baseUrl: 'http://api.test', fetch: fetchMock })
    const received: AgentEventEnvelope[] = []

    await client.events((envelope) => received.push(envelope), { sessionId: 's1' })

    expect(received).toHaveLength(2)
    expect(received[1].event.type).toBe('run.finished')
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://api.test/events?sessionId=s1')
  })
})

import { Validator } from '@seriousme/openapi-schema-validator'
import { afterEach, describe, expect, it } from 'vitest'
import { createApiServer, type ApiRuntime } from './api'
import { EventBus } from './event-bus'
import { openApiDocument } from './openapi'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const

/** Every route the server implements; the document must describe all of them. */
const EXPECTED_OPERATIONS = [
  'GET /agents',
  'GET /commands',
  'GET /config',
  'GET /events',
  'GET /health',
  'GET /lsp',
  'GET /mcp',
  'GET /openapi.json',
  'GET /permissions',
  'POST /permissions/{permissionId}',
  'GET /providers',
  'GET /questions',
  'POST /questions/{questionId}',
  'GET /sessions',
  'POST /sessions',
  'DELETE /sessions/{sessionId}',
  'GET /sessions/{sessionId}',
  'POST /sessions/{sessionId}/compact',
  'GET /sessions/{sessionId}/files',
  'GET /sessions/{sessionId}/files/content',
  'GET /sessions/{sessionId}/files/find',
  'GET /sessions/{sessionId}/files/grep',
  'GET /sessions/{sessionId}/messages',
  'POST /sessions/{sessionId}/messages',
  'POST /sessions/{sessionId}/stop'
].sort()

type PathItem = Record<string, unknown> & { parameters?: unknown }
type Document = ReturnType<typeof openApiDocument> & {
  paths: Record<string, PathItem>
}

function operationsOf(document: Document): string[] {
  return Object.entries(document.paths)
    .flatMap(([path, item]) =>
      HTTP_METHODS.filter((method) => method in item).map(
        (method) => `${method.toUpperCase()} ${path}`
      )
    )
    .sort()
}

function operation(document: Document, key: string): Record<string, unknown> {
  const [method, path] = key.split(' ')
  return document.paths[path][method.toLowerCase()] as Record<string, unknown>
}

let api: ReturnType<typeof createApiServer> | null = null

afterEach(async () => {
  await api?.close()
  api = null
})

describe('openApiDocument', () => {
  it('is a valid OpenAPI 3.1 document covering every route', async () => {
    const document = openApiDocument('9.9.9') as Document

    const result = await new Validator().validate(document)
    expect(result.errors ?? []).toEqual([])
    expect(result.valid).toBe(true)

    expect(document.openapi).toBe('3.1.0')
    expect(document.info).toMatchObject({ title: 'ATeam Server API', version: '9.9.9' })
    expect(operationsOf(document)).toEqual(EXPECTED_OPERATIONS)
  })

  it('gives every operation a unique id, a tag and responses', () => {
    const document = openApiDocument('0.1.0') as Document
    const ids = new Set<string>()

    for (const key of EXPECTED_OPERATIONS) {
      const current = operation(document, key)
      expect(current.operationId, key).toEqual(expect.any(String))
      expect(ids.has(current.operationId as string), key).toBe(false)
      ids.add(current.operationId as string)
      expect(current.tags, key).toEqual(expect.arrayContaining([expect.any(String)]))
      expect(Object.keys(current.responses as object).length, key).toBeGreaterThan(0)
    }
  })

  it('documents authentication and error responses', () => {
    const document = openApiDocument('0.1.0') as Document
    const components = document.components as { securitySchemes: Record<string, unknown> }
    expect(components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer'
    })

    // Public routes opt out of the global bearer requirement.
    for (const key of ['GET /health', 'GET /openapi.json']) {
      expect(operation(document, key).security, key).toEqual([])
    }

    // Everything else requires auth and documents the error status codes.
    for (const key of EXPECTED_OPERATIONS) {
      if (key === 'GET /health' || key === 'GET /openapi.json') continue
      const responses = operation(document, key).responses as Record<string, unknown>
      expect(responses['401'], key).toBeDefined()
      if (!key.startsWith('GET /events')) expect(responses.default, key).toBeDefined()
    }

    const notFound = operation(document, 'GET /sessions/{sessionId}').responses as Record<
      string,
      { $ref?: string }
    >
    expect(notFound['404'].$ref).toBe('#/components/responses/NotFound')
  })

  it('describes request bodies and query parameters', () => {
    const document = openApiDocument('0.1.0') as Document
    const create = operation(document, 'POST /sessions')
    expect(create.requestBody).toBeDefined()

    const send = operation(document, 'POST /sessions/{sessionId}/messages')
    expect(send.requestBody).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } }
      }
    })

    const grep = operation(document, 'GET /sessions/{sessionId}/files/grep')
    const names = [
      ...((document.paths['/sessions/{sessionId}/files/grep'].parameters ?? []) as Array<{
        name: string
      }>),
      ...(grep.parameters as Array<{ name: string }>)
    ].map((parameter) => parameter.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'sessionId',
        'path',
        'pattern',
        'include',
        'literal',
        'caseSensitive'
      ])
    )
  })
})

describe('GET /openapi.json', () => {
  it('serves the document without authentication, with or without the /v1 prefix', async () => {
    // The runtime is never reached by the meta routes.
    const runtime = new Proxy({} as ApiRuntime, {
      get: () => () => {
        throw new Error('runtime must not be called')
      }
    })
    api = createApiServer({
      runtime,
      bus: new EventBus(),
      token: 'secret',
      version: '4.5.6',
      port: 0
    })
    await api.listen()

    for (const path of ['/openapi.json', '/v1/openapi.json']) {
      const response = await fetch(`${api.url()}${path}`)
      expect(response.status, path).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      const document = (await response.json()) as Document
      expect((document.info as { version: string }).version).toBe('4.5.6')
      expect((await new Validator().validate(document)).valid).toBe(true)
      expect(operationsOf(document)).toEqual(EXPECTED_OPERATIONS)
    }

    // Other routes still require the bearer token.
    const unauthorized = await fetch(`${api.url()}/sessions`)
    expect(unauthorized.status).toBe(401)
  })
})

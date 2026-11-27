/**
 * OpenAPI 3.1 description of the ATeam Server API.
 *
 * The document is hand-maintained next to `api.ts`; `openapi.test.ts` fails
 * when a route or method is missing from it, and validates the document
 * against the official OpenAPI schema before it can be served.
 */

interface OpenApiDocument {
  [key: string]: unknown
}

const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` })

const responseRef = (name: string): { $ref: string } => ({
  $ref: `#/components/responses/${name}`
})

const jsonBody = (schema: unknown): Record<string, unknown> => ({
  'application/json': { schema }
})

const success = (description: string, schema: unknown): Record<string, unknown> => ({
  description,
  content: jsonBody(schema)
})

const sse = (description: string): Record<string, unknown> => ({
  description,
  content: { 'text/event-stream': { schema: { type: 'string' } } }
})

const errorResponse = (description: string): Record<string, unknown> => ({
  description,
  content: jsonBody(ref('Error'))
})

const sessionIdPath = {
  name: 'sessionId',
  in: 'path',
  required: true,
  description: 'Session id.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9-]{1,64}$' }
}

const sessionIdQuery = {
  name: 'sessionId',
  in: 'query',
  required: false,
  description:
    'Session whose workspace should be read. Omit to use the runtime default workspace. Unknown sessions return 404; malformed ids return 400.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9-]{1,64}$' }
}

const fileRoot = {
  name: 'path',
  in: 'query',
  required: false,
  description: 'Directory relative to the session workspace; defaults to the root.',
  schema: { type: 'string' }
}

const filePath = {
  name: 'path',
  in: 'query',
  required: true,
  description: 'File path relative to the session workspace.',
  schema: { type: 'string' }
}

const listLimit = {
  name: 'limit',
  in: 'query',
  required: false,
  description: 'Entry limit; values are clamped to 1..2,000.',
  schema: { type: 'integer', minimum: 1, maximum: 2_000 }
}

const searchLimit = {
  name: 'limit',
  in: 'query',
  required: false,
  description: 'Match limit; values are clamped to 1..500.',
  schema: { type: 'integer', minimum: 1, maximum: 500 }
}

const pattern = {
  name: 'pattern',
  in: 'query',
  required: true,
  description: 'Glob pattern for find, or a JavaScript regular expression for grep.',
  schema: { type: 'string', maxLength: 500 }
}

const object = (description: string): Record<string, unknown> => ({
  type: 'object',
  description,
  additionalProperties: true
})

function nullable(schema: unknown): Record<string, unknown> {
  return { oneOf: [schema, { type: 'null' }] }
}

function buildSchemas(): Record<string, unknown> {
  return {
    Error: {
      type: 'object',
      required: ['error'],
      properties: { error: { type: 'string' } }
    },
    Health: {
      type: 'object',
      required: ['ok', 'version'],
      properties: {
        ok: { type: 'boolean' },
        version: { type: 'string' }
      }
    },
    ModelRef: {
      type: 'object',
      required: ['providerId', 'modelId'],
      properties: {
        providerId: { type: 'string' },
        modelId: { type: 'string' },
        variant: nullable({ type: 'string' })
      }
    },
    SessionSettings: {
      type: 'object',
      properties: {
        permissionMode: { type: 'string', enum: ['plan', 'ask', 'acceptEdits', 'auto'] },
        reasoningEffort: nullable({
          type: 'string',
          enum: ['minimal', 'low', 'medium', 'high']
        })
      }
    },
    TodoItem: {
      type: 'object',
      required: ['id', 'content', 'status', 'priority'],
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] }
      }
    },
    SessionMeta: {
      type: 'object',
      required: ['id', 'title', 'status'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        model: nullable(ref('ModelRef')),
        status: { type: 'string', enum: ['idle', 'running', 'waiting-permission', 'error'] },
        permissionMode: { type: 'string', enum: ['plan', 'ask', 'acceptEdits', 'auto'] },
        reasoningEffort: nullable({
          type: 'string',
          enum: ['minimal', 'low', 'medium', 'high']
        }),
        compaction: object('Last context compaction, or null.'),
        redoAvailable: { type: 'boolean' },
        contextTokens: nullable({ type: 'integer' }),
        contextWindow: nullable({ type: 'integer' }),
        agent: nullable({ type: 'string' }),
        parentId: nullable({ type: 'string' }),
        hidden: { type: 'boolean' },
        todos: { type: 'array', items: ref('TodoItem') },
        directory: nullable({ type: 'string' })
      },
      additionalProperties: true
    },
    CreateSessionRequest: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        agent: nullable({ type: 'string' }),
        model: nullable(ref('ModelRef')),
        permissionMode: { type: 'string', enum: ['plan', 'ask', 'acceptEdits', 'auto'] },
        reasoningEffort: nullable({
          type: 'string',
          enum: ['minimal', 'low', 'medium', 'high']
        })
      }
    },
    MessagesSnapshot: {
      type: 'object',
      required: ['sessionId', 'seq', 'messages', 'running'],
      properties: {
        sessionId: { type: 'string' },
        seq: { type: 'integer' },
        messages: { type: 'array', items: object('A chat message.') },
        running: { type: 'boolean' },
        queued: { type: 'array', items: object('A queued user message.') }
      }
    },
    SendMessageRequest: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        model: nullable(ref('ModelRef')),
        wait: {
          type: 'boolean',
          description: 'Wait for the run to finish; defaults to false.'
        }
      }
    },
    SendMessageQueued: {
      type: 'object',
      required: ['sessionId', 'queued'],
      properties: {
        sessionId: { type: 'string' },
        queued: { type: 'boolean', const: true }
      }
    },
    SendMessageResult: {
      type: 'object',
      required: ['sessionId', 'status'],
      properties: {
        sessionId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['completed', 'failed', 'interrupted', 'max-steps']
        },
        error: { type: 'string' },
        messages: ref('MessagesSnapshot')
      }
    },
    CompactRequest: {
      type: 'object',
      properties: { force: { type: 'boolean' } }
    },
    DeleteResult: {
      type: 'object',
      required: ['deleted'],
      properties: { deleted: { type: 'boolean', const: true } }
    },
    StopResult: {
      type: 'object',
      required: ['stopped'],
      properties: { stopped: { type: 'boolean', const: true } }
    },
    OkResult: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean', const: true } }
    },
    WorkspaceFileEntry: {
      type: 'object',
      required: ['path', 'name', 'type', 'size'],
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace.' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['file', 'directory'] },
        size: nullable({ type: 'integer' })
      }
    },
    WorkspaceFileList: {
      type: 'object',
      required: ['sessionId', 'path', 'entries', 'truncated'],
      properties: {
        sessionId: { type: 'string' },
        path: { type: 'string' },
        entries: { type: 'array', items: ref('WorkspaceFileEntry') },
        truncated: { type: 'boolean' }
      }
    },
    WorkspaceFileContent: {
      type: 'object',
      required: ['sessionId', 'path', 'content', 'size', 'truncated'],
      properties: {
        sessionId: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
        size: { type: 'integer', description: 'Full file size in bytes.' },
        truncated: { type: 'boolean' }
      }
    },
    WorkspaceFileFindResult: {
      type: 'object',
      required: ['sessionId', 'root', 'pattern', 'matches', 'truncated'],
      properties: {
        sessionId: { type: 'string' },
        root: { type: 'string' },
        pattern: { type: 'string' },
        matches: { type: 'array', items: { type: 'string' } },
        truncated: { type: 'boolean' }
      }
    },
    WorkspaceFileMatch: {
      type: 'object',
      required: ['path', 'line', 'text'],
      properties: {
        path: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        text: { type: 'string' }
      }
    },
    WorkspaceFileGrepResult: {
      type: 'object',
      required: ['sessionId', 'root', 'pattern', 'matches', 'truncated'],
      properties: {
        sessionId: { type: 'string' },
        root: { type: 'string' },
        pattern: { type: 'string' },
        matches: { type: 'array', items: ref('WorkspaceFileMatch') },
        truncated: { type: 'boolean' }
      }
    },
    AgentDefinition: {
      type: 'object',
      required: ['id', 'name', 'description', 'mode', 'prompt', 'source'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        mode: { type: 'string', enum: ['primary', 'subagent', 'all'] },
        model: nullable(ref('ModelRef')),
        tools: nullable({ type: 'array', items: { type: 'string' } }),
        permissions: { type: 'array', items: object('Agent permission rule.') },
        maxSteps: nullable({ type: 'integer' }),
        temperature: nullable({ type: 'number' }),
        prompt: { type: 'string' },
        source: { type: 'string', enum: ['builtin', 'user', 'project'] }
      }
    },
    CommandDefinition: {
      type: 'object',
      required: ['id', 'name', 'description', 'template', 'source'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        template: { type: 'string' },
        agent: nullable({ type: 'string' }),
        model: nullable(ref('ModelRef')),
        mcp: nullable(object('MCP prompt command.')),
        source: { type: 'string', enum: ['builtin', 'user', 'project', 'skill', 'mcp'] },
        subtask: { type: 'boolean' }
      }
    },
    ProviderType: {
      type: 'string',
      enum: ['anthropic', 'openai', 'google', 'openai-compatible']
    },
    ResourceProvider: {
      type: 'object',
      required: ['id', 'name', 'type', 'hasApiKey', 'source'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: ref('ProviderType'),
        baseURL: { type: 'string', description: 'Without userinfo, query string or fragment.' },
        hasApiKey: { type: 'boolean' },
        source: { type: 'string', enum: ['runtime', 'project'] }
      }
    },
    McpServerStatus: {
      type: 'object',
      required: ['id', 'name', 'state'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        state: {
          type: 'string',
          enum: ['idle', 'connecting', 'connected', 'failed', 'auth-required']
        },
        toolCount: { type: 'integer' },
        promptCount: { type: 'integer' },
        resourceCount: { type: 'integer' },
        error: nullable({ type: 'string' }),
        updatedAt: nullable({ type: 'string', format: 'date-time' })
      }
    },
    ResourceMcpServer: {
      type: 'object',
      required: ['id', 'name', 'type', 'args', 'headerNames', 'envNames', 'enabled'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['local', 'remote'] },
        command: nullable({ type: 'string' }),
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Credential-carrying arguments are replaced with [REDACTED].'
        },
        url: {
          type: 'string',
          description: 'Without userinfo, query string or fragment.'
        },
        headerNames: { type: 'array', items: { type: 'string' } },
        envNames: { type: 'array', items: { type: 'string' } },
        enabled: { type: 'boolean' },
        timeout: nullable({ type: 'integer' }),
        cwd: nullable({ type: 'string' }),
        hasOAuthClientId: { type: 'boolean' },
        oauthScope: nullable({ type: 'string' }),
        source: { type: 'string', enum: ['user', 'project', 'transient'] },
        status: nullable(ref('McpServerStatus'))
      }
    },
    ResourceLspServer: {
      type: 'object',
      required: ['id', 'extensions', 'command', 'envNames', 'rootMarkers', 'npmPackages'],
      properties: {
        id: { type: 'string' },
        extensions: { type: 'array', items: { type: 'string' } },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Credential-carrying arguments are replaced with [REDACTED].'
        },
        envNames: { type: 'array', items: { type: 'string' } },
        rootMarkers: { type: 'array', items: { type: 'string' } },
        npmPackages: { type: 'array', items: { type: 'string' } }
      }
    },
    ResourceConfigSnapshot: {
      type: 'object',
      required: ['workspace', 'config', 'sources', 'diagnostics', 'provenance'],
      properties: {
        workspace: { type: 'string', description: 'Absolute workspace directory.' },
        config: {
          ...object(
            'Effective merged AgentConfig without MCP env/headers, LSP env or formatter environments.'
          ),
          description:
            'Effective merged AgentConfig without MCP env/headers, LSP env or formatter environments.'
        },
        sources: object('Configuration file paths.'),
        diagnostics: { type: 'array', items: object('Configuration diagnostic.') },
        provenance: object('Per-field configuration source.')
      }
    },
    PermissionRequest: {
      type: 'object',
      required: ['id', 'sessionId', 'messageId', 'toolCallId', 'action', 'resource'],
      properties: {
        id: { type: 'string' },
        sessionId: { type: 'string' },
        messageId: { type: 'string' },
        toolCallId: { type: 'string' },
        action: { type: 'string' },
        resource: { type: 'string' },
        toolName: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' }
      }
    },
    PermissionReplyRequest: {
      type: 'object',
      required: ['decision'],
      properties: { decision: { type: 'string', enum: ['once', 'always', 'reject'] } }
    },
    QuestionOption: {
      type: 'object',
      required: ['label'],
      properties: {
        label: { type: 'string' },
        description: { type: 'string' }
      }
    },
    QuestionRequest: {
      type: 'object',
      required: ['id', 'sessionId', 'messageId', 'header', 'question', 'options'],
      properties: {
        id: { type: 'string' },
        sessionId: { type: 'string' },
        messageId: { type: 'string' },
        toolCallId: { type: 'string' },
        header: { type: 'string' },
        question: { type: 'string' },
        options: { type: 'array', items: ref('QuestionOption') },
        multiple: { type: 'boolean' },
        allowCustom: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' }
      }
    },
    QuestionAnswer: {
      type: 'object',
      required: ['selected'],
      properties: {
        selected: { type: 'array', items: { type: 'string' } },
        custom: nullable({ type: 'string' }),
        cancelled: { type: 'boolean' },
        timedOut: { type: 'boolean' }
      }
    },
    QuestionReplyRequest: {
      type: 'object',
      required: ['answer'],
      properties: { answer: ref('QuestionAnswer') }
    },
    AgentEventEnvelope: {
      type: 'object',
      required: ['seq', 'at', 'event'],
      properties: {
        seq: { type: 'integer' },
        at: { type: 'string', format: 'date-time' },
        event: {
          type: 'object',
          required: ['type'],
          properties: { type: { type: 'string' } },
          additionalProperties: true
        }
      }
    },
    OpenApiDocument: object('An OpenAPI 3.1 document.')
  }
}

function buildPaths(): Record<string, unknown> {
  const unauthorized = responseRef('Unauthorized')
  const badRequest = responseRef('BadRequest')
  const unexpected = responseRef('UnexpectedError')

  return {
    '/health': {
      get: {
        tags: ['meta'],
        operationId: 'health',
        summary: 'Liveness probe',
        security: [],
        responses: {
          '200': success('Service is up.', ref('Health'))
        }
      }
    },
    '/openapi.json': {
      get: {
        tags: ['meta'],
        operationId: 'openapi',
        summary: 'This OpenAPI document',
        security: [],
        responses: {
          '200': success('OpenAPI 3.1 description of this server.', ref('OpenApiDocument'))
        }
      }
    },
    '/events': {
      get: {
        tags: ['events'],
        operationId: 'events',
        summary: 'Stream agent events over Server-Sent Events',
        description:
          'Each `data:` line is an AgentEventEnvelope. Browsers that cannot set headers may pass the bearer token in the `token` query parameter.',
        security: [{ bearerAuth: [] }, { eventToken: [] }],
        parameters: [
          {
            name: 'sessionId',
            in: 'query',
            required: false,
            description: 'Only stream events for this session.',
            schema: { type: 'string' }
          },
          {
            name: 'token',
            in: 'query',
            required: false,
            description: 'Bearer token alternative for EventSource clients.',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': sse('Event stream.'),
          '401': unauthorized
        }
      }
    },
    '/sessions': {
      get: {
        tags: ['sessions'],
        operationId: 'listSessions',
        summary: 'List sessions',
        responses: {
          '200': success('All known sessions.', { type: 'array', items: ref('SessionMeta') }),
          '401': unauthorized,
          default: unexpected
        }
      },
      post: {
        tags: ['sessions'],
        operationId: 'createSession',
        summary: 'Create a session',
        requestBody: { content: jsonBody(ref('CreateSessionRequest')) },
        responses: {
          '201': success('Session created.', ref('SessionMeta')),
          '400': badRequest,
          '401': unauthorized,
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}': {
      parameters: [sessionIdPath],
      get: {
        tags: ['sessions'],
        operationId: 'getSession',
        summary: 'Get one session',
        responses: {
          '200': success('Session metadata.', ref('SessionMeta')),
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      },
      delete: {
        tags: ['sessions'],
        operationId: 'deleteSession',
        summary: 'Delete a session',
        responses: {
          '200': success('Session deleted.', ref('DeleteResult')),
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/files': {
      parameters: [sessionIdPath],
      get: {
        tags: ['files'],
        operationId: 'listFiles',
        summary: 'List files and directories inside the session workspace',
        parameters: [
          fileRoot,
          {
            name: 'depth',
            in: 'query',
            required: false,
            description: 'Recursion depth; defaults to 1 and is clamped to 1..8.',
            schema: { type: 'integer', minimum: 1, maximum: 8, default: 1 }
          },
          listLimit
        ],
        responses: {
          '200': success('Directory listing.', ref('WorkspaceFileList')),
          '400': badRequest,
          '401': unauthorized,
          '403': responseRef('Forbidden'),
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/files/content': {
      parameters: [sessionIdPath],
      get: {
        tags: ['files'],
        operationId: 'readFile',
        summary: 'Read a text file inside the session workspace',
        parameters: [filePath],
        responses: {
          '200': success('File content, at most 512 KiB.', ref('WorkspaceFileContent')),
          '400': badRequest,
          '401': unauthorized,
          '403': responseRef('Forbidden'),
          '404': responseRef('NotFound'),
          '415': responseRef('UnsupportedMediaType'),
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/files/find': {
      parameters: [sessionIdPath],
      get: {
        tags: ['files'],
        operationId: 'findFiles',
        summary: 'Find files by glob pattern',
        parameters: [fileRoot, pattern, searchLimit],
        responses: {
          '200': success('Matching workspace-relative paths.', ref('WorkspaceFileFindResult')),
          '400': badRequest,
          '401': unauthorized,
          '403': responseRef('Forbidden'),
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/files/grep': {
      parameters: [sessionIdPath],
      get: {
        tags: ['files'],
        operationId: 'grepFiles',
        summary: 'Search file contents',
        parameters: [
          fileRoot,
          pattern,
          {
            name: 'include',
            in: 'query',
            required: false,
            description: 'Filename filter such as `*.ts`.',
            schema: { type: 'string' }
          },
          {
            name: 'literal',
            in: 'query',
            required: false,
            description: 'Treat the pattern as literal text.',
            schema: { type: 'boolean' }
          },
          {
            name: 'caseSensitive',
            in: 'query',
            required: false,
            schema: { type: 'boolean' }
          },
          searchLimit
        ],
        responses: {
          '200': success('Matching lines.', ref('WorkspaceFileGrepResult')),
          '400': badRequest,
          '401': unauthorized,
          '403': responseRef('Forbidden'),
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/messages': {
      parameters: [sessionIdPath],
      get: {
        tags: ['sessions'],
        operationId: 'getMessages',
        summary: 'Read the session transcript',
        responses: {
          '200': success('Messages and run state.', ref('MessagesSnapshot')),
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      },
      post: {
        tags: ['sessions'],
        operationId: 'sendMessage',
        summary: 'Send a user message',
        description:
          'Without `wait` the response is 202 and the run continues in the background. With `wait: true` the request resolves when the run finishes; the wait is capped at 10 minutes (504).',
        requestBody: { content: jsonBody(ref('SendMessageRequest')) },
        responses: {
          '200': success('Run finished (wait mode).', ref('SendMessageResult')),
          '202': success('Message queued (non-wait mode).', ref('SendMessageQueued')),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          '409': responseRef('Conflict'),
          '503': responseRef('ServiceUnavailable'),
          '504': responseRef('GatewayTimeout'),
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/stop': {
      parameters: [sessionIdPath],
      post: {
        tags: ['sessions'],
        operationId: 'stopSession',
        summary: 'Stop the active run',
        responses: {
          '202': success('Stop requested.', ref('StopResult')),
          '401': unauthorized,
          default: unexpected
        }
      }
    },
    '/sessions/{sessionId}/compact': {
      parameters: [sessionIdPath],
      post: {
        tags: ['sessions'],
        operationId: 'compactSession',
        summary: 'Compact the transcript',
        requestBody: { content: jsonBody(ref('CompactRequest')) },
        responses: {
          '200': success('Compacted session.', ref('SessionMeta')),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/agents': {
      get: {
        tags: ['resources'],
        operationId: 'listAgents',
        summary: 'List agent definitions',
        parameters: [sessionIdQuery],
        responses: {
          '200': success('Agent definitions.', {
            type: 'array',
            items: ref('AgentDefinition')
          }),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/commands': {
      get: {
        tags: ['resources'],
        operationId: 'listCommands',
        summary: 'List slash commands',
        parameters: [sessionIdQuery],
        responses: {
          '200': success('Command definitions.', {
            type: 'array',
            items: ref('CommandDefinition')
          }),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/config': {
      get: {
        tags: ['resources'],
        operationId: 'getConfig',
        summary: 'Read the effective configuration',
        description:
          'Credential values are removed: MCP env/headers, LSP env and formatter environments are dropped, and remaining text is redacted.',
        parameters: [sessionIdQuery],
        responses: {
          '200': success('Effective configuration.', ref('ResourceConfigSnapshot')),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/providers': {
      get: {
        tags: ['resources'],
        operationId: 'listProviders',
        summary: 'List providers with credential presence',
        parameters: [sessionIdQuery],
        responses: {
          '200': success('Providers; keys are never included.', {
            type: 'array',
            items: ref('ResourceProvider')
          }),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/mcp': {
      get: {
        tags: ['resources'],
        operationId: 'listMcpServers',
        summary: 'List MCP servers with credential names and status',
        parameters: [
          sessionIdQuery,
          {
            name: 'probe',
            in: 'query',
            required: false,
            description: 'Actively probe connections instead of returning the last known status.',
            schema: { type: 'boolean' }
          }
        ],
        responses: {
          '200': success('MCP servers; env and header values are never included.', {
            type: 'array',
            items: ref('ResourceMcpServer')
          }),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/lsp': {
      get: {
        tags: ['resources'],
        operationId: 'listLspServers',
        summary: 'List resolved LSP servers',
        parameters: [sessionIdQuery],
        responses: {
          '200': success('LSP servers; env values are never included.', {
            type: 'array',
            items: ref('ResourceLspServer')
          }),
          '400': badRequest,
          '401': unauthorized,
          '404': responseRef('NotFound'),
          default: unexpected
        }
      }
    },
    '/permissions': {
      get: {
        tags: ['permissions'],
        operationId: 'listPermissions',
        summary: 'List pending permission requests',
        responses: {
          '200': success('Pending permission requests.', {
            type: 'array',
            items: ref('PermissionRequest')
          }),
          '401': unauthorized,
          default: unexpected
        }
      }
    },
    '/permissions/{permissionId}': {
      parameters: [
        {
          name: 'permissionId',
          in: 'path',
          required: true,
          schema: { type: 'string' }
        }
      ],
      post: {
        tags: ['permissions'],
        operationId: 'replyPermission',
        summary: 'Answer a permission request',
        requestBody: { content: jsonBody(ref('PermissionReplyRequest')) },
        responses: {
          '200': success('Decision recorded.', ref('OkResult')),
          '400': badRequest,
          '401': unauthorized,
          default: unexpected
        }
      }
    },
    '/questions': {
      get: {
        tags: ['questions'],
        operationId: 'listQuestions',
        summary: 'List pending questions',
        responses: {
          '200': success('Pending questions.', {
            type: 'array',
            items: ref('QuestionRequest')
          }),
          '401': unauthorized,
          default: unexpected
        }
      }
    },
    '/questions/{questionId}': {
      parameters: [
        {
          name: 'questionId',
          in: 'path',
          required: true,
          schema: { type: 'string' }
        }
      ],
      post: {
        tags: ['questions'],
        operationId: 'replyQuestion',
        summary: 'Answer a question',
        requestBody: { content: jsonBody(ref('QuestionReplyRequest')) },
        responses: {
          '200': success('Answer recorded.', ref('OkResult')),
          '400': badRequest,
          '401': unauthorized,
          default: unexpected
        }
      }
    }
  }
}

/** Builds the OpenAPI document for a given server version. */
export function openApiDocument(version: string): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'ATeam Server API',
      version,
      description: [
        'HTTP API for the ATeam headless agent runtime.',
        '',
        'All routes are available both with and without a `/v1` prefix. When the server was started with a bearer token, every route except `/health` and `/openapi.json` requires `Authorization: Bearer <token>`; the `/events` route also accepts `?token=` for EventSource clients.',
        '',
        'Errors are returned as JSON `{ "error": string }`. Status codes: 400 invalid request, 401 missing or invalid token, 403 path escapes the workspace, 404 missing session/file, 409 session busy, 415 binary file, 503 runtime not ready, 504 wait timeout.'
      ].join('\n')
    },
    servers: [{ url: '/' }, { url: '/v1' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'meta' },
      { name: 'events' },
      { name: 'sessions' },
      { name: 'files' },
      { name: 'resources', description: 'Read-only configuration and extension resources.' },
      { name: 'permissions' },
      { name: 'questions' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque token' },
        eventToken: {
          type: 'apiKey',
          in: 'query',
          name: 'token',
          description: 'Bearer token alternative accepted only by /events.'
        }
      },
      responses: {
        BadRequest: errorResponse('Malformed or invalid request.'),
        Unauthorized: errorResponse('Missing or invalid bearer token.'),
        Forbidden: errorResponse('The path escapes the session workspace.'),
        NotFound: errorResponse('The session, file or route does not exist.'),
        Conflict: errorResponse('The session is busy with another run.'),
        UnsupportedMediaType: errorResponse('The file is binary and cannot be returned as text.'),
        ServiceUnavailable: errorResponse('The agent runtime is not ready.'),
        GatewayTimeout: errorResponse('The run did not finish within the wait timeout.'),
        UnexpectedError: errorResponse('Unexpected failure; the message is in `error`.')
      },
      schemas: buildSchemas()
    },
    paths: buildPaths()
  }
}

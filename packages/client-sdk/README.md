# @ateam/client-sdk

TypeScript client for the [ATeam](https://github.com/lxqddd/ATeam) headless HTTP API.

- Typed methods for sessions, workspace files, configuration resources and the
  event stream.
- Ships ESM, CommonJS and self-contained type declarations.
- Uses the global `fetch` (Node.js 18+ or any modern browser/runtime); inject a
  custom implementation with the `fetch` option.

## Install

```bash
npm install @ateam/client-sdk
```

## Usage

```ts
import { AteamClient } from '@ateam/client-sdk'

const client = new AteamClient({
  baseUrl: 'http://127.0.0.1:4096',
  token: process.env.ATEAM_API_TOKEN
})

const session = await client.createSession({ title: 'Release notes' })
await client.sendMessage(session.id, { text: 'Summarize the open issues', wait: true })

const files = await client.listFiles(session.id, { depth: 2 })
const matches = await client.findFiles(session.id, { pattern: '*.md' })
```

Routes are available both at `/` and under the `/v1` prefix; use whichever the
server exposes. When the server was started with a bearer token, pass it as
`token` and the client sends `Authorization: Bearer <token>` on every request.
`GET /health` and `GET /openapi.json` are public; the latter serves the OpenAPI
3.1 description this client is built against.

### Streaming events

`events()` reads the server-sent event stream until the stream closes or the
`AbortSignal` aborts. Each callback receives an `AgentEventEnvelope`.

```ts
const controller = new AbortController()
await client.events(
  (envelope) => {
    console.log(envelope.seq, envelope.event.type)
  },
  { sessionId: session.id, signal: controller.signal }
)
```

### Errors

Non-2xx responses throw `AteamApiError` with the HTTP `status` and parsed `body`.
The server returns `{ "error": string }`, so `error.message` carries codes such
as `SESSION_NOT_FOUND`, `SESSION_BUSY` or `FILE_PATH_ESCAPES_WORKSPACE`.

```ts
import { AteamApiError } from '@ateam/client-sdk'

try {
  await client.getSession('missing')
} catch (error) {
  if (error instanceof AteamApiError && error.status === 404) {
    // handle a missing session
  } else {
    throw error
  }
}
```

## API

| Method                           | HTTP route                         |
| -------------------------------- | ---------------------------------- |
| `health()`                       | `GET /health`                      |
| `listSessions()`                 | `GET /sessions`                    |
| `createSession(input?)`          | `POST /sessions`                   |
| `getSession(id)`                 | `GET /sessions/{id}`               |
| `deleteSession(id)`              | `DELETE /sessions/{id}`            |
| `getMessages(id)`                | `GET /sessions/{id}/messages`      |
| `sendMessage(id, input)`         | `POST /sessions/{id}/messages`     |
| `stopSession(id)`                | `POST /sessions/{id}/stop`         |
| `compactSession(id, force?)`     | `POST /sessions/{id}/compact`      |
| `listFiles(sessionId, options?)` | `GET /sessions/{id}/files`         |
| `readFile(sessionId, path)`      | `GET /sessions/{id}/files/content` |
| `findFiles(sessionId, options)`  | `GET /sessions/{id}/files/find`    |
| `grepFiles(sessionId, options)`  | `GET /sessions/{id}/files/grep`    |
| `listAgents(query?)`             | `GET /agents`                      |
| `listCommands(query?)`           | `GET /commands`                    |
| `getConfig(query?)`              | `GET /config`                      |
| `listProviders(query?)`          | `GET /providers`                   |
| `listMcpServers(query?)`         | `GET /mcp`                         |
| `listLspServers(query?)`         | `GET /lsp`                         |
| `listPermissions()`              | `GET /permissions`                 |
| `replyPermission(id, decision)`  | `POST /permissions/{id}`           |
| `listQuestions()`                | `GET /questions`                   |
| `replyQuestion(id, answer)`      | `POST /questions/{id}`             |
| `events(onEvent, options?)`      | `GET /events` (SSE)                |

Resource methods take an optional `{ sessionId }` query: without it the server
reads the default workspace, and with it the session's workspace. Credentials
are never returned — providers expose `hasApiKey`, MCP and LSP entries expose
environment and header _names_, and URLs are stripped of userinfo and query
strings.

### Types

Every wire type is exported from the package root: `SessionMeta`,
`MessagesSnapshot`, `ChatMessage`, `ModelRef`, `PermissionRequest`,
`QuestionRequest`, `AgentEvent`, `AgentEventEnvelope`, `AgentDefinition`,
`CommandDefinition`, `WorkspaceFile*`, `Resource*`, `McpServerStatus` and the
related enums. The published `dist/index.d.ts` inlines them, so no other
package is required.

## Development

```bash
pnpm --filter @ateam/client-sdk build
pnpm --filter @ateam/client-sdk test
pnpm --filter @ateam/client-sdk pack:check   # verify the publishable tarball
```

See the repository's `docs/sdk-release.md` for the release checklist.

## License

MIT

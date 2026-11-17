# ATeam

ATeam is a local-first, open-source cockpit for running multiple coding agents on real development tasks. It is an original implementation: it does not include HiFox code, documentation, UI assets, or trademarks.

> Status: M0 scaffold. The task/agent/run loop, SQLite persistence, HTTP + WebSocket API, Vue board, and Wails desktop shell are in place. Worktree provisioning, the remote runner, and real Claude Code/Codex adapters are the next milestones.

## What it does

```text
Task → Agent → isolated workspace → Runtime CLI → evidence → human review → merge
```

- **Task** is the context container: title, description, status, priority, assignee, labels.
- **Agent** is a reusable work profile: instructions, runtime, model, concurrency, timeout, allowed paths.
- **Run** is one execution: status, logs, summary, error, branch/worktree.
- **Runtime adapter** starts an existing coding agent (Claude Code, Codex, or a mock for development).
- **Human review** stays in the loop: the agent proposes, the developer reviews and merges.

## Monorepo layout

```text
ATeam/
├── cmd/ateam/              # Go CLI: serve, runner, version
├── internal/
│   ├── api/                # HTTP + WebSocket handlers, static SPA serving
│   ├── app/                # wiring, lifecycle, config
│   ├── domain/             # Task, Agent, Run, RunEvent
│   ├── events/             # WebSocket event hub
│   ├── runtime/            # adapter interface + mock/claude adapters
│   ├── scheduler/          # queue and run lifecycle
│   ├── store/              # SQLite store + migrations
│   ├── version/
│   └── workspace/          # workspace provisioning (M0: per-run directory)
├── apps/
│   ├── web/                # Vue 3 + TypeScript + Vite + Pinia + UnoCSS
│   │   └── src/api/        # axios client: http/ helpers + per-module APIs
│   └── desktop/            # Wails v3 shell
├── packages/
│   └── shared/             # shared TypeScript types
├── Makefile
├── pnpm-workspace.yaml
└── go.mod
```

## Quick start

Requirements: Go 1.27+, Node 24+, pnpm 11+, and (for the desktop shell) Wails v3.

```bash
# 1. install frontend dependencies
make web-install

# 2. terminal A: API server on http://127.0.0.1:8787
make dev-server

# 3. terminal B: Vue dev server on http://127.0.0.1:5173
make dev-web
```

Open <http://127.0.0.1:5173>. The Vite dev server proxies `/api` and the WebSocket to the Go server.

Web settings come from `apps/web/.env` (Vite reads env files from the Vite project root, not the repository root). Copy `apps/web/.env.example` to `apps/web/.env` to override `VITE_API_BASE`, `VITE_API_TIMEOUT_MS`, or `VITE_API_UNAUTHORIZED_REDIRECT`. These values are inlined at build time.

The Go server is configured with flags, not environment variables:

```bash
./bin/ateam serve --addr 127.0.0.1:8787 --db .data/ateam.db --web apps/web/dist
```

### Desktop shell

```bash
make dev-desktop
```

The Wails shell starts the Go server on a random local port and loads it in a native window. Packaging (DMG/NSIS/AppImage) is a later milestone.

### Build

```bash
make build
./bin/ateam serve --db .data/ateam.db --web apps/web/dist
```

`ateam serve` serves the API and the built SPA from `apps/web/dist` on the same origin. Without a web build, `/` shows a placeholder page while `/api/*` still works.

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and version |
| GET/POST | `/api/tasks` | List/create tasks |
| GET/PATCH/DELETE | `/api/tasks/{id}` | Read/update/delete a task |
| GET/POST | `/api/tasks/{id}/runs` | List runs / start a run with an agent |
| GET/POST | `/api/agents` | List/create agents |
| GET/PATCH/DELETE | `/api/agents/{id}` | Read/update/delete an agent |
| GET | `/api/runs` | List runs |
| GET | `/api/runs/{id}` | Read a run |
| GET | `/api/runs/{id}/events` | Run event log |
| POST | `/api/runs/{id}/cancel` | Request cancellation |
| GET | `/api/ws` | WebSocket event stream |
| GET | `/api/events` | Server-Sent Events stream (same payloads as WebSocket) |

## Runtime adapters

The scaffold ships with:

- `mock` — deterministic simulated run; the default for new agents.
- `claude` — executes the local `claude` CLI with the composed task prompt.

The Claude adapter is intentionally minimal. Real usage needs a runtime-specific command template, model selection, permission flags, and stream parsing. That belongs in M1.

## Roadmap

- **M0 (this scaffold)**: domain model, SQLite, API, mock runtime, Vue board, Wails shell.
- **M1**: git worktree isolation, diff review, real Claude Code adapter, run cancellation.
- **M2**: multiple agents in parallel, skills, inbox, task templates.
- **M3**: team mode (Postgres, auth, remote runner), GitHub PR integration.
- **M4**: automation (schedule/webhook), notifications, plugin API.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). ATeam is a clean-room implementation; do not contribute code, docs, screenshots, icons, or copy from another product.

## License

Apache-2.0. See [LICENSE](./LICENSE).

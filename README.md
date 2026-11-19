# ATeam

Local-first AI coding cockpit. Electron shell, React renderer, and an OpenCode-based harness.

## Stack

- TypeScript, Electron 45
- React 19, Vite 8
- Ant Design 6, Tailwind CSS 4
- pnpm workspaces + Turborepo
- `@ateam/shared` for shared domain types
- Theme tokens under `apps/web/src/styles/theme-tokens.css`
- i18n: Simplified Chinese and English, switchable from Settings and persisted locally
- UI: 7 built-in themes + follow-system, warm white/terracotta
  light palette, 12–22px type scale, 6/8/10/14/20 radii, icon rail + sidebar + chat workspace

## Roadmap

See [docs/next-tasks.md](docs/next-tasks.md) for the prioritized follow-up tasks.

## Structure

```
apps/
  desktop/    Electron main process, preload and packaging
  web/        React renderer (Vite)
packages/
  shared/     Shared TypeScript types
```

## Requirements

- Node.js >= 22.12
- pnpm 11

## Commands

```bash
pnpm install
pnpm dev            # Vite renderer + Electron shell
pnpm dev:web        # renderer only
pnpm build          # build shared, renderer and desktop
pnpm typecheck      # typecheck all packages
pnpm package        # unpacked Electron app in apps/desktop/release
```

The desktop app loads the Vite dev server in development and the bundled
`apps/web/dist` copy in production.

## OpenCode source kernel

The Electron main process starts a kernel built from OpenCode source on a random
loopback port with isolated XDG data directories, using its HTTP API and SSE
event stream. Build it with:

```bash
pnpm opencode:build
```

The runtime lives under `packages/` (see `SOURCE_COMMIT`), trimmed to the
harness/server dependency closure; app/desktop/gui/session-ui/stories, tests,
docs and examples are removed. The build bundles the CLI with Vite and packs it
into a single Node SEA executable at `apps/desktop/resources/opencode/opencode`.
Electron packages that binary through `extraResources`; `OPENCODE_BIN` can
override it for development.

Requirements: Node.js >= 26 and pnpm. The build downloads the pinned Node
release (26.4.0) used as the SEA base. Run `pnpm install` first.

Branding scope: product prose, system prompts, CLI/UI text and the assistant
self-description use ATeam. Internal package names, config paths, API routes,
authentication usernames and upstream hosted service names (OpenCode Console /
Go / Free / Zen / SDK) remain unchanged for compatibility.

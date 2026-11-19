# ATeam

Local-first AI coding cockpit. Electron shell, React renderer, and an OpenCode-based harness.

## Stack

- TypeScript, Electron 45
- React 19, Vite 8
- Ant Design 6, Tailwind CSS 4
- pnpm workspaces + Turborepo
- `@ateam/shared` for shared domain types
- Nomi 2.4.0 theme tokens vendored under `apps/web/src/styles/nomi-tokens.css` (MIT; see `THIRD_PARTY_NOTICES.md`)
- i18n: Simplified Chinese and English, switchable from Settings and persisted locally
- UI aligned with Nomi 2.4.0: 7 built-in themes + follow-system, warm white/terracotta
  light palette, 12–22px type scale, 6/8/10/14/20 radii, icon rail + sidebar + chat workspace

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

The source is vendored under `apps/desktop/src/runtime/opencode` (see `SOURCE_COMMIT`), trimmed
to the harness/server dependency closure; app/desktop/gui/session-ui/stories, tests,
docs and examples are removed. The build command applies ATeam branding to the
vendored source and builds `apps/desktop/resources/opencode/opencode` with Bun.
Electron packages that binary through `extraResources`; `OPENCODE_BIN` can
override it for development. To update, replace `apps/desktop/src/runtime/opencode` with a
newer `anomalyco/opencode` `dev` checkout and run the build again.

Requirements: Bun >= 1.4.4. Set `BUN_BIN` to a specific Bun executable if it is
not on PATH.

Branding scope: product prose, system prompts, CLI/UI text and the assistant
self-description use ATeam. Internal package names, config paths, API routes,
authentication usernames and upstream hosted service names (OpenCode Console /
Go / Free / Zen / SDK) remain unchanged for compatibility.

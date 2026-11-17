# ATeam Desktop Shell

The desktop shell is a thin Wails v3 window around the local ATeam server.

```bash
# from the repository root
make dev-desktop
# or
go run ./apps/desktop
```

It starts the Go server on a random `127.0.0.1` port and loads the SPA in a native window. The shell and the web UI share the same process, database (`~/.ateam/ateam.db`), and scheduler.

## Requirements

- Go 1.27+
- Wails v3
- A built web app (`make web-build`) for the real UI; without it, the window shows the API placeholder page.

## Packaging

Packaging (macOS DMG, Windows NSIS, Linux AppImage) is planned for M1. The shell already uses the Wails v3 `application` API, so adding the standard `wails3 build` configuration is the remaining step.

## Notes

- The shell is intentionally thin: business logic lives in `internal/`, not in Wails bindings.
- The same `internal/app` package powers `ateam serve` (browser mode) and the desktop shell.
- Remote runners and team mode will reuse the same HTTP/WebSocket API.

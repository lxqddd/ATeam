# Contributing to ATeam

ATeam is an original, clean-room implementation. By contributing, you confirm that:

1. You wrote the contribution yourself, or have the right to submit it.
2. You did not copy code, documentation, screenshots, icons, copy, or other assets from another product.
3. You did not use confidential information or trade secrets from a former employer or another company.
4. Your contribution is licensed under Apache-2.0.

## Development flow

```bash
make web-install
make dev-server   # terminal A
make dev-web      # terminal B
make test
```

Keep changes focused. For a new runtime adapter, implement the `runtime.Adapter` interface and register it in `internal/runtime`. For a new integration, add it under `internal/` behind an interface rather than calling a third-party SDK from handlers.

## Commit sign-off

Use the Developer Certificate of Origin (DCO):

```text
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds the sign-off automatically.

## Code style

- Go: `gofmt`, `go vet`, small interfaces, `context.Context` on blocking calls.
- TypeScript/Vue: `<script setup lang="ts">`, Composition API, Pinia stores, typed API client.
- No secrets in code, tests, fixtures, or documentation.

## Reporting issues

Open an issue with reproduction steps, expected behavior, and environment details. Do not include credentials or private repository contents.

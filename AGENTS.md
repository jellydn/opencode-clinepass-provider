# AGENTS.md — opencode-clinepass-provider

## Quick start

```bash
bun install
bun run lint           # oxlint — 0 warnings target
bun run typecheck      # tsc --noEmit — run before pushing
bun run test           # vitest run (81 tests, 8 files)
bun run test:watch     # vitest
bun run fmt            # oxfmt — format in place
bun run fmt:check      # oxfmt --check (CI)
bun run lint:fix       # oxlint --fix
bun run konsistent     # structural convention checks
```

Run `lint → typecheck → test` before pushing. Tests require no network — all I/O is injected.

## Architecture

7 modules under `src/`, entrypoint is `src/clinepass.ts`. A barrel file that re-exports everything from the other 6 modules — tests import from `"../src/clinepass.js"`.

No build step — this is raw TypeScript run directly by Bun.

## Plugin export shape

`src/clinepass.ts` uses a V1 compatibility wrapper — NOT `export default ClinePassPlugin`:

```ts
export default { id: "opencode-clinepass-provider", server: ClinePassPlugin };
```

Named exports (types, helpers) are safe alongside it — the `{ id, server }` object keeps the legacy loader from iterating over every export.

## Key conventions

- **No semicolons, double quotes** for strings
- **All I/O injectable** via `IoOptions` / `WorkosRefreshOptions` — no `vi.mock()` needed in tests
- **`sanitizeApiKey()`** strips bracketed paste wrappers and control chars (users paste from terminals)
- **`classifyClinePassError()`** maps raw messages to user-friendly types (403/401/429)
- **Private helpers stay private** (`walkClineProviderSettings`, `readJsonFile`, `defaultRead` in `auth.ts`)
- **`client.app.log(...).catch(() => {})`** — logging failures must not crash the plugin

## Testing

- Uses `tests/helpers.ts` fakes: `fakeFetch`, `fakeClient`, `ioFor`, `ioByPath`
- Per-module tests in `tests/unit/`, plugin integration tests in `tests/clinepass.test.ts`
- `fetchRemoteModels()` gracefully returns `undefined` on any error — callers fall back to `MODELS` static array

## Auth paths

- Cline CLI: `~/.cline/data/settings/providers.json` (key `providers["cline-pass"|"cline"].settings.auth`)
- OpenCode auth: `~/.local/share/opencode/auth.json` and macOS `~/Library/Application Support/opencode/auth.json`
- WorkOS tokens are prefixed `workos:`, refreshed lazily in `chat.headers` hook (5 min margin)
- Static API key from `CLINE_API_KEY` env var or `providers.json settings.apiKey`

## Node version

Requires Node >= 22 (engines field in package.json).

## Reference

Detailed architecture, conventions, and testing docs live in `.planning/codebase/`.

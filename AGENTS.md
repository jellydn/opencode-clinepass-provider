# AGENTS.md — opencode-clinepass-provider

## Quick start

```bash
bun install
bun run fmt            # oxfmt — no semicolons, double quotes, trailing commas
bun run lint           # oxlint — 0 warnings target
bun run typecheck      # tsc --noEmit
bun run test           # vitest run (no network)
bun run test:watch     # vitest
bun run konsistent     # structural convention checks
```

Run `fmt → lint → typecheck → test` before pushing. Pre-commit runs `fmt`, `lint`, and `konsistent` automatically.

## Runtime model

- **No build step** — Bun runs the raw TypeScript source directly.
- `@opencode-ai/plugin`, `@opencode-ai/sdk`, and `@ai-sdk/openai-compatible` are provided by OpenCode at runtime. They are intentionally `devDependencies` here for typechecking and testing — do not add them as production dependencies.

## Plugin structure

- Only `src/clinepass.ts` is a plugin entry point. OpenCode's file-based plugin scanner would load any other `.ts` file at the top level as a standalone plugin, so the six helper modules live under `src/lib/`:

```
src/clinepass.ts          # plugin + barrel re-exports
src/lib/{utils,env,errors,workos,auth,models}.ts
```

## Plugin export shape

`src/clinepass.ts` must export the V1 compatibility object — **not** `export default ClinePassPlugin`:

```ts
export default { id: "opencode-clinepass-provider", server: ClinePassPlugin };
```

The legacy loader iterates every export if you default-export the function, so the `{ id, server }` wrapper is required. Named re-exports of helpers and types are safe alongside it.

## Style

`.oxfmtrc.json` locks the repo style:

- No semicolons
- Double quotes for strings
- `trailingComma: "all"`
- `printWidth: 120`, `tabWidth: 2`
- ESM imports use `.js` extensions: `from "./lib/auth.js"`
- JSDoc `/** ... */` on every exported function

## Conventions

- **All I/O injectable** via `IoOptions` / `WorkosRefreshOptions` — prefer dependency injection over `vi.mock()` in tests.
- **`sanitizeApiKey()`** strips bracketed paste wrappers (`[200~`, `[201~`) and control characters so terminal-pasted keys work.
- **`classifyClinePassError()`** maps raw error messages to user-friendly types (`not_subscribed`, `auth_expired`, `rate_limited`) for 403/401/429.
- **`client.app.log(...).catch(() => {})`** — logging failures must not crash the plugin.
- **Private helpers stay private** (`walkClineProviderSettings`, `readJsonFile`, `defaultRead` in `auth.ts`).
- **In-memory auth cache** lives in `auth.ts` (`getCachedAuth` / `setCachedAuth`); `persistAuth` updates both the SDK auth store and the cache.

## Auth paths

- **Cline CLI**: `~/.cline/data/settings/providers.json` — keys `providers["cline-pass"].settings` (then `providers["cline"].settings`).
- **OpenCode auth store**: `~/.local/share/opencode/auth.json`, with macOS fallback `~/Library/Application Support/opencode/auth.json`.
- **Kilo auth store**: `~/.local/share/kilo/auth.json` (preferred when the process is the Kilo CLI).
- **WorkOS tokens** are prefixed `workos:`, refreshed lazily via custom `fetch` + `chat.headers` (5-minute margin).
- **Static API key** priority: `CLINE_API_KEY` env var → `providers.json settings.apiKey` (wins over stored OAuth).

## Testing

- Shared fakes in `tests/helpers.ts`: `fakeFetch`, `fakeClient`, `ioFor`, `ioByPath`.
- One module test per source file in `tests/unit/`; `tests/clinepass.test.ts` covers `autoImportCredentials` only; plugin hooks are in `tests/unit/plugin-hooks.test.ts`.
- Tests require no network — all I/O is injected. The only allowed `vi.mock()` is in plugin-hooks tests for the module-scoped auth cache.
- `fetchRemoteModels()` returns `undefined` on any error; callers fall back to the static `MODELS` array.

## Reference

Detailed architecture, conventions, and testing docs live in `.planning/codebase/`.

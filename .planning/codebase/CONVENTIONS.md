# Conventions

## Code Style

- **Semicolons**: None (Bun/TypeScript default style)
- **Quotes**: Double quotes for strings
- **JSDoc**: Every exported function has a `/** ... */` comment explaining purpose
- **Section headers**: `// ─── Section Name ──` with em-dash separators
- **Module headers**: Each file starts with a `@module` JSDoc tag

## Export Patterns

- **Default export**: `{ id: "opencode-clinepass-provider", server: ClinePassPlugin }` — required by OpenCode's V1 plugin loader
- **Named exports**: All functions, types, and constants that need to be testable or consumed
- **Barrel re-exports**: `clinepass.ts` re-exports everything using `export { ... } from "...js"` syntax
- **Private helpers**: Non-exported `function` declarations for internal use (`walkClineProviderSettings`, `readJsonFile`, `defaultRead`, `errMsg`)

## Type Patterns

- **Union types for constrained strings**: `type ThinkingLevel = "off" | "minimal" | ...`, `type ClinePassErrorType = "not_subscribed" | ...`
- **Readonly records for lookup tables**: `Readonly<Record<ThinkingLevel, string | null>>` — immutable by contract
- **Injectable IO options**: Every function with side effects accepts an optional options object with injectable alternatives (e.g., `IoOptions`, `WorkosRefreshOptions`)
- **Type assertions for SDK boundaries**: `ctx.client as unknown as ClientLike` bridges OpenCode's plugin context to the internal `ClientLike` interface

## Error Handling Patterns

1. **Never throw from auth file reading**: `readJsonFile` catches all errors and returns `undefined`
2. **Suppress ENOENT silently**: File-not-found errors are expected; only log corrupt/permission errors
3. **Classify before surfacing**: `classifyClinePassError` maps raw error messages → user-friendly types before displaying
4. **Graceful fallback**: `fetchRemoteModels` catches all errors and returns `undefined`; callers fall back to static data
5. **Silent catch for logging**: `client.app.log(...).catch(() => {})` — logging failures must not crash the plugin

## Auth Patterns

- **Credential priority chain**: Env var → Cline CLI file → OpenCode auth store
- **WorkOS token prefix**: `"workos:"` identifies OAuth tokens vs static API keys
- **Lazy refresh**: `chat.headers` hook checks expiry before each request (margin: 5 min)
- **In-memory cache**: `cachedAuth` avoids repeated FS reads for token state

## Testing Patterns

- **Dependency injection**: All I/O functions accept injectable alternatives — no FS mocking needed
- **Fake implementations**: `fakeFetch`, `fakeClient`, `ioFor`, `ioByPath` in `tests/helpers.ts`
- **1:1 module mapping**: Each source file has a corresponding test file in `tests/unit/`
- **Plugin-specific tests**: `clinepass.test.ts` only tests `autoImportCredentials` (the only unique logic in `clinepass.ts`)

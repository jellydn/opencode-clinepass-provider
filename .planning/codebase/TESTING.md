# Testing

## Framework

| Aspect | Choice |
|--------|--------|
| Framework | Vitest ^2.1.0 |
| Environment | Node (`vitest.config.ts`: `environment: "node"`) |
| Test pattern | `tests/**/*.test.ts` (8 files) |
| Runner | `bun run test` → `vitest run` |

## Test Structure

```
tests/
├── helpers.ts              # Shared fakes and utilities
├── clinepass.test.ts       # autoImportCredentials only
└── unit/
    ├── utils.test.ts       # isRecord, stringValue, numberValue, jwtExpirySeconds
    ├── env.test.ts         # resolveApiBase, sanitizeApiKey, isWorkosToken
    ├── errors.test.ts      # classifyClinePassError, messages validation
    ├── workos.test.ts      # refreshWorkosToken (refresh, expiresAt shapes, timeout, errors)
    ├── auth.test.ts        # credential extraction, auth store, extractKey, persistAuth cache
    ├── models.test.ts      # MODELS, modelsToConfig, buildProviderConfig,
    │                       #             injectProviderConfig, fetchRemoteModels
    └── plugin-hooks.test.ts # plugin hooks (config, provider.models, chat.headers, auth loader, event)
```

**Total**: 99 tests across 8 files (run `bun run test` to confirm)

## Shared Test Helpers (`tests/helpers.ts`)

| Helper | Purpose |
|--------|---------|
| `clineProvidersJson(opts)` | Generate mock `providers.json` with Cline CLI structure |
| `ioFor(content, exists)` | Minimal `IoOptions` — single file, single home dir |
| `fakeFetch(body, opts)` | Mock `fetch` returning controlled JSON responses |
| `ioByPath(map)` | `IoOptions` that resolves multiple paths → file contents |
| `fakeClient()` | Mock `ClientLike` tracking `calls.set` and `calls.logs` |
| `HOME`, `CLINE_PATH`, `AUTH_PATH` | Shared path constants |

## Test Coverage by Module

### `utils.test.ts`
- `isRecord`: objects → true, arrays/null/strings → false
- `stringValue`: strings pass through, non-strings → undefined
- `numberValue`: numbers/strings pass through, empty/NaN → undefined
- `jwtExpirySeconds`: decodes `workos:` JWT exp, rejects malformed input

### `env.test.ts`
- `resolveApiBase`: default, custom with trailing slashes, whitespace-only
- `sanitizeApiKey`: bracketed paste wrappers, ANSI wrappers, control characters
- `isWorkosToken`: prefix detection, non-workos tokens

### `errors.test.ts`
- 403 → `not_subscribed`, 401 → `auth_expired`, 429 → `rate_limited`, unknown → `unknown`
- Case insensitive matching
- "subscription required" phrase detection
- All error messages are non-empty strings

### `workos.test.ts`
- Refresh via nested `{ data: { ... } }` envelope, adds `workos:` prefix
- Preserves existing `workos:` prefix
- accessToken-only responses reuse the input refresh token
- Honors `expiresAt` as ISO string, numeric ms, or numeric seconds
- Throws on `success:false`, non-OK response, missing tokens, AbortError timeout

### `auth.test.ts`
- `resolveClineAuthCredentials`: extracts from `cline-pass` and `cline` providers, incomplete auth, no auth, defaults `expiresAt`
- `resolveClineStaticKey`: env var priority, reads from `providers.json`, undefined when nothing set
- `readOpencodeAuth` / `saveOpencodeAuth`: store round-trips and platform path behaviour
- `extractKey`: oauth→access, api→key, wellknown→key, undefined→undefined
- `persistAuth`: updates in-memory cache via `setCachedAuth`

### `models.test.ts`
- `MODELS`: 10 models, all have `reasoning` + 6-level `thinkingLevelMap`
- Thinking levels: GLM xhigh, Kimi null-off, DeepSeek high/xhigh only (off/minimal/low/medium null)
- `modelsToConfig`: includes name, limit, reasoning, thinkingLevelMap
- `buildProviderConfig`: npm package, name, baseURL, model count, reasoning metadata
- `injectProviderConfig`: injects when absent, preserves existing, doesn't overwrite
- `fetchRemoteModels`: no apiKey→undefined, data envelope with reasoning, filters non-cline-pass, falls back to static, non-ok response→undefined, network error→undefined

### `clinepass.test.ts`
- Skips when clinepass auth already exists
- Imports fresh WorkOS credentials without refreshing
- Refreshes expired WorkOS credentials before importing
- Imports static API key from env
- Logs warning when no credentials found

### `plugin-hooks.test.ts`
- **config hook**: injects into empty config, preserves existing, preserves other providers
- **provider.models hook**: falls back to static when no auth / remote fetch fails
- **chat.headers hook**: no-op for other providers / missing info / api auth; injects Authorization for oauth; suppresses stale bearer on unrecoverable refresh failure; saves on successful refresh
- **auth loader hook**: returns apiKey for oauth/api/wellknown; falls back to file auth; returns {} for null/undefined/rejected
- **event hook**: no-op for non-session / unknown errors; logs friendly 403/401/429

## Mocking Patterns

- **Prefer injection**: All I/O functions accept injectable alternatives — unit tests pass fakes via options
- **Controlled fetch**: `fakeFetch(body)` returns a controlled `Response`-like object with `.ok`, `.status`, `.json()`, `.text()`
- **Auth file simulation**: `ioByPath(map)` maps file paths → file contents, simulating the filesystem
- **Client tracking**: `fakeClient()` tracks all `auth.set()` and `app.log()` calls for assertion
- **Limited `vi.mock`**: `plugin-hooks.test.ts` mocks `readOpencodeAuth` / `saveOpencodeAuth` / cache helpers so hook tests do not touch the real filesystem or module cache

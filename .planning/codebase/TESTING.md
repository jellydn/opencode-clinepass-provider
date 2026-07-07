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
├── helpers.ts            # Shared fakes and utilities
├── clinepass.test.ts     # 5 tests — autoImportCredentials only
└── unit/
    ├── utils.test.ts     # 3 tests  — isRecord, stringValue, numberValue
    ├── env.test.ts       # 7 tests  — resolveApiBase, sanitizeApiKey, isWorkosToken
    ├── errors.test.ts    # 7 tests  — classifyClinePassError, messages validation
    ├── workos.test.ts    # 5 tests  — refreshWorkosToken (refresh, timeout, errors)
    ├── auth.test.ts      # 14 tests — credential extraction, auth store, extractKey
    ├── models.test.ts    # 17 tests — MODELS, modelsToConfig, buildProviderConfig,
                          #             injectProviderConfig, fetchRemoteModels
    └── clinepass.test.ts # 23 tests — plugin hook tests (config, provider.models,
                          #             chat.headers, auth loader, event)
```

**Total**: 81 tests across 8 files (up from 55 in 1 monolithic file)

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

### `utils.test.ts` (3 tests)
- `isRecord`: objects → true, arrays/null/strings → false
- `stringValue`: strings pass through, non-strings → undefined
- `numberValue`: numbers/strings pass through, empty/NaN → undefined

### `env.test.ts` (7 tests)
- `resolveApiBase`: default, custom with trailing slashes, whitespace-only
- `sanitizeApiKey`: bracketed paste wrappers, ANSI wrappers, control characters
- `isWorkosToken`: prefix detection, non-workos tokens

### `errors.test.ts` (7 tests)
- 403 → `not_subscribed`, 401 → `auth_expired`, 429 → `rate_limited`, unknown → `unknown`
- Case insensitive matching
- "subscription required" phrase detection
- All error messages are non-empty strings

### `workos.test.ts` (5 tests)
- Refresh via nested `{ data: { ... } }` envelope, adds `workos:` prefix
- Preserves existing `workos:` prefix
- Throws on non-OK response
- Throws when tokens are missing from response
- Throws friendly timeout error on `AbortError`

### `auth.test.ts` (14 tests)
- `resolveClineAuthCredentials`: extracts from `cline-pass` and `cline` providers, incomplete auth, no auth, defaults `expiresAt`
- `resolveClineStaticKey`: env var priority, reads from `providers.json`, undefined when nothing set
- `readOpencodeAuth`: returns stored auth, undefined when absent
- `extractKey`: oauth→access, api→key, wellknown→key, undefined→undefined

### `models.test.ts` (17 tests)
- `MODELS`: 10 models, all have `reasoning` + 6-level `thinkingLevelMap`
- Thinking levels: GLM xhigh, Kimi null-off, DeepSeek null-low/medium + xhigh→high
- `modelsToConfig`: includes name, limit, reasoning, thinkingLevelMap
- `buildProviderConfig`: npm package, name, baseURL, model count, reasoning metadata
- `injectProviderConfig`: injects when absent, preserves existing, doesn't overwrite
- `fetchRemoteModels`: no apiKey→undefined, data envelope with reasoning, filters non-cline-pass, falls back to static, non-ok response→undefined, network error→undefined

### `clinepass.test.ts` (5 tests)
- Skips when clinepass auth already exists
- Imports fresh WorkOS credentials without refreshing
- Refreshes expired WorkOS credentials before importing
- Imports static API key from env
- Logs warning when no credentials found

### `unit/clinepass.test.ts` (23 tests)
- **config hook** (3): injects into empty config, preserves existing, preserves other providers
- **provider.models hook** (3): falls back to static when no auth, falls back on remote fetch failure (api/oauth)
- **chat.headers hook** (5): no-op for other providers, no-op for missing info, no-op for api auth, injects Authorization for oauth, handles expired token refresh failure gracefully
- **auth loader hook** (6): returns apiKey for oauth/api/wellknown, returns {} for null/undefined/rejected auth
- **event hook** (6): no-op for non-session events, no-op for non-clinepass errors, logs for 403/401/429, no-op for events without error message

## Mocking Patterns

- **No `vi.mock()` needed**: All I/O is injected via options objects — tests pass fake implementations directly
- **Controlled fetch**: `fakeFetch(body)` returns a controlled `Response`-like object with `.ok`, `.status`, `.json()`, `.text()`
- **Auth file simulation**: `ioByPath(map)` maps file paths → file contents, simulating the filesystem
- **Client tracking**: `fakeClient()` tracks all `auth.set()` and `app.log()` calls for assertion

# Architecture

## Pattern: Modular Plugin with Barrel Re-exports

The project follows the architecture of [jellydn/pi-clinepass-provider](https://github.com/jellydn/pi-clinepass-provider):

- **7 modules** with single responsibilities
- **1 barrel file** (`clinepass.ts`) — plugin entry + re-exports everything for test imports
- **Per-module tests** — 1:1 mapping between source and test files

## Module Dependency Graph

```
src/utils.ts          (type guards, zero deps)
src/env.ts            (constants, env helpers, IoOptions)
src/errors.ts         (error classification)
src/workos.ts         ── depends on utils, env
src/auth.ts           ── depends on utils, env, @opencode-ai/sdk
src/models.ts         ── depends on env
src/clinepass.ts      ── depends on ALL modules + @opencode-ai/plugin
```

## Layers

### 1. Foundation Layer (utils, env)
Pure functions with no side effects. All I/O is injectable via `IoOptions` for testability.
- `utils.ts`: `isRecord`, `stringValue`, `numberValue`
- `env.ts`: Constants (`PROVIDER_ID`, paths, timeouts), `resolveApiBase`, `sanitizeApiKey`, `isWorkosToken`, `IoOptions`

### 2. Domain Layer (errors, workos, auth, models)
Business logic with injected dependencies.
- `errors.ts`: `classifyClinePassError` — maps error messages to user-friendly types
- `workos.ts`: `refreshWorkosToken` — calls Cline's refresh endpoint
- `auth.ts`: Credential extraction from Cline CLI, OpenCode auth store helpers, `extractKey`
- `models.ts`: `MODELS` array, `modelsToConfig`, `fetchRemoteModels`, `buildProviderConfig`, `injectProviderConfig`

### 3. Plugin Layer (clinepass.ts)
OpenCode plugin implementation. Orchestrates all domain modules:
- `autoImportCredentials` — zero-config credential import at startup
- `ClinePassPlugin` — the plugin function returned by the module
- Hooks: `config`, `provider.models`, `auth`, `chat.headers`, `event`

## Data Flow: Request Lifecycle

```
1. Plugin init
   └─ autoImportCredentials() → stores creds in OpenCode auth store
   └─ config hook → injectProviderConfig() → adds clinepass provider to config

2. User runs /connect → ClinePass
   └─ auth.methods[0].authorize() → resolveClineAuthCredentials()
   └─ Returns { url, method: "auto", callback }
   └─ callback() → { type: "success", access, refresh, expires }

3. User selects a ClinePass model
   └─ loader(auth) → extractKey(stored_auth) → { apiKey: key }
   └─ provider.models → fetchRemoteModels(key) or modelsToConfig()

4. Request sent
   └─ chat.headers hook → check token expiry
   └─ If expired: refreshWorkosToken() → inject Authorization header
   └─ If static key: skip (loader handles auth via apiKey option)

5. Response received
   └─ event hook → classifyClinePassError() for 403/401/429
```

## Key Design Decisions

1. **All I/O injectable**: `IoOptions`, `WorkosRefreshOptions`, `RemoteModelsOptions` — every function that does I/O accepts injectable alternatives for testing.

2. **Barrel re-exports**: `clinepass.ts` re-exports everything from all modules so tests can import from a single entry point (`../src/clinepass`). This preserves backward compatibility with the original monolithic structure.

3. **Private helpers stay private**: `walkClineProviderSettings`, `readJsonFile`, and `defaultRead` in `auth.ts` are not exported — they're implementation details.

4. **Static fallback for model discovery**: `fetchRemoteModels` tries the API first, falls back to the static `MODELS` array. Remote models without a static entry fall back to `DEFAULT_THINKING_LEVEL_MAP`.

5. **Dual auth methods**: The auth hook registers both OAuth (WorkOS token reuse) and API key methods, with auto-import at startup for zero-config setup.

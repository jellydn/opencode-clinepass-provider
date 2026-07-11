# Concerns

## Known Limitations

### 1. `@ai-sdk/openai` Incompatibility
**Severity**: Medium | **File**: `src/lib/models.ts`

The provider was briefly switched from `@ai-sdk/openai-compatible` to `@ai-sdk/openai` to enable first-class `reasoningEffort` support, but this caused auth failures. The `@ai-sdk/openai` provider uses the official OpenAI client which may handle injected `apiKey` differently from `@ai-sdk/openai-compatible`. Reverted to `@ai-sdk/openai-compatible`. The thinking level maps remain as metadata for future use.

### 2. OAuth Auth Flow Opens Unnecessary Browser Tab
**Severity**: Low | **File**: `src/clinepass.ts`

The OAuth authorize method returns `{ url: "https://app.cline.bot", method: "auto", callback }`. OpenCode opens the URL in the browser while also calling the callback immediately. Users see a browser tab open to `app.cline.bot` with no action needed — confusing but harmless. The SDK type `AuthOAuthResult` requires `url` and `instructions`, so we can't omit them.

### 3. No Per-Model Reasoning Effort at Runtime
**Severity**: Low | **File**: `src/lib/models.ts`

The thinking level maps (`ThinkingLevelMap`) are stored in the model config but `@ai-sdk/openai-compatible` doesn't support `reasoningEffort` as a first-class parameter. The metadata is available for OpenCode's UI (model selection, capability display) but doesn't affect API requests. To enable end-to-end reasoning, OpenCode would need to support `reasoningEffort` with `openai-compatible` providers, or the plugin would need to inject it via `chat.headers` (which currently only handles auth).

### 4. Token Refresh Failures Surface as Auth Errors
**Severity**: Low | **File**: `src/clinepass.ts`

When `refreshWorkosToken()` fails in `chat.headers`, the error is logged. If the token is already expired, the hook no longer sends a stale `Authorization` header (avoids a guaranteed 401 that masks the real failure). If the token is still within the refresh margin, the existing bearer is sent as a best-effort fallback. Proactive re-auth prompting in the UI remains OpenCode's responsibility.

### 5. No Rate Limit Backoff
**Severity**: Low | **File**: `src/lib/errors.ts`

The error classification detects 429 responses but doesn't implement retry logic or exponential backoff. OpenCode handles retries at its level — the plugin just surfaces a friendly message.

## Technical Debt

### 6. Duplicate Credential Resolution Logic
**Severity**: Minor | **File**: `src/lib/auth.ts`, `src/clinepass.ts`

`resolveClineAuthCredentials()` is called in three places: `autoImportCredentials`, the OAuth `authorize` callback, and implicitly via the `loader`. Each call site handles the credentials slightly differently (auto-import persists to auth store, authorize caches in memory, loader extracts the key). Could be unified under a single credential resolution pipeline.

### 7. SDK Boundary Casts for Model Config
**Severity**: Minor | **File**: `src/clinepass.ts`

The `provider.models` hook returns `remote as unknown as Record<string, ModelV2>` (and the same for the static fallback) because `ModelConfigEntry` carries fields (`limit`, `thinkingLevelMap`) that `ModelV2` does not declare but OpenCode consumes at runtime. Honest boundary casts with comments — not `as any`.

### 8. No Rate Limit or Circuit Breaker for WorkOS Refresh
**Severity**: Minor | **File**: `src/lib/workos.ts`

`refreshWorkosToken()` retries on every request when a token is near expiry. If the refresh endpoint is temporarily down, every subsequent request will attempt a refresh, fail, log an error, and then fail the API call. A circuit breaker or cooldown period would reduce noise.

## Security

### 9. API Key Sanitization
**Severity**: Low | **File**: `src/lib/env.ts`

`sanitizeApiKey()` strips terminal paste wrappers and control characters. This is a defense-in-depth measure against accidental paste issues. Keys are never logged — the `readJsonFile` is explicitly warned to "never log file contents or the resolved key."

### 10. Auth Files Are Read from User Home
**Severity**: Info | **File**: `src/lib/auth.ts`

Credentials are read from `~/.cline/data/settings/providers.json` and `~/.local/share/opencode/auth.json`. These are user-owned files with standard permissions. No credentials are bundled or hardcoded.

## Performance

### 11. `MODELS.find()` in `fetchRemoteModels` → Fixed
**Severity**: Resolved | **File**: `src/lib/models.ts`

~~`fetchRemoteModels` used `MODELS.find(m => m.id === id)` for each remote model (O(n²) worst case).~~ Fixed: replaced with `new Map(MODELS.map(m => [m.id, m])).get(id)` for O(1) lookups.

### 12. `sanitizeApiKey` Uses 4 `.replaceAll()` Calls
**Severity**: Negligible | **File**: `src/lib/env.ts`

Four sequential string replacements could be combined into one regex. But this function is called once during auth setup, not on hot paths — clarity is more important than micro-optimization.

## Fragile Areas

### 13. OpenCode SDK Version Coupling
**Severity**: Medium | **File**: `package.json`

The plugin depends on `@opencode-ai/plugin@^1.17.13` and `@opencode-ai/sdk@^1.17.13`. The SDK's `AuthOAuthResult` type dictates the auth flow shape. Breaking changes in the SDK (e.g., changing the authorize return type) would break the plugin. The caret range (`^1.17.13`) allows minor/patch updates which should be compatible.

### 14. Cline API Model Endpoint Availability
**Severity**: Low | **File**: `src/lib/models.ts`

`fetchRemoteModels` has a 5-second timeout and falls back to the static `MODELS` array on any error. This is resilient. But if Cline's API changes the model format (e.g., renames `context_length` → `context_window`), remote model discovery would silently fail and fall back to static data without surfacing the incompatibility.

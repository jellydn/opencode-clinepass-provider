# Integrations

## Cline API

**Endpoint**: `https://api.cline.bot/api/v1` (override with `CLINE_API_BASE`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/chat/completions` | POST | OpenAI-compatible chat completions |
| `/api/v1/models` | GET | Model listing (OpenAI-compatible format: `{ data: [...] }`) |
| `/api/v1/auth/refresh` | POST | WorkOS OAuth token refresh |

Auth: Bearer token with `workos:` prefix for WorkOS OAuth tokens, or bare API key.

## Cline CLI (Credential Source)

**Path**: `~/.cline/data/settings/providers.json`

The Cline CLI stores credentials in a nested JSON structure:

```json
{
  "providers": {
    "cline-pass": {
      "settings": {
        "apiKey": "ck_...",           // static API key
        "auth": {
          "accessToken": "workos:eyJ...",
          "refreshToken": "r...",
          "expiresAt": 1735689600,
          "accountId": "..."
        }
      }
    },
    "cline": {
      "settings": {
        "auth": { ... }  // fallback provider key
      }
    }
  }
}
```

Credential resolution priority (`src/lib/auth.ts`):
1. `CLINE_API_KEY` env var
2. `~/.cline/data/settings/providers.json` → `providers["cline-pass"].settings.apiKey`
3. `~/.cline/data/settings/providers.json` → `providers["cline-pass"].settings.auth` (WorkOS OAuth)
4. Fallback to `providers["cline"].settings` entries

## OpenCode Auth Store

**Paths** (`src/lib/auth.ts`):
- `~/.local/share/opencode/auth.json` (Linux/macOS)
- `~/Library/Application Support/opencode/auth.json` (macOS fallback)

The plugin reads/writes auth entries keyed by provider id (`clinepass`):

```json
{
  "clinepass": {
    "type": "oauth",
    "access": "workos:eyJ...",
    "refresh": "r...",
    "expires": 1735689600
  }
}
```

## WorkOS OAuth

**Provider**: WorkOS (Cline's auth provider)

**Token format**: Access tokens are prefixed with `workos:` (e.g., `workos:eyJ...`). Refresh tokens are opaque strings without the prefix.

**Refresh flow** (`src/lib/workos.ts`):
1. POST `{apiBase}/api/v1/auth/refresh` with `{ granttype: "refresh_token", refreshToken }`
2. Response: `{ data: { accessToken, refreshToken } }` (nested) or `{ accessToken, refreshToken }` (flat)
3. New access token is re-prefixed with `workos:` if the API returns a bare JWT
4. Timeout: 15 seconds. Refresh margin: 5 minutes before expiry.

## Auth Methods (User-facing)

| Method | Type | Source |
|--------|------|--------|
| Cline CLI / ClinePass subscription | OAuth | Reuses `~/.cline/data/settings/providers.json` WorkOS credentials |
| Static API key | API | User pastes key from `app.cline.bot → Settings → API Keys` |

## Model Discovery

**Endpoint**: `GET /api/v1/models` (OpenAI-compatible format)
- Response: `{ data: [{ id, name, context_length, max_output_tokens, reasoning }] }`
- Filters to models with `cline-pass/` prefix
- 5-second timeout, falls back to static `MODELS` array on any error

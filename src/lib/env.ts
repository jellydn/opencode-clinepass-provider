/**
 * Constants, environment helpers, and shared I/O options.
 *
 * @module env
 */

import { join } from "node:path"

/** Provider id used in opencode.json (`provider.clinepass`) and auth.json. */
export const PROVIDER_ID = "clinepass"

/** Cline API base URL (override with CLINE_API_BASE). */
export const DEFAULT_API_BASE = "https://api.cline.bot"

/** Env var that holds a static ClinePass API key. */
export const ENV_API_KEY = "CLINE_API_KEY"

/** Env var that overrides the API base URL. */
export const ENV_API_BASE = "CLINE_API_BASE"

/** Prefix that identifies WorkOS OAuth access tokens (e.g. "workos:eyJ…"). */
export const WORKOS_TOKEN_PREFIX = "workos:"

/** Cline's server-side token refresh endpoint (relative to the API base). */
export const CLINE_REFRESH_PATH = "/api/v1/auth/refresh"

/** Cline API Keys dashboard, opened during manual API-key login. */
export const DASHBOARD_URL = "https://app.cline.bot/settings/api-keys"

/** Path (relative to $HOME) of the Cline CLI provider settings file. */
export const CLINE_CLI_AUTH_REL = join(".cline", "data", "settings", "providers.json")

/** Path (relative to $HOME) of opencode's stored credentials. */
export const OPENCODE_AUTH_REL = join(".local", "share", "opencode", "auth.json")

/** Conservative WorkOS token lifetime estimate (~1h). */
export const WORKOS_TOKEN_LIFETIME_MS = 55 * 60 * 1000

/** Refresh this far before expiry to avoid races. */
export const WORKOS_REFRESH_MARGIN_MS = 5 * 60 * 1000

/** Timeout for the refresh HTTP request. */
export const WORKOS_REFRESH_TIMEOUT_MS = 15_000

/** Resolve the API base URL, honouring CLINE_API_BASE and normalising slashes. */
export function resolveApiBase(env: Record<string, string | undefined> = process.env): string {
  const base = env[ENV_API_BASE]?.trim()
  if (!base) return DEFAULT_API_BASE
  return base.replace(/\/+$/, "")
}

/** Strip terminal paste wrappers & control chars from pasted API keys. */
export function sanitizeApiKey(input: string): string {
  const esc = "\x1b"
  return input
    .replaceAll(`${esc}[200~`, "")
    .replaceAll(`${esc}[201~`, "")
    .replaceAll("[200~", "")
    .replaceAll("[201~", "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
}

/** Is this a WorkOS OAuth access token? */
export function isWorkosToken(token: string): boolean {
  return token.startsWith(WORKOS_TOKEN_PREFIX)
}

export interface IoOptions {
  env?: Record<string, string | undefined>
  homeDir?: () => string
  readFile?: (path: string) => string
  fileExists?: (path: string) => boolean
  writeFile?: (path: string, data: string) => void
  /** Atomically replace target file with source path (optional override for testing). */
  rename?: (from: string, to: string) => void
  /** Create parent directories (optional override for testing). */
  mkdir?: (path: string) => void
}

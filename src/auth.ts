/**
 * Cline CLI credential extraction, auth-file walking, and opencode auth store
 * helpers.
 *
 * @module auth
 */

import type { Auth } from "@opencode-ai/sdk/v2"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { isRecord, stringValue, numberValue } from "./utils.js"
import { IoOptions, ENV_API_KEY, WORKOS_TOKEN_LIFETIME_MS, CLINE_CLI_AUTH_REL, OPENCODE_AUTH_REL } from "./env.js"

function defaultRead(p: string): string {
  return readFileSync(p, "utf-8")
}

/** Walk Cline CLI providers.json `providers["cline-pass"|"cline"].settings`. */
function walkClineProviderSettings<T>(
  parsed: Record<string, unknown>,
  extract: (settings: Record<string, unknown>) => T | undefined,
): T | undefined {
  const providers = isRecord(parsed.providers) ? parsed.providers : undefined
  if (!providers) return undefined
  for (const key of ["cline-pass", "cline"]) {
    const provider = isRecord(providers[key]) ? providers[key] : undefined
    if (!provider) continue
    const settings = isRecord(provider.settings) ? provider.settings : undefined
    if (!settings) continue
    const result = extract(settings)
    if (result !== undefined) return result
  }
  return undefined
}

/** Read & parse a JSON file, returning undefined on any error (never throws). */
function readJsonFile(path: string, opts: IoOptions = {}): Record<string, unknown> | undefined {
  const fileExists = opts.fileExists ?? existsSync
  const readFile = opts.readFile ?? defaultRead
  try {
    if (!fileExists(path)) return undefined
    const parsed: unknown = JSON.parse(readFile(path))
    return isRecord(parsed) ? parsed : undefined
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("ENOENT") && !msg.includes("not found")) {
      console.warn(`[clinepass] Warning: failed to read ${path}: ${msg}`)
    }
    return undefined
  }
}

/** WorkOS OAuth credentials extracted from the Cline CLI. */
export interface ClineAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
}

/** Paths searched for Cline CLI credentials. */
export function clineCliAuthPaths(home: string = homedir()): string[] {
  return [join(home, CLINE_CLI_AUTH_REL)]
}

/**
 * Extract WorkOS OAuth credentials from the Cline CLI's providers.json.
 * Looks at providers["cline-pass"].settings.auth then providers["cline"].settings.auth.
 * The accessToken may be expired — refresh via refreshWorkosToken() before use.
 */
export function resolveClineAuthCredentials(opts: IoOptions = {}): ClineAuthCredentials | undefined {
  const home = opts.homeDir?.() ?? homedir()
  for (const path of clineCliAuthPaths(home)) {
    const parsed = readJsonFile(path, opts)
    if (!parsed) continue
    const creds = walkClineProviderSettings(parsed, (settings) => {
      const auth = isRecord(settings.auth) ? settings.auth : undefined
      if (!auth) return undefined
      const accessToken = stringValue(auth.accessToken)
      const refreshToken = stringValue(auth.refreshToken)
      if (!accessToken || !refreshToken) return undefined
      const expiresAt = numberValue(auth.expiresAt) ?? Date.now() + WORKOS_TOKEN_LIFETIME_MS
      const accountId = stringValue(auth.accountId)
      return { accessToken, refreshToken, expiresAt, accountId } satisfies ClineAuthCredentials
    })
    if (creds) return creds
  }
  return undefined
}

/**
 * Resolve a static ClinePass API key (long-lived).
 * Priority: CLINE_API_KEY env → Cline CLI providers.json settings.apiKey.
 */
export function resolveClineStaticKey(opts: IoOptions = {}): string | undefined {
  const env = opts.env ?? process.env
  if (env[ENV_API_KEY]) return env[ENV_API_KEY]
  const home = opts.homeDir?.() ?? homedir()
  for (const path of clineCliAuthPaths(home)) {
    const parsed = readJsonFile(path, opts)
    if (!parsed) continue
    const key = walkClineProviderSettings(parsed, (settings) => stringValue(settings.apiKey))
    if (key) return key
  }
  return undefined
}

/** Paths searched for opencode's stored credentials. */
export function opencodeAuthPaths(home: string = homedir()): string[] {
  return [join(home, OPENCODE_AUTH_REL), join(home, "Library", "Application Support", "opencode", "auth.json")]
}

/** Read the stored Auth for a provider id from opencode's auth.json. */
export function readOpencodeAuth(id: string, opts: IoOptions = {}): Auth | undefined {
  const home = opts.homeDir?.() ?? homedir()
  for (const path of opencodeAuthPaths(home)) {
    const parsed = readJsonFile(path, opts)
    if (!parsed) continue
    const entry = parsed[id]
    if (isRecord(entry)) return entry as unknown as Auth
  }
  return undefined
}

export function oauthAuth(access: string, refresh: string, expires: number, accountId?: string): Auth {
  const a: Auth = { type: "oauth", access, refresh, expires }
  if (accountId) (a as { accountId?: string }).accountId = accountId
  return a
}

export function apiAuth(key: string): Auth {
  return { type: "api", key }
}

/** Extract a usable bearer token from a stored Auth record. */
export function extractKey(auth?: Auth | null): string | undefined {
  if (!auth) return undefined
  if (auth.type === "oauth") return auth.access
  if (auth.type === "api" || auth.type === "wellknown") return auth.key
  return undefined
}

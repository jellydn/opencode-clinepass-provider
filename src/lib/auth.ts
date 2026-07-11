/**
 * Cline CLI credential extraction, auth-file walking, and opencode auth store
 * helpers.
 *
 * @module auth
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Auth } from "@opencode-ai/sdk/v2"
import {
  CLINE_CLI_AUTH_REL,
  ENV_API_KEY,
  type IoOptions,
  KILO_AUTH_REL,
  OPENCODE_AUTH_REL,
  sanitizeApiKey,
  WORKOS_TOKEN_LIFETIME_MS,
} from "./env.js"
import { errMsg, isRecord, jwtExpirySeconds, numberValue, stringValue } from "./utils.js"
import { ensureValidWorkosToken, type RefreshedToken } from "./workos.js"

function defaultRead(p: string): string {
  return readFileSync(p, "utf-8")
}

/**
 * In-memory auth cache (perf: avoids a per-request file read of auth.json).
 *
 * Invalidation contract: the cache is written by `setCachedAuth` (auth loader
 * and refresh paths) and by `persistAuth` (which always ends with
 * `setCachedAuth`). It is never invalidated by a bare `saveOpencodeAuth` on
 * disk, so a concurrent external change to the file won't be observed until
 * the next loader/refresh pass. The file read is the cold-start fallback.
 */
const authCache = new Map<string, Auth>()

/** Resolve the latest known Auth for a provider — in-memory cache, then file. */
export function getCachedAuth(id: string, opts: IoOptions = {}): Auth | undefined {
  return authCache.get(id) ?? readOpencodeAuth(id, opts)
}

/** Update the in-memory auth cache (loader, refresh, and persistAuth). */
export function setCachedAuth(id: string, auth: Auth | undefined): void {
  if (auth) authCache.set(id, auth)
  else authCache.delete(id)
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
    const msg = errMsg(e)
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
      return {
        accessToken,
        refreshToken,
        expiresAt,
        accountId,
      } satisfies ClineAuthCredentials
    })
    if (creds) return creds
  }
  return undefined
}

/**
 * Resolve a static ClinePass API key (long-lived).
 * Priority: CLINE_API_KEY env → Cline CLI providers.json settings.apiKey.
 * Sanitizes paste wrappers/control chars so terminal-exported keys work.
 */
export function resolveClineStaticKey(opts: IoOptions = {}): string | undefined {
  const env = opts.env ?? process.env
  const fromEnv = sanitizeApiKey(env[ENV_API_KEY] ?? "")
  if (fromEnv) return fromEnv
  const home = opts.homeDir?.() ?? homedir()
  for (const path of clineCliAuthPaths(home)) {
    const parsed = readJsonFile(path, opts)
    if (!parsed) continue
    const key = walkClineProviderSettings(parsed, (settings) => {
      const raw = stringValue(settings.apiKey)
      return raw ? sanitizeApiKey(raw) : undefined
    })
    if (key) return key
  }
  return undefined
}

/**
 * True when this process is the Kilo Code CLI (OpenCode-compatible fork).
 * Used to prefer ~/.local/share/kilo/auth.json over OpenCode's auth store.
 */
export function isKiloHost(): boolean {
  const argv0 = process.argv0 ?? ""
  const argv1 = process.argv[1] ?? ""
  const blob = `${argv0} ${argv1}`.toLowerCase()
  // Binary names like `kilo`, `kilo.exe`, or paths ending in /kilo
  if (/(^|[\\/])kilo(\.exe)?$/.test(argv0.toLowerCase())) return true
  if (blob.includes("kilo") && !blob.includes("opencode")) return true
  return false
}

/**
 * Paths searched for host credential stores (OpenCode + Kilo Code).
 * Host-primary path is first so reads/writes prefer the product that's running.
 */
export function opencodeAuthPaths(home: string = homedir()): string[] {
  const kilo = [join(home, KILO_AUTH_REL), join(home, "Library", "Application Support", "kilo", "auth.json")]
  const opencode = [
    join(home, OPENCODE_AUTH_REL),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]
  return isKiloHost() ? [...kilo, ...opencode] : [...opencode, ...kilo]
}

/** Read the stored Auth for a provider id from the host auth.json. */
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

/** Build an oauth Auth record for the OpenCode auth store. */
export function oauthAuth(access: string, refresh: string, expires: number, accountId?: string): Auth {
  const a: Auth = { type: "oauth", access, refresh, expires }
  if (accountId) a.accountId = accountId
  return a
}

/**
 * True expiry (ms since epoch) of an oauth Auth — prefers the JWT `exp` claim,
 * falling back to the stored `expires` field. Returns 0 for non-oauth auth.
 */
export function oauthExpiryMs(a: Auth): number {
  if (a.type !== "oauth") return 0
  const jwtExp = jwtExpirySeconds(a.access)
  if (jwtExp !== undefined) return jwtExp * 1000
  const stored = a.expires
  return typeof stored === "number" && Number.isFinite(stored) ? stored : 0
}

/** Refresh a ClineAuthCredentials, returning the canonical RefreshedToken shape. */
export async function refreshClineAuthCreds(
  creds: ClineAuthCredentials,
  options?: { fetch?: typeof globalThis.fetch },
): Promise<RefreshedToken> {
  return ensureValidWorkosToken(creds.accessToken, creds.refreshToken, creds.expiresAt, {
    fetch: options?.fetch,
  })
}

/** Convert a refreshed token into an oauth Auth, carrying over the accountId. */
export function refreshedToAuth(refreshed: RefreshedToken, accountId?: string): Auth {
  return oauthAuth(refreshed.access, refreshed.refresh, refreshed.expires, accountId)
}

/**
 * Persist an Auth for a provider to both the SDK auth store and the on-disk
 * auth.json file. The SDK `auth.set` is the runtime credential store; the file
 * write is a belt-and-suspenders fallback for early-init / store-mismatch
 * paths. Both writes swallow errors — `auth.set` is wrapped so a rejection
 * can't break the caller, and `saveOpencodeAuth` is documented as non-throwing.
 */
export async function persistAuth(
  client: {
    auth: { set(opts: { path: { id: string }; body: Auth }): Promise<unknown> }
  },
  id: string,
  auth: Auth,
  opts: IoOptions = {},
): Promise<void> {
  try {
    await client.auth.set({ path: { id }, body: auth })
  } catch {
    // Non-fatal: the file fallback below persists independently.
  }
  saveOpencodeAuth(id, auth, opts)
  // Keep the in-memory cache in sync so getCachedAuth sees the write without a file re-read.
  setCachedAuth(id, auth)
}

/** Build an api Auth record for a static ClinePass API key. */
export function apiAuth(key: string): Auth {
  return { type: "api", key }
}

/**
 * Write the Auth for a provider id into the host auth.json file (OpenCode or
 * Kilo). Used as a belt-and-suspenders persistence alongside `client.auth.set()`.
 * Creates parent directories if needed and writes atomically via temp file.
 * Returns true on success, false on any error (never throws).
 *
 * Prefers an existing auth file among known host paths. When none exist,
 * creates the host-primary default (`~/.local/share/kilo/auth.json` under
 * Kilo, `~/.local/share/opencode/auth.json` under OpenCode).
 */
export function saveOpencodeAuth(id: string, auth: Auth, opts: IoOptions = {}): boolean {
  const home = opts.homeDir?.() ?? homedir()
  const writeFile = opts.writeFile ?? ((p: string, d: string) => writeFileSync(p, d, "utf-8"))
  const rename = opts.rename ?? renameSync
  const mkdir = opts.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  const readFile = opts.readFile ?? defaultRead
  const fileExists = opts.fileExists ?? existsSync
  const paths = opencodeAuthPaths(home)
  const defaultPath = defaultOpencodeAuthPath(home)
  for (const path of paths) {
    try {
      const exists = fileExists(path)
      if (!exists && path !== defaultPath) continue
      const raw = exists ? JSON.parse(readFile(path)) : {}
      if (typeof raw !== "object" || raw === null) continue
      raw[id] = auth
      // Write atomically: temp file → rename to avoid partial writes
      const tmp = `${path}.tmp-${process.pid}`
      mkdir(dirname(path))
      writeFile(tmp, JSON.stringify(raw, null, 2))
      rename(tmp, path)
      return true
    } catch (e) {
      const msg = errMsg(e)
      if (!msg.includes("ENOENT") && !msg.includes("not found") && !msg.includes("EACCES")) {
        console.warn(`[clinepass] Warning: failed to write auth to ${path}: ${msg}`)
      }
    }
  }
  return false
}

/**
 * Host-primary default path for auth.json when creating a new file.
 * Kilo: ~/.local/share/kilo/auth.json
 * OpenCode: ~/.local/share/opencode/auth.json
 */
export function defaultOpencodeAuthPath(home: string): string {
  // First entry of opencodeAuthPaths is always the host-primary XDG path.
  return opencodeAuthPaths(home)[0]
}

/** Extract a usable bearer token from a stored Auth record. */
export function extractKey(auth?: Auth | null): string | undefined {
  if (!auth) return undefined
  if (auth.type === "oauth") return auth.access
  if (auth.type === "api" || auth.type === "wellknown") return auth.key
  return undefined
}

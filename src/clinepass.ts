/**
 * opencode-clinepass-provider
 *
 * ClinePass provider plugin for Opencode.
 *
 * Authenticate with Cline Pass using either:
 *   1. Your Cline CLI / ClinePass subscription (WorkOS OAuth) — automatically
 *      reused from ~/.cline/data/settings/providers.json, with short-lived
 *      access tokens refreshed via Cline's server-side endpoint.
 *   2. A static API key created at app.cline.bot → Settings → API Keys.
 *
 * Once authenticated you get access to 10 curated open-weight coding models
 * (GLM-5.2, Kimi K2.7 Code, DeepSeek V4, Qwen3.7, …) through Cline's
 * OpenAI-compatible API (https://api.cline.bot/api/v1).
 *
 * This is the Opencode equivalent of jellydn/pi-clinepass-provider, adapted to
 * Opencode's plugin API (@opencode-ai/plugin): it registers an `auth` hook
 * (oauth + api methods), a credential `loader`, and a `chat.headers` hook that
 * refreshes WorkOS tokens right before each request.
 *
 * The provider itself (base URL + model list) is declared in opencode.json
 * under `provider.clinepass` — see opencode.example.json / README.md.
 *
 * @module opencode-clinepass-provider
 */

import type { Plugin, AuthHook, Hooks } from "@opencode-ai/plugin"
import type { Auth } from "@opencode-ai/sdk/v2"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ─── Constants ─────────────────────────────────────────────────────────────

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

// ─── Type guards ───────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    if (value.trim() === "") return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

// ─── Environment helpers ───────────────────────────────────────────────────

/** Resolve the API base URL, honouring CLINE_API_BASE and normalising slashes. */
export function resolveApiBase(
  env: Record<string, string | undefined> = process.env,
): string {
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

// ─── Shared auth-file walking ──────────────────────────────────────────────

export interface IoOptions {
  env?: Record<string, string | undefined>
  homeDir?: () => string
  readFile?: (path: string) => string
  fileExists?: (path: string) => boolean
}

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
function readJsonFile(
  path: string,
  opts: IoOptions = {},
): Record<string, unknown> | undefined {
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

// ─── Cline CLI credential extraction ───────────────────────────────────────

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
export function resolveClineAuthCredentials(
  opts: IoOptions = {},
): ClineAuthCredentials | undefined {
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

// ─── WorkOS token refresh ──────────────────────────────────────────────────

export interface WorkosRefreshOptions {
  fetch?: typeof globalThis.fetch
  apiBase?: string
}

export interface RefreshedToken {
  access: string
  refresh: string
  expires: number
}

/**
 * Refresh a WorkOS OAuth access token via Cline's server-side endpoint.
 *
 * POST {apiBase}/api/v1/auth/refresh { granttype:"refresh_token", refreshToken }
 * → { data: { accessToken, refreshToken } } (or flat). The new access token is
 * re-prefixed with "workos:" if the API returns a bare JWT.
 */
export async function refreshWorkosToken(
  refreshToken: string,
  options: WorkosRefreshOptions = {},
): Promise<RefreshedToken> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const apiBase = options.apiBase ?? resolveApiBase()
  if (!fetchFn) throw new Error("ClinePass refresh: fetch is unavailable")

  let response: Response
  try {
    response = await fetchFn(`${apiBase}${CLINE_REFRESH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ granttype: "refresh_token", refreshToken }),
      signal: AbortSignal.timeout(WORKOS_REFRESH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("ClinePass token refresh timed out — check your network or use a static API key.")
    }
    throw err
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error")
    throw new Error(
      `ClinePass token refresh failed (${response.status}): ${text}` +
        " — run `cline auth` to re-login, or use a static API key.",
    )
  }

  const data = (await response.json()) as {
    data?: { accessToken?: string; refreshToken?: string }
    accessToken?: string
    refreshToken?: string
  }
  const tokens = data.data ?? data
  const newAccess = stringValue(tokens?.accessToken)
  const newRefresh = stringValue(tokens?.refreshToken)
  if (!newAccess || !newRefresh) {
    throw new Error("ClinePass token refresh returned an unexpected response format")
  }
  const access = isWorkosToken(newAccess) ? newAccess : `${WORKOS_TOKEN_PREFIX}${newAccess}`
  return {
    access,
    refresh: newRefresh,
    expires: Date.now() + WORKOS_TOKEN_LIFETIME_MS - WORKOS_REFRESH_MARGIN_MS,
  }
}

// ─── opencode auth store ───────────────────────────────────────────────────

/** Paths searched for opencode's stored credentials. */
export function opencodeAuthPaths(home: string = homedir()): string[] {
  return [
    join(home, OPENCODE_AUTH_REL),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]
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

// ─── Auth helpers ──────────────────────────────────────────────────────────

function oauthAuth(access: string, refresh: string, expires: number, accountId?: string): Auth {
  const a: Auth = { type: "oauth", access, refresh, expires }
  if (accountId) (a as { accountId?: string }).accountId = accountId
  return a
}

function apiAuth(key: string): Auth {
  return { type: "api", key }
}

/** Extract a usable bearer token from a stored Auth record. */
export function extractKey(auth?: Auth | null): string | undefined {
  if (!auth) return undefined
  if (auth.type === "oauth") return auth.access
  if (auth.type === "api" || auth.type === "wellknown") return auth.key
  return undefined
}

// ─── Error classification ──────────────────────────────────────────────────

export type ClinePassErrorType = "not_subscribed" | "auth_expired" | "rate_limited" | "unknown"

export const CLINEPASS_ERROR_MESSAGES: Record<ClinePassErrorType, string> = {
  not_subscribed:
    "ClinePass subscription required. Visit app.cline.bot to subscribe, or run /connect → ClinePass to re-authenticate.",
  auth_expired:
    "ClinePass authentication expired. Run /connect, select ClinePass to refresh your credentials.",
  rate_limited:
    "ClinePass rate limit reached. Wait a moment and try again, or check your plan at app.cline.bot.",
  unknown: "ClinePass request failed. Check your subscription at app.cline.bot or run /connect → ClinePass.",
}

export function classifyClinePassError(message: string): {
  type: ClinePassErrorType
  message: string
} {
  const lower = message.toLowerCase()
  if (/(403|forbidden|subscription required|not subscribed)/.test(lower)) {
    return { type: "not_subscribed", message: CLINEPASS_ERROR_MESSAGES.not_subscribed }
  }
  if (/(401|unauthorized|invalid api key|invalid_api_key)/.test(lower)) {
    return { type: "auth_expired", message: CLINEPASS_ERROR_MESSAGES.auth_expired }
  }
  if (/(429|rate limit|too many requests|rate_limit)/.test(lower)) {
    return { type: "rate_limited", message: CLINEPASS_ERROR_MESSAGES.rate_limited }
  }
  return { type: "unknown", message: CLINEPASS_ERROR_MESSAGES.unknown }
}

// ─── Models ────────────────────────────────────────────────────────────────

export interface ModelDef {
  id: string
  name: string
  context: number
  output: number
}

/** The 10 curated ClinePass models (id, display name, context & output limits). */
export const MODELS: readonly ModelDef[] = [
  { id: "cline-pass/glm-5.2", name: "GLM-5.2 (ClinePass)", context: 1_048_576, output: 131_072 },
  { id: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code (ClinePass)", context: 262_144, output: 131_072 },
  { id: "cline-pass/kimi-k2.6", name: "Kimi K2.6 (ClinePass)", context: 262_144, output: 131_072 },
  { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro (ClinePass)", context: 1_000_000, output: 384_000 },
  { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash (ClinePass)", context: 1_000_000, output: 384_000 },
  { id: "cline-pass/mimo-v2.5", name: "MiMo-V2.5 (ClinePass)", context: 262_144, output: 131_072 },
  { id: "cline-pass/mimo-v2.5-pro", name: "MiMo-V2.5-Pro (ClinePass)", context: 262_144, output: 131_072 },
  { id: "cline-pass/minimax-m3", name: "MiniMax M3 (ClinePass)", context: 1_048_576, output: 131_072 },
  { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max (ClinePass)", context: 262_144, output: 131_072 },
  { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)", context: 1_048_576, output: 131_072 },
]

/** Build the opencode.json `provider.clinepass.models` object from MODELS. */
export function modelsToConfig(
  models: readonly ModelDef[] = MODELS,
): Record<string, { name: string; limit: { context: number; output: number } }> {
  const out: Record<string, { name: string; limit: { context: number; output: number } }> = {}
  for (const m of models) {
    out[m.id] = { name: m.name, limit: { context: m.context, output: m.output } }
  }
  return out
}

/**
 * Fetch the model list from the Cline API `/api/v1/models` endpoint (OpenAI-compatible
 * format: `{ data: [{ id, name, context_length, max_output_tokens, ... }] }`).
 * Returns a record keyed by model id, or `undefined` on any error (network, auth, parse).
 *
 * The returned objects carry enough fields for Opencode to use them as provider models
 * — name, limit, and api info. The caller should map these into the shape Opencode expects.
 */
export async function fetchRemoteModels(
  apiKey: string | undefined,
  options: { apiBase?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<Record<string, { name: string; limit: { context: number; output: number } }> | undefined> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const apiBase = options.apiBase ?? resolveApiBase()
  const timeoutMs = options.timeoutMs ?? 5_000

  if (!apiKey || !fetchFn) return undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn(`${apiBase}/api/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })

    if (!response.ok) return undefined

    const json: unknown = await response.json()
    const rawList: Array<Record<string, unknown>> = Array.isArray(json)
      ? json
      : (json as Record<string, unknown>).data !== undefined && Array.isArray((json as Record<string, unknown>).data)
        ? ((json as Record<string, unknown>).data as Array<Record<string, unknown>>)
        : []

    if (rawList.length === 0) return undefined

    // Only include models with the "cline-pass/" prefix
    const out: Record<string, { name: string; limit: { context: number; output: number } }> = {}
    for (const raw of rawList) {
      const id = typeof raw.id === "string" ? raw.id : undefined
      if (!id || !id.startsWith("cline-pass/")) continue

      const name = typeof raw.name === "string" ? raw.name : id
      const context = typeof raw.context_length === "number" ? raw.context_length : undefined
      const output = typeof raw.max_output_tokens === "number" ? raw.max_output_tokens : undefined

      // Fall back to static data if the API doesn't provide these fields
      const staticFallback = MODELS.find((m) => m.id === id)
      out[id] = {
        name,
        limit: {
          context: context ?? staticFallback?.context ?? 128_000,
          output: output ?? staticFallback?.output ?? 8_192,
        },
      }
    }

    return Object.keys(out).length > 0 ? out : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build the full `provider.clinepass` config block that the `config` hook
 * injects into opencode's config at startup. Exported for testing.
 */
export function buildProviderConfig(
  env: Record<string, string | undefined> = process.env,
): {
  npm: string
  name: string
  options: { baseURL: string }
  models: Record<string, { name: string; limit: { context: number; output: number } }>
} {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "ClinePass",
    options: { baseURL: `${resolveApiBase(env)}/api/v1` },
    models: modelsToConfig(),
  }
}

/**
 * Inject the clinepass provider config into a config object (in-place), but
 * only if the user hasn't already declared a `clinepass` provider themselves.
 * Exported for testing the `config` hook logic without a plugin runtime.
 */
export function injectProviderConfig<T extends { provider?: Record<string, unknown> }>(
  input: T,
  env: Record<string, string | undefined> = process.env,
): void {
  const provider = input.provider ?? {}
  if (provider.clinepass) return // respect user's manual config
  provider.clinepass = buildProviderConfig(env)
  input.provider = provider
}

// ─── In-memory credential cache ────────────────────────────────────────────
// Populated by the loader / authorize / auto-import, read by chat.headers.

let cachedAuth: Auth | undefined

// ─── Minimal client surface used by the plugin (for testability) ───────────

export interface ClientLike {
  auth: { set(opts: { path: { id: string }; body: Auth }): Promise<unknown> }
  app: {
    log(opts: {
      body: { service: string; level: string; message: string; extra?: Record<string, unknown> }
    }): Promise<unknown>
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Zero-config: if the user hasn't connected ClinePass yet but already has
 * Cline CLI (WorkOS) credentials or CLINE_API_KEY, import them into opencode's
 * auth store so the provider works without running /connect.
 *
 * Never overwrites an existing `clinepass` entry.
 */
export async function autoImportCredentials(
  client: ClientLike,
  opts: IoOptions & { fetch?: typeof globalThis.fetch } = {},
): Promise<void> {
  const log = (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) =>
    client.app.log({ body: { service: "clinepass", level, message, extra } }).catch(() => {})

  if (readOpencodeAuth(PROVIDER_ID, opts)) return // already configured — don't clobber

  const creds = resolveClineAuthCredentials(opts)
  if (creds) {
    let { accessToken, refreshToken, expiresAt, accountId } = creds
    if (expiresAt <= Date.now() + WORKOS_REFRESH_MARGIN_MS) {
      try {
        const r = await refreshWorkosToken(refreshToken, { fetch: opts.fetch })
        accessToken = r.access
        refreshToken = r.refresh
        expiresAt = r.expires
      } catch (e) {
        await log("warn", "Cline CLI token needs refresh — run /connect, select ClinePass to re-authenticate.", {
          error: errMsg(e),
        })
        return
      }
    }
    try {
      await client.auth.set({ path: { id: PROVIDER_ID }, body: oauthAuth(accessToken, refreshToken, expiresAt, accountId) })
      await log("info", "ClinePass: imported your Cline CLI subscription automatically.")
    } catch (e) {
      await log("error", "ClinePass: failed to import Cline CLI credentials.", { error: errMsg(e) })
    }
    return
  }

  const key = resolveClineStaticKey(opts)
  if (key) {
    try {
      await client.auth.set({ path: { id: PROVIDER_ID }, body: apiAuth(key) })
      await log("info", "ClinePass: imported your CLINE_API_KEY automatically.")
    } catch (e) {
      await log("error", "ClinePass: failed to import API key.", { error: errMsg(e) })
    }
    return
  }

  await log(
    "warn",
    "ClinePass: no credentials found. Run /connect and select ClinePass, or run `cline auth` / set CLINE_API_KEY.",
  )
}

// ─── Plugin ────────────────────────────────────────────────────────────────

/**
 * Opencode plugin for ClinePass.
 *
 * Wire it up by either:
 *   - dropping this file in ~/.config/opencode/plugins/clinepass.ts, or
 *   - adding "opencode-clinepass-provider" to the `plugin` array in opencode.json.
 *
 * The plugin auto-registers the `clinepass` provider (baseURL + 10 models) via
 * a `config` hook — no manual opencode.json editing required. Just install the
 * plugin, run /connect → ClinePass, and pick a model.
 */
export const ClinePassPlugin: Plugin = async (ctx) => {
  const client = ctx.client as unknown as ClientLike
  const log = (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) =>
    client.app.log({ body: { service: "clinepass", level, message, extra } }).catch(() => {})

  // Zero-config auto-import of Cline CLI / env credentials (never overwrites /connect).
  await autoImportCredentials(client).catch((e) =>
    log("error", "ClinePass: auto-import failed.", { error: errMsg(e) }),
  )

  const authHook: AuthHook = {
    provider: PROVIDER_ID,
    // Feed the stored credential into the provider as `apiKey`.
    loader: async (auth) => {
      const a = (await auth().catch(() => undefined)) as Auth | undefined
      cachedAuth = a ?? undefined
      const key = extractKey(a)
      return key ? { apiKey: key } : {}
    },
    methods: [
      // ── Subscription: reuse Cline CLI WorkOS login ──────────────────────
      {
        type: "oauth",
        label: "Cline CLI / ClinePass subscription (WorkOS)",
        authorize: async () => {
          const creds = resolveClineAuthCredentials()
          if (!creds) {
            return {
              url: DASHBOARD_URL,
              instructions:
                "No Cline CLI login detected. Install the Cline CLI (npm i -g cline) and run `cline auth` to sign in with your Cline subscription, then retry — or cancel and use 'Static API key'.",
              method: "auto",
              callback: async () => ({ type: "failed" as const }),
            }
          }
          let { accessToken, refreshToken, expiresAt, accountId } = creds
          if (expiresAt <= Date.now() + WORKOS_REFRESH_MARGIN_MS) {
            try {
              const r = await refreshWorkosToken(refreshToken)
              accessToken = r.access
              refreshToken = r.refresh
              expiresAt = r.expires
            } catch {
              return {
                url: DASHBOARD_URL,
                instructions:
                  "Could not refresh your Cline CLI token. Run `cline auth` again, then retry — or use 'Static API key'.",
                method: "auto",
                callback: async () => ({ type: "failed" as const }),
              }
            }
          }
          cachedAuth = oauthAuth(accessToken, refreshToken, expiresAt, accountId)
          return {
            url: "https://app.cline.bot",
            instructions:
              "Reusing your Cline CLI login (WorkOS). You can close the browser tab if one opened — no action needed.",
            method: "auto",
            callback: async () => ({
              type: "success" as const,
              access: accessToken,
              refresh: refreshToken,
              expires: expiresAt,
              ...(accountId ? { accountId } : {}),
            }),
          }
        },
      },
      // ── Static API key ──────────────────────────────────────────────────
      {
        type: "api",
        label: "Static API key (app.cline.bot → Settings → API Keys)",
        prompts: [
          {
            type: "text",
            key: "apiKey",
            message: "Paste your ClinePass API key (create one at app.cline.bot → Settings → API Keys):",
            placeholder: "ck_…",
            validate: (v: string) =>
              v.trim().length < 20 ? "API key looks too short — make sure you copied the full key." : undefined,
          },
        ],
        authorize: async (inputs) => {
          const key = sanitizeApiKey(inputs?.apiKey ?? "")
          if (!key) return { type: "failed" as const }
          cachedAuth = apiAuth(key)
          return { type: "success" as const, key, provider: PROVIDER_ID }
        },
      },
    ],
  }

  const hooks: Hooks = {
    // Auto-register the clinepass provider (baseURL + models) so users never
    // need to manually edit opencode.json. This hook runs BEFORE the provider
    // database is built, making ClinePass self-registering like built-in
    // providers (Copilot, OpenCode Go). Respects any user-defined clinepass.
    config: async (input) => {
      injectProviderConfig(input)
    },

    // Dynamically discover models from the Cline API (`/api/v1/models`) so the
    // model list stays current with Cline's offerings (new models, updated
    // context windows, etc.). Falls back to the static MODELS array on any
    // error (network, auth, parse) — you always have a working set of models.
    provider: {
      id: PROVIDER_ID,
      models: async (_provider, ctx) => {
        const key = extractKey(ctx.auth)
        if (key) {
          const remote = await fetchRemoteModels(key).catch(() => undefined)
          if (remote) return remote as Record<string, any> as any
        }
        return modelsToConfig() as Record<string, any> as any
      },
    },

    auth: authHook,

    // Refresh WorkOS tokens lazily, right before each LLM request, and inject
    // the fresh Authorization header. Static keys are handled by the loader's
    // apiKey option, so this hook only acts for oauth credentials.
    "chat.headers": async (input, output) => {
      const providerInfo = input.provider?.info
      if (providerInfo?.id !== PROVIDER_ID) return
      let a = cachedAuth
      if (!a) {
        a = readOpencodeAuth(PROVIDER_ID) ?? undefined
        if (a) cachedAuth = a
      }
      if (!a || a.type !== "oauth") return
      let token = a.access
      if (Date.now() >= a.expires - WORKOS_REFRESH_MARGIN_MS) {
        try {
          const r = await refreshWorkosToken(a.refresh)
          cachedAuth = oauthAuth(r.access, r.refresh, r.expires, (a as { accountId?: string }).accountId)
          token = r.access
          client.auth.set({ path: { id: PROVIDER_ID }, body: cachedAuth }).catch(() => {})
          await log("info", "ClinePass: refreshed WorkOS access token.")
        } catch (e) {
          await log("error", "ClinePass: token refresh failed — requests may fail until you re-authenticate.", {
            error: errMsg(e),
          })
        }
      }
      output.headers["Authorization"] = `Bearer ${token}`
    },

    // Surface friendly ClinePass errors (403/401/429) into the opencode log.
    event: async (input) => {
      const ev = input.event as unknown as {
        type?: string
        properties?: { error?: { message?: string } }
      }
      if (ev?.type !== "session.next.step.failed") return
      const msg = ev?.properties?.error?.message ?? ""
      if (typeof msg !== "string" || !msg) return
      const lower = msg.toLowerCase()
      if (!lower.includes("cline") && !lower.includes("subscription") && !lower.includes("clinepass")) return
      const { message } = classifyClinePassError(msg)
      await log("error", message)
    },
  }

  return hooks
}

export default {
  // Required by Opencode's file-based plugin loader: resolvePluginId() throws
  // "Path plugin must export id" for file:// plugins without an id field.
  id: "opencode-clinepass-provider",
  // V1 plugin module format: Opencode's loader reads `mod.default.server`
  // and calls `server(input, options)`. Using this object form (instead of
  // `export default ClinePassPlugin`) ensures the legacy loader path — which
  // iterates *every* export and throws if any isn't a function — is never
  // reached, so the helper/constant exports below are safe.
  server: ClinePassPlugin,
}







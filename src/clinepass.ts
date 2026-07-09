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
 * Architecture (modular — mirrors jellydn/pi-clinepass-provider):
 *   src/lib/utils.ts   — type guards (isRecord, stringValue, numberValue)
 *   src/lib/env.ts     — constants, env helpers, IoOptions
 *   src/lib/errors.ts  — error classification
 *   src/lib/workos.ts  — WorkOS token refresh
 *   src/lib/auth.ts    — credential extraction + auth store helpers
 *   src/lib/models.ts  — model definitions + config generation
 *   src/clinepass.ts — plugin (this file) + re-exports
 *
 * @module opencode-clinepass-provider
 */

import type { AuthHook, Hooks, Plugin } from "@opencode-ai/plugin"
import type { Auth, Model as ModelV2 } from "@opencode-ai/sdk/v2"

// auth
export {
  apiAuth,
  type ClineAuthCredentials,
  clineCliAuthPaths,
  extractKey,
  oauthAuth,
  opencodeAuthPaths,
  readOpencodeAuth,
  resolveClineAuthCredentials,
  resolveClineStaticKey,
} from "./lib/auth.js"

// env
export {
  CLINE_CLI_AUTH_REL,
  CLINE_REFRESH_PATH,
  DASHBOARD_URL,
  DEFAULT_API_BASE,
  ENV_API_BASE,
  ENV_API_KEY,
  type IoOptions,
  isWorkosToken,
  OPENCODE_AUTH_REL,
  PROVIDER_ID,
  resolveApiBase,
  sanitizeApiKey,
  WORKOS_REFRESH_MARGIN_MS,
  WORKOS_REFRESH_TIMEOUT_MS,
  WORKOS_TOKEN_LIFETIME_MS,
  WORKOS_TOKEN_PREFIX,
} from "./lib/env.js"

// errors
export { CLINEPASS_ERROR_MESSAGES, type ClinePassErrorType, classifyClinePassError } from "./lib/errors.js"
// models
export {
  buildProviderConfig,
  DEFAULT_THINKING_LEVEL_MAP,
  fetchRemoteModels,
  injectProviderConfig,
  MODELS,
  type ModelConfigEntry,
  type ModelDef,
  modelsToConfig,
  type ThinkingLevel,
  type ThinkingLevelMap,
} from "./lib/models.js"
// utils
export { errMsg, isRecord, jwtExpirySeconds, numberValue, stringValue } from "./lib/utils.js"
// workos
export {
  ensureValidWorkosToken,
  type RefreshedToken,
  refreshWorkosToken,
  type WorkosRefreshOptions,
} from "./lib/workos.js"

import {
  apiAuth,
  extractKey,
  oauthAuth,
  readOpencodeAuth,
  resolveClineAuthCredentials,
  resolveClineStaticKey,
  saveOpencodeAuth,
} from "./lib/auth.js"
import { DASHBOARD_URL, type IoOptions, PROVIDER_ID, sanitizeApiKey } from "./lib/env.js"
import { classifyClinePassError } from "./lib/errors.js"
import { fetchRemoteModels, injectProviderConfig, modelsToConfig } from "./lib/models.js"
import { errMsg, jwtExpirySeconds } from "./lib/utils.js"
import { ensureValidWorkosToken } from "./lib/workos.js"

/**
 * In-memory cache for the resolved Auth object, set by the auth.loader hook
 * and read by chat.headers to avoid per-request file IO reading opencode's
 * auth.json on every LLM call. Also updated on token refresh.
 */
let latestAuth: Auth | undefined

/** Minimal client surface used by the plugin (for testability). */
export interface ClientLike {
  auth: { set(opts: { path: { id: string }; body: Auth }): Promise<unknown> }
  app: {
    log(opts: {
      body: {
        service: string
        level: string
        message: string
        extra?: Record<string, unknown>
      }
    }): Promise<unknown>
  }
}

/** Shared logger helper — avoids duplicating the log closure in both plugin body and autoImportCredentials. */
function makeLogger(client: ClientLike) {
  return (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) =>
    client.app.log({ body: { service: "clinepass", level, message, extra } }).catch(() => {})
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
  const log = makeLogger(client)

  if (readOpencodeAuth(PROVIDER_ID, opts)) return // already configured — don't clobber

  const creds = resolveClineAuthCredentials(opts)
  if (creds) {
    const { accountId } = creds
    let accessToken: string
    let refreshToken: string
    let expiresAt: number
    try {
      const r = await ensureValidWorkosToken(creds.accessToken, creds.refreshToken, creds.expiresAt, {
        fetch: opts.fetch,
      })
      accessToken = r.access
      refreshToken = r.refresh
      expiresAt = r.expires
    } catch (e) {
      await log("warn", "Cline CLI token needs refresh — run /connect, select ClinePass to re-authenticate.", {
        error: errMsg(e),
      })
      return
    }
    const authBody = oauthAuth(accessToken, refreshToken, expiresAt, accountId)
    try {
      await client.auth.set({
        path: { id: PROVIDER_ID },
        body: authBody,
      })
      await log("info", "ClinePass: imported your Cline CLI subscription automatically.")
    } catch (e) {
      await log("error", "ClinePass: failed to import Cline CLI credentials via SDK.", {
        error: errMsg(e),
      })
    }
    // Belt-and-suspenders: also persist directly to auth.json in case the
    // SDK's server API doesn't flush to the file (e.g. early-init timing).
    saveOpencodeAuth(PROVIDER_ID, authBody, opts)
    return
  }

  const key = resolveClineStaticKey(opts)
  if (key) {
    const apiBody = apiAuth(key)
    try {
      await client.auth.set({ path: { id: PROVIDER_ID }, body: apiBody })
      await log("info", "ClinePass: imported your CLINE_API_KEY automatically.")
    } catch (e) {
      await log("error", "ClinePass: failed to import API key via SDK.", {
        error: errMsg(e),
      })
    }
    saveOpencodeAuth(PROVIDER_ID, apiBody, opts)
    return
  }

  await log(
    "warn",
    "ClinePass: no credentials found. Run /connect and select ClinePass, or run `cline auth` / set CLINE_API_KEY.",
  )
}

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
  // SDK client types don't expose the internal shape; ClientLike captures the
  // minimal surface the plugin actually uses — honest boundary cast.
  const client = ctx.client as unknown as ClientLike
  const log = makeLogger(client)

  // Zero-config auto-import of Cline CLI / env credentials (never overwrites /connect).
  await autoImportCredentials(client).catch((e) => log("error", "ClinePass: auto-import failed.", { error: errMsg(e) }))

  const authHook: AuthHook = {
    provider: PROVIDER_ID,
    // Feed the stored credential into the provider as `apiKey`.
    // Falls back to reading the auth.json file directly if the SDK's auth()
    // store doesn't have the entry (e.g. v1/v2 store mismatch, startup timing).
    loader: async (auth) => {
      const a = (await auth().catch(() => undefined)) as Auth | undefined
      latestAuth = a ?? readOpencodeAuth(PROVIDER_ID)
      const key = extractKey(latestAuth)
      return key ? { apiKey: key } : {}
    },
    methods: [
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
          const { accountId } = creds
          let accessToken: string
          let refreshToken: string
          let expiresAt: number
          try {
            const r = await ensureValidWorkosToken(creds.accessToken, creds.refreshToken, creds.expiresAt)
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
      models: async (_provider, providerCtx) => {
        const key = extractKey(providerCtx.auth)
        if (key) {
          const remote = await fetchRemoteModels(key).catch(() => undefined)
          // ModelConfigEntry carries fields (limit, thinkingLevelMap) that ModelV2
          // does not declare but OpenCode consumes at runtime — honest boundary cast.
          if (remote) return remote as unknown as Record<string, ModelV2>
        }
        // Same boundary cast for the static fallback path.
        return modelsToConfig() as unknown as Record<string, ModelV2>
      },
    },

    auth: authHook,

    // Refresh WorkOS tokens lazily, right before each LLM request, and inject
    // the fresh Authorization header. Static keys are handled by the loader's
    // apiKey option, so this hook only acts for oauth credentials.
    "chat.headers": async (input, output) => {
      const providerInfo = input.provider?.info
      if (providerInfo?.id !== PROVIDER_ID) return
      const a = latestAuth ?? readOpencodeAuth(PROVIDER_ID)
      if (!a || a.type !== "oauth") return
      // Prefer the token's own JWT `exp` claim for true expiry, since
      // opencode's auth store may not reliably round-trip the custom
      // `expires` field. Fall back to the stored `expires` (ms) otherwise.
      const jwtExp = jwtExpirySeconds(a.access)
      const storedMs = (a as { expires?: number }).expires
      const expiresMs =
        jwtExp !== undefined ? jwtExp * 1000 : typeof storedMs === "number" && Number.isFinite(storedMs) ? storedMs : 0
      let token = a.access
      let sendToken = true
      try {
        const r = await ensureValidWorkosToken(a.access, a.refresh, expiresMs)
        if (r.access !== a.access) {
          token = r.access
          const updated = oauthAuth(r.access, r.refresh, r.expires, (a as { accountId?: string }).accountId)
          latestAuth = updated
          // Save via SDK API for the runtime credential store
          client.auth.set({ path: { id: PROVIDER_ID }, body: updated }).catch(() => {})
          // Also persist directly to auth.json so readOpencodeAuth always sees
          // fresh tokens on subsequent requests and across restarts.
          saveOpencodeAuth(PROVIDER_ID, updated)
          await log("info", "ClinePass: refreshed WorkOS access token.")
        }
      } catch (e) {
        await log("error", "ClinePass: token refresh failed — re-run /connect to re-authenticate.", {
          error: errMsg(e),
        })
        // Don't send a stale bearer when the token is already expired and
        // unrecoverable — sending it guarantees a 401 and masks the failure.
        if (expiresMs <= Date.now()) sendToken = false
      }
      if (sendToken) output.headers["Authorization"] = `Bearer ${token}`
    },

    // Surface friendly ClinePass errors (403/401/429) into the opencode log.
    // Classify all errors, but only log non-unknown ones to avoid noise.
    event: async (input) => {
      const ev = input.event as unknown as {
        type?: string
        properties?: { error?: { message?: string } }
      }
      if (ev?.type !== "session.next.step.failed") return
      const msg = ev?.properties?.error?.message ?? ""
      if (typeof msg !== "string" || !msg) return
      const { type, message } = classifyClinePassError(msg)
      if (type === "unknown") return
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

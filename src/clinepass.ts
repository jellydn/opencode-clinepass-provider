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
 *   src/utils.ts   — type guards (isRecord, stringValue, numberValue)
 *   src/env.ts     — constants, env helpers, IoOptions
 *   src/errors.ts  — error classification
 *   src/workos.ts  — WorkOS token refresh
 *   src/auth.ts    — credential extraction + auth store helpers
 *   src/models.ts  — model definitions + config generation
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
} from "./auth.js"

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
} from "./env.js"

// errors
export { CLINEPASS_ERROR_MESSAGES, type ClinePassErrorType, classifyClinePassError } from "./errors.js"
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
} from "./models.js"
// utils
export { isRecord, numberValue, stringValue } from "./utils.js"
// workos
export { ensureValidWorkosToken, type RefreshedToken, refreshWorkosToken, type WorkosRefreshOptions } from "./workos.js"

import {
  apiAuth,
  extractKey,
  oauthAuth,
  readOpencodeAuth,
  resolveClineAuthCredentials,
  resolveClineStaticKey,
} from "./auth.js"
import { DASHBOARD_URL, type IoOptions, PROVIDER_ID, sanitizeApiKey } from "./env.js"
import { classifyClinePassError } from "./errors.js"
import { fetchRemoteModels, injectProviderConfig, modelsToConfig } from "./models.js"
import { ensureValidWorkosToken } from "./workos.js"

let cachedAuth: Auth | undefined

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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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
    try {
      await client.auth.set({
        path: { id: PROVIDER_ID },
        body: oauthAuth(accessToken, refreshToken, expiresAt, accountId),
      })
      await log("info", "ClinePass: imported your Cline CLI subscription automatically.")
    } catch (e) {
      await log("error", "ClinePass: failed to import Cline CLI credentials.", {
        error: errMsg(e),
      })
    }
    return
  }

  const key = resolveClineStaticKey(opts)
  if (key) {
    try {
      await client.auth.set({ path: { id: PROVIDER_ID }, body: apiAuth(key) })
      await log("info", "ClinePass: imported your CLINE_API_KEY automatically.")
    } catch (e) {
      await log("error", "ClinePass: failed to import API key.", {
        error: errMsg(e),
      })
    }
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
  const client = ctx.client as unknown as ClientLike
  const log = makeLogger(client)

  // Zero-config auto-import of Cline CLI / env credentials (never overwrites /connect).
  await autoImportCredentials(client).catch((e) => log("error", "ClinePass: auto-import failed.", { error: errMsg(e) }))

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
      models: async (_provider, providerCtx) => {
        const key = extractKey(providerCtx.auth)
        if (key) {
          const remote = await fetchRemoteModels(key).catch(() => undefined)
          if (remote) return remote as unknown as Record<string, ModelV2>
        }
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
      let a = cachedAuth
      if (!a) {
        a = readOpencodeAuth(PROVIDER_ID) ?? undefined
        if (a) cachedAuth = a
      }
      if (!a || a.type !== "oauth") return
      let token = a.access
      try {
        const r = await ensureValidWorkosToken(a.access, a.refresh, a.expires)
        if (r.access !== a.access) {
          token = r.access
          cachedAuth = oauthAuth(r.access, r.refresh, r.expires, (a as { accountId?: string }).accountId)
          client.auth.set({ path: { id: PROVIDER_ID }, body: cachedAuth }).catch(() => {})
          await log("info", "ClinePass: refreshed WorkOS access token.")
        }
      } catch (e) {
        await log("error", "ClinePass: token refresh failed — requests may fail until you re-authenticate.", {
          error: errMsg(e),
        })
      }
      output.headers["Authorization"] = `Bearer ${token}`
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

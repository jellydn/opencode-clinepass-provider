/**
 * WorkOS OAuth token refresh via Cline's server-side endpoint.
 *
 * @module workos
 */

import {
  CLINE_REFRESH_PATH,
  isWorkosToken,
  resolveApiBase,
  WORKOS_REFRESH_MARGIN_MS,
  WORKOS_REFRESH_TIMEOUT_MS,
  WORKOS_TOKEN_LIFETIME_MS,
  WORKOS_TOKEN_PREFIX,
} from "./env.js"
import { stringValue } from "./utils.js"

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
 * Refresh a WorkOS token if it's near expiry, otherwise return it unchanged.
 * Centralizes the expiry-check-and-refresh pattern used across the plugin.
 */
export async function ensureValidWorkosToken(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
  options?: { fetch?: typeof globalThis.fetch },
): Promise<RefreshedToken> {
  if (expiresAt > Date.now() + WORKOS_REFRESH_MARGIN_MS) {
    return { access: accessToken, refresh: refreshToken, expires: expiresAt }
  }
  return refreshWorkosToken(refreshToken, options)
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
      throw new Error("ClinePass token refresh timed out — check your network or use a static API key.", { cause: err })
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

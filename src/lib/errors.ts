/**
 * ClinePass error classification — detects 403/401/429 and returns
 * user-friendly messages.
 *
 * @module errors
 */

export type ClinePassErrorType = "not_subscribed" | "auth_expired" | "rate_limited" | "unknown"

/** User-facing messages keyed by classified ClinePass error type. */
export const CLINEPASS_ERROR_MESSAGES: Readonly<Record<ClinePassErrorType, string>> = {
  not_subscribed:
    "ClinePass subscription required. Visit app.cline.bot to subscribe, or run /connect → ClinePass to re-authenticate.",
  auth_expired: "ClinePass authentication expired. Run /connect, select ClinePass to refresh your credentials.",
  rate_limited: "ClinePass rate limit reached. Wait a moment and try again, or check your plan at app.cline.bot.",
  unknown: "ClinePass request failed. Check your subscription at app.cline.bot or run /connect → ClinePass.",
}

/**
 * Map a raw error message to a ClinePass error type and user-friendly message.
 * Detects 403/subscription, 401/invalid key, and 429/rate-limit patterns.
 */
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

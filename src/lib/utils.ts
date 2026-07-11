/**
 * Type guards and coercion helpers — zero dependencies.
 *
 * @module utils
 */

/** True when value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Return value when it is a string; otherwise undefined. */
export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** Coerce a finite number or numeric string; empty/NaN → undefined. */
export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    if (value.trim() === "") return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Extract a human-readable message from an unknown error value (never throws). */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Decode the `exp` claim (seconds since epoch) from a `workos:<jwt>` access token.
 * Returns undefined if the token is not a decodable JWT (no prefix, non-JWT
 * string, or malformed base64). No signature verification — only for expiry timing.
 */
export function jwtExpirySeconds(token: string | undefined): number | undefined {
  if (!token) return undefined
  const raw = token.startsWith("workos:") ? token.slice("workos:".length) : token
  const part = raw.split(".")[1]
  if (!part) return undefined
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf-8")) as { exp?: unknown }
    return typeof json.exp === "number" ? json.exp : undefined
  } catch {
    return undefined
  }
}

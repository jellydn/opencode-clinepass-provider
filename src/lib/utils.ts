/**
 * Type guards and coercion helpers — zero dependencies.
 *
 * @module utils
 */

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

/** Extract a human-readable message from an unknown error value (never throws). */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

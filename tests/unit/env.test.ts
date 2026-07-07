/**
 * Unit tests for constants and env helpers (src/env.ts).
 */

import { describe, it, expect } from "vitest"
import { DEFAULT_API_BASE, WORKOS_TOKEN_PREFIX, resolveApiBase, sanitizeApiKey, isWorkosToken } from "../../src/env.js"

describe("resolveApiBase", () => {
  it("defaults to the Cline API base", () => {
    expect(resolveApiBase({})).toBe(DEFAULT_API_BASE)
  })

  it("honours CLINE_API_BASE and strips trailing slashes", () => {
    expect(resolveApiBase({ CLINE_API_BASE: "https://example.com//" })).toBe("https://example.com")
  })

  it("treats whitespace-only override as missing", () => {
    expect(resolveApiBase({ CLINE_API_BASE: "   " })).toBe(DEFAULT_API_BASE)
  })
})

describe("sanitizeApiKey", () => {
  it("strips bracketed paste wrappers and trims", () => {
    expect(sanitizeApiKey("[200~sk-abc[201~")).toBe("sk-abc")
  })

  it("strips ANSI paste wrappers", () => {
    expect(sanitizeApiKey("\u001b[200~sk-abc\u001b[201~")).toBe("sk-abc")
  })

  it("strips control characters", () => {
    expect(sanitizeApiKey("sk-\u0000abc")).toBe("sk-abc")
  })
})

describe("isWorkosToken", () => {
  it("detects the workos: prefix", () => {
    expect(isWorkosToken(`${WORKOS_TOKEN_PREFIX}eyJ...`)).toBe(true)
    expect(isWorkosToken("sk-...")).toBe(false)
  })
})

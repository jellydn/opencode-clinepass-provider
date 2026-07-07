/**
 * Unit tests for error classification (src/errors.ts).
 */

import { describe, expect, it } from "vitest"
import { CLINEPASS_ERROR_MESSAGES, classifyClinePassError } from "../../src/errors.js"

describe("classifyClinePassError", () => {
  it("403 -> not_subscribed", () => {
    expect(classifyClinePassError("403 Forbidden").type).toBe("not_subscribed")
  })

  it("401 -> auth_expired", () => {
    expect(classifyClinePassError("401 Unauthorized").type).toBe("auth_expired")
  })

  it("429 -> rate_limited", () => {
    expect(classifyClinePassError("429 Too Many Requests").type).toBe("rate_limited")
  })

  it("other -> unknown", () => {
    expect(classifyClinePassError("something broke").type).toBe("unknown")
  })

  it("case insensitive matching", () => {
    expect(classifyClinePassError("FORBIDDEN").type).toBe("not_subscribed")
    expect(classifyClinePassError("Rate Limit Exceeded").type).toBe("rate_limited")
  })

  it("subscription required phrase classified as not_subscribed", () => {
    expect(classifyClinePassError("subscription required").type).toBe("not_subscribed")
  })

  it("all error messages are non-empty strings", () => {
    for (const [, msg] of Object.entries(CLINEPASS_ERROR_MESSAGES)) {
      expect(typeof msg).toBe("string")
      expect(msg.length).toBeGreaterThan(10)
    }
  })
})

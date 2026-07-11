/**
 * Unit tests for type guards (src/utils.ts).
 */

import { describe, expect, it } from "vitest"
import { isRecord, jwtExpirySeconds, numberValue, stringValue } from "../../src/lib/utils.js"

const makeJwt = (exp: number) => {
  const payload = Buffer.from(JSON.stringify({ exp }), "utf-8").toString("base64url")
  return `workos:eyJheader.${payload}.sig`
}

describe("type guards", () => {
  it("isRecord", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord("x")).toBe(false)
  })

  it("stringValue", () => {
    expect(stringValue("x")).toBe("x")
    expect(stringValue(1)).toBeUndefined()
  })

  it("numberValue", () => {
    expect(numberValue(1)).toBe(1)
    expect(numberValue("2")).toBe(2)
    expect(numberValue("")).toBeUndefined()
    expect(numberValue(NaN)).toBeUndefined()
  })
})

describe("jwtExpirySeconds", () => {
  it("decodes the exp claim from a workos: JWT", () => {
    const exp = 1_700_000_000
    expect(jwtExpirySeconds(makeJwt(exp))).toBe(exp)
  })

  it("returns undefined for a non-JWT string", () => {
    expect(jwtExpirySeconds("workos:not-a-jwt")).toBeUndefined()
  })

  it("returns undefined when there is no workos prefix and no dot", () => {
    expect(jwtExpirySeconds("plain-token")).toBeUndefined()
  })

  it("returns undefined for undefined input", () => {
    expect(jwtExpirySeconds(undefined)).toBeUndefined()
  })
})

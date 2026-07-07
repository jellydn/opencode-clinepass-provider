/**
 * Unit tests for type guards (src/utils.ts).
 */

import { describe, it, expect } from "vitest"
import { isRecord, stringValue, numberValue } from "../../src/utils.js"

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

/**
 * Unit tests for credential extraction and auth store (src/auth.ts).
 */

import { describe, it, expect } from "vitest"
import {
  resolveClineAuthCredentials,
  resolveClineStaticKey,
  readOpencodeAuth,
  extractKey,
} from "../../src/auth.js"
import { clineProvidersJson, ioFor, ioByPath, AUTH_PATH } from "../helpers.js"

describe("resolveClineAuthCredentials", () => {
  it("extracts cline-pass WorkOS credentials", () => {
    const json = clineProvidersJson({
      clinePassAuth: { accessToken: "workos:eA", refreshToken: "rA", expiresAt: 9000, accountId: "acc" },
    })
    expect(resolveClineAuthCredentials(ioFor(json))).toEqual({
      accessToken: "workos:eA", refreshToken: "rA", expiresAt: 9000, accountId: "acc",
    })
  })

  it("falls back to the cline provider entry", () => {
    const json = clineProvidersJson({ clineAuth: { accessToken: "workos:eB", refreshToken: "rB", expiresAt: 8000 } })
    expect(resolveClineAuthCredentials(ioFor(json))?.accessToken).toBe("workos:eB")
    expect(resolveClineAuthCredentials(ioFor(json))?.accountId).toBeUndefined()
  })

  it("returns undefined when auth is incomplete", () => {
    const json = clineProvidersJson({ clinePassAuth: { accessToken: "workos:eA" } })
    expect(resolveClineAuthCredentials(ioFor(json))).toBeUndefined()
  })

  it("returns undefined when no auth present", () => {
    expect(resolveClineAuthCredentials(ioFor(clineProvidersJson({})))).toBeUndefined()
  })

  it("defaults expiresAt when missing", () => {
    const json = clineProvidersJson({ clinePassAuth: { accessToken: "workos:e", refreshToken: "r" } })
    expect(resolveClineAuthCredentials(ioFor(json))?.expiresAt).toBeGreaterThan(Date.now())
  })
})

describe("resolveClineStaticKey", () => {
  it("prefers CLINE_API_KEY env var", () => {
    const opts = { ...ioFor(clineProvidersJson({ clinePassApiKey: "from-file" })), env: { CLINE_API_KEY: "from-env" } }
    expect(resolveClineStaticKey(opts)).toBe("from-env")
  })

  it("reads settings.apiKey from providers.json", () => {
    expect(resolveClineStaticKey(ioFor(clineProvidersJson({ clinePassApiKey: "ck-static" })))).toBe("ck-static")
  })

  it("returns undefined when nothing is set", () => {
    expect(resolveClineStaticKey(ioFor(clineProvidersJson({})))).toBeUndefined()
  })
})

describe("readOpencodeAuth", () => {
  it("returns the stored auth for an id", () => {
    const opts = ioByPath({ [AUTH_PATH]: JSON.stringify({ clinepass: { type: "api", key: "k" } }) })
    expect(readOpencodeAuth("clinepass", opts)).toEqual({ type: "api", key: "k" })
  })

  it("returns undefined when the id is absent", () => {
    const opts = ioByPath({ [AUTH_PATH]: JSON.stringify({ other: { type: "api", key: "x" } }) })
    expect(readOpencodeAuth("clinepass", opts)).toBeUndefined()
  })
})

describe("extractKey", () => {
  it("oauth -> access", () => {
    expect(extractKey({ type: "oauth", access: "a", refresh: "r", expires: 1 })).toBe("a")
  })

  it("api -> key", () => {
    expect(extractKey({ type: "api", key: "k" })).toBe("k")
  })

  it("wellknown -> key", () => {
    expect(extractKey({ type: "wellknown", key: "k", token: "t" })).toBe("k")
  })

  it("undefined -> undefined", () => {
    expect(extractKey(undefined)).toBeUndefined()
  })
})

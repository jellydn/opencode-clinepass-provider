/**
 * Plugin-specific tests — autoImportCredentials (the only logic unique to clinepass.ts).
 *
 * All other tests are in per-module files under tests/unit/:
 *   utils.test.ts, env.test.ts, errors.test.ts, workos.test.ts, auth.test.ts, models.test.ts
 */

import { describe, it, expect } from "vitest"
import { autoImportCredentials } from "../src/clinepass.js"
import { clineProvidersJson, ioByPath, fakeFetch, fakeClient, AUTH_PATH, CLINE_PATH } from "./helpers.js"

describe("autoImportCredentials", () => {
  it("does nothing when clinepass auth already exists", async () => {
    const c = fakeClient()
    const opts = ioByPath({ [AUTH_PATH]: JSON.stringify({ clinepass: { type: "api", key: "existing" } }) })
    await autoImportCredentials(c, opts)
    expect(c.calls.set).toHaveLength(0)
  })

  it("imports fresh WorkOS credentials without refreshing", async () => {
    const c = fakeClient()
    const opts = ioByPath({
      [AUTH_PATH]: "{}",
      [CLINE_PATH]: clineProvidersJson({ clinePassAuth: { accessToken: "workos:e", refreshToken: "r", expiresAt: Date.now() + 3600_000 } }),
    })
    await autoImportCredentials(c, opts)
    expect(c.calls.set).toHaveLength(1)
    expect((c.calls.set[0] as { body: { type: string; access: string } }).body).toMatchObject({ type: "oauth", access: "workos:e" })
  })

  it("refreshes expired WorkOS credentials before importing", async () => {
    const c = fakeClient()
    const f = fakeFetch({ data: { accessToken: "eyJFresh", refreshToken: "rFresh" } })
    const opts = {
      ...ioByPath({
        [AUTH_PATH]: "{}",
        [CLINE_PATH]: clineProvidersJson({ clinePassAuth: { accessToken: "workos:e", refreshToken: "r", expiresAt: 1 } }),
      }),
      fetch: f,
    }
    await autoImportCredentials(c, opts)
    expect(c.calls.set).toHaveLength(1)
    expect((c.calls.set[0] as { body: { access: string } }).body.access).toBe("workos:eyJFresh")
  })

  it("imports a static API key from env", async () => {
    const c = fakeClient()
    const opts = { ...ioByPath({ [AUTH_PATH]: "{}", [CLINE_PATH]: clineProvidersJson({}) }), env: { CLINE_API_KEY: "ck-env" } }
    await autoImportCredentials(c, opts)
    expect(c.calls.set).toHaveLength(1)
    expect((c.calls.set[0] as { body: { type: string; key: string } }).body).toEqual({ type: "api", key: "ck-env" })
  })

  it("warns when no credentials are found", async () => {
    const c = fakeClient()
    await autoImportCredentials(c, ioByPath({ [AUTH_PATH]: "{}", [CLINE_PATH]: clineProvidersJson({}) }))
    expect(c.calls.set).toHaveLength(0)
    expect(c.calls.logs.some((l) => /no credentials found/.test(String((l as { message: string }).message)))).toBe(true)
  })
})

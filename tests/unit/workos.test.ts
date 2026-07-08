/**
 * Unit tests for WorkOS token refresh (src/workos.ts).
 */

import { describe, it, expect, vi } from "vitest"
import { refreshWorkosToken } from "../../src/lib/workos.js"
import { fakeFetch } from "../helpers.js"

describe("refreshWorkosToken", () => {
  it("refreshes via the nested data envelope and adds the workos: prefix", async () => {
    const f = fakeFetch({ data: { accessToken: "eyJnew", refreshToken: "rnew" } })
    const r = await refreshWorkosToken("oldR", { fetch: f })
    expect(r.access).toBe("workos:eyJnew")
    expect(r.refresh).toBe("rnew")
    expect(r.expires).toBeGreaterThan(Date.now())
    expect(f).toHaveBeenCalledWith(
      "https://api.cline.bot/api/v1/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("keeps an existing workos: prefix", async () => {
    const f = fakeFetch({ accessToken: "workos:eyJ", refreshToken: "r" })
    expect((await refreshWorkosToken("r", { fetch: f })).access).toBe("workos:eyJ")
  })

  it("throws on non-OK response", async () => {
    const f = fakeFetch("bad", { ok: false, status: 400 })
    await expect(refreshWorkosToken("r", { fetch: f })).rejects.toThrow(/400/)
  })

  it("throws when tokens are missing", async () => {
    const f = fakeFetch({ data: {} })
    await expect(refreshWorkosToken("r", { fetch: f })).rejects.toThrow(/unexpected/)
  })

  it("throws a friendly timeout error on abort", async () => {
    const f = vi.fn(async () => {
      throw new DOMException("timeout", "AbortError")
    }) as unknown as typeof globalThis.fetch
    await expect(refreshWorkosToken("r", { fetch: f })).rejects.toThrow(/timed out/)
  })
})

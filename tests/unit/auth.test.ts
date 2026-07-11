/**
 * Unit tests for credential extraction and auth store (src/auth.ts).
 */

import { describe, it, expect, vi } from "vitest"
import {
  resolveClineAuthCredentials,
  resolveClineStaticKey,
  readOpencodeAuth,
  extractKey,
  saveOpencodeAuth,
  oauthAuth,
  apiAuth,
  getCachedAuth,
  setCachedAuth,
  persistAuth,
  opencodeAuthPaths,
  defaultOpencodeAuthPath,
} from "../../src/lib/auth.js"
import { clineProvidersJson, ioFor, ioByPath, AUTH_PATH } from "../helpers.js"

describe("resolveClineAuthCredentials", () => {
  it("extracts cline-pass WorkOS credentials", () => {
    const json = clineProvidersJson({
      clinePassAuth: { accessToken: "workos:eA", refreshToken: "rA", expiresAt: 9000, accountId: "acc" },
    })
    expect(resolveClineAuthCredentials(ioFor(json))).toEqual({
      accessToken: "workos:eA",
      refreshToken: "rA",
      expiresAt: 9000,
      accountId: "acc",
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
    const opts = {
      ...ioFor(clineProvidersJson({ clinePassApiKey: "from-file" })),
      env: { CLINE_API_KEY: "from-env-key" },
    }
    expect(resolveClineStaticKey(opts)).toBe("from-env-key")
  })

  it("sanitizes paste wrappers from CLINE_API_KEY", () => {
    const opts = {
      ...ioFor(clineProvidersJson({})),
      env: { CLINE_API_KEY: "[200~ck-pasted-key[201~" },
    }
    expect(resolveClineStaticKey(opts)).toBe("ck-pasted-key")
  })

  it("treats whitespace-only CLINE_API_KEY as missing", () => {
    const opts = {
      ...ioFor(clineProvidersJson({ clinePassApiKey: "from-file" })),
      env: { CLINE_API_KEY: "   " },
    }
    expect(resolveClineStaticKey(opts)).toBe("from-file")
  })

  it("reads settings.apiKey from providers.json", () => {
    expect(resolveClineStaticKey(ioFor(clineProvidersJson({ clinePassApiKey: "ck-static" })))).toBe("ck-static")
  })

  it("returns undefined when nothing is set", () => {
    expect(resolveClineStaticKey({ ...ioFor(clineProvidersJson({})), env: {} })).toBeUndefined()
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

describe("saveOpencodeAuth", () => {
  it("writes oauth auth to an existing file", () => {
    const writeFile = vi.fn()
    const rename = vi.fn()
    const mkdir = vi.fn()
    const opts = {
      ...ioByPath({ [AUTH_PATH]: JSON.stringify({ existing: { type: "api", key: "keep" } }) }),
      writeFile,
      rename,
      mkdir,
    }
    const auth = oauthAuth("workos:token", "refresh", Date.now() + 3600000, "acc-1")
    const result = saveOpencodeAuth("clinepass", auth, opts)
    expect(result).toBe(true)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(mkdir).toHaveBeenCalledTimes(1)
    const tmpPath = writeFile.mock.calls[0][0]
    expect(tmpPath).toContain(".tmp-")
    const written = JSON.parse(writeFile.mock.calls[0][1])
    expect(written.clinepass).toEqual(auth)
    expect(written.existing).toEqual({ type: "api", key: "keep" })
    expect(writeFile.mock.calls[0][1]).toContain("\n")
  })

  it("writes api auth into an empty file", () => {
    const writeFile = vi.fn()
    const rename = vi.fn()
    const mkdir = vi.fn()
    const opts = {
      ...ioByPath({ [AUTH_PATH]: "{}" }),
      writeFile,
      rename,
      mkdir,
    }
    const auth = apiAuth("ck-test")
    const result = saveOpencodeAuth("clinepass", auth, opts)
    expect(result).toBe(true)
    const written = JSON.parse(writeFile.mock.calls[0][1])
    expect(written.clinepass).toEqual(auth)
    expect(Object.keys(written)).toEqual(["clinepass"])
  })

  it("updates existing clinepass entry in-place", () => {
    const writeFile = vi.fn()
    const rename = vi.fn()
    const mkdir = vi.fn()
    const existing = JSON.stringify({ clinepass: { type: "oauth", access: "old", refresh: "old", expires: 1 } })
    const opts = { ...ioByPath({ [AUTH_PATH]: existing }), writeFile, rename, mkdir }
    const auth = oauthAuth("new-token", "new-refresh", 9999)
    saveOpencodeAuth("clinepass", auth, opts)
    const written = JSON.parse(writeFile.mock.calls[0][1])
    expect(written.clinepass.access).toBe("new-token")
    expect(written.clinepass.refresh).toBe("new-refresh")
  })

  it("returns false when no auth file exists and cannot be written", () => {
    const writeFile = vi.fn(() => {
      throw new Error("EACCES: permission denied")
    })
    const rename = vi.fn()
    const mkdir = vi.fn()
    const opts = {
      homeDir: () => "/nonexistent",
      fileExists: () => false,
      readFile: () => "{}",
      writeFile,
      rename,
      mkdir,
    }
    const result = saveOpencodeAuth("clinepass", apiAuth("ck"), opts)
    expect(result).toBe(false)
  })

  it("falls through to next path when parsed content is not an object", () => {
    const writeFile = vi.fn()
    const rename = vi.fn()
    const mkdir = vi.fn()
    const allBad = {
      homeDir: () => "/",
      fileExists: () => true,
      readFile: () => '"string"',
      writeFile,
      rename,
      mkdir,
    }
    const result = saveOpencodeAuth("clinepass", apiAuth("ck"), allBad)
    expect(result).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe("persistAuth", () => {
  it("updates the in-memory cache so getCachedAuth returns the persisted auth", async () => {
    setCachedAuth("clinepass", undefined)
    const writeFile = vi.fn()
    const rename = vi.fn()
    const mkdir = vi.fn()
    const opts = {
      ...ioByPath({ [AUTH_PATH]: "{}" }),
      writeFile,
      rename,
      mkdir,
    }
    const client = {
      auth: {
        set: async () => true,
      },
    }
    const auth = apiAuth("ck-persisted")
    await persistAuth(client, "clinepass", auth, opts)
    expect(getCachedAuth("clinepass", { fileExists: () => false, readFile: () => "{}" })).toEqual(auth)
    setCachedAuth("clinepass", undefined)
  })
})

describe("opencodeAuthPaths", () => {
  it("includes both OpenCode and Kilo XDG auth paths", () => {
    const paths = opencodeAuthPaths("/home/user")
    expect(paths).toContain("/home/user/.local/share/opencode/auth.json")
    expect(paths).toContain("/home/user/.local/share/kilo/auth.json")
    expect(paths).toContain("/home/user/Library/Application Support/opencode/auth.json")
    expect(paths).toContain("/home/user/Library/Application Support/kilo/auth.json")
  })

  it("defaultOpencodeAuthPath is the first (host-primary) path", () => {
    const home = "/home/user"
    expect(defaultOpencodeAuthPath(home)).toBe(opencodeAuthPaths(home)[0])
  })
})

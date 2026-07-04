import { describe, it, expect, vi } from "vitest"
import {
  PROVIDER_ID,
  DEFAULT_API_BASE,
  WORKOS_TOKEN_PREFIX,
  isRecord,
  stringValue,
  numberValue,
  resolveApiBase,
  sanitizeApiKey,
  isWorkosToken,
  resolveClineAuthCredentials,
  resolveClineStaticKey,
  refreshWorkosToken,
  readOpencodeAuth,
  extractKey,
  classifyClinePassError,
  MODELS,
  modelsToConfig,
  buildProviderConfig,
  injectProviderConfig,
  autoImportCredentials,
  type ClientLike,
} from "../src/clinepass"

function clineProvidersJson(opts: {
  clinePassAuth?: object
  clinePassApiKey?: string
  clineAuth?: object
}): string {
  const providers: Record<string, unknown> = {}
  if (opts.clinePassAuth !== undefined || opts.clinePassApiKey !== undefined) {
    const settings: Record<string, unknown> = {}
    if (opts.clinePassAuth) settings.auth = opts.clinePassAuth
    if (opts.clinePassApiKey) settings.apiKey = opts.clinePassApiKey
    providers["cline-pass"] = { settings }
  }
  if (opts.clineAuth !== undefined) providers["cline"] = { settings: { auth: opts.clineAuth } }
  return JSON.stringify({ version: 1, providers })
}

function ioFor(content: string, exists = true) {
  return { homeDir: () => "/fake-home", fileExists: () => exists, readFile: () => content }
}

function fakeFetch(
  body: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof globalThis.fetch
}

function fakeClient(): ClientLike & { calls: { set: unknown[]; logs: unknown[] } } {
  const calls = { set: [] as unknown[], logs: [] as unknown[] }
  return {
    calls,
    auth: { set: async (o: { path: { id: string }; body: unknown }) => { calls.set.push(o); return true } },
    app: { log: async (o: { body: unknown }) => { calls.logs.push(o.body); return true } },
  }
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

const HOME = "/fake-home"
const CLINE_PATH = `${HOME}/.cline/data/settings/providers.json`
const AUTH_PATH = `${HOME}/.local/share/opencode/auth.json`

function ioByPath(map: Record<string, string>) {
  return {
    homeDir: () => HOME,
    fileExists: (p: string) => p in map,
    readFile: (p: string) => map[p] ?? "{}",
  }
}

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
})

describe("models", () => {
  it("defines 10 curated models", () => {
    expect(MODELS).toHaveLength(10)
    expect(MODELS.every((m) => m.id.startsWith("cline-pass/"))).toBe(true)
  })
  it("modelsToConfig produces the opencode provider shape", () => {
    const cfg = modelsToConfig()
    expect(cfg["cline-pass/glm-5.2"]).toEqual({ name: "GLM-5.2 (ClinePass)", limit: { context: 200000, output: 131072 } })
  })
})

describe("buildProviderConfig", () => {
  it("produces a complete provider config block", () => {
    const cfg = buildProviderConfig()
    expect(cfg.npm).toBe("@ai-sdk/openai-compatible")
    expect(cfg.name).toBe("ClinePass")
    expect(cfg.options.baseURL).toBe("https://api.cline.bot/api/v1")
    expect(Object.keys(cfg.models)).toHaveLength(10)
  })
  it("honours CLINE_API_BASE for the baseURL", () => {
    const cfg = buildProviderConfig({ CLINE_API_BASE: "https://custom.example.com/" })
    expect(cfg.options.baseURL).toBe("https://custom.example.com/api/v1")
  })
})

describe("injectProviderConfig", () => {
  it("injects clinepass when no provider config exists", () => {
    const input: { provider?: Record<string, unknown> } = {}
    injectProviderConfig(input)
    expect(input.provider?.clinepass).toBeDefined()
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("@ai-sdk/openai-compatible")
  })
  it("injects clinepass when provider exists but clinepass is absent", () => {
    const input: { provider?: Record<string, unknown> } = { provider: { anthropic: { name: "Anthropic" } } }
    injectProviderConfig(input)
    expect(input.provider?.clinepass).toBeDefined()
    expect(input.provider?.anthropic).toBeDefined() // existing preserved
  })
  it("does NOT overwrite an existing clinepass config", () => {
    const input: { provider?: Record<string, unknown> } = {
      provider: { clinepass: { npm: "custom-package", name: "My Custom" } },
    }
    injectProviderConfig(input)
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("custom-package")
  })
})

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



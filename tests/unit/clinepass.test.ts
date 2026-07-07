/**
 * Plugin hook tests — config, provider.models, chat.headers, event.
 *
 * These tests exercise the hook functions returned by ClinePassPlugin,
 * verifying that each hook behaves correctly with controlled inputs.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { ClinePassPlugin, PROVIDER_ID } from "../../src/clinepass.js"
import { fakeClient } from "../helpers.js"

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Mock fetch so refreshWorkosToken fails fast in tests (avoids real network). */
function mockFetchToFail() {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in test"))
}

function restoreFetch() {
  vi.restoreAllMocks()
}

/** Get the hooks object from a fresh plugin instance with a fake client. */
async function getHooks() {
  const client = fakeClient()
  const ctx = { client }
  return {
    hooks: await ClinePassPlugin(ctx as any),
    client,
  }
}

/** Build a chat.headers input object for the ClinePass provider. */
function chatInput(providerId = PROVIDER_ID) {
  return { provider: { info: { id: providerId } } }
}

/** Build a chat.headers output object. */
function chatOutput(): { headers: Record<string, string> } {
  return { headers: {} }
}

/** Build an event input for session.next.step.failed. */
function failedEvent(message: string) {
  return {
    event: {
      type: "session.next.step.failed",
      properties: { error: { message } },
    },
  }
}

// ─── config hook ───────────────────────────────────────────────────────────

describe("config hook", () => {
  afterEach(restoreFetch)

  it("injects the clinepass provider into an empty config", async () => {
    const { hooks } = await getHooks()
    const input: { provider?: Record<string, unknown> } = {}
    await hooks.config!(input)
    expect(input.provider?.clinepass).toBeDefined()
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("@ai-sdk/openai-compatible")
  })

  it("does not overwrite an existing clinepass provider config", async () => {
    const { hooks } = await getHooks()
    const input: { provider?: Record<string, unknown> } = {
      provider: { clinepass: { npm: "custom", name: "Custom" } },
    }
    await hooks.config!(input)
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("custom")
  })

  it("preserves other providers when injecting clinepass", async () => {
    const { hooks } = await getHooks()
    const input: { provider?: Record<string, unknown> } = {
      provider: { anthropic: { name: "Anthropic" } },
    }
    await hooks.config!(input)
    expect(input.provider?.anthropic).toBeDefined()
    expect(input.provider?.clinepass).toBeDefined()
  })
})

// ─── provider.models hook ──────────────────────────────────────────────────

describe("provider.models hook", () => {
  it("falls back to static models when no auth is available", async () => {
    const { hooks } = await getHooks()
    const models = await hooks.provider!.models({} as any, { auth: undefined })
    expect(models).toBeDefined()
    expect(Object.keys(models!)).toHaveLength(10)
    expect(models!["cline-pass/glm-5.2"]).toBeDefined()
  })

  it("falls back to static models when remote fetch fails (api auth)", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.provider!.models({} as any, {
      auth: { type: "api", key: "sk-test" },
    })
    // fetchRemoteModels will fail (no real network), so falls back to static
    expect(result).toBeDefined()
    expect(Object.keys(result!)).toHaveLength(10)
  })

  it("falls back to static models when remote fetch fails (oauth auth)", async () => {
    const { hooks } = await getHooks()
    // We can't easily inject fetch here since the hook doesn't pass options.
    // But we can verify the fallback behavior is correct.
    const result = await hooks.provider!.models({} as any, {
      auth: { type: "oauth", access: "workos:eyJ", refresh: "r", expires: Date.now() + 9999 },
    })
    expect(result).toBeDefined()
    expect(Object.keys(result!).length).toBeGreaterThanOrEqual(10)
  })
})

// ─── chat.headers hook ─────────────────────────────────────────────────────

describe("chat.headers hook", () => {
  afterEach(restoreFetch)

  it("is a no-op for non-clinepass providers", async () => {
    const { hooks } = await getHooks()
    const input = chatInput("other-provider")
    const output = chatOutput()
    await hooks["chat.headers"]!(input as any, output)
    expect(output.headers["Authorization"]).toBeUndefined()
  })

  it("is a no-op when provider info is missing", async () => {
    const { hooks } = await getHooks()
    const output = chatOutput()
    await hooks["chat.headers"]!({} as any, output)
    expect(output.headers["Authorization"]).toBeUndefined()
  })

  it("is a no-op for api-type auth (loader handles apiKey)", async () => {
    const { hooks } = await getHooks()
    // Use the loader to set cachedAuth with api type
    await hooks.auth!.loader(async () => ({ type: "api", key: "ck-test" }))

    const input = chatInput()
    const output = chatOutput()
    await hooks["chat.headers"]!(input as any, output)
    // API keys are handled by the loader's apiKey option, not chat.headers
    expect(output.headers["Authorization"]).toBeUndefined()
  })

  it("injects Authorization header for oauth auth", async () => {
    const { hooks } = await getHooks()
    // Set up cachedAuth with oauth type via the loader
    const expires = Date.now() + 3600_000
    await hooks.auth!.loader(async () => ({
      type: "oauth",
      access: "workos:test-token",
      refresh: "r-test",
      expires,
    }))

    const input = chatInput()
    const output = chatOutput()
    await hooks["chat.headers"]!(input as any, output)
    expect(output.headers["Authorization"]).toBe("Bearer workos:test-token")
  })

  it("handles expired oauth token refresh failure gracefully", async () => {
    mockFetchToFail()
    const { hooks, client } = await getHooks()
    // Set up expired oauth auth via the loader
    await hooks.auth!.loader(async () => ({
      type: "oauth",
      access: "workos:old-token",
      refresh: "r-old",
      expires: 1, // expired — triggers refresh path
    }))

    const input = chatInput()
    const output = chatOutput()
    await hooks["chat.headers"]!(input as any, output)
    // When refresh fails, the old token is still injected
    expect(output.headers["Authorization"]).toBe("Bearer workos:old-token")
    // An error about refresh failure should be logged
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs.length).toBeGreaterThan(0)
  })
})

// ─── auth loader hook ───────────────────────────────────────────────────────

describe("auth loader hook", () => {
  it("returns { apiKey } for oauth auth", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.auth!.loader(async () => ({
      type: "oauth",
      access: "workos:eyJ",
      refresh: "r",
      expires: Date.now() + 3600_000,
    }))
    expect(result).toEqual({ apiKey: "workos:eyJ" })
  })

  it("returns { apiKey } for api auth", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.auth!.loader(async () => ({
      type: "api",
      key: "ck-test-key",
    }))
    expect(result).toEqual({ apiKey: "ck-test-key" })
  })

  it("returns { apiKey } for wellknown auth", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.auth!.loader(async () => ({
      type: "wellknown",
      key: "wk-token",
      token: "t",
    }))
    expect(result).toEqual({ apiKey: "wk-token" })
  })

  it("returns {} when auth is null", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.auth!.loader(async () => null as any)
    expect(result).toEqual({})
  })

  it("returns {} when auth is undefined", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.auth!.loader(async () => undefined)
    expect(result).toEqual({})
  })

  it("returns {} when auth() rejects", async () => {
    const { hooks } = await getHooks()
    const result = await hooks.auth!.loader(async () => {
      throw new Error("auth store unavailable")
    })
    expect(result).toEqual({})
  })
})

// ─── event hook ─────────────────────────────────────────────────────────────

describe("event hook", () => {
  it("is a no-op for non-session events", async () => {
    const { hooks, client } = await getHooks()
    await hooks.event!({ event: { type: "some.other.event" } } as any)
    // No error logs should be generated
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs).toHaveLength(0)
  })

  it("is a no-op for session.next.step.failed with non-clinepass error", async () => {
    const { hooks, client } = await getHooks()
    await hooks.event!(failedEvent("Some generic LLM error") as any)
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs).toHaveLength(0)
  })

  it("logs an error for session.next.step.failed with clinepass 403", async () => {
    const { hooks, client } = await getHooks()
    await hooks.event!(failedEvent("403 Forbidden — ClinePass subscription required") as any)
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs.length).toBeGreaterThan(0)
    const msg = (errorLogs[0] as { message: string }).message
    expect(msg).toContain("subscription")
  })

  it("logs an error for session.next.step.failed with clinepass 401", async () => {
    const { hooks, client } = await getHooks()
    await hooks.event!(failedEvent("401 Unauthorized — invalid api key for ClinePass") as any)
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs.length).toBeGreaterThan(0)
    const msg = (errorLogs[0] as { message: string }).message
    expect(msg).toContain("expired")
  })

  it("logs an error for session.next.step.failed with clinepass 429", async () => {
    const { hooks, client } = await getHooks()
    await hooks.event!(failedEvent("429 Too Many Requests — rate limit for clinepass") as any)
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs.length).toBeGreaterThan(0)
    const msg = (errorLogs[0] as { message: string }).message
    expect(msg).toContain("rate")
  })

  it("is a no-op for events without error message", async () => {
    const { hooks, client } = await getHooks()
    await hooks.event!({
      event: { type: "session.next.step.failed", properties: {} },
    } as any)
    const errorLogs = client.calls.logs.filter(
      (l) => (l as { level: string }).level === "error",
    )
    expect(errorLogs).toHaveLength(0)
  })
})

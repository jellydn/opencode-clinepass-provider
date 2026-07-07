/**
 * Plugin hook tests — config, provider.models, chat.headers, event.
 *
 * These tests exercise the hook functions returned by ClinePassPlugin,
 * verifying that each hook behaves correctly with controlled inputs.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import type { Auth } from "@opencode-ai/sdk/v2"
import type { Config } from "@opencode-ai/plugin"
import { ClinePassPlugin, PROVIDER_ID } from "../../src/clinepass.js"
import { fakeClient } from "../helpers.js"

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
  const ctx = { client } as unknown as Parameters<typeof ClinePassPlugin>[0]
  return {
    hooks: await ClinePassPlugin(ctx),
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

describe("config hook", () => {
  afterEach(restoreFetch)

  it("injects the clinepass provider into an empty config", async () => {
    const { hooks } = await getHooks()
    const input = {} as Config
    hooks.config!(input)
    expect(input.provider?.clinepass).toBeDefined()
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("@ai-sdk/openai-compatible")
  })

  it("does not overwrite an existing clinepass provider config", async () => {
    const { hooks } = await getHooks()
    const input = {
      provider: { clinepass: { npm: "custom", name: "Custom" } },
    } as Config
    hooks.config!(input)
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("custom")
  })

  it("preserves other providers when injecting clinepass", async () => {
    const { hooks } = await getHooks()
    const input = {
      provider: { anthropic: { name: "Anthropic" } },
    } as Config
    hooks.config!(input)
    expect(input.provider?.anthropic).toBeDefined()
    expect(input.provider?.clinepass).toBeDefined()
  })
})

describe("provider.models hook", () => {
  it("falls back to static models when no auth is available", async () => {
    const { hooks } = await getHooks()
    const providerHook = hooks.provider!
    const models = await providerHook.models!({} as Parameters<NonNullable<typeof providerHook.models>>[0], {
      auth: undefined,
    })
    expect(models).toBeDefined()
    expect(Object.keys(models!)).toHaveLength(10)
    expect(models!["cline-pass/glm-5.2"]).toBeDefined()
  })

  it("falls back to static models when remote fetch fails (api auth)", async () => {
    const { hooks } = await getHooks()
    const providerHook = hooks.provider!
    const result = await providerHook.models!({} as Parameters<NonNullable<typeof providerHook.models>>[0], {
      auth: { type: "api", key: "sk-test" },
    })
    expect(result).toBeDefined()
    expect(Object.keys(result!)).toHaveLength(10)
  })

  it("falls back to static models when remote fetch fails (oauth auth)", async () => {
    const { hooks } = await getHooks()
    const providerHook = hooks.provider!
    const result = await providerHook.models!({} as Parameters<NonNullable<typeof providerHook.models>>[0], {
      auth: { type: "oauth", access: "workos:eyJ", refresh: "r", expires: Date.now() + 9999 },
    })
    expect(result).toBeDefined()
    expect(Object.keys(result!).length).toBeGreaterThanOrEqual(10)
  })
})

describe("chat.headers hook", () => {
  afterEach(restoreFetch)

  it("is a no-op for non-clinepass providers", async () => {
    const { hooks } = await getHooks()
    const input = chatInput("other-provider")
    const output = chatOutput()
    await hooks["chat.headers"]!(input as Parameters<NonNullable<(typeof hooks)["chat.headers"]>>[0], output)
    expect(output.headers["Authorization"]).toBeUndefined()
  })

  it("is a no-op when provider info is missing", async () => {
    const { hooks } = await getHooks()
    const output = chatOutput()
    await hooks["chat.headers"]!({} as Parameters<NonNullable<(typeof hooks)["chat.headers"]>>[0], output)
    expect(output.headers["Authorization"]).toBeUndefined()
  })

  it("is a no-op for api-type auth (loader handles apiKey)", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    await authHook.loader!(
      async () => ({ type: "api" as const, key: "ck-test" }),
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )

    const input = chatInput()
    const output = chatOutput()
    await hooks["chat.headers"]!(input as Parameters<NonNullable<(typeof hooks)["chat.headers"]>>[0], output)
    expect(output.headers["Authorization"]).toBeUndefined()
  })

  it("injects Authorization header for oauth auth", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const expires = Date.now() + 3600_000
    await authHook.loader!(
      async () => ({
        type: "oauth" as const,
        access: "workos:test-token",
        refresh: "r-test",
        expires,
      }),
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )

    const input = chatInput()
    const output = chatOutput()
    await hooks["chat.headers"]!(input as Parameters<NonNullable<(typeof hooks)["chat.headers"]>>[0], output)
    expect(output.headers["Authorization"]).toBe("Bearer workos:test-token")
  })

  it("handles expired oauth token refresh failure gracefully", async () => {
    mockFetchToFail()
    const { hooks, client } = await getHooks()
    const authHook = hooks.auth!
    await authHook.loader!(
      async () => ({
        type: "oauth" as const,
        access: "workos:old-token",
        refresh: "r-old",
        expires: 1,
      }),
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )

    const input = chatInput()
    const output = chatOutput()
    await hooks["chat.headers"]!(input as Parameters<NonNullable<(typeof hooks)["chat.headers"]>>[0], output)
    expect(output.headers["Authorization"]).toBe("Bearer workos:old-token")
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs.length).toBeGreaterThan(0)
  })
})

describe("auth loader hook", () => {
  it("returns { apiKey } for oauth auth", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const result = await authHook.loader!(
      async () => ({
        type: "oauth" as const,
        access: "workos:eyJ",
        refresh: "r",
        expires: Date.now() + 3600_000,
      }),
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )
    expect(result).toEqual({ apiKey: "workos:eyJ" })
  })

  it("returns { apiKey } for api auth", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const result = await authHook.loader!(
      async () => ({
        type: "api" as const,
        key: "ck-test-key",
      }),
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )
    expect(result).toEqual({ apiKey: "ck-test-key" })
  })

  it("returns { apiKey } for wellknown auth", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const result = await authHook.loader!(
      async () => ({
        type: "wellknown" as const,
        key: "wk-token",
        token: "t",
      }),
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )
    expect(result).toEqual({ apiKey: "wk-token" })
  })

  it("returns {} when auth is null", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const result = await authHook.loader!(
      async () => null as unknown as Auth,
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )
    expect(result).toEqual({})
  })

  it("returns {} when auth is undefined", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const result = await authHook.loader!(
      async () => undefined as unknown as Auth,
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )
    expect(result).toEqual({})
  })

  it("returns {} when auth() rejects", async () => {
    const { hooks } = await getHooks()
    const authHook = hooks.auth!
    const result = await authHook.loader!(
      async () => {
        throw new Error("auth store unavailable")
      },
      {} as Parameters<NonNullable<typeof authHook.loader>>[1],
    )
    expect(result).toEqual({})
  })
})

describe("event hook", () => {
  it("is a no-op for non-session events", async () => {
    const { hooks, client } = await getHooks()
    hooks.event!({ event: { type: "some.other.event" } } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs).toHaveLength(0)
  })

  it("is a no-op for session.next.step.failed with non-clinepass error", async () => {
    const { hooks, client } = await getHooks()
    hooks.event!(failedEvent("Some generic LLM error") as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs).toHaveLength(0)
  })

  it("logs an error for session.next.step.failed with clinepass 403", async () => {
    const { hooks, client } = await getHooks()
    hooks.event!(
      failedEvent("403 Forbidden — ClinePass subscription required") as unknown as Parameters<
        NonNullable<typeof hooks.event>
      >[0],
    )
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs.length).toBeGreaterThan(0)
    const msg = (errorLogs[0] as { message: string }).message
    expect(msg).toContain("subscription")
  })

  it("logs an error for session.next.step.failed with clinepass 401", async () => {
    const { hooks, client } = await getHooks()
    hooks.event!(
      failedEvent("401 Unauthorized — invalid api key for ClinePass") as unknown as Parameters<
        NonNullable<typeof hooks.event>
      >[0],
    )
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs.length).toBeGreaterThan(0)
    const msg = (errorLogs[0] as { message: string }).message
    expect(msg).toContain("expired")
  })

  it("logs an error for session.next.step.failed with clinepass 429", async () => {
    const { hooks, client } = await getHooks()
    hooks.event!(
      failedEvent("429 Too Many Requests — rate limit for clinepass") as unknown as Parameters<
        NonNullable<typeof hooks.event>
      >[0],
    )
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs.length).toBeGreaterThan(0)
    const msg = (errorLogs[0] as { message: string }).message
    expect(msg).toContain("rate")
  })

  it("is a no-op for events without error message", async () => {
    const { hooks, client } = await getHooks()
    hooks.event!({
      event: { type: "session.next.step.failed", properties: {} },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    const errorLogs = client.calls.logs.filter((l) => (l as { level: string }).level === "error")
    expect(errorLogs).toHaveLength(0)
  })
})

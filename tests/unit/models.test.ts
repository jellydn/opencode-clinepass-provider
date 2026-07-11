/**
 * Unit tests for model definitions and config generation (src/models.ts).
 */

import { describe, it, expect, vi } from "vitest"
import {
  MODELS,
  modelsToConfig,
  buildProviderConfig,
  fetchRemoteModels,
  injectProviderConfig,
  type ThinkingLevel,
} from "../../src/lib/models.js"
import { fakeFetch } from "../helpers.js"

describe("models", () => {
  it("defines 10 curated models", () => {
    expect(MODELS).toHaveLength(10)
    expect(MODELS.every((m) => m.id.startsWith("cline-pass/"))).toBe(true)
  })

  it("every model has reasoning and a 6-level thinkingLevelMap", () => {
    const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]
    for (const m of MODELS) {
      expect(m.reasoning).toBe(true)
      for (const level of levels) {
        expect(m.thinkingLevelMap).toHaveProperty(level)
      }
    }
  })

  it("GLM-5.2 supports xhigh reasoning", () => {
    const glm = MODELS.find((m) => m.id === "cline-pass/glm-5.2")!
    expect(glm.thinkingLevelMap.xhigh).toBe("xhigh")
    expect(glm.thinkingLevelMap.off).toBe("none")
  })

  it("Kimi models have off as null (no non-reasoning mode)", () => {
    for (const id of ["cline-pass/kimi-k2.7-code", "cline-pass/kimi-k2.6"]) {
      const m = MODELS.find((x) => x.id === id)!
      expect(m.thinkingLevelMap.off).toBeNull()
      expect(m.thinkingLevelMap.low).toBe("low")
    }
  })

  it("DeepSeek models only support high/xhigh (off/minimal/low/medium null)", () => {
    for (const id of ["cline-pass/deepseek-v4-pro", "cline-pass/deepseek-v4-flash"]) {
      const m = MODELS.find((x) => x.id === id)!
      expect(m.thinkingLevelMap.off).toBeNull()
      expect(m.thinkingLevelMap.minimal).toBeNull()
      expect(m.thinkingLevelMap.low).toBeNull()
      expect(m.thinkingLevelMap.medium).toBeNull()
      expect(m.thinkingLevelMap.xhigh).toBe("high")
      expect(m.thinkingLevelMap.high).toBe("high")
    }
  })

  it("modelsToConfig produces the opencode provider shape with reasoning", () => {
    const cfg = modelsToConfig()
    const glm = cfg["cline-pass/glm-5.2"]
    expect(glm.name).toBe("GLM-5.2 (ClinePass)")
    expect(glm.limit).toEqual({ context: 1048576, output: 131072 })
    expect(glm.reasoning).toBe(true)
    expect(glm.thinkingLevelMap.off).toBe("none")
    expect(glm.thinkingLevelMap.xhigh).toBe("xhigh")
  })
})

describe("buildProviderConfig", () => {
  it("produces a complete provider config block with reasoning metadata", () => {
    const cfg = buildProviderConfig()
    expect(cfg.npm).toBe("@ai-sdk/openai-compatible")
    expect(cfg.name).toBe("ClinePass")
    expect(cfg.options.baseURL).toBe("https://api.cline.bot/api/v1")
    expect(Object.keys(cfg.models)).toHaveLength(10)
    const glm = cfg.models["cline-pass/glm-5.2"]
    expect(glm.reasoning).toBe(true)
    expect(glm.thinkingLevelMap.xhigh).toBe("xhigh")
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
    expect(input.provider?.anthropic).toBeDefined()
  })

  it("does NOT overwrite an existing clinepass config", () => {
    const input: { provider?: Record<string, unknown> } = {
      provider: { clinepass: { npm: "custom-package", name: "My Custom" } },
    }
    injectProviderConfig(input)
    expect((input.provider?.clinepass as { npm: string }).npm).toBe("custom-package")
  })
})

describe("fetchRemoteModels", () => {
  it("returns undefined when no apiKey is provided", async () => {
    expect(await fetchRemoteModels(undefined)).toBeUndefined()
  })

  it("fetches and parses the OpenAI-compatible data envelope with reasoning", async () => {
    const f = fakeFetch({
      data: [
        {
          id: "cline-pass/glm-5.2",
          name: "GLM-5.2",
          context_length: 1_048_576,
          max_output_tokens: 131_072,
          reasoning: false,
        },
        { id: "cline-pass/new-model", name: "New Model", context_length: 500_000, max_output_tokens: 100_000 },
      ],
    })
    const result = await fetchRemoteModels("sk-test", { fetch: f })
    expect(result).toBeDefined()
    expect(Object.keys(result!)).toHaveLength(2)
    expect(result!["cline-pass/glm-5.2"]!.limit.context).toBe(1_048_576)
    expect(result!["cline-pass/glm-5.2"]!.reasoning).toBe(false)
    expect(result!["cline-pass/glm-5.2"]!.thinkingLevelMap.xhigh).toBe("xhigh")
    expect(result!["cline-pass/new-model"]!.limit.output).toBe(100_000)
    expect(result!["cline-pass/new-model"]!.thinkingLevelMap.off).toBe("none")
    expect(result!["cline-pass/new-model"]!.thinkingLevelMap.xhigh).toBeNull()
  })

  it("filters out non-cline-pass models", async () => {
    const f = fakeFetch({
      data: [
        { id: "cline-pass/glm-5.2", name: "GLM-5.2", context_length: 200_000, max_output_tokens: 131_072 },
        { id: "anthropic/claude-4", name: "Claude 4", context_length: 200_000, max_output_tokens: 100_000 },
      ],
    })
    const result = await fetchRemoteModels("sk-test", { fetch: f })
    expect(Object.keys(result!)).toHaveLength(1)
    expect(result!["anthropic/claude-4"]).toBeUndefined()
  })

  it("falls back to static data when API returns incomplete entries", async () => {
    const f = fakeFetch({ data: [{ id: "cline-pass/glm-5.2", name: "GLM-5.2" }] })
    const result = await fetchRemoteModels("sk-test", { fetch: f })
    expect(result!["cline-pass/glm-5.2"]!.limit.context).toBe(1_048_576)
  })

  it("returns undefined on non-ok response", async () => {
    const f = fakeFetch("error", { ok: false, status: 401 })
    expect(await fetchRemoteModels("sk-test", { fetch: f })).toBeUndefined()
  })

  it("returns undefined on network error", async () => {
    const f = vi.fn(async () => {
      throw new Error("network")
    }) as unknown as typeof globalThis.fetch
    expect(await fetchRemoteModels("sk-test", { fetch: f })).toBeUndefined()
  })
})

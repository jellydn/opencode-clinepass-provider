/**
 * Shared test utilities used across per-module test files.
 */

import { vi } from "vitest"
import type { ClientLike } from "../src/clinepass.js"

export const HOME = "/fake-home"
export const CLINE_PATH = `${HOME}/.cline/data/settings/providers.json`
export const AUTH_PATH = `${HOME}/.local/share/opencode/auth.json`

export function clineProvidersJson(opts: {
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

export function ioFor(content: string, exists = true) {
  return { homeDir: () => HOME, fileExists: () => exists, readFile: () => content }
}

export function fakeFetch(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof globalThis.fetch
}

export function ioByPath(map: Record<string, string>) {
  return {
    homeDir: () => HOME,
    fileExists: (p: string) => p in map,
    readFile: (p: string) => map[p] ?? "{}",
  }
}

export function fakeClient(): ClientLike & { calls: { set: unknown[]; logs: unknown[] } } {
  const calls = { set: [] as unknown[], logs: [] as unknown[] }
  return {
    calls,
    auth: {
      set: async (o: { path: { id: string }; body: unknown }) => {
        calls.set.push(o)
        return true
      },
    },
    app: {
      log: async (o: { body: unknown }) => {
        calls.logs.push(o.body)
        return true
      },
    },
  }
}

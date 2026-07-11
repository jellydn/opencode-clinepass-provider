# Stack

## Runtime & Language

| Category | Choice | Version |
|----------|--------|---------|
| Runtime | Bun (plugin host) | — |
| Language | TypeScript | ^5.7.0 |
| Module system | ESM (`"type": "module"`) | — |
| Node types | `@types/node` | ^22.10.0 |

## Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@opencode-ai/plugin` | ^1.17.13 | Plugin API: hooks, auth, config injection |
| `@opencode-ai/sdk` | ^1.17.13 | Auth type definitions (`Auth` from `sdk/v2`) |

These are `devDependencies` — the plugin runs inside OpenCode's Bun runtime which provides them. They're installed for typechecking and testing.

## Development Tools

| Tool | Config | Purpose |
|------|--------|---------|
| Vitest | `vitest.config.ts` | Unit testing (node environment) |
| TypeScript | `tsconfig.json` | Type checking (`noEmit`) |
| Bun | `bun run test` | Package manager + test runner |

## Provider Configuration

The plugin registers ClinePass as an `@ai-sdk/openai-compatible` provider in OpenCode's config:

```json
{
  "npm": "@ai-sdk/openai-compatible",
  "name": "ClinePass",
  "options": { "baseURL": "https://api.cline.bot/api/v1" }
}
```

The `@ai-sdk/openai-compatible` package is provided by OpenCode at runtime — not listed in `package.json`.

## Package Metadata

| Field | Value |
|-------|-------|
| Name | `opencode-clinepass-provider` |
| Entry | `src/clinepass.ts` |
| Exports | `"./src/clinepass.ts"` (single entry) |
| License | MIT |
| Keywords | opencode, opencode-plugin, cline, clinepass, llm, ai |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CLINE_API_KEY` | Static ClinePass API key | — |
| `CLINE_API_BASE` | Override API endpoint | `https://api.cline.bot` |

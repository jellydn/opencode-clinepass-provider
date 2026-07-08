# opencode-clinepass-provider 🚀

**ClinePass provider plugin for [Opencode](https://opencode.ai)** — 10 curated
open-weight coding models (GLM-5.2, Kimi K2.7 Code, DeepSeek V4, Qwen3.7, and
more) accessible through Cline's $9.99/month
[ClinePass](https://docs.cline.bot/getting-started/clinepass) subscription.

This is the Opencode equivalent of
[`jellydn/pi-clinepass-provider`](https://github.com/jellydn/pi-clinepass-provider),
adapted from pi's extension API to Opencode's plugin API (`@opencode-ai/plugin`).

## Features

- 🔐 **Two authentication methods** — Cline CLI subscription (WorkOS OAuth) _or_
  static API key, both selectable from Opencode's `/connect` command
- ⚡ **Zero-config auto-import** — reuses your existing `cline auth` login or
  `CLINE_API_KEY` env var on startup (never overwrites manual `/connect` entries)
- 🔄 **Automatic token refresh** — short-lived WorkOS access tokens (~1 hour)
  are refreshed lazily before each request via Cline's server-side endpoint
- 🧠 **10 curated models** — GLM-5.2, Kimi K2.7 Code, Kimi K2.6, DeepSeek V4
  Pro/Flash, MiMo V2.5/Pro, MiniMax M3, Qwen3.7 Max/Plus
- 🎯 **Per-model thinking level maps** — each model declares support for 6
  thinking levels (off/minimal/low/medium/high/xhigh) mapped to provider-specific
  `reasoning_effort` values (GLM-5.2 supports xhigh, Kimi is reasoning-only, etc.)
- 📦 **Modular architecture** — 7 source files matching
  [pi-clinepass-provider](https://github.com/jellydn/pi-clinepass-provider)'s
  structure (utils, env, errors, workos, auth, models, plugin)
- 🪝 **Friendly, actionable errors** — clear messages for 403 (not subscribed),
  401 (auth expired), and 429 (rate limited) responses

## Prerequisites

- [Opencode](https://opencode.ai) v1.17+ (the plugin API ships from there)
- One of:
  - The **Cline CLI** installed and signed in (`npm i -g cline` then `cline auth`)
    with an active ClinePass subscription, **or**
  - A **ClinePass API key** from
    [app.cline.bot → Settings → API Keys](https://app.cline.bot/settings/api-keys)

## Installation

### Option A — One-line install (recommended)

Clone the repo and copy the plugin into Opencode's plugin directory:

```bash
git clone https://github.com/haconglinh1990/opencode-clinepass-provider.git
mkdir -p ~/.config/opencode/plugins/lib
cp opencode-clinepass-provider/src/clinepass.ts ~/.config/opencode/plugins/
cp opencode-clinepass-provider/src/lib/{auth,env,errors,models,utils,workos}.ts ~/.config/opencode/plugins/lib/
```

> **Note:** Only `clinepass.ts` is a plugin entry point. The other 6 modules
> live in `lib/` so Opencode's plugin scanner doesn't try to load them as
> standalone plugins. The imports in `clinepass.ts` use `./lib/` paths to
> match this layout.

### Option B — Clone the repo

```bash
git clone https://github.com/haconglinh1990/opencode-clinepass-provider.git
mkdir -p ~/.config/opencode/plugins/lib
cp opencode-clinepass-provider/src/clinepass.ts ~/.config/opencode/plugins/
cp opencode-clinepass-provider/src/lib/{auth,env,errors,models,utils,workos}.ts ~/.config/opencode/plugins/lib/
```

### Option C — npm package (when published)

Add the package to your Opencode config and Opencode installs it automatically
with Bun at startup:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-clinepass-provider"],
}
```

### That's it — no config editing needed!

The plugin **auto-registers** the `clinepass` provider (base URL + all 10 models)
via Opencode's `config` hook at startup — just like built-in providers such as
GitHub Copilot and OpenCode Go. You do **not** need to manually add anything to
`opencode.json`.

> **Optional:** If you want to customize the provider (e.g. override the base
> URL, hide certain models, or change display names), you can still declare a
> `clinepass` block in `opencode.json` — the plugin respects your manual config
> and won't overwrite it. See [`opencode.example.json`](./opencode.example.json)
> for the full block.

## Authentication

This plugin supports two authentication methods, available from Opencode's
`/connect` command:

### Option 1: Cline CLI Login (WorkOS OAuth — recommended)

If you already use the Cline CLI (`npm i -g cline`) and have authenticated with
`cline auth`, this plugin automatically reuses your login — no separate API key
needed.

1. Run `/connect` in the Opencode TUI and select **ClinePass**
2. Choose **Cline CLI / ClinePass subscription (WorkOS)**
3. The plugin detects your WorkOS OAuth credentials from
   `~/.cline/data/settings/providers.json` and logs you in instantly

Short-lived access tokens (~1 hour) are refreshed automatically via Cline's
server-side endpoint (see [How WorkOS token refresh works](#how-workos-token-refresh-works)).

> 💡 **Zero-config:** if you've already run `cline auth`, you don't even need
> `/connect` — the plugin auto-imports your credentials on Opencode startup.

### Option 2: Static API Key (manual)

1. Subscribe to ClinePass at [app.cline.bot](https://app.cline.bot)
2. Go to **Settings → API Keys** and click **Generate API key**
3. Copy it
4. Set the environment variable:

```bash
echo 'export CLINE_API_KEY="your_key_here"' >> ~/.zshrc
source ~/.zshrc
```

Alternatively, run `/connect` in Opencode, select **ClinePass**, and choose
**Static API key** — if no Cline CLI login is detected, it opens the Cline
dashboard and prompts you to paste a static API key.

## Available models

| Model ID                       | Display name      |   Context | Max output |      Reasoning      |
| ------------------------------ | ----------------- | --------: | ---------: | :-----------------: |
| `cline-pass/glm-5.2`           | GLM-5.2           | 1,048,576 |    131,072 |      ✅ xhigh       |
| `cline-pass/kimi-k2.7-code`    | Kimi K2.7 Code    |   262,144 |    131,072 | ✅ (reasoning-only) |
| `cline-pass/kimi-k2.6`         | Kimi K2.6         |   262,144 |    131,072 | ✅ (reasoning-only) |
| `cline-pass/deepseek-v4-pro`   | DeepSeek V4 Pro   | 1,000,000 |    384,000 |   ✅ (high only)    |
| `cline-pass/deepseek-v4-flash` | DeepSeek V4 Flash | 1,000,000 |    384,000 |   ✅ (high only)    |
| `cline-pass/mimo-v2.5`         | MiMo-V2.5         |   262,144 |    131,072 |         ✅          |
| `cline-pass/mimo-v2.5-pro`     | MiMo-V2.5-Pro     |   262,144 |    131,072 |         ✅          |
| `cline-pass/minimax-m3`        | MiniMax M3        | 1,048,576 |    131,072 |         ✅          |
| `cline-pass/qwen3.7-max`       | Qwen3.7 Max       |   262,144 |    131,072 |         ✅          |
| `cline-pass/qwen3.7-plus`      | Qwen3.7 Plus      | 1,048,576 |    131,072 |         ✅          |

Reference a model as `clinepass/<model-id>`, e.g. `clinepass/cline-pass/glm-5.2`.

## Usage

```bash
# pick a model in the TUI with /models, or set it in config:
opencode --model clinepass/cline-pass/kimi-k2.7-code
```

Switch models in-session with `/model clinepass/cline-pass/deepseek-v4-pro`.

## How WorkOS token refresh works

The Cline CLI authenticates via WorkOS OAuth. The access token is a short-lived
JWT (prefixed `workos:`) that expires after ~1 hour; the refresh token is
longer-lived. This plugin refreshes expired tokens by calling Cline's
server-side endpoint:

```
POST https://api.cline.bot/api/v1/auth/refresh
{ "granttype": "refresh_token", "refreshToken": "<your_refresh_token>" }
```

The response contains a new `accessToken` (re-prefixed with `workos:` if needed)
and a rotated `refreshToken`. Refresh happens lazily in the `chat.headers` hook,
~5 minutes before expiry, and the refreshed credential is persisted back to
Opencode's auth store. If the refresh token is revoked (e.g. you re-run
`cline auth`), just `/connect` → ClinePass again.

## Environment variables

| Variable         | Default                 | Purpose                                                |
| ---------------- | ----------------------- | ------------------------------------------------------ |
| `CLINE_API_KEY`  | —                       | A static ClinePass API key (auto-imported on startup). |
| `CLINE_API_BASE` | `https://api.cline.bot` | Override the Cline API base URL.                       |

## Development

```bash
bun install            # or npm install
bun run lint           # oxlint
bun run fmt:check      # oxfmt --check (format check)
bun run typecheck      # tsc --noEmit
bun run test           # vitest run (81 tests across 8 files)
bun run konsistent     # structural convention checks
```

### Architecture

The plugin follows a modular structure matching
[pi-clinepass-provider](https://github.com/jellydn/pi-clinepass-provider):

```
src/
├── clinepass.ts       # Plugin entry + barrel re-exports
└── lib/
    ├── utils.ts           # Type guards
    ├── env.ts             # Constants, env helpers, IoOptions
    ├── errors.ts          # Error classification
    ├── workos.ts          # WorkOS token refresh
    ├── auth.ts            # Credential extraction, auth store
    └── models.ts          # Model definitions, config generation, thinking levels

tests/
├── helpers.ts              # Shared test fakes and utilities
├── clinepass.test.ts       # autoImportCredentials tests
└── unit/
    ├── utils.test.ts
    ├── env.test.ts
    ├── errors.test.ts
    ├── workos.test.ts
    ├── auth.test.ts
    ├── models.test.ts
    └── clinepass.test.ts   # Plugin hook tests (config, provider, chat, event)
```

The pure functions (`resolveClineAuthCredentials`, `refreshWorkosToken`,
`autoImportCredentials`, …) accept injectable I/O (`fileExists`, `readFile`,
`fetch`, `env`) so the test suite runs with no network or real credentials.

## Notes

- **Pricing:** ClinePass is a flat $9.99/month subscription. Per-token costs in
  upstream docs are for usage tracking only.
- **Context windows** are estimates from ClinePass docs — verify against
  Cline's `/models` endpoint if needed.

## License

MIT — see [LICENSE](./LICENSE).

## Credit

Modeled on [`jellydn/pi-clinepass-provider`](https://github.com/jellydn/pi-clinepass-provider)
by [@jellydn](https://github.com/jellydn), adapted from pi's extension API to
Opencode's plugin API.

## Author

👤 **Linh Ha**

- GitHub: [@haconglinh1990](https://github.com/haconglinh1990)

## Show your support

Give a ⭐️ if this project helped you!

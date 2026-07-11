# Structure

## Directory Layout

```
opencode-clinepass-provider/
├── src/
│   ├── clinepass.ts          # Plugin entry + barrel re-exports
│   └── lib/
│       ├── utils.ts          # Type guards, errMsg, jwtExpirySeconds
│       ├── env.ts            # Constants + env helpers + IoOptions
│       ├── errors.ts         # Error classification
│       ├── workos.ts         # WorkOS token refresh
│       ├── auth.ts           # Credential extraction + auth store + cache
│       └── models.ts         # Model definitions + config generation
├── tests/
│   ├── clinepass.test.ts     # autoImportCredentials tests only
│   ├── helpers.ts            # Shared test utilities
│   └── unit/
│       ├── utils.test.ts
│       ├── env.test.ts
│       ├── errors.test.ts
│       ├── workos.test.ts
│       ├── auth.test.ts
│       ├── models.test.ts
│       └── plugin-hooks.test.ts
├── opencode.example.json
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .planning/
    └── codebase/
```

## Key Locations

| What | Where |
|------|-------|
| Plugin entry point | `src/clinepass.ts` (default export: `{ id, server }`) |
| Provider registration | `src/lib/models.ts` → `injectProviderConfig()` |
| Credential resolution | `src/lib/auth.ts` → `resolveClineAuthCredentials()`, `resolveClineStaticKey()` |
| Token refresh | `src/lib/workos.ts` → `refreshWorkosToken()` / `ensureValidWorkosToken()` |
| Auth cache + persist | `src/lib/auth.ts` → `getCachedAuth`, `setCachedAuth`, `persistAuth` |
| Model discovery | `src/lib/models.ts` → `fetchRemoteModels()` |
| Auth flow | `src/clinepass.ts` → `authHook` inside `ClinePassPlugin` |
| Error surfacing | `src/lib/errors.ts` → `classifyClinePassError()` + `src/clinepass.ts` → `event` hook |
| Plugin hook tests | `tests/unit/plugin-hooks.test.ts` |
| Test helpers | `tests/helpers.ts` |

## File Naming Conventions

- Source files: `kebab-case.ts` (e.g., `clinepass.ts`)
- Helper modules: under `src/lib/` so OpenCode's plugin scanner does not load them as plugins
- Test files: `{module}.test.ts` matching source module name
- Barrel re-exports: all from `clinepass.ts`
- Imports: `.js` extension in import paths (ESM convention): `from "./utils.js"`

## Installation Points

| Method | Path |
|--------|------|
| File-based plugin | `~/.config/opencode/plugins/clinepass.ts` + `plugins/lib/*` |
| npm-based plugin | `"plugin": ["opencode-clinepass-provider"]` in `opencode.json` |
| Manual config | `"provider.clinepass"` in `opencode.json` (see `opencode.example.json`) |
| Kilo Code | `~/.config/kilo/plugin/` (same layout as OpenCode) |

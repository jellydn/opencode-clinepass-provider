# Structure

## Directory Layout

```
opencode-clinepass-provider/
├── src/
│   ├── clinepass.ts          # Plugin entry + barrel re-exports (274 lines)
│   ├── utils.ts              # Type guards (22 lines)
│   ├── env.ts                # Constants + env helpers + IoOptions (76 lines)
│   ├── errors.ts             # Error classification (33 lines)
│   ├── workos.ts             # WorkOS token refresh (69 lines)
│   ├── auth.ts               # Credential extraction + auth store (155 lines)
│   └── models.ts             # Model definitions + config generation (231 lines)
├── tests/
│   ├── clinepass.test.ts     # autoImportCredentials tests only (5 tests)
│   ├── helpers.ts            # Shared test utilities (clineProvidersJson, fakeFetch, etc.)
│   └── unit/
│       ├── utils.test.ts     # 3 tests
│       ├── env.test.ts       # 7 tests
│       ├── errors.test.ts    # 7 tests
│       ├── workos.test.ts    # 5 tests
│       ├── auth.test.ts      # 14 tests
│       └── models.test.ts    # 17 tests
├── opencode.example.json     # Example opencode.json config
├── package.json              # Package manifest
├── tsconfig.json             # TypeScript config (noEmit)
├── vitest.config.ts          # Vitest config (tests/**/*.test.ts)
└── .planning/
    └── codebase/             # Generated codebase documentation
```

## Key Locations

| What | Where |
|------|-------|
| Plugin entry point | `src/clinepass.ts` (default export: `{ id, server }`) |
| Provider registration | `src/models.ts` → `injectProviderConfig()` |
| Credential resolution | `src/auth.ts` → `resolveClineAuthCredentials()`, `resolveClineStaticKey()` |
| Token refresh | `src/workos.ts` → `refreshWorkosToken()` |
| Model discovery | `src/models.ts` → `fetchRemoteModels()` |
| Auth flow | `src/clinepass.ts` → `authHook` inside `ClinePassPlugin` |
| Error surfacing | `src/errors.ts` → `classifyClinePassError()` + `src/clinepass.ts` → `event` hook |
| Test helpers | `tests/helpers.ts` → `clineProvidersJson`, `fakeFetch`, `ioByPath`, `fakeClient` |
| Example config | `opencode.example.json` |

## File Naming Conventions

- Source files: `kebab-case.ts` (e.g., `clinepass.ts`, `error-handler.ts`)
- Test files: `{module}.test.ts` matching source module name
- Barrel re-exports: all from `clinepass.ts`
- Imports: `.js` extension in import paths (ESM convention): `from "./utils.js"`

## Installation Points

| Method | Path |
|--------|------|
| File-based plugin | `~/.config/opencode/plugins/clinepass.ts` |
| npm-based plugin | `"plugin": ["opencode-clinepass-provider"]` in `opencode.json` |
| Manual config | `"provider.clinepass"` in `opencode.json` (see `opencode.example.json`) |

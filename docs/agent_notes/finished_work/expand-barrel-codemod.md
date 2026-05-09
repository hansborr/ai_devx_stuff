# Barrel Expansion Codemod + Lint Rule

## Context

AI agents frequently create barrel files (`index.ts` re-exporting from siblings) despite the
"No barrel files; import from source" rule in AGENTS.md. Three barrels currently exist in
`@musi/shared` and are exposed as package subpaths. There is also a live circular dependency
caused by one of them:

- `packages/shared/src/rules/character-rules.ts:327-331` re-exports from `./multiclass-rules.js`
- `packages/shared/src/rules/multiclass-rules.ts:2-6` imports from `./character-rules.js`

Plan: build `codemod:expand-barrel` → validate on the circular dep → expand/remove all existing
barrels → only then add hard `no-barrel` ESLint enforcement.

**Status: Cleanup and enforcement complete in the working tree**

Landed first slice:

- Added temporary wildcard exports for `@musi/shared/{rules,dice,map}/*.js`.
- Added `codemod:expand-barrel` with `--check`, `--barrel`, `--package`, `--all`,
  and `--dry-run` support.
- Added fixtures covering star exports, named exports, type imports, namespace
  skips, re-export chains, relative test consumers, and Vitest mock string
  warnings.
- Verified `@musi/shared/rules` with a real dry-run; it would currently rewrite
  92 files and resolves the multiclass re-export chain.
- Additional dry-runs: `@musi/shared/dice` would rewrite 14 files; `@musi/shared/map`
  would rewrite 18 files and warns on the expected `token-shape.test.tsx`
  namespace/mock strings.
- Verification commands run: `bun run vitest run scripts/codemods/expand-barrel.test.ts`,
  `bun tsc -p tsconfig.scripts.json`, and `bun run verify:changed`.

Follow-up hardening added richer import shapes while keeping the tool focused on expansion:
local `import ...; export ...` bindings now resolve to leaf imports, mixed barrels preserve
barrel-local exports as residual imports, `export { default as X }` rewrites to a default import,
`export * as X` rewrites to a namespace import, and bare `vi.mock` / `jest.mock` calls append direct
automocks when the file produced direct imports. Factory mocks and `vi.importActual` still warn for
manual cleanup. Verified with the fixture suite, scripts typecheck, `--check`, `--all --dry-run`,
and `verify:changed`.
Review hardening also made `--check` report re-export consumers and added a negative fixture for
duplicate symbol conflicts.

Latest slice completed the production cleanup:

- Expanded and removed `@musi/shared/{rules,dice,map}` barrels and exact
  package exports; wildcard deep-import exports remain.
- Removed the `character-rules.ts` multiclass re-export cycle and moved the
  shared multiclass test to `multiclass-rules.ts`.
- Split the service-layer indices in `encounter-combat` and
  `character-live-state` into direct leaf imports; `socket/index.ts` remains
  because it owns setup code and has no sibling re-exports.
- Added `local/no-barrel` enforcement plus focused rule coverage.

Verification commands run in this slice: `bun run verify:changed` after the
rules cleanup, `bun run vitest run eslint-rules/no-barrel.test.js`,
`bun run format:changed`, and `bun run verify` (OK in 214s; soft budget warning
only, hard budget not exceeded).

---

## Removed barrels

| File | Package subpath | Notes |
|---|---|---|
| `packages/shared/src/rules/index.ts` | `@musi/shared/rules` | ~30 consumers; has circular dep |
| `packages/shared/src/map/index.ts` | `@musi/shared/map` | ~17 client consumers |
| `packages/shared/src/dice/index.ts` | `@musi/shared/dice` | ~9 consumers; named (not `export *`) |

Additional internal `index.ts` files previously existed under
`packages/server/src/socket/`, `packages/server/src/services/encounter-combat/`,
and `packages/server/src/services/character-live-state/`. `socket/index.ts`
owns real setup code, so it is not a barrel. The two service-layer indices and
their namespace router consumers were removed during the cleanup slice.

## Circular dep: what to fix

External production consumers of multiclass symbols (both import from `@musi/shared/rules`):
- `packages/server/src/services/level-up/core.ts` — uses `checkMulticlassPrerequisites`
- `packages/client/src/components/sheet/level-up-helpers.tsx` — uses `checkMulticlassPrerequisites`

Shared tests also import multiclass symbols from `./character-rules.js`:
- `packages/shared/src/rules/character-rules.test.ts`

Fix: remove `character-rules.ts:327-331`, rewrite both consumers to
`@musi/shared/rules/multiclass-rules.js`, and rewrite the shared test import to
`./multiclass-rules.js`.

---

## Step 1 — Expand `packages/shared/package.json` exports (prerequisite)

Add wildcard subpaths **before** the existing barrel entries so deep imports resolve during the
migration:

```json
"./rules/*.js": { "types": "./dist/rules/*.d.ts", "default": "./dist/rules/*.js" },
"./dice/*.js": { "types": "./dist/dice/*.d.ts", "default": "./dist/dice/*.js" },
"./map/*.js":  { "types": "./dist/map/*.d.ts",  "default": "./dist/map/*.js"  }
```

Without this, codemod output like `@musi/shared/rules/multiclass-rules.js` fails to typecheck.
Keep the existing exact barrel exports temporarily so the migration can land incrementally; remove
`"./rules"`, `"./dice"`, and `"./map"` only after all consumers have moved.

---

## Step 2 — Codemod: `scripts/codemods/expand-barrel.ts`

Uses `ts-morph` (already in devDeps). Reuse from `scripts/codemods/lib/trpc-shared-schema.ts`:
`createProject`, `CodemodError`, `fail`, `writeOrPreviewFiles`, and `sortImportBlocks`. Use
`collectExportedTopLevelIdentifiers` only for direct exports from a leaf source file; add a
codemod-local resolver for re-export declarations.

Register in root `package.json`: `"codemod:expand-barrel": "bun scripts/codemods/expand-barrel.ts"`

### CLI

```
bun run codemod:expand-barrel -- --check
bun run codemod:expand-barrel -- --barrel packages/shared/src/rules/index.ts [--dry-run]
bun run codemod:expand-barrel -- --package @musi/shared/rules [--dry-run]
bun run codemod:expand-barrel -- --all [--dry-run]
```

### Algorithm

1. **Build symbol map** — parse the barrel's export declarations. For each source module, collect
   exported identifiers → `Map<symbolName, absoluteSourcePath>`.
   - `export * from "./x.js"`: collect top-level exports from `x.ts`.
   - `export { A, type B } from "./x.js"` / `export type { B } from "./x.js"`: map those exported
     names directly to `x.ts`.
   - If a source module only re-exports a symbol, recursively resolve it to the leaf file. This is
     required for the current multiclass cycle: `rules/index.ts` exports `character-rules.ts`, and
     `character-rules.ts` re-exports `multiclass-rules.ts`.
2. **Find consumers** — scan all `.ts`/`.tsx` under `packages/` (skip `dist/`, `generated/`,
   `node_modules/`) for imports matching the barrel specifier (exact package subpath or resolved
   relative path). Include tests; removing barrels breaks tests too.
3. **Rewrite each consumer** — group imported names by source module, emit one import per group,
   preserve `import type` / inline `type` markers / local aliases. Use `writeOrPreviewFiles` +
   `sortImportBlocks` from shared lib.

**Output specifiers:** package barrel → `@musi/shared/rules/multiclass-rules.js`; relative barrel
→ relative path from consumer with `.js` extension.

### Edge cases

| Case | Handling |
|---|---|
| `import type { X }` | Preserve `import type` on emitted declaration |
| `import { type X, Y }` | Preserve per-specifier `type` keyword |
| default import from barrel | Fail; current barrels do not expose default exports |
| `import * as ns` (namespace) | Skip with warning; cannot auto-expand |
| `import type * as ns` | Skip with warning; manually rewrite before removing the barrel |
| `vi.mock()` / `vi.importActual()` string uses | Warn; manually rewrite or delete with the related test |
| Symbol in multiple source modules | Fail with conflict message |
| Symbol not in symbol map | Fail identifying unknown symbol |

### Fixtures

Mirrors other codemods in `scripts/codemods/fixtures/expand-barrel/`. Minimum cases:
`star-export/`, `named-export/` (selective like dice), `type-imports/`, `namespace-skip/` (input
== output, just warning), `reexport-chain/` (rules → character-rules → multiclass-rules),
`test-consumer/`, and `mock-string-warning/`.

---

## Step 3 — Clean Up Existing Barrels

Run cleanup in small verified slices. Do not enable hard `no-barrel` enforcement until this list is
done.

1. **Rules first / circular dep fix**
   - Ensure the `./rules/*.js` export exists.
   - Run `codemod:expand-barrel --barrel packages/shared/src/rules/index.ts`.
   - Manually rewrite `packages/shared/src/rules/character-rules.test.ts`.
   - Remove the multiclass re-export block from `character-rules.ts`.
   - Add `export * from "./multiclass-rules.js"` to `rules/index.ts` only as a temporary
     compatibility step if any consumers still import multiclass symbols from the barrel during the
     slice.
   - After all `@musi/shared/rules` consumers are expanded, remove `packages/shared/src/rules/index.ts`
     and remove the `./rules` exact export from `packages/shared/package.json`.
2. **Dice**
   - Ensure the `./dice/*.js` export exists.
   - Run `codemod:expand-barrel --barrel packages/shared/src/dice/index.ts`.
   - Remove `packages/shared/src/dice/index.ts` and the `./dice` exact export after consumers move.
3. **Map**
   - Ensure the `./map/*.js` export exists.
   - Run `codemod:expand-barrel --barrel packages/shared/src/map/index.ts`.
   - Manually fix `packages/client/src/components/campaign/tokens/token-shape.test.tsx`, which uses
     `import type * as SharedMap`, `vi.mock("@musi/shared/map")`, and
     `vi.importActual("@musi/shared/map")`.
   - Remove `packages/shared/src/map/index.ts` and the `./map` exact export after consumers move.
4. **Service-layer indices**
   - Manually expand namespace imports in routers:
     `packages/server/src/routers/encounter-combat.ts`,
     `packages/server/src/routers/character.ts`, `packages/server/src/routers/rest.ts`,
     `packages/server/src/routers/sorcery-point.ts`, and `packages/server/src/routers/spell-slot.ts`.
   - Move `CombatActionContext` out of `encounter-combat/index.ts` to a source file such as
     `types.ts`, then rewrite sibling imports from `./index.js`.
   - Split `character-live-state/index.ts` consumers to direct source imports, then remove the file.

## Step 4 — ESLint rule: `eslint-rules/no-barrel.js`

Plain JS, `// @ts-check`. Flags any `index.ts`/`index.tsx` containing a re-export from another
module (`export * from`, `export { … } from`, or `export type { … } from`). Report the specific
re-export node. This catches both pure barrels and mixed files like the current
`encounter-combat/index.ts`; it must not flag `packages/server/src/socket/index.ts`, which contains
real setup code and no sibling re-exports.

Message: `"Barrel file detected. Run: bun run codemod:expand-barrel -- --barrel <path>. See AGENTS.md."`

Register in `eslint.config.js` `localPlugin` and apply as `"local/no-barrel": "error"`.
Add `eslint-rules/no-barrel.test.js`:
- pure star barrel → error
- pure named/type barrel → error
- file with local definition plus sibling re-export → error
- `socket/index.ts`-style setup module → no error

Only register the rule as `error` after all current barrels above are removed. If landing the rule
before cleanup is useful for development, keep it out of `eslint.config.js` or wire it as a local
test-only rule until the cleanup is complete.

---

## Sequence

1. [x] Add wildcard exports to `packages/shared/package.json`; keep exact barrel exports temporarily
2. [x] Create `scripts/codemods/expand-barrel.ts` + `.test.ts` + fixtures
3. [x] Register codemod in root `package.json`
4. [x] Run `codemod:expand-barrel --barrel packages/shared/src/rules/index.ts` and manually fix the
   shared multiclass test; remove the multiclass re-export cycle
5. [x] Run `bun run verify:changed`
6. [x] Run codemod/cleanup for `dice` and `map`, including manual mock/namespace test fixes
7. [x] Manually remove the service-layer indices and namespace imports
8. [x] Remove exact barrel exports from `packages/shared/package.json`
9. [x] Create `eslint-rules/no-barrel.js` + `.test.js`, register rule in `eslint.config.js`
10. [x] `bun run verify` — confirm clean with enforcement enabled

## Key files

| Path | Role |
|---|---|
| `packages/shared/package.json` | Add wildcard subpath exports |
| `scripts/codemods/expand-barrel.ts` | Codemod |
| `scripts/codemods/expand-barrel.test.ts` | Tests |
| `scripts/codemods/fixtures/expand-barrel/` | Fixtures |
| `scripts/codemods/lib/trpc-shared-schema.ts` | Shared lib (reuse, don't extend) |
| `eslint-rules/no-barrel.js` | ESLint rule |
| `eslint-rules/no-barrel.test.js` | Rule tests |
| `eslint.config.js` | Register rule |
| `package.json` (root) | Register codemod script |
| `packages/shared/src/rules/character-rules.ts:327-331` | Remove re-export block |
| `packages/shared/src/rules/character-rules.test.ts` | Rewrite multiclass imports |
| `packages/server/src/services/level-up/core.ts` | Rewrite multiclass import |
| `packages/client/src/components/sheet/level-up-helpers.tsx` | Rewrite multiclass import |
| `packages/client/src/components/campaign/tokens/token-shape.test.tsx` | Manual map mock rewrite |
| `packages/server/src/routers/encounter-combat.ts` | Manual service namespace expansion |
| `packages/server/src/routers/{character,rest,sorcery-point,spell-slot}.ts` | Manual live-state namespace expansion |

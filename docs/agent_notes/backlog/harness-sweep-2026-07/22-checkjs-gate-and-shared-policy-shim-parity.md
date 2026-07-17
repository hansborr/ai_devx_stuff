# 22 — eslint-rules @ts-check is ungated; shared-policy .d.ts can drift silently

Status: Split (re-triage 2026-07-12) — 22a Done · 22b Done · 22c Parked P4/L (see below)
Track: T (tooling) · Priority: P3 · Size: M

## Re-triage (2026-07-12 second-pass review)

The lintrules lane skipped this leaf: the filed evidence sized the checkJs gate
at HEAD wrong by an order of magnitude (the review probe found 75 errors across
23 files, driven by `eslint-rules/*.js` typing against estree while the repo's
rules run under typescript-eslint's TSESTree). The second-pass review split the
leaf three ways; the user adopted the split:

- **22a — shim-parity test (Done):** a runtime-parity test asserting every
  export declared in `scripts/eslint-config-shared-policy.d.ts` exists in the
  imported JS with the declared shape (shallow shapes; export-set equality
  deliberately not required; spot-checks one `configSurfaceEntries` entry and
  one max-lines exception). Landed as `scripts/eslint-config-shared-policy.test.ts`
  (lintrules lane, commit 3c1efd82).
- **22b — scoped checkJs gate (Done):** `tsconfig.eslint-js.json`
  (`allowJs`+`checkJs`+`noEmit`) over **`eslint-config/*.js` only** (7 errors,
  all fixed in the same commit), wired into `scripts/typecheck.sh` as a third
  lane with the smoke extended. Landed on the lintrules lane, commit 96d98183.
  `eslint-rules/*.js` is deliberately NOT included — that is 22c.
- **22c — estree→TSESTree migration of eslint-rules (PARKED, P4/L):** extending
  the checkJs gate to `eslint-rules/*.js` requires migrating the rule files'
  JSDoc types from `@types/eslint`/estree to TSESTree (review2 probe:
  75 errors / 23 files at 629d2460; re-probe after the lintrules lane merge
  before sizing). Do not pick this up as a side effect of another leaf; it is
  its own L-sized effort with no current gate pressure — the pragma remains
  editor-only for eslint-rules, and 22a's parity test plus 22b's config gate
  close the drift channels the original Failure block named.

## Evidence (verified 2026-07-11; re-verify before implementing)

- `eslint-config/*.js` (14 of 14) and every non-test `eslint-rules/*.js` open with `// @ts-check` (`eslint-config/shared-policy.js:1`) — the pragma promises typechecking.
- `tsconfig.scripts.json:7` includes only `scripts/**/*.ts`; `tsconfig.base.json` sets neither `allowJs` nor `checkJs`, and a repo-wide grep of all `tsconfig*.json` finds no `checkJs`/`allowJs` covering `eslint-config/` or `eslint-rules/`. So the `// @ts-check` pragmas run in the editor only; no verify/typecheck slot enforces them.
- `scripts/eslint-config-shared-policy.d.ts:1` — a hand-written ambient `declare module "*eslint-config/shared-policy.js"` (plus `config-surfaces.js` and `eslint-rules/max-lines.js`) restates ~15 exports and their shapes for the `scripts` project, which imports the JS but excludes it from compilation. `scripts/README.md:32` documents it as a "Sanctioned exception" with no parity check; nothing verifies the declaration against the real JS.
- `scripts/max-lines-exceptions.test.ts:557` acknowledges the resulting hole: `// shared-policy.js is JS, so its exceptions array widens to any[] on import.` (importers at `scripts/max-lines-exceptions.ts:12`, `scripts/lib/max-lines-policy.ts:1`, `scripts/harness/generate-config-surfaces.ts:4`, `scripts/path-policy/path-policy.ts:2`).
- Probe: a `checkJs`+`allowJs` pass over these files surfaces genuine (non-implicit-any) findings the editor pragma already implies but the gate never sees — e.g. `eslint-config/base-configs.js:84` (`Property 'files' does not exist on type 'CompatibleConfig'`), `shared-policy.js:205` (untyped exception entry), and `eslint-rules/concurrency-guard.js:156` / `e2e-prefer-role-selectors.js:37` (custom `meta.docs.principle`/`repairCommand` fields not in `@types/eslint`'s `RulesMetaDocs`). Making the gate green needs a small type-augmentation pass, so this is honestly M, not XS.

Failure: An adopter copies `eslint-rules/*.js` from the repo the memory note calls a public harness-engineering reference, sees `// @ts-check` on every file, and reasonably assumes CI enforces it — it does not, so a real type error in the most-copied tree ships green. Internally, someone changes an export shape in `eslint-config/shared-policy.js` (e.g. renames a field on a `configSurfaceEntries` entry). The hand-written `.d.ts` stays stale, every `scripts/` consumer compiles clean against the old declared shape, and the `scripts` typecheck slot — the only one that touches this surface — never notices; the divergence surfaces only at runtime.

## Do

One commit if the type friction is small; may need a second for the augmentation pass — sequence it as:

1. Add a `tsconfig.eslint-js.json` (`allowJs`+`checkJs`+`noEmit`, `include` = `eslint-config/*.js` and non-test `eslint-rules/*.js`) tuned to match the loose semantics the `// @ts-check` pragma already implies in-editor (do not import the strict base wholesale — noImplicitAny would drown the signal in JSDoc-light params). Wire it into the typecheck slot so the pragmas become enforced.
2. Resolve the handful of real findings the probe surfaced: augment `@types/eslint`'s `RulesMetaDocs` for the repo's custom `meta.docs` fields (`principle`, `category`, `pairedGuide`, `repairKind`, `repairCommand`), and fix or JSDoc-annotate the `base-configs.js` `CompatibleConfig.files` and `shared-policy.js` exception-entry sites.
3. Close the shim's blind spot: either delete `scripts/eslint-config-shared-policy.d.ts` in favor of types the checked JS now exposes (preferred, if the `scripts` project can resolve the checked JS), or — if the resolver boundary in `scripts/README.md:32` must stay — add a parity test asserting each export declared in the `.d.ts` exists at runtime in the imported JS with the declared shape, so a rename fails a test instead of drifting silently.

## Verify

```
bun run typecheck            # now also checks the eslint-config/eslint-rules JS
bunx tsc -p tsconfig.eslint-js.json --noEmit   # 0 errors
bun run test -- scripts/max-lines-exceptions.test.ts   # parity test (if added) passes
bun run harness:check        # generated-surface + slot wiring still consistent
```

## Acceptance

The typecheck slot fails on an introduced type error in any `eslint-config/*.js` or non-test `eslint-rules/*.js` file (verify by temporarily breaking one), and a shape change to an export declared in `scripts/eslint-config-shared-policy.d.ts` is caught by either the checked JS types or the parity test rather than compiling clean.

Sources: eslint-local

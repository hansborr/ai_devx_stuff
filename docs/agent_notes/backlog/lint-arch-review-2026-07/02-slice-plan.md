# 02 — Slice plan: replace the copy manifest with a real package seam

Status: DRAFT rev 2 (design phase, 2026-07-17; reworked after codex adversarial
review — 2 P0 + 11 P1 + 1 P2, all CONFIRMED against the tree). Implements the
rulings in [`02-package-seam-replaces-copy-manifest.md`](./02-package-seam-replaces-copy-manifest.md)
and the leaf 05 cap-policy ruling. Design-only; re-reviewed before implementation.

Single sequential lane, one slice at a time, each landed green through the full
gate. Every recorded ruling is binding and honored. Where this plan decides
something the rulings left open it is marked **[Design decision]**.

---

## 0. The architectural decision that shapes everything

The rulings fix the destination (a `tools/` workspace root, `@musi/lint-ratchet`
carrying layers 1–3, adapter outside under `scripts/`, demo joins the workspace,
delete the sync harness). They do not fix where the seam falls inside the ~100
engine files. The tree answers it cleanly.

**Finding:** the engine is already, de facto, "pure operations + Musi bindings".
The pure operations already take their Musi inputs as explicit arguments
(`compareCurrentToBaseline(baseline, lintRatchets, currentById)`,
`collectCurrentById(hashes, concurrency)`,
`runLintRatchetZeroBaselineAuditResult({ baselinePath, registry })`,
`checkLintRatchetRegistry({ ratchets, trackedFiles, baselineText, ... })`). The
Musi bindings concentrate in a small set of files that import the registry
**data**, import the shared harness-diagnostics **schema**, read
`harness.controls.json`, resolve `repoRoot`/`baselinePath`, or compose the CLI.

So the seam is: **the package is a library of pure, context-parameterized
operations (layers 1–3); the adapter is the Musi CLI that constructs an engine
context, binds the registry, renders the harness envelope, and composes the
modes (layer 4)** — exactly ruling item 2, read at file granularity.

### [Design decision] Harness-diagnostics envelope stays adapter-side

The one genuinely-ambiguous placement (checklist item 1) is
`packages/shared/src/schemas/harness-diagnostics.ts`, imported by four engine
files (`diagnostics.ts`, `info-diagnostics.ts`, `output.ts`, `report.ts`).

- Rejected — **package vendors its own copy**: re-introduces sync (the thing this
  leaf deletes).
- Rejected — **package imports `packages/shared`**: forbidden `@musi/*` import,
  breaks the structural acceptance check.
- Chosen — **envelope construction is layer-4 adapter, stays in `scripts/`.** The
  package's kernel/governance already return neutral typed results
  (`LintRatchetComparison`, debt-accounting records, zero-baseline audit rows,
  trend series); the adapter renders those into Musi's `HarnessDiagnostics`.
  `packages/shared` stays the single owner of the envelope schema (product code
  must never depend on a private `tools/` dev package); zero sync; matches the
  existing portability story (the baseline+comparison model is portable, the
  envelope schema is a copy-along an adopter may swap — e.g. Biome). The demo,
  as second adapter, renders a minimal envelope of its own.

The `howToFix`/`why` guidance in `diagnostics.ts` (with `MAX_LINES_*` guidance
and rule-docs lookups) is Musi-adapter-specific and stays in `scripts/`.

**[fix P1-report, P1-local-rule-fix] Two files this pulls adapter-side, verified
against the tree — the envelope decision is now internally consistent:**

- `report.ts` **stays adapter-side, not split.** The earlier draft called for
  moving a "report-as-data computation" and retaining the render; but the module
  is built around the harness envelope from its imports onward (`report.ts:3`
  imports `harnessDiagnosticsSchema` from `packages/shared`) and its entrypoint
  is `readFileSync` → `parseDiagnostics` → `formatHarnessDiagnosticsReport`
  (`report.ts:263`) — it is envelope→markdown end to end. There is no neutral
  report model to extract without a semantic redesign; that is out of scope for
  this leaf. `report.ts` is adapter, whole.
- `local-rule-fix-text.ts` **stays adapter-side.** It imports the Musi-side
  `RuleDocsEntry` (`local-rule-fix-text.ts:1`), so the §2 boundary checker would
  reject it in the package. It is part of the same adapter-side rule-guidance
  family as `diagnostics.ts`.

Consequence: **`check-registry.ts` is the *only* split file** (portable
validator → package; harness-controls cross-check → adapter). `report.ts` and
`local-rule-fix-text.ts` move wholesale into the adapter, not the package.

### [Design decision] Wide-surface member placements (checklist item 1)

| Portable-manifest member | Placement | Rationale |
| --- | --- | --- |
| `eslint-rules/max-lines.js` (rule + `MAX_LINES_*` consts) | Stays outside; the two guidance consts are consumed by adapter `diagnostics.ts` | Musi local-rule source, rule-source-hashed, linted by the demo's own `eslint-rules/`. |
| `packages/shared/src/schemas/harness-diagnostics.ts` | Stays in `packages/shared`; adapter renders it | See decision above. |
| `scripts/harness/harness-diagnostics-output.ts` | Adapter | Sidecar writer; consumed only by adapter `output.ts`. |
| `scripts/harness/harness-manifest.ts` | Adapter | Resolves `harness.controls.json`; Musi harness wiring. |
| `scripts/git/*` merge shells (11) + the two CLI entrypoints they invoke by path | Stay in `scripts/` as **thin adapter wrappers**; pure merge/truth-up logic moves to the package git-rail | See §1.4 and the merge-driver fix in S4 — keeping the invoked paths fixed means **no installed-driver reinstall**. |
| `scripts/lib/lint-rule-docs.ts` | Adapter | Reads Musi `docs/`; adoption guide already documents stubbing it. |
| `eslint-config/shared-policy.js` | Stays outside | Registry-data dependency; registry stays adapter-side. |

The "delete ~1k LOC" payoff is not overstated: the deleted code is
`portable-manifest-expand.ts` + `check-lint-ratchet-demo-sync.ts` (+ test) +
`portable-manifest.json` + the demo's mirrored engine copy. None of the members
above needs a compensating harness.

---

## 1. Target state

### 1.1 Directory layout (`tools/lint-ratchet/`)

Source-only, no build, no `index.ts` barrel (ruling item 3); per-layer subpath
exports. Files keep their current names so moves stay mechanical.

```
tools/lint-ratchet/
  package.json
  tsconfig.json
  vitest.config.ts             # the package's own Vitest project (a maintained config surface — see S2)
  README.md                    # the package's own "copy tools/lint-ratchet into your repo" doc
  src/
    kernel/      # layer 1 — baseline codec/collect/compare/update, registry types, metric strategies, and the disposition schema + lifecycle-diff the codec/validation/update decisions depend on
    git-rail/    # layer 2 — pure merge + truth-up operations (CLI wrappers stay in scripts/)
    governance/  # layer 3 — debt-log, zero-baseline audit, trend, propose, edit-check, retire
  test/          # package-owned fixture tests only (see §1.6)
```

Per-file layer assignment is Appendix A.

### 1.2 `package.json`

```jsonc
{
  "name": "@musi/lint-ratchet",
  "private": true,
  "type": "module",
  "exports": {
    "./kernel/*.js": "./src/kernel/*.ts",
    "./git-rail/*.js": "./src/git-rail/*.ts",
    "./governance/*.js": "./src/governance/*.ts"
  },
  "dependencies": {
    "zod": "<root>", "eslint": "<root>", "minimatch": "<root>",
    "typescript-eslint": "<root>", "typescript": "<root>"
  },
  "devDependencies": { "vitest": "<root>", "@types/node": "<root>" }
}
```

- **[fix P0a]** The exports **key includes the `.js` specifier**
  (`"./kernel/*.js": "./src/kernel/*.ts"`), matching the working pattern in
  `packages/shared/package.json:9` (`"./schemas/*.js"`). With `"./kernel/*"` the
  wildcard substitutes the literal `baseline.js` and targets `baseline.js.ts` —
  unresolvable. Because the package is source-only (no `dist`), the value is the
  `.ts` source directly (unlike `packages/shared`, which points at `dist`).
- **[fix P1-portable-tests]** The package declares its **own** `vitest` and
  `@types/node` devDeps; it does not borrow the root's (ruling item 4: "a
  wholesale directory copy must be self-contained").
- **[Design decision] wildcard subpath exports** (not per-file) keep the exports
  map from becoming a second hand-maintained inventory. A resolution assertion
  (see §2) proves every exported source file resolves through its key.
- Deps carry exact root versions. **Superseded by the S2 minimal-deps
  amendment (see S2 below):** the manifest declares only what each slice's code
  imports, so the full set here is the target reached across S3/S4, not an S2
  obligation.

### 1.3 The adapter (stays in `scripts/`)

`scripts/lint-ratchet.ts` (entry) + `scripts/lint-ratchet/` keep the Musi-bound
files, now importing `@musi/lint-ratchet/*`:

- `lint-ratchet-config.ts` → registry data only (`lintRatchets`,
  `lintRatchetThirdPartyPluginAllowlist`, `registry-builders.ts`), importing
  portable types from `@musi/lint-ratchet/kernel/config-types.js`.
- `paths.ts` → Musi root/baseline/debt-log resolution; constructs the context.
- CLI composition: `modes.ts`, `cli*.ts`, `default-mode.ts`, `cli-errors.ts`.
- Harness wiring: `diagnostics.ts`, `info-diagnostics.ts`, `output.ts`,
  `report.ts`, `ratchet-manifest-message.ts`, the harness-controls half of
  `check-registry.ts`, `scripts/lib/lint-rule-docs.ts`.
- **Git-rail CLI wrappers stay put** at their current paths (the installed merge
  driver invokes them by path): `scripts/lint-ratchet/baseline-merge-cli.ts`
  and `scripts/lint-ratchet/post-merge-baseline-preflight.ts` remain thin
  adapters that bind Musi registry+paths and call the package git-rail op.

### 1.4 The engine context (the "seam")

**Finding:** there is no `LintRatchetEngineContext` today — `paths.ts` hardcodes
`repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")` and
exports module-level `baselinePath`/`debtLogPath`. **[fix P1] 23 production
files import `paths.ts`** (not 10 — the earlier draft undercounted; exhaustive
list in Appendix A). So the context is built by this leaf. It is small:

```ts
export interface LintRatchetEngineContext {
  readonly repoRoot: string;
  readonly baselinePath: string;
  readonly debtLogPath: string;
}
```

Kernel/governance operations that need a root take the context (or `repoRoot`)
as a parameter instead of importing `paths.ts`. The adapter owns the one
concrete Musi construction; the demo constructs its own; tests construct fixture
contexts. Appendix A gives every `paths.ts` importer a per-file disposition
(context-parameterized → package, or stays adapter).

### 1.5 Git-rail: pure op in package, CLI binding in adapter

**[fix P1-merge-driver, P1-preflight]** The installed merge driver
(`scripts/git/baseline-merge-driver.sh:32`) hardcodes
`semantic_driver="scripts/lint-ratchet/baseline-merge-cli.ts"`, and
`scripts/git/baseline-post-merge-truth-up.sh:144` invokes
`scripts/lint-ratchet/post-merge-baseline-preflight.ts` by path. Both are
executed from **already-installed copies in every clone's git-common-dir**, so
*moving these paths would silently break every installed driver and every
worktree until reinstall*. The reviewer's fix (move paths + reinstall
everywhere + document mandatory refresh) is avoided by a cleaner resolution:

- **Keep the two entrypoints at their exact current paths as thin adapters.**
  Move only their pure operation into `tools/lint-ratchet/src/git-rail/`
  (`merge-cli`'s merge logic, the preflight parse). The wrappers import the
  package op and bind Musi registry/paths.
- `post-merge-baseline-preflight.ts` currently composes `lintRatchets` +
  `baselinePath` + `parseLintRatchetBaseline` + `buildRuleSourceHashesById` —
  binding layer 4 — so it **stays entirely in `scripts/`** (adapter); nothing to
  move.
- Consequence: **no shell edit, no fixture change, no reinstall** for the ratchet
  driver. (The generic shell already dispatches by `driver_key`; the ratchet
  key's path is unchanged.)

### 1.6 The demo as ordinary consumer

`examples/lint-ratchet-demo/` joins the workspace (ruling item 5): mirrored
engine copy deleted, lockfile removed, depends on `@musi/lint-ratchet`,
constructs its own context + minimal envelope render. It becomes the non-Musi
second adapter proving the seam (inherited leaf-71 acceptance test).

---

## 2. The structural checks that replace byte-parity

Leaf 71's byte-parity-of-copies check becomes structural (2026-07-16 ruling
item 2). Three assertions, none comparing copied bytes:

1. **[fix P1-boundary, P1-node-builtins] Resolver-aware boundary checker
   (fail-closed).** A committed test/script that, for every `.ts` under
   `tools/lint-ratchet/**`, enumerates **both static and dynamic** module
   specifiers (import, `export from`, `import()`), classifies each, and accepts
   **exactly three** categories: (a) a specifier that resolves to a path inside
   `tools/lint-ratchet/`; (b) a recognized **`node:` or `bun:` built-in** (an
   explicit allowlist — moved kernel sources import `node:module`, `node:fs`,
   `node:child_process`, etc., e.g. `eslint-runner.ts:11` `createRequire` from
   `node:module`; built-ins are neither package files nor declared deps, so they
   must be named explicitly); (c) a bare specifier whose package **root is a
   declared dependency** of the package's `package.json`. Everything else is
   rejected: any resolved path outside the package, any non-self `@musi/*`, any
   `local:`/`file:`/`workspace:` dependency, and any unresolved bare import. This
   replaces the naive "forbid every `../`" ESLint rule the earlier draft
   proposed — broken (kernel siblings legitimately import via `../`, and the
   package self-imports `@musi/lint-ratchet/*`) and not fail-closed (a syntactic
   restricted-import list misses dynamic imports and alias spellings). A coarse
   ESLint `no-restricted-imports` forbidding the specific outward targets
   (`packages/`, `scripts/`, `eslint-config/`, `eslint-rules/`) is kept as a fast
   secondary signal; the resolver-aware checker is the proof.
2. **Dependency self-containment (knip + package-deps).** `knip` with
   `tools/lint-ratchet` as its own workspace: every `@musi/lint-ratchet` import
   resolves to a declared dep, and every declared dep is used. The boundary
   checker (1) additionally verifies every bare package root is declared.
3. **Non-Musi fixture-context acceptance test.** In the package `test/` and in
   the demo: construct a `LintRatchetEngineContext` over a throwaway fixture repo
   with a non-Musi registry, run collect→compare→update, assert the gate behaves.
   Leaf 71's "non-Musi fixture context" test, now proving package consumability
   with no Musi binding.

Byte-identical Musi behavior is proven per move slice by the parity proofs in
§3, not by byte-comparing baselines.

### Parity-proof standard (applies to every move slice)

**[fix P1-parity]** A parity proof is a **one-shot, land-time verification
script**, never a committed test:

- It checks out the pre-move commit SHA and the post-move commit SHA into two
  **detached `git worktree`s**, runs the CLI in each, and diffs: **normalized
  stdout + stderr, exit status, the written `lint-ratchet.baseline.json` and
  `lint-ratchet.debt-log.jsonl`, the semantic-merge-driver output on a fixture
  conflict, and the post-merge truth-up marker behavior.** (Not just
  collect/compare output — the earlier draft's proof was too narrow.)
- Both sides are explicit SHAs. A committed test that compares a pinned old
  revision against the live tree is forbidden — that is the time-bomb class
  caught in leaf 01.
- The script lives in the lane's scratch, is run before land, and its result is
  recorded in the slice's land note; it is not added to the repo.

---

## 3. Slice-by-slice plan

**Parity definition (every move slice):** identical runtime semantics, proven by
the §2 land-time parity script. Baselines change only by the **exact
transformation** defined per slice (mapped item paths, mapped registry
selectors, and the `configHash` values those selectors derive) — never
byte-identical, never a historical-comparison test.

**[fix P1-demo-runnable, P1-demo-smoke] Demo transition (the P0b constraint,
re-solved to keep the demo runnable *and* honor "deletion last").**
`lint:ratchet:demo-sync` (`check-lint-ratchet-demo-sync.ts`) runs in **every**
full `verify` (`steps.generated.sh:12`, seq + parallel) and, verified against the
checker, fails the instant one manifested source moves on **both** paths:
`missing source` (`:90`, the moved source is gone) *and* `not in manifest (stale
copy?)` (`findStaleCopies`, `:136`, an orphaned demo mirror file). So the gate
**cannot survive a partial move** — the earlier "shrink in lockstep" idea is
impossible (shrinking the manifest orphans the mirror copies; not shrinking it
orphans the source), and the review correctly noted that gutting the mirror also
leaves the demo non-runnable. Resolution:

- **The demo's mirror is a self-contained snapshot.** It does not import the
  moving engine, so a **frozen, untouched mirror stays fully runnable** at every
  slice boundary regardless of what moves in `scripts/`/`tools/`.
- **S3 suspends *every* live-tree demo-sync enforcement path** (not just root
  `verify` — see the exact edits in the S3 slice; the manifest-driven generator,
  the sensor control, and the demo CI workflow all invoke the checker against the
  live tree and would otherwise go red). Once suspended, the checker source, the
  manifest, the expander, and the mirror are genuinely **dormant** — nothing
  invokes them until S5 deletes them. The demo-sync **test keeps passing
  untouched** — it runs the checker in `mkdtempSync` synthetic fixtures
  (`check-lint-ratchet-demo-sync.test.ts:51` builds its own temp
  `examples/lint-ratchet-demo` tree), not against the live repo, so engine moves
  do not affect it, and it is deleted with the checker in S5.
- **New-package correctness is proven live** by the §2 fixture-context acceptance
  test, added in S3 — that is the live-code proof during the transition, so the
  frozen demo's staleness is not load-bearing.
- **S5 deletes the compensation harness last** — the ~1k LOC (manifest, expander,
  checker, checker test, frozen mirror) — *as* the demo is converted to a live
  workspace consumer with the §2 structural checks standing in. "Deletion last"
  is honored (the harness *files* die in the final slice); the only earlier
  change is suspending the gate in S3, forced by the mechanical fact above.

**Manifest-copy tests (`output.test.ts`, `scripts/tests/test-lint-ratchet.sh`).**
These read live sources *via the manifest* to copy them into a temp repo, so they
break in S3 the same way — the self-containment proof they provide moves to the
§2 fixture-context test. In S3 their manifest-copy assertions are **reworked out**
(not the whole files: `output.test.ts` still covers envelope output); the manifest
+ expander are deleted in S5.

### S0 — Engine max-lines zone cap (leaf 05 item 2 precursor)

- **Mechanism (verified):** base rule is `local/max-lines ["error", { max: 300,
  skipBlankLines, skipComments }]` in `eslint-config/rule-groups.js`
  (`maxLinesRules`), applied via `createRepoCodeQualityConfigs`, with per-file
  overrides appended after (`maxLinesExceptionConfigs`, then
  `maxLinesGeneratedExemptionConfigs`) in `eslint.config.js`. Add
  `maxLinesEngineZoneConfigs` in `eslint-config/code-quality-configs.js`:
  `files: ["scripts/lint-ratchet/**", "scripts/lib/baseline/**"]`, rule
  `local/max-lines ["error", { max: 500, ...maxLinesPolicy.counting }]`. Spread
  in `eslint.config.js` **after** `createRepoCodeQualityConfigs` and **before**
  `maxLinesExceptionConfigs` (so genuine >500 outliers keep their per-file entry,
  which wins last).
- **Files:** `eslint-config/code-quality-configs.js`, `eslint.config.js`. No new
  config file → no manifest entry.
- **Registration:** editing `eslint-config/**` busts main-lint cache identity →
  **full-scan** (`path-policy.ts` `ESLINT_FULL_SCAN_TRIGGERS` prefix
  `eslint-config/`).
- **Acceptance:** `bun run lint` green; a temporary 350-line engine file passes
  (was failing at 300); remove it.
- **Landing:** full-scan → `NODE_OPTIONS=--max-old-space-size=6144`, sequential
  verify-bridge, `merge --no-ff`. Single review (config-only).

### S1 — Registry/types split (`lint-ratchet-config.ts`)

- **Split (verified against the file):** portable types → new `config-types.ts`
  (`LintRatchetMode`, `LintRatchetMetric`, `LintRatchetParserProfile`, the
  `LintRatchet*Source` union, `LintRatchetConfigBase`, `LintRatchetConfig`,
  `LintRatchetThirdPartyPluginAllowlistEntry`, `Json*`). Musi registry data
  stays in `lint-ratchet-config.ts` (`lintRatchets`, the allowlist value, the
  `shared-policy.js` imports and per-entry constants), importing types from
  `./config-types.js`.
- **Consumers to repoint** (type-only imports flip to `./config-types.js`; data
  imports stay): `baseline.ts`, `check-registry.ts`, `runtime-config.ts`,
  `registry-builders.ts`, `diagnostics.ts`, and the rest per `code:intel refs`.
- **Registration:** coverage-map asserts each `ratchet/<id>` exists in
  `lint-ratchet-config.ts` — file keeps name/path → no coverage-map churn;
  `harness:check` unaffected.
- **Acceptance:** `lint:ratchet:check-registry` OK; `typecheck`; focused
  `baseline.test.ts`/`check-registry.test.ts`. **Parity: `lint-ratchet.baseline.json`
  byte-unchanged** (this slice changes no rule identity, so byte-equality is the
  correct assertion *here*, unlike move slices).
- **Landing:** pure `scripts/` TS, not full-scan → commit gate → merge. Single
  review.

### S2 — Scaffold `tools/` package + full workspace registration

Package non-empty (one real export + its package-owned test) so knip/vitest
resolve. Demo **not** yet joined; demo-sync stays green (nothing moved).

**[Amendment 2026-07-17, owner-approved during S2 confirm-then-fix] Dependencies
are minimal-at-scaffold, not the full §1.2 kernel set.** S2's `package.json`
declares only the dependencies its scaffold code actually imports (`typescript`;
dev `vitest`/`@types/node`). Declaring the not-yet-used kernel deps in S2 would
be flagged by knip's "every declared dep is used" — the very §2.2
self-containment invariant this leaf builds — so the manifest stays honest
per-slice and the remaining deps arrive with the code that imports them (S3
below). The full §1.2 dependency block is the **target** end state, reached
across S3/S4, not an S2 obligation.

**[fix P1-vitest/config/coverage, P1-mutation, P1-smoke/path-policy,
registration breadth] Registration surfaces (exact, verified file:line):**

1. Root `package.json:6` `workspaces` → add `"tools/*"` (currently only
   `"packages/*"`).
2. Root `tsconfig*.json` references/includes → add `tools/lint-ratchet`.
3. `vitest.config.ts:29` `projects: [...]` → add `"tools/lint-ratchet"`; add its
   coverage `include` block (the project list is flat dir names, each with a
   config; the package needs `tools/lint-ratchet/vitest.config.ts`).
4. `eslint.config.js` / `eslint-config/*` → add a `tools/**` reach block;
   carry the S0 zone cap glob to `tools/lint-ratchet/**`; add the coarse
   `no-restricted-imports` outward-target guard (§2.1 secondary).
5. **[fix P1-config-surface-group]** `eslint-config/config-surface-manifest.json`
   → register **both** maintained TS configs the package adds —
   `tools/lint-ratchet/vitest.config.ts` **and** `tools/stryker-lint-ratchet.ts`
   (item 6) — in the **existing `root-package-ts` group**, not a new group.
   Verified: the derived consumers filter on a closed set —
   `rootAndPackageTsConfigFiles` selects only `group === "root-package-ts"`
   (`config-surfaces.js:88`), and config files outside that group are otherwise
   ignored — so a new `tools-package-ts` group would be picked up by nothing
   unless every group-filtered consumer and the generated `tsconfig.configs.json`
   are also updated. Reusing `root-package-ts` (whose parser project fits a
   root-relative TS config) is the minimal correct choice. Then regenerate
   `tsconfig.configs.json` via `bun run harness:config-surfaces`.
6. **[fix P1-mutation]** The scripts Stryker lane (`scripts/stryker-scripts.ts`)
   is pinned to `tsconfigFile: tsconfig.scripts.json`, `vitest.configFile:
   scripts/vitest.config.ts`, `dir: scripts`, `mutate: scripts/**/*.ts` — a
   `tools/**` mutate glob there is **insufficient**. Add a **dedicated
   `tools/stryker-lint-ratchet.ts`** using the package tsconfig + package Vitest
   project, wired as its own mutation command, and register it as a config surface
   (item 5).
7. **Smoke-subject generation:** `path-policy-smoke-subjects-data.ts` is
   **generated** (`// Generated by generate-smoke-subjects.ts. Do not edit`) — it
   is regenerated, not repointed. Register any new `tools/` smoke subjects and
   run the generator.
8. **Coverage map:** `scripts/lint-coverage-map-check-patterns.ts:26`
   `ROOT_PATH_PREFIXES = Set(["packages","scripts","docs","e2e","eslint-rules"])`
   → add `"tools"`; add `tools/**` rows to `docs/generated/lint-coverage-map.md`.
9. `harness.controls.json` + `harness:check` fixtures → the moved control
   sources are updated later (S4); S2 only proves the wiring is green.
10. **knip** → add `tools/lint-ratchet` workspace + entry points.
11. **Prettier / `.prettierignore` / format scope** → include `tools/`.
12. **Changed-file/path policy:** `scripts/path-policy/path-policy.ts` — add
    `tools/` to `sourceRelevant.selectors`, a `tools/*/package.json` /
    `tools/*/tsconfig*.json` pair to `ESLINT_FULL_SCAN_TRIGGERS`, and a
    directory-prefix selector; `scripts/test-changed.sh:195` — add a `tools/*`
    project branch (mirroring the `packages/*` branches) so tool-file changes
    route to the tool Vitest project.
13. Regenerate: `steps.generated.sh` (its generator), `tsconfig.configs.json`,
    smoke subjects, coverage map — then `bun run harness:check` green.

- **Acceptance:** `bun install` resolves the workspace; `harness:check` green;
  `doctor` clean; the package test runs under the new Vitest project; `knip`
  clean; the tool mutation command runs; **the §2 resolution assertion passes for
  the one real export** (proves the exports map + `.js` keys resolve).
- **Landing:** workspace-glob + config-surface → full-scan, heap 6144,
  verify-bridge. Cross-model confirm-then-fix (registration omissions bite here).

### S3 — Kernel move + context seam + sensor repoint + demo-sync suspend

- **Grow the package dependencies (per the S2 minimal-at-scaffold amendment).**
  As each kernel file moves in, add its first-imported dependency to
  `tools/lint-ratchet/package.json` — `zod`, `eslint`, `minimatch`,
  `typescript-eslint` — at the **exact root `package.json` versions**, and update
  `bun.lock`. Landing target: after S3 the manifest declares exactly the deps the
  moved kernel imports, so the §2 boundary/knip self-containment invariant stays
  green (no undeclared import, no unused declared dep).
- **Move into `src/kernel/`:** all `scripts/lib/baseline/*` (non-test) + the
  ratchet kernel files (Appendix A) + `config-types.ts`. For
  `scripts/lib/codepoint-compare.ts` and `scripts/lib/eslint-json.ts`: confirm
  out-of-engine consumers via `code:intel dependents`; if shared, repoint those
  consumers to the package, else move. Per Amendment 1, S3 kernel also includes
  `metric-strategies.ts`, `metrics-complexity.ts`, `lifecycle-diff.ts`,
  `recovery-command.ts`, `zero-baseline-disposition.ts`, `zero-baseline-types.ts`
  (kernel import-closure); `baseline-update-apply.ts` stays in `scripts/` this
  slice.
- **Context seam:** replace the `paths.ts` consts in the kernel importers
  (Appendix A rows tagged *context*) with a passed-in `repoRoot`/context. The
  adapter `paths.ts` stays and constructs the Musi context.
- **Sensor repoint (out-of-engine kernel consumers, verified):**
  `scripts/sensor-knip-unused-exports-{baseline,core,merge-cli}.ts`,
  `scripts/sensor-near-duplicates-{baseline,baseline-io,baseline-gate,core,cli-options,merge-cli}.ts`,
  `scripts/max-lines-exceptions{,-core,-merge-cli}.ts`, and the CLI entry
  `scripts/lint-ratchet.ts` flip `scripts/lib/baseline/*` imports to
  `@musi/lint-ratchet/kernel/*`.
- **Git-rail wrappers:** move `merge-cli` merge logic into `src/git-rail/`; keep
  `scripts/lint-ratchet/baseline-merge-cli.ts` as the thin wrapper at its
  current path (§1.5). No shell/driver change.
- **[fix P1-baseline] Exact, settled baseline transformation.** Verified against
  the actual baselines, the engine footprint is *small and enumerable* — not
  "every `scripts/lint-ratchet/**` key" (that prefix contains files with three
  different fates). `configHashInput` (`baseline-hash.ts:92`) folds `files` +
  `ignores`, so a selector change re-hashes.

  > **Amendment 2 (2026-07-18, baseline key-map correction — orchestrator ruling).**
  > The map below misattributes the ratchet. Verified against the live baseline:
  > `ratchet/local-type-assertion-boundary` has **zero** items (it is a
  > narrow-floor zero-debt ratchet), so its only S3 change is the **configHash**
  > (adding `tools/**/*.ts`). The `eslint-runner.ts` / `lint-ratchet.ts` /
  > `portable-manifest-expand.ts` items listed below actually live in
  > `ratchet/local-no-swallowed-errors-broader-semantics` (whose glob already
  > covers `tools/**`, so its configHash is **unchanged**). Because the
  > debt-accounting path-diff has no net-neutral-rename primitive, a pure file
  > move of `eslint-runner.ts`'s no-swallowed-errors item would force fake debt;
  > the ruled resolution is **Option B** — make its best-effort fd-cleanup catch
  > genuinely rule-compliant (a named acknowledgement of the ignored close error,
  > no suppression), which *removes* the finding entirely. So the real S3
  > `lint-ratchet.baseline.json` delta is exactly: (1) the type-assertion
  > `configHash` change, and (2) `no-swallowed-errors` **loses**
  > `scripts/lint-ratchet/eslint-runner.ts` — a strict improvement, realized by
  > plain `lint:ratchet:update` (no `--allow-worse`, no debt-log line).
  > `lint-ratchet.ts` and `portable-manifest-expand.ts` (both `no-swallowed-errors`
  > items) stay put in S3; `portable-manifest-expand.ts` is deleted in S5.

  **Immutable per-file key map (`lint-ratchet.baseline.json`, superseded by
  Amendment 2 — the items below are `ratchet/local-no-swallowed-errors-broader-semantics`,
  not `local-type-assertion-boundary`):**

  | Old key | Fate | New key | Slice |
  | --- | --- | --- | --- |
  | `scripts/lint-ratchet.ts` (`:403`, count 1) | **STAYS** — adapter CLI entry, never moves | *(unchanged)* | — |
  | `scripts/lint-ratchet/eslint-runner.ts` (`:407`, count 1) | **MOVES** to kernel | `tools/lint-ratchet/src/kernel/eslint-runner.ts` | **S3** |
  | `scripts/lint-ratchet/portable-manifest-expand.ts` (`:411`, count 1) | **DELETED** with the harness → strict improvement | *(removed)* | **S5** |

  The two `baseline.test.ts` items (`:1286`, `:1333`, in the vitest
  `expect-expect` / `valid-expect` ratchets) — see the settled home below — **do
  not move**. The `max-lines-exceptions.baseline.json` has exactly one engine
  key, `scripts/lint-ratchet/lint-ratchet-config.ts` (cap 600, lifecycle
  permanent) — the **registry-data file stays adapter-side**, so that entry never
  moves and is untouched (post-S1 it is still > the 300 base, well under its 600
  cap, so the exceptions gate keeps it valid).

  **Settled `baseline.test.ts` home:** **split, and the ratcheted path stays put.**
  Package-owned baseline-codec cases → new `tools/lint-ratchet/test/baseline-codec.test.ts`
  (package fixtures, no Musi imports). The Musi-integration cases it currently
  carries (`baseline.test.ts:8-14` import the shared diagnostics schema +
  `lint-rule-docs` + the CLI entry) **remain at `scripts/lint-ratchet/baseline.test.ts`**
  as an adapter test — so `scriptVitestOptionPinnedFiles` (`lint-ratchet-config.ts:154`)
  and its two baseline items need **no change**. `single-group-spec.test.ts`
  (imports three Musi sensor specs, `:6-8`) is likewise split: kernel-fixture
  cases → package, sensor-spec cases → an adapter/sensor test under `scripts/`.

  **Exact S3 hash delta (as corrected by Amendment 2) — one configHash changes:**
  only `ratchet/local-type-assertion-boundary` (its `files` at
  `lint-ratchet-config.ts:230` gains `"tools/**/*.ts"` to keep covering the moved
  kernel); that ratchet has **zero items**, so nothing else about it changes.
  Separately, `ratchet/local-no-swallowed-errors-broader-semantics` **loses** its
  `scripts/lint-ratchet/eslint-runner.ts` item (the Option-B fd-cleanup fix
  removes the finding; a strict improvement, no configHash change since that glob
  already covers `tools/**`). **Assert:** every other ratchet's `configHash`,
  every count, every fingerprint, every `ruleOptions`, and every `ruleSourceHash`
  unchanged; `scripts/lint-ratchet.ts` and `portable-manifest-expand.ts` items
  unchanged in S3. Realize via plain `lint:ratchet:update` (no `--allow-worse`);
  review the diff against exactly this. Rule-source
  hashes: `eslint-runner.ts` is a kernel runner, not a `local/*` rule source, so
  no local-rule closure hash changes (confirm no ratcheted `local/*` rule imports
  a moved kernel file).
- **[fix P1-slot-suspension] Demo-sync suspension — the exact, verified edits.**
  The verify slot is *derived from* `harness.controls.json`, not hand-written in
  `steps.generated.sh` (`generate-verify-steps.ts:96` builds slots from the
  controls by id), so suspending it is a manifest edit + regeneration + test
  update, all in S3:
  1. **`harness.controls.json` — remove the `demo-sync` slot from both whole-tree
     verifier controls:** the two `slots` arrays each carry a
     `{ "name": "demo-sync", "script": "lint:ratchet:demo-sync" }` entry
     (`:589`, `:738`). Delete both, and edit each control's enumerating
     `principle` line to drop `demo-sync` from its slot narration.
  2. **[fix P1-workflow-sensor] `harness.controls.json` — represent the sensor as
     temporarily disabled:** remove the `sensor/lint-ratchet-demo-sync` control
     (`:536`, whose `invocation` advertises `bun run lint:ratchet:demo-sync`), and
     **parity-exempt the retained `lint:ratchet:demo-sync` package script** so
     `harness:check` does not flag an orphaned script (the script + checker still
     exist, dormant, until S5). Record the exemption as transitional.
  3. **`.github/workflows/lint-ratchet-demo.yml` — suspend the live-tree step**
     `"Check the demo matches the portable manifest"` (`:41`,
     `bun scripts/check-lint-ratchet-demo-sync.ts`) so `workflow_dispatch` or any
     concurrent demo edit does not go red mid-transition. The "Fresh-install
     portability smoke" step still runs the frozen self-contained demo.
  4. **`scripts/harness/generate-verify-steps.test.ts:48`** — the "keeps
     documentation drift guards in both whole-tree verifiers" case asserts
     `MUSI_VERIFY_DEMO_SYNC_CMD=('bun' 'run' 'lint:ratchet:demo-sync')`; update
     that expectation to the suspended slot set.
  5. **Regenerate** `steps.generated.sh` (the generator) **and**
     `docs/generated/harness-controls.md` (`bun run docs:harness-controls`) —
     `harness.controls.json` is a freshness trigger for the harness-controls doc
     (`generated-surface-freshness.ts:93`), so a stale doc fails the freshness
     gate.
  6. **Acceptance:** `bun run harness:check` green with `demo-sync` absent from
     both verifiers and the sensor control gone.

  **All of the above is reversed in S5** when the checker/manifest/expander are
  deleted for good and the standing structural checks + demo-consumer slot take
  their place (see S5).
- **[fix P1-portable-tests + P1-smoke] Rework the manifest-copy tests** that read
  live sources via the manifest: `output.test.ts`'s "copy runtime files into a
  temp repo and run the CLI" case and `scripts/tests/test-lint-ratchet.sh`
  (hardcoded copy/dispatch paths `:405`,`:604`) drop their manifest-copy
  assertions; the self-containment proof moves to the §2 fixture-context test. Do
  **not** shrink the manifest or delete mirror files here (that would trip
  `findStaleCopies` / `missing source` — see §3 head); the manifest + mirror die
  in S5.
- **Acceptance:** full `verify`; the sensors' own gates
  (`lint:max-lines-exceptions`, near-duplicates, knip) green; ratchet gate green;
  §2 boundary + resolution + fixture-context checks green for the kernel.
  **Parity: the §2 land-time script** (two SHAs, detached worktrees, full I/O
  surface).
- **Landing:** broad TS graph → full-scan, heap 6144, verify-bridge. Cross-model
  confirm-then-fix (highest risk: context seam + sensor repoint + baseline
  transformation + test re-homing).

### S4 — Governance + git-rail move + harness-source updates

- **Move into `governance/`:** `debt-log*`, `zero-baseline*`, `trend`,
  `propose*`, `edit-check*`, `retire*`, `retire-promotion-proof`,
  `metric-strategies`, `metrics-complexity`, `lifecycle-diff`,
  `ratchet-coverage`, `recovery-command`, `zero-baseline-disposition`. These
  already take `baselinePath`/`registry` as args; residual `paths.ts` use is
  context-threaded. Per Amendment 1, the six lifecycle/metric files listed above
  already moved in S3; S4 governance additionally moves `baseline-update-apply.ts`
  (with `debt-log-write.ts`). **`report.ts` and `local-rule-fix-text.ts` do NOT move** —
  both are adapter-side (§0 fix): `report.ts` is envelope→markdown end to end and
  `local-rule-fix-text.ts` imports `RuleDocsEntry`. There is no "report-as-data"
  extraction in this leaf.
- **Move into `git-rail/`:** the pure body of `baseline-info-attributes.ts` (the
  leaf-04 TS attributes rewriter); the shell + the CLI wrapper stay in
  `scripts/git/` / `scripts/`.
- **Adapter files stay** and now import governance from the package:
  `diagnostics.ts`, `info-diagnostics.ts`, `output.ts`, `report.ts`, `modes.ts`,
  `default-mode.ts`, `cli*.ts`, harness-controls half of `check-registry.ts`,
  `post-merge-baseline-preflight.ts` (unmoved).
- **[fix P1-harness-manifest] Moved control sources:** `harness.controls.json`
  names engine sources directly — `"source": "scripts/lint-ratchet/zero-baseline.ts"`
  (`:1252` area) and the debt-accounting control (`:1262`). Update those `source`
  fields to the new `tools/lint-ratchet/src/governance/...` paths and
  **regenerate the harness docs** (`harness-controls.md`) in this slice;
  `harness:check` must be green with the new sources.
- **Demo:** nothing to do — the `demo-sync` slot was suspended in S3 and the
  frozen mirror stays intact until S5. No manifest shrink, no mirror edits.
- **Baseline transformation:** none required — the only `lint-ratchet.baseline.json`
  engine items are the three type-assertion entries settled in S3 (all handled:
  `eslint-runner.ts` renamed in S3, `lint-ratchet.ts` stays, `portable-manifest-expand.ts`
  in S5), and no moved governance file carries a max-lines exception. Assert the
  baseline is byte-unchanged by S4 (governance files aren't in any baseline;
  confirm at implementation via `git diff` on both baselines).
- **Acceptance:** full `verify`; every `lint:ratchet:*` subcommand exercised
  against a fixture (summary, trend, zero-baseline, debt-log, propose, report);
  §2 checks green for governance + git-rail; §2 land-time parity script.
- **Landing:** full-scan, heap 6144, verify-bridge. Cross-model confirm-then-fix
  on governance; the pure git-rail move can be a separate single-review commit.

### S5 — Demo flip + delete residual harness + standing structural checks (final)

The payoff, deletion last.

- **Demo joins the workspace.** **[fix P2]** There is **no existing exclusion to
  undo**: the demo is simply outside the sole `"packages/*"` glob
  (`package.json:6`). S5 adds the **exact demo path** to `workspaces` and
  **removes `examples/lint-ratchet-demo/bun.lock`**.
- **[fix P1-prepare-hook] Neutralize the demo `prepare` hook first.** Its
  `package.json:18` `"prepare": "bun run lint:ratchet:install-merge-driver"` runs
  `bash scripts/git/install-lint-ratchet-merge-driver.sh` on the **enclosing Musi
  git root** during root `bun install` once it's a workspace member — it could
  rewrite the root driver. **Remove** the `prepare` hook; move driver
  installation into the smoke's isolated repo only (below).
- **Demo becomes a consumer:** depends on `@musi/lint-ratchet` + root
  `eslint`/`zod`; constructs its own `LintRatchetEngineContext`, its own tiny
  registry, its own minimal CLI adapter, and a minimal envelope render (proving
  envelope-agnosticism). Its `eslint.config.js`/`eslint-rules/`/baseline stay;
  reconcile its dep versions to root.
- **[fix P1-demo-gitrail] Enumerate the demo-owned git-rail adapter files to
  RETAIN/re-author before the mirror deletion.** The package owns only *pure* git
  operations; the shell driver bodies and the fixed-path CLI wrappers are
  layer-4 adapter (§1.5), and the smoke installs + exercises them. Verified, these
  live under `examples/lint-ratchet-demo/scripts/` today (manifest-copied via
  `portable-manifest.json:30` `mergeDriverFiles`) and must survive as
  **demo-owned** files, re-authored to consume the package's pure ops:
  - `scripts/git/` shells (11): `baseline-merge-driver.sh`,
    `baseline-merge-driver-lib.sh`, `baseline-post-merge-truth-up.sh`,
    `check-baseline-merge-driver.sh`, `check-lint-ratchet-merge-driver.sh`,
    `install-baseline-merge-driver.sh`, `install-lint-ratchet-merge-driver.sh`,
    `lint-ratchet-merge-driver-lib.sh`,
    `lint-ratchet-post-merge-baseline-truth-up.sh`,
    `restore-generated-baseline-stage.sh`, and `baseline-info-attributes.ts`.
  - `scripts/lint-ratchet/` fixed-path CLI wrappers (2):
    `baseline-merge-cli.ts`, `post-merge-baseline-preflight.ts` — the exact
    dispatch paths the installed driver invokes (mirrors the Musi adapter shape).

  Only the mirrored *engine* copy (kernel/governance TS) is deleted; this
  adapter rail is retained.
- **[fix P1-demo-smoke, P1-smoke-gitlevel] Rewrite `smoke.sh`'s isolation model.**
  Verified: today it copies **only** `examples/lint-ratchet-demo` to a temp
  checkout (`smoke.sh:25`) and runs a **frozen install** there (`smoke.sh:42`) —
  with a `@musi/lint-ratchet` workspace dependency that cannot resolve in a lone
  demo dir. New model, with the Git level fixed for the installer's `repo_root`
  resolution:
  - Copy both `tools/lint-ratchet` and the demo into a temp dir under a generated
    root `package.json` with `workspaces: ["tools/lint-ratchet", "demo"]`.
  - Run **`bun install` at the generated workspace root** (resolves the
    `workspace:*` link).
  - **`git init` and install + exercise the driver *inside the `demo/` member*,
    not the workspace root.** Verified necessity: the installer does
    `repo_root=$(git rev-parse --show-toplevel)` then requires
    `$repo_root/scripts/git/<driver>` (`install-baseline-merge-driver.sh:43,54`)
    and the driver dispatches `scripts/lint-ratchet/baseline-merge-cli.ts`
    relative to the Git root (`baseline-merge-driver.sh:32`). Initializing Git at
    the workspace root would look for `<root>/scripts/git` (absent — the rail is
    under `demo/scripts/git`). Git inside `demo/` makes `repo_root == demo/`, so
    every adapter path stays repository-root-relative and resolves.

  This proves the real adoption story ("copy `tools/lint-ratchet` + an adapter,
  it runs, driver included") in genuine isolation, off the Musi root.
- **Delete the compensation harness (the "deletion last" payoff):** the frozen
  demo *engine* mirror (kernel/governance TS — not the retained git-rail above),
  `portable-manifest.json`, `scripts/lint-ratchet/portable-manifest-expand.ts`,
  and `scripts/check-lint-ratchet-demo-sync.ts` (+ `.test.ts`). Also remove the
  now-dead `lint:ratchet:demo-sync` / `:demo-sync:update` package scripts.
- **[fix P1-slot-suspension reversal] Retire the S3 transitional wiring
  permanently.** The `demo-sync` slot + sensor control were *removed* from
  `harness.controls.json` in S3 (stay gone); in S5 also **drop the S3 parity
  exemption** on the `lint:ratchet:demo-sync` script (the script itself is
  deleted now), and **re-purpose the suspended `.github/workflows/lint-ratchet-demo.yml`
  step**: replace the removed "Check the demo matches the portable manifest" step
  with the new demo-consumer smoke rather than restoring the deleted checker.
  Regenerate `steps.generated.sh`, `harness-controls.md`, and update
  `generate-verify-steps.test.ts` again to their final (demo-sync-free) state.
- **[fix P1-standing-replacement]** In the **same slice** wire the standing
  replacements: a committed **demo-consumer verify slot** (or fold the demo smoke
  into the existing scripts slot) plus the §2 boundary, resolution,
  self-containment, and fixture-context checks as committed gates.
- **[fix P1-baseline S5 improvement] Record the `portable-manifest-expand.ts`
  removal.** Deleting that file removes its `ratchet/local-type-assertion-boundary`
  item (`lint-ratchet.baseline.json:411`, count 1) — a **strict improvement**, so
  run `lint:ratchet:update` (NOT `--allow-worse`) with a **pin-honesty
  assertion**: exactly that one item is removed and nothing else in either
  baseline changes. (`scripts/lint-ratchet.ts` item stays; `eslint-runner.ts`
  already renamed in S3.)
- **[fix registration tripwire]** Regenerate everything the deletion touches:
  `steps.generated.sh`, smoke subjects, coverage map, and the `harness:check`
  **fixtures that copy the generator** — all in this slice, or `harness:check`
  fails.
- **Docs rewrite:** `examples/lint-ratchet-demo/README.md` and
  `docs/guides/lint-ratchet-adoption.md` shift from "copy the manifest-selected
  files" to "copy `tools/lint-ratchet`, write an adapter like this demo"; update
  the "portable adoption" sections of `docs/guides/lint-ratchet{,-reference}.md`
  and the reference's "Shared baseline kernel / leaf 02" note to the package
  model. (Docs path-sweep hit list drives exact edits.)
- **Acceptance:** full `verify` with demo-sync **gone**; `harness:check` green;
  the demo's `smoke.sh` runs green as a workspace member; the §2 fixture-context
  test passes from both package and demo; grep proves no remaining reference to
  `portable-manifest.json`/`demo-sync` in code, config, or docs.
- **Landing:** config-surface/full-scan → heap 6144, verify-bridge. Cross-model
  confirm-then-fix (consumer flip + final deletion).

> **Amendment 3 (2026-07-18, S5 implementation + review adjudication).** Three
> rulings settled during the S5 confirm-then-fix round:
>
> - **A. Standing gate is CI-only.** The demo-consumer `smoke.sh` needs a real,
>   network-dependent `bun install` into a throwaway workspace, which is unfit for
>   the hermetic per-commit/land `verify` path. It stays the path-triggered
>   `.github/workflows/lint-ratchet-demo.yml` job; the S5 bullet's "committed
>   verify slot (or fold into the scripts slot)" option is **rejected** on
>   hermeticity grounds. The permanent *local* standing checks are the §2
>   structural guards (resolver-aware boundary + knip self-containment +
>   fixture-context acceptance) that run in the `tools/lint-ratchet` vitest project
>   under the normal `test` slot. No new verify slot, so no `memory-budget.sh`
>   entry is added (the suspended S3 `[demo-sync]=256` line stays gone).
> - **B. Demo baseline `ruleSourceHash` transition is expected.** Reconciling the
>   demo's `typescript-eslint` to the root caret range shifts the committed
>   baseline's `ruleSourceHash` (the hash pins the installed toolchain versions).
>   This is the intended consequence of "reconcile dep versions to root", not a
>   defect; the demo baseline's only S5 change is that one hash line. In a
>   copied-out isolated install the range floats further, so the smoke runs
>   `lint:ratchet:update` once to baseline its own toolchain (the documented
>   adopter step).
> - **C. Demo dependency set.** The engine resolves BOTH `eslint` and
>   `typescript-eslint` dynamically from the demo repo root (ESLint bin + rule-source
>   version reads), so both are declared and knip-ignored — matching the package's
>   own `ignoreDependencies`. `zod` is the engine's internal dependency, resolved
>   from the package location, so the demo does **not** declare it. This refines
>   the plan's "eslint/zod" wording (which predated the concrete consumer shape).

**Total: 6 slices (S0–S5).** S0/S1 single review; S2–S5 cross-model
confirm-then-fix. The demo mirror is **frozen** (untouched, runnable) through
S3/S4 with only the `demo-sync` verify slot suspended in S3; the demo flip,
compensation-harness deletion, and standing structural checks land together in
S5 (deletion last).

---

## 4. Landing mechanics

| Slice | Full-scan? | Heap | Land path | Review |
| --- | --- | --- | --- | --- |
| S0 cap | Yes (`eslint-config/`) | 6144 | fast-commit → verify-bridge → `merge --no-ff` | single |
| S1 split | No | default | commit gate → merge | single |
| S2 scaffold | Yes (workspaces + config surfaces) | 6144 | verify-bridge | confirm-then-fix |
| S3 kernel+context | Yes | 6144 | verify-bridge | confirm-then-fix |
| S4 governance+rail | Yes | 6144 | verify-bridge | confirm-then-fix |
| S5 demo flip + delete | Yes (config surfaces) | 6144 | verify-bridge | confirm-then-fix |

- One full `bun run verify` on the lane base **before** dispatch (fast-commit
  base can carry deferred test debt; a clean baseline keeps land-time failures
  attributable to the slice).
- **[fix P1-parity-order] One authoritative order, every move slice: slice commit
  → pinned parity proof → `bash scripts/land.sh`.** The §3 parity script (two
  explicit SHAs — the slice commit and its parent — in detached worktrees) runs
  **before** `land.sh`, so a parity failure blocks the merge instead of being
  discovered after it. `land.sh` (full sequential verify + `git merge --no-ff`)
  is the last step. S0/S1 have no move, so no parity proof: commit → `land.sh`.

---

## 5. Risks & open questions (with recommended defaults)

1. **Harness-diagnostics placement** — decided adapter-side (§0). *Default:* keep
   it; the package stays envelope-agnostic and the demo proves a second envelope.
2. **`baseline.test.ts` re-homing — SETTLED (no longer open).** Split: package
   baseline-codec cases → `tools/lint-ratchet/test/baseline-codec.test.ts`;
   Musi-integration cases (shared schema + `lint-rule-docs` + CLI entry) **stay at
   `scripts/lint-ratchet/baseline.test.ts`**, so `scriptVitestOptionPinnedFiles`
   and its two baseline items do not change (S3 §). This is the decided design,
   not a default.
3. **`codepoint-compare.ts` / `eslint-json.ts` non-engine consumers.** *Default:*
   if shared, repoint consumers to the package; only if that fans out too far,
   copy the tiny util into the package and leave the `scripts/lib/` copy for
   non-engine consumers (decided from the S3 dependents check).
4. **Exports-map granularity** — wildcards (§1.2). *Default:* wildcards + the §2
   resolution assertion; fall back to generated explicit entries only if
   wildcard subpath resolution misbehaves under the repo's module settings.
5. **Config-surface group — SETTLED.** Both package TS configs
   (`vitest.config.ts`, `stryker-lint-ratchet.ts`) register in the existing
   `root-package-ts` group (S2 §), not a new group — a new group is inert unless
   every group-filtered consumer (`config-surfaces.js:88`) is also updated.
   Open only if `root-package-ts`'s parser project turns out not to resolve a
   `tools/`-rooted config, in which case update the consumers explicitly.
6. **Demo dependency-version reconciliation.** *Default:* bump the demo to root
   versions; it is a proof, not a compatibility matrix.

---

## Appendix A — Per-file layer & slice assignment

> **Amendment 1 (2026-07-17, implementation-discovered closure fix — leaf02-design ruling).** The S3 kernel import-closure (breaking only the two authorized seam edges — ./paths.js context and ./lint-ratchet-config.js registry injection) is wider than the original per-file table, and metric-strategies/metrics-complexity were double-listed. Six files move to S3 kernel and the baseline-update family splits. Verified against 23446d12.

Every non-test `.ts` under `scripts/lint-ratchet/` (83) and `scripts/lib/baseline/`
gets exactly one of kernel / git-rail / governance (→ package) or adapter (→
stays in `scripts/`), plus its slice. `paths.ts` importers are tagged *context*
(parameterized on move) so all 23 are dispositioned.

- **Adapter (stays in `scripts/`):** `lint-ratchet-config.ts` (registry data),
  `registry-builders.ts`, `paths.ts`, `modes.ts`, `default-mode.ts` *(context)*,
  `cli.ts`, `cli-types.ts`, `cli-usage.ts`, `cli-validate.ts`, `cli-errors.ts`,
  `diagnostics.ts` *(context)*, `info-diagnostics.ts`, `output.ts`, `report.ts`,
  `local-rule-fix-text.ts` (imports `RuleDocsEntry`), `ratchet-manifest-message.ts`,
  harness-controls half of `check-registry.ts` *(context)*,
  `scripts/lib/lint-rule-docs.ts`, and the two git-rail CLI wrappers
  `baseline-merge-cli.ts` + `post-merge-baseline-preflight.ts` *(context)*.
- **Kernel (→ package, S3):** all `scripts/lib/baseline/*` (non-test);
  `baseline*.ts` family, `metric*.ts` family, `current-collector.ts` *(context)*,
  `current-collection-scheduler.ts`, `eslint-config.ts` *(context)*,
  `eslint-runner.ts` *(context)*, `ratchet-globs.ts`, `registry-validation.ts`,
  `rule-source.ts` *(context)*, `rule-source-drift.ts` *(context)*,
  `rule-source-import-guard.ts`, `git-tracked-files.ts` *(context)*,
  `message-identity.ts` *(context)*, `message-swap-info.ts`,
  `removed-path-improvements.ts`, `markdown-escape.ts`, `runtime-config.ts`,
  `config-types.ts`, `codepoint-compare.ts`/`eslint-json.ts` *(pending S3
  consumer check)*, and `baseline-update.ts` + `baseline-update-lifecycle.ts`
  *(in the `baseline.ts` re-export closure)*; **and (Amendment 1)**
  `metric-strategies.ts`, `metrics-complexity.ts`, `lifecycle-diff.ts`,
  `recovery-command.ts`, `zero-baseline-disposition.ts`, `zero-baseline-types.ts`
  — each import-closed within the kernel. `baseline-update-apply.ts` is **NOT**
  S3 kernel (see Adapter/S4).
- **Git-rail pure ops (→ package, S3/S4):** `merge-cli` merge logic,
  `merge-driver-presence.ts`, `baseline-info-attributes.ts` body.
- **Governance (→ package, S4):** `debt-log*.ts` *(context via `debt-log.ts`,
  `debt-log-write.ts`)*, `zero-baseline.ts` *(context; the audit-mode file — the
  `-disposition`/`-types` pair are kernel now)*, `trend.ts` *(context)*,
  `propose*.ts`, `edit-check*.ts` *(context via `edit-check.ts`)*, `retire*.ts`
  *(context via `retire-update.ts`)*, `retire-promotion-proof.ts`,
  `ratchet-coverage.ts` *(context)*,
  `baseline-debt-accounting*.ts` *(context via `-format`, `-git`, and the base)*.
  **(Amendment 1)** `baseline-update-apply.ts` *(deferred from S3; see note)* —
  the baseline+debt-log write orchestration; moves with `debt-log-write.ts`. Its
  `cli-errors.js` (WorseBaselineError) dependency is resolved in S4: either
  WorseBaselineError moves into the package or baseline-update-apply stays
  adapter-side. Its sole consumer is `modes.ts` (adapter).

**One file is split, not moved:** `check-registry.ts` (portable validator →
package; harness-controls cross-check → adapter). `report.ts` and
`local-rule-fix-text.ts` are **adapter-side, whole** (both are listed in the
Adapter group above; the earlier "report-as-data split" is withdrawn — it was a
semantic redesign out of scope for this leaf, §0).

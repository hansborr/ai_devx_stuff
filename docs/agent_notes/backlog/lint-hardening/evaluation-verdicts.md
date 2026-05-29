# Lint Hardening Evaluation Verdict Register

Status: Central register
Last updated: 2026-05-20

Use this file when a promoted lint-hardening leaf evaluates a rule, plugin,
or structural sensor and chooses **reject**, **defer after inventory**,
**adopt only a subset**, or **full adoption with caveats/scoped exceptions**.
Keep the local leaf updated too, but do not leave the reason only in the leaf;
this register is the review surface for "why did we not enable that?" and
"what caveat did we accept?"

Straightforward full adoption with no caveats does not need a row.

## Required Shape

Every new verdict row should answer:

- What candidate was evaluated?
- Which leaf or audit produced the verdict?
- Was the outcome `reject`, `defer`, `adopt subset`, or `adopt full with
  caveats`?
- What evidence supports the decision?
- What would justify revisiting it?

Use links to the leaf, audit, inventory output, or follow-up issue/note. Keep
the reason short enough to scan; put detailed per-site walkthroughs in the leaf
or audit note.

## Example Row Shapes

Use these as shape examples only; do not copy them into `## Verdicts` unless a
real inventory produced the outcome.

- **Defer after inventory**: `Leaf N / rule-name` — defer. Evidence: 37 hits,
  most split between intentional framework glue and unclear wrappers; no clean
  package boundary yet. Revisit when `packages/server/src/foo/` has a named
  helper or after a postmortem shows this rule would have caught a bug.
- **Adopt subset**: `Leaf N / plugin-name` — adopt subset
  (`rule-a`, `rule-b`), reject `rule-c`. Evidence: `rule-a` and `rule-b`
  found three real bugs and cleaned to zero; `rule-c` produced 28 style-only
  findings already covered by Prettier. Revisit `rule-c` only with a concrete
  bug class.
- **Adopt full with caveats**: `Leaf N / sensor-name` — adopt full with
  scoped exceptions. Evidence: baseline is clean except generated fixtures
  under `path/**`, which are excluded with comments in the config. Revisit if
  those fixtures stop being generated or the allowlist grows.

## Verdicts

### 2026-05-17 - Leaf 12 `local/type-assertion-boundary` Pass C

Leaf: `docs/agent_notes/backlog/lint-hardening/12-type-assertion-boundary-lint.md`.

Outcome: scoped adoption with packages deferred.

- `local/type-assertion-boundary` now runs at `error` for `e2e/**/*.ts` and
  the linted scripts subset
  (`scripts/code-intel/**/*.ts`, `scripts/drift/**/*.ts`, and
  `scripts/generate-lint-guidance.ts`).
- Evidence: the Pass B scout found 11 in-scope findings, all legitimate
  json/interop boundary casts; Pass C added parseable comments and kept lint
  clean for the narrow scope.
- Deferred: the remaining 321 findings in `packages/shared`,
  `packages/server`, and `packages/client` need code rewrites for the
  convenience-cast subset alongside any true boundary comments. Revisit in
  follow-up package or feature slices, not by widening this scoped override.

### 2026-05-17 - Leaf 18 adjacent structural sensors

Source:
`docs/agent_notes/backlog/lint-hardening/18-structural-sensors.md`.

Outcome: partial adoption with report-only caveats; one candidate rejected.

- Adopted `bun run drift:ai harness-freshness` as a WARN-only harness
  inventory check and surfaced it from `doctor`. Baseline was cleaned by
  linking the two existing unreferenced guides in `docs/ai-harness.md`.
- Adopted `bun run sensor:blob-size` as a WARN-only staged-file sensor and
  surfaced it from `doctor`. It is not wired into pre-commit in this leaf.
- Initial `.blob-size-allowlist` covers existing tracked blobs over 500 KiB:
  `docs/SRD_CC_v5.2.1.pdf` and
  `packages/server/src/seed/data/5e-srd-monsters.json`.
- ASCII/smart-character hygiene was explicitly rejected by the user for this
  leaf. Spell-check and architecture-boundary sensors were not implemented.
  Revisit blob-size gating only after the report stays low-noise and the
  allowlist remains reasoned and small.

### 2026-05-16 - Leaf 23 generated lint guidance spike

Leaf: `docs/agent_notes/backlog/lint-hardening/23-llm-core-generated-lint-guidance-spike.md`.

Outcome: **KEEP and EXPANDED** — confirmed 2026-05-19 in commit `77522709`.

- `principle` field expanded from the three-rule spike (structured-logging,
  no-barrel, strict-trpc-input) to every `local/*` rule via the PR 1
  `meta.docs` contract enforced in `scripts/lint-rule-docs.ts`. As of
  2026-05-19, `scripts/generate-lint-guidance.ts` emits 18 entries —
  one per file in `eslint-rules/*.js`.
- Generator: `scripts/generate-lint-guidance.ts`; outputs
  `docs/generated/local-lint-rules.md`.
- Scripts: `bun run docs:lint-guidance` (write),
  `bun run docs:lint-guidance:check` (CI freshness, gated after Lint in
  `.github/workflows/ci.yml:71` per commit `944779fc`).
  `scripts/harness-check.ts:43` exempts the `:check` variant from
  manifest parity — only the writer is in `harness.controls.json` under
  the `doc-generator/lint-guidance` control.
- Smoke test: `scripts/test-generate-lint-guidance.sh`, wired into
  `scripts/test-scripts.sh` runner list and changed-manifest table.
- Linked from `docs/ai-harness.md` as the local-rule reference.
- The harness controls manifest references the lint-rules doc by path
  (`scripts/fixtures/generate-harness-controls/expected.md:8`), keeping
  the two outputs orthogonal (manifest = enumeration; lint-rules =
  per-rule principle + repair kind). Folding the lint-rules doc into the
  manifest would lose the per-rule principle/repair surface that an
  agent uses to recover from a diagnostic, so the decision is keep-as-is.

### 2026-05-16 - Leaf 19 `import-x/no-extraneous-dependencies`

Leaf: `docs/agent_notes/backlog/lint-hardening/19-package-dependency-policy.md`.

Outcome: defer after inventory.

- `eslint-plugin-import-x@4.16.2` was probed with only
  `import-x/no-extraneous-dependencies` enabled, scoped per package with
  `packageDir` for `packages/{shared,server,client}` plus root `scripts/`.
- Evidence: 472 findings, split as `packages/client` 258,
  `packages/server` 165, and `packages/shared` 49. The dominant pattern is
  root-only dev tooling imported from package source/test files: 469 `vitest`,
  2 `prettier`, and 1 client test-helper `@testing-library/react`
  devDependency glob mismatch.
- The plugin install and ESLint config were reverted. Revisit after an explicit
  package-local devDependency policy, a decision on `*.test-helper.*` dev globs,
  and classification of server `src/seed` generators. The Leaf 19
  manifest-policy script remains parked as a separate slice.

### 2026-05-17 - Leaf 19 `import-x/no-extraneous-dependencies` Pass 2

Leaf: `docs/agent_notes/backlog/lint-hardening/19-package-dependency-policy.md`.

Outcome: full adoption with scoped file-glob caveats.

- `eslint-plugin-import-x@4.16.2` is installed at the repo root and
  `import-x/no-extraneous-dependencies` runs at `error` across
  `packages/{shared,server,client}/src`.
- Strict package source uses `packageDir: ["packages/<pkg>"]`, so non-test
  package source cannot satisfy imports from root-only dev tooling.
- Tests and helpers use `packageDir: ["packages/<pkg>", "."]` with
  `devDependencies: true`. This intentionally allows root-owned test
  infrastructure for `*.test.*`, `*.spec.*`, `*.test-helper.*`, and the
  existing package `src/test/**` helper directories without adding `vitest` to
  package manifests.
- `prettier` is declared in `packages/server` `devDependencies`; the server
  strict tier allows package-local devDependencies for the two
  `src/seed/generate-srd-*.ts` generator entrypoints. The root fallback is not
  available to those generator files.
- Verification: `bun run lint -- --max-warnings=0` and `bun run typecheck`
  both exited 0.
- Revisit if non-test package source needs a root-only tool, if helper files
  outside the listed globs start importing dev tooling, or if the SRD
  generators move out of `src/seed`.

### 2026-05-16 - Leaf 22 local-rule message guidance tests

Outcome: convention adopted as test + doc.

- `eslint-rules/message-guidance.test.js` extended to cover all 27
  rule/messageId pairs. 11 classified as guidance, 16 classified as policy.
- Rule-authoring convention documented in
  `docs/guides/local-eslint-rules.md`.
- Messages updated to meet the convention are listed in the commit body.

### 2026-05-16 - Leaf 11 Restricted Primitives (process.exit)

Source: `docs/agent_notes/backlog/lint-hardening/11-restricted-primitives.md`.

Outcome: scoped adoption (process.exit only).

- `no-restricted-syntax` (process.exit selector): adopted at error with a
  6-file allowlist for CLI entrypoints, bootstrap, and seed scripts.
  Diagnostic names the alternative (process.exitCode + return/throw) and the
  allowlist mechanism.
- Inventory was 9 sites across 6 files - all legitimate terminator contexts,
  all allowlisted. No code changes needed.
- Other restricted primitives (raw fetch, process.env reads, Date.now(),
  timers) deferred per backlog rollout order.

### 2026-05-16 - Leaf 21 `eslint-plugin-regexp` (Pass 2a)

Leaf: `docs/agent_notes/backlog/lint-hardening/21-regexp-plugin.md`.

Outcome: subset adoption; 3 rules deferred to Pass 2b.

- `regexp/no-dupe-characters-character-class`: adopted at error. 5
  auto-fixes applied.
- `regexp/no-useless-flag`: adopted at error (promoted from warn). 2
  auto-fixes applied.
- `regexp/prefer-d`: adopted at error. 1 auto-fix applied.
- `regexp/no-unused-capturing-group`: adopted at error. 1 hand-fix in
  `scripts/code-intel/cli-values.ts`.
- All other enabled rules in `flat/recommended` adopted, with the remaining
  upstream warn-level recommended rules promoted to error for the zero-warning
  gate.
- `regexp/no-super-linear-backtracking`: Deferred. 24 findings across 10
  sites in seed parsers / spell blocks / glossary entries / monster form /
  graph-cache. Catastrophic-backtracking rewrites need targeted tests; tracked
  in Pass 2b.
- `regexp/no-misleading-capturing-group`: Deferred. 1 site, tied to a
  backtracking rewrite in `monster-form-data.ts`.
- `regexp/no-contradiction-with-assertion`: Deferred. 1 site in
  `generate-srd-spells.ts`; needs semantic review of the section-header
  matcher.
- `regexp/prefer-named-capture-group`: explicitly off (style, not
  correctness).

### 2026-05-17 - Leaf 21 `eslint-plugin-regexp` (Pass 2b)

Leaf: `docs/agent_notes/backlog/lint-hardening/21-regexp-plugin.md`.

Outcome: deferred semantic rules adopted at error.

- `regexp/no-super-linear-backtracking`: adopted at error after all 24
  findings across the 10 backtracking sites were rewritten with targeted
  characterization coverage.
- `regexp/no-misleading-capturing-group`: adopted at error after the monster
  comma-pair parser rewrite in Fix A.
- `regexp/no-contradiction-with-assertion`: adopted at error after the
  `SECTION_HEADER_RE` minimum rewrite in Fix C.
- `regexp/prefer-named-capture-group` remains explicitly off as style-only.

### 2026-05-16 - Leaf 13 `react/jsx-no-leaked-render`

Leaf: `docs/agent_notes/backlog/lint-hardening/13-eslint-plugin-react.md`.

Outcome: defer after inventory.

- `react/jsx-no-leaked-render`: Deferred. Evidence: 87 findings in
  `eslint-plugin-react@7.37.5`; the rule has no `allowExpressions` option and
  flags JSX-attribute boolean expressions as false-positive noise. Revisit
  only if a narrower scope or upstream rule improvement appears.

### 2026-05-16 - Leaf 14 `react-hooks/set-state-in-effect`

Leaf: `docs/agent_notes/backlog/lint-hardening/14-react-hooks-broadened.md`.

Outcome: defer after inventory.

- `react-hooks/set-state-in-effect`: Deferred. Evidence: 23 findings in
  established props-to-local-state, dialog reset, and external-system sync
  patterns. Promoting this rule requires a UI-wide refactor, not a focused
  lint-hardening cleanup. Revisit when those patterns have a shared design and
  targeted route/dialog tests to prove the behavior change.

### 2026-05-16 - Leaf 9 `typescript-eslint` Stricter Opt-Ins

Leaf: `docs/agent_notes/backlog/lint-hardening/09-ts-eslint-stricter-optins.md`.

Outcome: partial adoption with deferred rules.

- `@typescript-eslint/strict-boolean-expressions`: Deferred. Evidence: 423
  findings across all packages, where each truthy check may be a real bug or an
  intentional JavaScript truthiness guard; revisit as per-package rollout
  starting with shared, then e2e/scripts, then smaller server/client slices.
- `@typescript-eslint/promise-function-async`: Initially deferred in Pass 2.
  Evidence: 349 findings with poor signal-to-noise because test mocks such as
  `vi.fn(() => Promise.resolve())` dominate and production overlap with
  existing `no-floating-promises` / `no-misused-promises` findings was zero.
- Pass A update (2026-05-17): `@typescript-eslint/promise-function-async`
  adopted at `error`. Evidence: three targeted overrides cover test files,
  client tRPC mock factories, and dynamic-import loaders; the remaining 87
  findings were resolved with 84 `async` additions and 3 reasoned per-line
  disables. `@typescript-eslint/strict-boolean-expressions` remained deferred
  globally with 423 case-by-case findings.
- Leaf 23 update (2026-05-19): the shared-package slice landed as
  `ratchet/strict-boolean-expressions-shared` and was drained to 0 current
  findings. Global normal-ESLint adoption remains a separate rollout decision.

### 2026-05-16 - Leaf 10 Core ESLint AI-Footgun Rules

Leaf: `docs/agent_notes/backlog/lint-hardening/10-builtin-ai-footgun-rules.md`.

Outcome: partial adoption with deferred rules.

- `no-constant-binary-expression`: adopted at `error` in Leaf 10 Pass 2.
  Evidence: Pass 1 inventory found 0 findings.
- `no-param-reassign` with default `props: false`: adopted at `error` in
  Leaf 10 Pass 2. Evidence: Pass 1 inventory found 0 shallow parameter
  reassignment findings.
- `radix`: adopted at `error` in Leaf 10 Pass 2. Evidence: Pass 1 inventory
  found 0 findings; `parseInt` call sites already pass an explicit radix or
  are absent.
- `no-await-in-loop`: Deferred. Evidence: 164 findings dominated by deliberate
  sequential code: server transactions/retry loops, seed scripts, e2e step
  ordering, test scenario setup, and socket cleanup. Revisit with an
  intentional-vs-bug classification slice before adoption.
- `no-param-reassign` with `{ props: true }`: Deferred. Evidence: flipping
  the option on produced 17 findings, mostly canvas-context mutation in
  `FogOverlay`, CLI parser state accumulation, and project-cache lazy init.
  Revisit through a focused refactor leaf.

### 2026-05-16 - Leaf 17 `@eslint/json`

Outcome: full adoption.

- `json/no-duplicate-keys`: adopted at `error`. 0 findings.
- `json/no-empty-keys`: adopted at `error`. 0 findings.
- `json/no-unnormalized-keys`: adopted at `error`. 0 findings.
- `json/no-unsafe-values`: adopted at `error`. 0 findings.
- Scope: 22 tracked JSON-family files after existing top-level ignores:
  14 strict JSON files and 8 JSONC-style `tsconfig*.json` files. No
  recommended rule was dropped, and no new generated file family was excluded.
  The existing `scripts/**/*` top-level ignore keeps codemod and drift fixture
  JSON outside ESLint scope.

### 2026-05-16 - Leaf 5 `eslint-plugin-jsx-a11y`

Outcome: adopt full with caveats/scoped exceptions.

- `eslint-plugin-jsx-a11y`: adopt the full recommended client TSX rule set at
  `error`. Evidence: the Pass 1 inventory produced 58 warnings and Pass 2
  cleaned the final baseline to 0 findings without dropping a recommended
  rule. Caveats: TanStack Router `Link` needs `anchor-is-valid`
  `{ components: ["Link"], specialLink: ["to"] }` because plugin 6.10.2 does
  not consume the recorded `settings["jsx-a11y"].linkComponents`; the lucide
  `Link` icon import was renamed to avoid identifier collision; accepted
  line-level exceptions remain for modal primary-input autofocus, test-only
  canvas DOM stand-ins, and the notification popover `role="list"`
  Safari/VoiceOver workaround. Revisit if jsx-a11y starts honoring
  `linkComponents`, if accepted suppression count grows, or if a future React
  lint leaf introduces component-aware checks that can replace a caveat.

### 2026-05-16 - Leaf 8 Codemod Scripts ESLint Coverage

Leaf: `docs/agent_notes/backlog/lint-hardening/08-scripts-eslint-coverage.md`.

Outcome: defer after inventory.

- `scripts/codemods/**/*.ts`: defer enabling ESLint coverage as one broad
  slice. Evidence: a temporary project block mirroring
  `scripts/code-intel/**/*.ts` and pointing at `./tsconfig.scripts.json`
  produced 70 findings with `bun run lint -- --max-warnings=0` after excluding
  `scripts/codemods/fixtures/**`: 59 errors and 11 warnings. Of the 59 errors,
  16 are `eslint --fix`-able (mostly `simple-import-sort/imports` and
  `@typescript-eslint/consistent-type-imports`); the remaining 43 errors are
  implementation-shape pressure, not small cleanup: 17 complexity errors,
  6 `max-params` errors, 5 `local/max-lines` errors across large codemod
  modules, plus repeated codemod test-harness patterns (void-expression
  callbacks, non-`Error` throws, missing explicit assertions). The autofix
  subset on its own would not enable coverage because the 28 hard structural
  errors remain blockers. No ESLint config or codemod fixes landed in this
  stop-path commit. Revisit by promoting narrower cleanup slices for the
  large codemods and shared test harness pattern before re-enabling codemod
  coverage; a mechanical `--fix` commit may go first to shrink noise during
  the structural pass.

### 2026-05-16 - Leaf 7 `knip` Unused-Code Sensor

Leaf: `docs/agent_notes/backlog/lint-hardening/07-knip-unused-export-sensor.md`.

Outcome: adopted as sensor, report-only via `doctor`.

- `knip`: adopt as a report-only structural sensor. Evidence: config was
  tightened so shared schemas/rules and client `components/ui` are treated as
  deliberate contract surfaces, server `__type-tests__` and SRD generator
  scripts are explicit entries, and `@prisma/client`, `jscpd`, and
  `pino-pretty` are documented dependency false positives. Two confirmed
  devDependency deletes landed: `@tanstack/react-router-devtools` and
  `@types/bcryptjs`. The hard-fail decision is deferred: knip is not wired
  into `verify:changed` or pre-commit. Revisit through Leaf 7b, the
  dead-export cleanup sweep, which must triage the remaining 87 unused exports
  and 74 unused exported types one finding at a time.

### 2026-05-16 - Leaf 3 `@vitest/eslint-plugin` First Slice

Source: `docs/agent_notes/backlog/lint-hardening/03-vitest-test-quality-rules.md`.
Testing Library and jest-dom remain deferred to separate Leaf 3 slices.

Outcome: adopt subset.

- `@vitest/eslint-plugin`: adopt subset for non-e2e
  `**/*.test.{ts,tsx}` and `**/*.spec.ts`. Evidence: the recommended-rule
  inventory was clean for 13 rules, `expect-expect` found seven real
  no-assert tests after whitelisting Musi assertion helpers,
  `valid-expect` found one lint-hostile, double-invoking `toThrow` pattern
  plus ten legitimate Vitest assertion-message calls handled with
  `maxArgs: 2`, and
  `prefer-called-exactly-once-with` had two direct assertion-strength
  cleanups. The zero-finding matcher-style rules
  `prefer-comparison-matcher`, `prefer-equality-matcher`, and
  `prefer-to-contain` were also enabled because they required no churn.
  Deferred after inventory: `no-conditional-expect` (81 mixed hits),
  `prefer-to-be` (2 style-only hits), and `prefer-to-have-length` (24
  style-only hits). Reason: the `no-conditional-expect` inventory mixes
  legitimate Zod `safeParse` narrowing, `try { expect.unreachable() } catch {
  ... }`, and concurrency-branch patterns with vacuous-pass bug shapes. This
  fix landed two in-scope bug repairs: `packages/server/src/routers/encounter-combat-spell.test.ts`
  now asserts the high-bonus spell hit before checking HP, and
  `packages/server/src/routers/srd-spell.test.ts` now asserts at least two
  spells before pairwise sort checks. Revisit through Leaf 3b:
  vacuous-conditional-expect bugs, tracked in the backlog index, to separate
  silent-pass bugs from legitimate assertion narrowing. Revisit the deferred
  matcher-style rules only in an explicit style cleanup leaf.

### 2026-05-11 - `eslint-plugin-llm-core` Parked Rules Audit

Outcome: no upstream rules promoted.

- `no-incorrect-sort`: reject rule; fix two sites by hand. Evidence: 21 hits,
  0 active bugs, 2 latent numeric-sort smells. Most hits were intentional
  string sorts, so global signal was roughly 2/21. Revisit only if numeric
  `.sort()` bugs recur, preferably as a narrower type-aware local rule.
- `no-empty-catch`: reject. Evidence: 7 hits, all documented best-effort
  cleanup, expected test failures, or fire-and-forget work. Core `no-empty`
  already catches truly bare `catch {}`. Revisit only with a local rule that
  accepts documented intentional empty catches.
- `max-nesting-depth`: reject rule; hand-refactor if desired. Evidence: 4
  hits, 2 refactor candidates, 2 intentional shapes. Existing
  `complexity: 10` is a better repo-wide signal. Revisit after repeated
  review comments about nesting that complexity misses.
- `no-commented-out-code`: reject. Evidence: 1 hit, a false positive on an
  important concurrency policy comment; no actual commented-out code found.
  Revisit only with a narrower local artifact detector.
- `no-exported-function-expressions`: reject. Evidence: 4 hits, all typed
  function values where expression form carries the contract. Converting
  would duplicate interface signatures or require casts. Revisit only if
  exported function expressions create a concrete maintainability bug.
- `prefer-early-return`: reject. Evidence: 23 hits, all canonical
  single-guard React/hook bodies or similar style cases; 0 maintainability
  findings. Revisit only after a concrete bug/postmortem tied to nested guard
  style.

### 2026-05-16 — Leaf 15 assertion failure quality (Zod parse helpers)

Outcome: helpers landed + current migration complete (shared/server/client).

- `expectParseSuccess` / `expectParseFailure` added at
  `packages/shared/src/test/parse-helpers.ts`. On failure, the diagnostic shows
  Zod issues (success path) or the unexpectedly parsed data (failure path),
  making test failures self-explanatory.
- Migrated 679 current Zod parse-result boolean assertion sites across 35 test
  files: 652 shared, 3 server, 24 client. The live branch inventory exceeded
  the stale 193-site handoff count; the migration covered all confirmed
  `.safeParse(...).success` sites plus `validateHomebrewData(...)` parse
  result sites.
- No local lint rule added yet (deferred per backlog rollout; the helper
  pattern needs to prove itself first).

### 2026-05-16 — Leaf 24 parked LLM-core sort-comparator fixes

Outcome: housekeeping close-out — both sites already fixed.

- Both `.sort()` follow-up sites
  (`cast-spell-concentration.test.ts:383`, `race-helpers.test.ts:35`)
  were fixed in commit `0652826e`
  (`test(server): fix numeric sort comparators (AUD-LINT-001)`) prior
  to this session. Verified in-place on 2026-05-16.
- The underlying `no-incorrect-sort` rule remains intentionally
  unadopted (2/21 signal-to-noise per the original audit).

### 2026-05-17 — Leaf 7b knip dead-export sweep

Source: `docs/agent_notes/backlog/lint-hardening/07-knip-unused-export-sensor.md`.

Outcome: landed cleanup; knip export/dependency inventory is clean.

- Triaged all 161 export/type findings with delete-unless-justified default:
  5 deleted, 41 carved out as intentional surface, and 115 made
  module-private. New carve-outs are scoped to shared map contracts,
  documented homebrew form `FormData` re-exports, reusable fixture builders,
  server test fixtures, and e2e helper surfaces.
- Dependency findings were configuration/declaration issues, not delete
  candidates: `@commitlint/cli` is ignored for Husky `bunx commitlint`, and
  `@commitlint/types` is now a root devDependency for the JSDoc config type.
- Final `bun run sensor:knip` exits 0. The sensor remains report-only unless a
  separate leaf promotes it to a hard gate.

### 2026-05-19 - Leaf 10a: `vitest/no-conditional-expect` Re-Triage

Follow-up: `docs/agent_notes/backlog/lint-followups/10-test-quality-followups.md`.
Branch: `feature/lint-hardening-leaf-10a-vitest-conditional-expect`.

Outcome: **defer rule, fix surfaced bugs**.

- `vitest/no-conditional-expect`: defer (rule remains off in
  `eslint.config.js`). 55 findings across `packages/**/*.test.{ts,tsx}`
  classified as 5 bug / 6 safeParse / 20 unreachable / 16 concurrency /
  8 other. Five real silent-pass sites in
  `packages/server/src/services/combat-actions/combat-actions.test.ts`
  (`hit`/`criticalMiss` conditional branches around lines 210-214 and
  329-331) were repaired in commit `a44e71a4` by injecting a
  deterministic mid-roll RNG (`midRng = () => 10`) and dropping the
  conditional guards. The remaining 50 findings are legitimate Zod
  `expectParseSuccess` / `expectParseFailure` narrowing, `try {
  expect.unreachable(); } catch {...}` / `expect.fail()` shapes,
  concurrency-branch assertions (both branches assert valid final
  states), and table-driven optional-property checks. The rule cannot
  distinguish these from real bugs without inline suppressions on >30%
  of findings, so promoting it now would add disable noise without
  bug-prevention benefit beyond the 5 already-fixed sites. Revisit only
  if a future helper convention makes the legitimate shapes
  rule-friendly (e.g. a typed `assertHit(...)` helper that the rule
  recognizes), or if a different rule/config catches the silent-pass
  shapes without the false-positive density.

### 2026-05-19 - Leaf 13a: `no-await-in-loop` Server Services Re-Triage

Follow-up: `docs/agent_notes/backlog/lint-followups/13-core-footgun-deferred-rules.md`.
Branch: `feature/lint-hardening-leaf-13a-no-await-in-loop-services`.

Outcome: **defer rule for this family**.

- `no-await-in-loop`: defer for `packages/server/src/services/**`
  (rule remains off in `eslint.config.js`). 7 findings classified as
  3 intentional-sequential, 1 promise-all-safe, 3 transaction-boundary,
  0 rate-limit-boundary, 0 other. Intentional patterns:
  `character-live-state/side-effects.ts:23` and
  `encounter-combat/broadcast-helpers.ts:36` preserve observable
  ordering for the deduplicated post-commit character-update fan-out
  and the combat-result socket fan-out; `rest-service.ts:411` is the
  long-rest retry loop that depends on the previous attempt's
  serialization-failure outcome. Transaction-boundary patterns are all
  Prisma `$transaction` callbacks where parallel awaits against the
  same client are unsafe (`character-delete.ts:37` turn-index CAS,
  `combat-actions/initiative.ts:44` initiative/sort-order writes,
  `rest-service.ts:229` hit-dice writes in the canonical
  `Stats -> CharacterClass` lock order). The lone promise-all-safe
  candidate at `character-delete.ts:50` is a deletion-path read fan-out
  — not a bug — and not worth rewriting outside a broader perf pass.
  6/7 sites would need inline disables if the rule were enabled, so
  adoption would mostly add suppression noise. The other deferred
  Leaf 13 rule, `no-param-reassign` with `{ props: true }`, is not
  part of this slice and remains parked.

### 2026-05-19 — Leaf 13b: `no-param-reassign` Props Re-Triage

Follow-up: `docs/agent_notes/backlog/lint-followups/13-core-footgun-deferred-rules.md`.
Branch: `feature/lint-hardening-leaf-13b-no-param-reassign-props`.

Outcome: **defer option for this scope**.

- Rule: `no-param-reassign` with `{ props: true }` remains off; the
  default `no-param-reassign` shape with `props: false` stays adopted
  from Leaf 10.
- Scope: `scripts/**/*.ts`, `packages/client/src/**/*.{ts,tsx}`,
  `packages/server/src/**/*.ts`, and `packages/shared/src/**/*.ts`,
  excluding tests except the intentional
  `packages/client/src/test/mock-trpc.tsx` helper.
- Findings: 17 total, classified as 9 intentional-helper-state,
  4 canvas-mutation, 2 accumulator, 1 prisma-update-input, 1 mock-state,
  0 other. The exact probe matched the expected branch total.
- Verdict: defer the `{ props: true }` option for this scope.
- Reasoning: every current hit is an intentional mutation boundary:
  CLI parser state passed to option consumers, Canvas 2D context property
  writes, lazy project-cache/compiler-path accumulator helpers, a
  documented Prisma dynamic update input boundary, or mock fixture state.
  The inventory found no genuine bug and no obvious 1-2 line
  bug-prevention rewrite, so adoption would mostly add inline disables
  or return-new-state style churn.
- Follow-up: "Defer `no-param-reassign` with `{ props: true }` — all 17 current findings are intentional canvas/API/helper-state/Prisma/mock mutations, so enabling it would mostly add suppressions or style rewrites with no surfaced bug-prevention value."

### 2026-05-19 — Leaf 15 (set-state-in-effect)

Follow-up: `docs/agent_notes/backlog/lint-followups/15-react-deferred-rules.md`.
Branch: `feature/lint-hardening-leaf-15-react-set-state-in-effect`.

Outcome: **defer rule for this scope**.

- Rule: `react-hooks/set-state-in-effect` remains off in
  `eslint.config.js`.
- Scope: `packages/client/src/**/*.{ts,tsx}`, excluding tests; no test
  files produced findings.
- Findings: 24 total, classified as 11 dialog-reset,
  6 props-to-local-state, 5 external-system-sync, 0 derived-state,
  0 cleanup-reset, 2 other. The exact probe matched the expected branch
  total and is +1 from Leaf 14's 23-warning inventory.
- Verdict: defer the rule for this client source scope.
- Reasoning: current hits are intentional dialog resets, editable local
  draft synchronization, browser/socket resource bridges, or
  non-trivial state-machine resets. The rule still cannot distinguish
  those accepted patterns from its target bug class without broad
  disables or a larger UI state-pattern refactor, and the inventory
  found no genuine bug or obvious 1-2 line bug-prevention cleanup.
- Follow-up: "Defer `react-hooks/set-state-in-effect` for the client source scope — all 24 current findings are intentional dialog resets, props-to-local draft sync, external resource/socket bridges, or non-trivial state-machine resets, so enabling it now would require broad disables or behavior refactors without surfacing a clear bug."

### 2026-05-19 — Leaf 15b (jsx-no-leaked-render)

Follow-up: `docs/agent_notes/backlog/lint-followups/15-react-deferred-rules.md`.
Branch: `feature/lint-hardening-leaf-15b-jsx-no-leaked-render`.

Outcome: **defer rule for this scope**.

- Rule: `react/jsx-no-leaked-render` remains off in `eslint.config.js`.
- Scope: `packages/client/src/**/*.tsx`.
- Findings: 87 total across 38 files, unchanged from the prior inventory.
  A 35-site sample classified as 3 attribute-boolean,
  0 string-array-length, 9 nullable-object, 9 truthy-string,
  0 actual-bug, 14 other.
- Verdict: defer the rule for this client TSX scope.
- Reasoning: sampled sites are React-safe JSX attribute booleans,
  nullable object/query guards, optional string guards, and boolean or
  comparison child guards. The rule still cannot separate those accepted
  patterns from bare numeric render leaks. In `eslint-plugin-react@7.37.5`,
  the schema still only exposes `validStrategies: ["ternary", "coerce"]`
  and no `allowExpressions` option.
- Follow-up: "Defer `react/jsx-no-leaked-render` for the client TSX scope — the fresh probe still reports 87 findings, the sampled sites are React-safe attribute, nullable-object, optional-string, and boolean/comparison guards with 0 actual leaked-render bugs, and eslint-plugin-react v7.37.5 still has no `allowExpressions` option to separate those patterns from bare numeric render leaks."

### 2026-05-19 — Leaf 14a (clock primitives)

Follow-up: `docs/agent_notes/backlog/lint-followups/14-restricted-primitives.md`.
Branch: `feature/lint-hardening-leaf-14a-clock-primitives`.

Outcome: **defer until sanctioned clock helper exists**.

- Candidate: raw clock primitives (`Date.now()`, `new Date(`) in production
  `packages/shared/src/**` and `packages/server/src/**`, excluding tests and
  test helpers.
- Findings: 0 shared rows and 20 server rows after the explicit
  `*-test-helper.ts` exclude; the legacy probe shape reports 22 server rows
  because `level-up-test-helper.ts` contributes two test-helper false
  positives. Production rows classify as 7 input-date-parsing,
  3 persisted-now-write, 3 expiry-computation, 3 expiry-comparison,
  2 rate-limit-window, 2 logging-timestamp, and 0 other. The 20 rows contain
  23 raw primitive expression matches because three expiry computations use
  `new Date(Date.now() + ...)`.
- Verdict: defer a raw clock primitive ban for this shared/server scope.
- Reasoning: the policy requires the diagnostic to name the sanctioned
  alternative, and no `Clock` boundary exists yet. A naive `new Date(` ban
  would false-positive on parsed cursor/date-field constructors, while the
  genuine clock reads need `Clock.now()` / `Clock.nowMs()` threaded through
  server context, service factories, and rate-limit construction before the
  rule can offer a repair path.
- Follow-up: "Defer a raw clock primitive ban until a sanctioned `Clock` helper exists — the current production probe has 20 server rows, including 7 input-date-parsing false positives for a naive `new Date(` ban, and the genuine clock reads need `Clock.now()` / `Clock.nowMs()` threaded through service context before a diagnostic can name a repair path."

### 2026-05-19 — Leaf 14b (process.env)

Follow-up: `docs/agent_notes/backlog/lint-followups/14-restricted-primitives.md`.
Branch: `feature/lint-hardening-leaf-14b-process-env`.

Outcome: **adopt full with scoped allowlist caveats**.

- Candidate: raw `process.env` member access in production
  `packages/shared/src/**`, `packages/server/src/**`, and `scripts/**`,
  excluding tests, test helpers, and `packages/server/src/generated/**`.
- Findings: 0 shared rows. Server production had one unsanctioned row,
  `packages/server/src/prisma/client.ts` reading `DATABASE_POOL_MAX`;
  it moved into `loadServerEnv` as an optional positive integer and is now
  consumed through `serverEnv.databasePoolMax`. Remaining rows are sanctioned:
  the env helper default source, the db-status admin display tool, and
  child-process spawn `env: process.env` pass-through scripts.
- Verdict: adopt the `no-restricted-syntax` selector
  `MemberExpression[object.name='process'][property.name='env']` with named
  allowlist files.
- Reasoning: the diagnostic can name the repair path (`serverEnv` / add the
  key in `packages/server/src/config/env.ts`) and the only production config
  read outside the helper had a small schema-backed rewrite. The shared
  override intentionally disables the whole restricted-syntax rule for named
  files, so some entries receive both the `process.exit` and `process.env`
  bypass even when they only need one. Test/helper/e2e setup files keep the
  `process.exit(...)` selector while allowing env setup reads outside the
  production ban.
- Follow-up: "Adopt the `process.env` ban: `loadServerEnv` is the sanctioned reader, one production site (`prisma/client.ts`) moves into the env schema, and the existing `no-restricted-syntax` allowlist extends to cover the child-process spawn pass-through scripts."

### 2026-05-19 — Leaf 14c (raw fetch)

Follow-up: `docs/agent_notes/backlog/lint-followups/14-restricted-primitives.md`.
Branch: `feature/lint-hardening-leaf-14c-raw-fetch`.

Outcome: **adopt full with scoped allowlist caveats**.

- Candidate: raw global `fetch(...)` calls in production
  `packages/shared/src/**`, `packages/server/src/**`,
  `packages/client/src/**`, and `scripts/**`, excluding tests, test helpers,
  and `packages/server/src/generated/**`.
- Findings: 0 shared rows and 0 script rows. Server has three textual
  `fetch(` rows in `packages/server/src/utils/srd-query-helpers.ts`, but all
  call a shadowing DI parameter and are not global fetch sites. Client has two
  sanctioned bare global fetch calls: the auth-token refresh endpoint in
  `packages/client/src/lib/trpc.ts` and the multipart map-image upload in
  `packages/client/src/hooks/use-map-image-upload.ts`. The tRPC object method
  named `fetch` and explicit `globalThis.fetch(...)` calls are not reported by
  `no-restricted-globals`.
- Verdict: adopt `no-restricted-globals` for `fetch` across client/server
  source with a named allowlist for the two sanctioned client boundary files.
- Reasoning: the diagnostic can name the repair path for app API calls
  (tRPC via `packages/client/src/lib/trpc.ts`) while allowing the framework
  refresh/upload boundaries. `no-restricted-globals` matches the intended
  semantics because it reports only unresolved global identifiers; a
  `no-restricted-syntax` `CallExpression[callee.name='fetch']` selector would
  false-positive on the server DI parameter.
- Follow-up: "Adopt the raw-fetch ban via `no-restricted-globals`: the inventory shows 0 sites in shared/server/scripts and only 2 sanctioned client sites (auth-token refresh and multipart map-image upload), both of which the allowlist override covers explicitly."
- Caveat (codex review [P2], merge 36250691): `no-restricted-globals` only
  reports the bare global identifier, so `globalThis.fetch(...)` and
  `window.fetch(...)` member expressions outside the allowlisted boundary
  files would slip past. This was the explicit design trade-off so the
  framework escape hatch in `lib/trpc.ts` doesn't false-positive. Inventory
  shows 0 such sites in production code; revisit if a member-expression
  fetch lands outside the allowlist.

### 2026-05-19 — Leaf 21 (assertion-quality lint rule)

Branch: `feature/lint-hardening-leaf-21-assertion-quality`.

Outcome: **defer after inventory**.

- Candidate: a local Musi-specific lint rule to prevent regressions from
  `expectParseSuccess` / `expectParseFailure` back to raw Zod parse-result
  boolean assertions.
- Findings: helper usage has soaked across 38 files. There are 0 raw
  `.safeParse(...).success` test assertion sites and 0
  `.safeParseAsync(...).success` rows. The only direct
  `.safeParse(...).success` row is a production Zod `.refine(...)` predicate
  in `packages/shared/src/schemas/map-inputs.ts:36`.
- Verdict: defer the local rule. The current target pattern is absent, while
  the nearby `.success` rows are tRPC response-body `{ success: boolean }`
  assertions, a `toast.success` spy assertion, or post-helper Zod result
  narrowing guards for data/error detail assertions.
- Reasoning: a rule narrow enough to be correct currently has nothing to
  flag, and a generic `.success` assertion rule would false-positive on
  unrelated result shapes and legitimate narrowing. Revisit after a
  code-review/postmortem catches a regression to the old pattern or after a
  wider parse-result helper surface such as `safeParseAsync(...)` needs lint
  protection.

### 2026-05-19 — Leaf 19 slice 1 (`scripts/lint-rule-docs.ts` coverage)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: `feature/lint-hardening-leaf-19-lint-rule-docs`.

Outcome: **adopt full** for this one file.

- Candidate: extend ESLint coverage to one additional `tsconfig.scripts.json`
  input — the shared `local/*` `meta.docs` loader at
  `scripts/lint-rule-docs.ts`.
- Findings: 0 ESLint findings before adoption. No code changes required.
- Verdict: enable lint coverage via three narrow `eslint.config.js`
  additions (ignore exemption, scripts parser-options block,
  `local/type-assertion-boundary` block).
- Reasoning: the file is the shared loader behind the PR 1 `meta.docs`
  contract, consumed by `scripts/generate-lint-guidance.ts` (already
  linted), `scripts/generate-harness-controls.ts`, and
  `scripts/lint-agent.ts`. Mirroring the linted sibling closes a one-file
  gap without expanding into broader script families that remain parked.
- Follow-up: the next narrow candidate was
  `scripts/generate-harness-controls.ts`, probed immediately as Leaf 19
  slice 2 — see the next entry for the deferral. The broader script
  families (codemods, drift-ai, logs-audit) remain parked in Leaf 11 and
  the rest of Leaf 19.

### 2026-05-19 — Leaf 19 slice 3 (`scripts/lint-ratchet-config.ts` coverage)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: `feature/lint-hardening-leaf-19-lint-ratchet-config`.

Outcome: **adopt full** for this one file.

- Candidate: extend ESLint coverage to `scripts/lint-ratchet-config.ts`,
  the central configuration module for the PR 4 lint ratchet
  (`scripts/lint-ratchet.ts`, `scripts/lint-ratchet-baseline.ts`).
- Findings: 0 ESLint findings before adoption. 166 lines, well under
  the 300 `local/max-lines` ceiling.
- Verdict: enable lint coverage via three narrow `eslint.config.js`
  additions (ignore exemption, scripts parser-options block,
  `local/type-assertion-boundary` block).
- Reasoning: the file is the central ratchet configuration module that
  pairs with already-linted scripts in `scripts/code-intel/**`. Closes
  another single-file gap with no architectural blockers.
- Follow-up: the remaining ratchet runtime files (`lint-ratchet.ts` at
  846 lines, `lint-ratchet-baseline.ts` at 880, `harness-check.ts` at
  529, `lint-agent.ts` at 332) all likely surface `local/max-lines`
  and/or complexity findings — same shape as slice 2's deferral. They
  need explicit budget to either split or take warn-only overrides.

### 2026-05-19 — Leaf 19 slice 2 (`scripts/generate-harness-controls.ts` deferral)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: `feature/lint-hardening-leaf-19-generate-harness-controls`.

Outcome: **defer after inventory**.

- Candidate: extend ESLint coverage to `scripts/generate-harness-controls.ts`
  as the next sibling of the already-linted scripts subset.
- Findings: 2 ESLint errors before adoption — `resolveNonLintControl`
  cyclomatic complexity 13 vs the 10 ceiling, and 384 effective lines vs
  the 300 `local/max-lines` ceiling.
- Verdict: defer. The probe was reverted; no production or config
  changes landed.
- Reasoning: both findings would need either structural refactoring
  (helper extraction, module splitting) or a targeted warn-only
  `local/max-lines` override entered above the current line count. The
  `local/max-lines` diagnostic itself offers either repair path; both
  are local debt decisions the autonomous slice declined to make on its
  own judgment alone. Revisit when a planned refactor of the generator
  lands on its own, when the repo changes the relevant ceilings, or when
  a future leaf has explicit budget to pick the repair and pair it with
  coverage adoption.

### 2026-05-19 — Leaf 19 slice 4 (`scripts/code-intel-server.ts` + `scripts/logs-audit.test.ts` coverage)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: `feature/lint-hardening-leaf-19-code-intel-entry-and-logs-audit-test`.

Outcome: **adopt subset** (two files adopted, one carved out).

- Candidates probed: `scripts/code-intel.ts` (136 lines),
  `scripts/code-intel-server.ts` (4 lines),
  `scripts/logs-audit.test.ts` (273 lines).
- Findings: `code-intel-server.ts` and `logs-audit.test.ts` both probed
  at 0 ESLint findings. `code-intel.ts` produced 10 errors — 1
  autofixable `simple-import-sort/exports` reorder plus 9
  `@typescript-eslint/consistent-type-imports` violations on
  `typeof import("./code-intel/...")` annotations.
- Verdict: adopt `code-intel-server.ts` and `logs-audit.test.ts` via
  the standard three narrow `eslint.config.js` additions (ignore
  exemption, scripts parser-options block,
  `local/type-assertion-boundary` block). Carve `code-intel.ts` out for
  a future leaf.
- Reasoning: converting the `typeof import()` annotations to top-level
  `import type` declarations is a structural rewrite, not a mechanical
  edit — the file uses these typeof-import shapes deliberately for
  deferred module-loading metadata. Mirrors the slice 2 deferral
  pattern. Revisit when a planned refactor of the code-intel facade
  lands or when a future leaf has explicit budget for the rewrite.

### 2026-05-19 — Leaf 19 slice 5 (drift-ai small-module subset coverage)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: `feature/lint-hardening-leaf-19-drift-ai-small-modules`.

Outcome: **adopt subset** (3 of 16 `drift-ai/` files).

- Candidates: `scripts/drift-ai/**/*.ts` glob.
- Findings: 0 ESLint findings for 3 files (`errors.ts`, `scope.ts`,
  `scope.test.ts`). Four other under-ceiling files exposed findings
  after a codex review correction added the required directory
  unignore (`!scripts/drift-ai/`): `current-inventory.ts` and
  `current-inventory.test.ts` autofixable `simple-import-sort/imports`,
  `harness-freshness.test.ts` `explicit-function-return-type`, and
  `comments.ts` complexity 21 plus
  `restrict-template-expressions`/`regexp/no-unused-capturing-group`.
  Probe of the whole glob would also surface `local/max-lines` on 9
  more files (332–696 lines): `suppressions.test.ts`,
  `harness-freshness.ts`, `comments.test.ts`, `suppressions.ts`,
  `config.ts`, `duplicates.ts`, `ghost-files.ts`,
  `ghost-files.test.ts`, `duplicates.test.ts`.
- Verdict: adopt the 3 clean files via the standard `eslint.config.js`
  additions plus a `!scripts/drift-ai/` directory unignore. Defer
  the 4 finding-bearing under-ceiling files and the 9 oversized files
  to a future leaf with explicit budget.
- Reasoning: per the slice 2 deferral pattern, the autonomous slice
  doesn't pick autofix applications, type-annotation additions,
  structural splits, or warn-only overrides on its own. The codex
  review caught that file-level negations without a directory
  unignore silently bypass the full-repo lint walk — important
  gotcha to record for future single-file slices in scripts/.
  Revisit the whole-glob adoption when the oversized files come
  under the ceiling and the finding-bearing files are repaired.

### 2026-05-19 — Leaf 19 probe deferral (top-level scripts outside tsconfig)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: deleted after the probe (no commits landed).

Outcome: **defer after inventory**.

- Candidates: three under-ceiling top-level `scripts/*.ts` files —
  `db-status.ts` (102), `harness-emit-envelope.ts` (172),
  `sensor-blob-size.test.ts` (195).
- Findings: parse error before lint runs; none are listed in
  `tsconfig.scripts.json` or any root tsconfig. The
  `harness-emit-envelope.ts` reference in test:scripts smoke
  subjects confirms the file is live, just outside the project graph.
- Verdict: defer. Adopting requires first adding entries to
  `tsconfig.scripts.json` and dealing with any latent type errors
  surfaced — a project-shape decision the autonomous slice declined.
- Reasoning: the slice 2 deferral pattern. Pair the tsconfig
  change with a future leaf with explicit budget. Alternative is a
  separate non-type-aware lint flavor for ad-hoc Bun scripts, which
  is itself a design decision and not in this slice's scope.

### 2026-05-19 — Leaf 19 probe deferral (codemod test files)

Follow-up: `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`.
Branch: deleted after the probe (no commits landed).

Outcome: **defer after inventory**.

- Candidates: `scripts/codemods/concurrency-guard.test.ts`,
  `expand-barrel.test.ts`, `structured-logging-fix.test.ts`,
  `trpc-shared-schema-codemod.test.ts` (191–234 lines each, all
  under ceiling, all already in `tsconfig.scripts.json`).
- Findings: 20 ESLint errors total across the four files in
  repeating shapes: `@typescript-eslint/no-confusing-void-expression`
  (arrow returns), `@typescript-eslint/only-throw-error` (throw
  literal), `vitest/expect-expect` (codemod-shape tests without
  inline asserts), and one autofixable
  `simple-import-sort/imports` reorder.
- Verdict: defer. The `only-throw-error` and `expect-expect`
  repairs change test semantics; the void-expression brace fixes
  need per-site review; the autofix is still a code change.
- Reasoning: folds naturally into Leaf 11's parked codemod-coverage
  decision or a future test-quality leaf. Mirrors the slice 5
  carve-out pattern: autonomous slice declines to apply autofixes
  or modify test assertions on its own judgment alone.

## Pending Evaluations

The following leaves are expected to add rows here if they reject, defer after
inventory, subset-adopt candidates, or fully adopt with caveats/scoped
exceptions:

- Leaf 3: `@vitest/eslint-plugin`, `eslint-plugin-testing-library`,
  `eslint-plugin-jest-dom`.
- Leaves 5/13/14: jsx-a11y, main React rules, broadened react-hooks.
- Leaf 6: `@tanstack/eslint-plugin-query`.
- Leaf 9/10: stricter `typescript-eslint` and core ESLint opt-ins.
- Leaf 11/12: restricted primitives and type-assertion boundary lint.
- Leaf 4: eslint-comments hygiene.
- Leaf 17: JSON lint.
- Leaf 21: regexp plugin.
- Leaf 8: scripts ESLint coverage, if any script family is scoped out or
  deferred.
- Leaf 27: any future unicorn / sonarjs / promise cherry-pick.

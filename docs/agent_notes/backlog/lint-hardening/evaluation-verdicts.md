# Lint Hardening Evaluation Verdict Register

Status: Central register
Last updated: 2026-05-17

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

### 2026-05-16 - Leaf 23 generated lint guidance spike

Source:
`docs/agent_notes/backlog/lint-hardening/23-llm-core-generated-lint-guidance-spike.md`.

Outcome: spike landed; KEEP / DROP / FOLD decision pending after a few rule
changes.

- `principle` field added to local/{structured-logging, no-barrel,
  strict-trpc-input}.
- Generator: `scripts/generate-lint-guidance.ts`; outputs
  `docs/generated/local-lint-rules.md`.
- Scripts: `bun run docs:lint-guidance` (write),
  `bun run docs:lint-guidance:check` (CI freshness).
- Smoke test: `scripts/test-generate-lint-guidance.sh`.
- Linked from `docs/ai-harness.md`.
- Decision: keep through one or two rule diffs; if the principle field does
  not drift and the generated doc stays useful, expand to all local rules and
  revisit Leaf 25 metadata schema. If the principle field rots, drop and
  revisit Leaf 25 alone.

### 2026-05-16 - Leaf 19 `import-x/no-extraneous-dependencies`

Source: `docs/agent_notes/backlog/lint-hardening/19-package-dependency-policy.md`
and
`docs/agent_notes/finished_work/lint-hardening-leaf-19-import-x-inventory.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/19-package-dependency-policy.md`
and
`docs/agent_notes/finished_work/lint-hardening-leaf-19-import-x-inventory.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/22-llm-core-rule-message-guidance.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/21-regexp-plugin.md` and
`docs/agent_notes/finished_work/lint-hardening-leaf-21-regexp-inventory.md`.

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

### 2026-05-16 - Leaf 13 `react/jsx-no-leaked-render`

Source: `docs/agent_notes/backlog/lint-hardening/13-eslint-plugin-react.md`
and
`docs/agent_notes/finished_work/lint-hardening-leaf-13-eslint-plugin-react-inventory.md`.

Outcome: defer after inventory.

- `react/jsx-no-leaked-render`: Deferred. Evidence: 87 findings in
  `eslint-plugin-react@7.37.5`; the rule has no `allowExpressions` option and
  flags JSX-attribute boolean expressions as false-positive noise. Revisit
  only if a narrower scope or upstream rule improvement appears.

### 2026-05-16 - Leaf 14 `react-hooks/set-state-in-effect`

Source: `docs/agent_notes/backlog/lint-hardening/14-react-hooks-broadened.md`
and
`docs/agent_notes/finished_work/lint-hardening-leaf-14-react-hooks-inventory.md`.

Outcome: defer after inventory.

- `react-hooks/set-state-in-effect`: Deferred. Evidence: 23 findings in
  established props-to-local-state, dialog reset, and external-system sync
  patterns. Promoting this rule requires a UI-wide refactor, not a focused
  lint-hardening cleanup. Revisit when those patterns have a shared design and
  targeted route/dialog tests to prove the behavior change.

### 2026-05-16 - Leaf 9 `typescript-eslint` Stricter Opt-Ins

Source: `docs/agent_notes/backlog/lint-hardening/09-ts-eslint-stricter-optins.md`
and
`docs/agent_notes/finished_work/lint-hardening-leaf-9-ts-eslint-strict-inventory.md`.

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
  disables. `@typescript-eslint/strict-boolean-expressions` remains deferred
  with 423 case-by-case findings.

### 2026-05-16 - Leaf 10 Core ESLint AI-Footgun Rules

Source: `docs/agent_notes/backlog/lint-hardening/10-builtin-ai-footgun-rules.md`
and
`docs/agent_notes/finished_work/lint-hardening-leaf-10-core-eslint-ai-footgun-inventory.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/17-json-lint-eslint-json.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/05-jsx-a11y.md` and
`docs/agent_notes/finished_work/lint-hardening-leaf-5-jsx-a11y-inventory.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/08-scripts-eslint-coverage.md`
and `docs/agent_notes/in_progress/lint-hardening-leaf-8-codemods.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/07-knip-unused-export-sensor.md`
and `docs/agent_notes/finished_work/lint-hardening-leaf-7-knip-inventory.md`.

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

Source: `docs/agent_notes/in_progress/eslint-llm-parked-rules-verification.md`.
Leaf 24 carries the two hand-fix follow-ups.

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

Source: `docs/agent_notes/backlog/lint-hardening/15-assertion-failure-quality.md`.

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

Source: `docs/agent_notes/backlog/lint-hardening/24-llm-core-parked-rules-followups.md`.

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

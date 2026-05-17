# Lint Hardening Cross-Repo Review

Date: 2026-05-16 (extended)
Status: Parked index
Source: Direct review of external reference repos `ma-toki` and `hookrail`
checked out under temporary local paths at the time of writing, plus Musi
lint and harness state. Detailed provenance lives in
`lint-hardening/00-context-and-rollout.md`; evaluation verdicts live in
`lint-hardening/evaluation-verdicts.md`.

This is the start-here index for the lint-hardening backlog. Do not promote
this whole plan. Promote exactly one leaf file from `lint-hardening/`, copy
only that leaf's ready-now slice into `NEXT.md`, and leave the rest parked
until a human asks for the next iteration.

**The breadth is deliberate.** This backlog is a parking lot of evaluated
candidates, not a sequential implementation plan. It exists because lint for
AI-authored TypeScript is an under-explored design space, and the explicit
intent is to keep a wide menu of plausible-but-unverified leaves so future
agents can pick the highest-leverage one given current evidence. Several
plugin leaves will likely end with a "reject", "defer after inventory", or
"adopt narrow subset" verdict after inventory — that is a successful outcome,
not failure to land the leaf. Do *not* read this index as a TODO list and do
*not* attempt to drain it; promote one leaf, finish it, return for the next.

TL;DR: Musi already has strong type-aware lint plus local architecture rules.
The next iteration adds: a deterministic warning gate, staged-content
correctness, a Vitest/Testing-Library/jest-dom test-quality block, a React
accessibility and correctness block (jsx-a11y, eslint-plugin-react, broader
react-hooks), a TanStack Query block, named-path primitive and
type-assertion tripwires, a small set of high-signal core ESLint and
typescript-eslint opt-ins aimed at AI mistakes, and a handful of structural
sensors (knip, ASCII/smart-character, blob-size, spell-check, harness
freshness, commitlint, JSON lint).

## How To Use

- Read this index to choose the next leaf.
- If `docs/agent_notes/NEXT.md` does not already name a promoted
  lint-hardening leaf, stop unless a human has asked for the next
  lint-hardening cycle. When that happens, follow the fresh-checkout
  preflight in `NEXT.md` before promoting exactly one leaf or narrow slice.
- Read only the chosen leaf file before implementation.
- If a leaf bundles multiple evaluations, promote only the narrow slice that
  fits one iteration into `NEXT.md` (for example, Vitest first; Testing
  Library and jest-dom as later scoped slices).
- Keep `NEXT.md` to one promoted lint-hardening slice unless a human
  explicitly authorizes parallel work; parallel leaves need separate
  branches/sessions because many touch `eslint.config.js` or broad cleanup
  surfaces.
- Read `lint-hardening/00-context-and-rollout.md` only when provenance from
  `ma-toki` / `hookrail` matters.
- Keep new rules or sensors report-only until their baseline, repair path,
  and tests are known.
- When a candidate is rejected, deferred after inventory, adopted only as a
  subset, or fully adopted with caveats/scoped exceptions, append a row to
  `lint-hardening/evaluation-verdicts.md` and link the local leaf/audit that
  has the detailed walkthrough.
- After a leaf lands, update `LOG.md`, `STATUS.md` / `NEXT.md` if the
  promotion pointer changed, and the specific leaf file if follow-up state
  changed.

## Operating Principles

1. **Sanctioned-path rule.** A primitive ban requires a named sanctioned
   helper, wrapper, or scoped boundary. If the diagnostic cannot say "use X
   instead", write the helper first.
2. **Zero-warning target.** Stable ESLint rules should be `error` or
   otherwise fail the lint command. Experiments should be report-only, not
   long-lived `warn` rules that contributors must notice manually.
   Throwaway local `warn` configs are fine for inventory, but do not commit
   warning-severity experiments unless the leaf explicitly calls that out as a
   temporary migration step with a named follow-up.
3. **Diagnostic quality over config legibility.** Contributors and AI
   agents are not expected to read `eslint.config.js`. They are expected to
   read the diagnostic when lint fails. Optimise rule rollout for the
   *failure-time* experience: every rule should have a clear message and,
   where possible, a named alternative or guide reference.
4. **Fix real findings; scope, defer, or reject rules that cannot explain a
   real bug or smell.** The intent of this workstream is to improve code
   quality, not to maximise rule count. Four responses are valid when a rule
   fires:
   - **Fix the code.** This is the right response for strong-semantic rules
     (the local Musi rules, `typescript-eslint` correctness rules,
     accessibility rules with clear remediation) and for any finding that
     points to a real bug.
   - **Scope-silence with a reasoned disable.** Use
     `// eslint-disable-next-line <rule> -- <reason>` only when the
     intent is correct and the rule cannot reasonably be narrowed. Do not
     weaken the rule globally to avoid churn — global weakening cancels the
     leverage.
   - **Scope or reject the rule.** For broad ecosystem-plugin rules, repeat
     false positives are signal about rule fit, not signal to disable
     everywhere. Drop the rule from the chosen subset and record the
     verdict in the leaf and in
     `lint-hardening/evaluation-verdicts.md`. Particularly relevant for
     plugin presets where some rules are correctness and some are pure style.
   - **Defer after inventory.** If the findings are too unclear to classify in
     one leaf, do not guess and do not enable the rule as a "maybe". Record the
     inventory, the unresolved questions, and the revisit trigger in
     `lint-hardening/evaluation-verdicts.md`, then park the rule for a future
     evaluation.
5. **Report-only shape for sensors.** Follow the current `drift:ai`
   pattern: readable text on stdout, warnings or pointers on stderr,
   `--format json`, optional `--output`, and no failing exit while the
   sensor is report-only. Add a checked mode or wrapper only after the
   baseline is clean. Do not invent a fake `--json` flag and do not treat
   `drift:ai --check` as an exit-status switch — today it selects which
   detector checks to run.

Do not promote new lint ideas directly into `verify:changed` or
pre-commit. Add one small lint leaf at a time. The failure mode to avoid is a
"drain the backlog" pass: once one promoted slice lands, stop and wait for the
next human-requested cycle.

## Current Snapshot

- Type-aware ESLint is enabled through `typescript-eslint` strict checked
  config.
- Local rules already cover async array callbacks, swallowed console-only
  catches, explicit `any`, tRPC schemas, socket broadcasts, Prisma
  concurrency, shared runtime neutrality, e2e selector shape, max effective
  lines, and test file location.
- Suppression hygiene already exists through
  `scripts/eslint-disable-register.sh` and
  `bun run drift:ai --check suppressions`.
- Vitest is installed, but `@vitest/eslint-plugin` is not in `package.json`
  or `eslint.config.js`.
- `eslint-plugin-react-hooks` is installed but only `rules-of-hooks` and
  `exhaustive-deps` are enabled.
- `eslint-plugin-jsx-a11y`, the main `eslint-plugin-react`,
  `@tanstack/eslint-plugin-query`, `eslint-plugin-testing-library`,
  `eslint-plugin-jest-dom`, `eslint-plugin-regexp`, `@eslint/json`,
  `@eslint-community/eslint-plugin-eslint-comments`, and `commitlint` are
  not installed.
- Most of `scripts/**/*.ts` is excluded from lint despite being covered by
  `tsconfig.scripts.json`. Only `scripts/code-intel/**/*.ts` is re-included.
- `bun run lint` and `bun run lint:changed` do not pass
  `--max-warnings=0`.
- A 2026-05-16 `bun run lint -- --max-warnings=0` probe found 102
  warnings: 100 `no-magic-numbers` warnings in prepared-spell tables plus
  two `local/max-lines` warnings.
- `scripts/lint-changed.sh` currently lints working-tree changed files. It
  does not reject partially staged lint targets, so pre-commit can verify
  different content than the staged commit.
- `.husky/pre-commit` uses `--diff-filter=ACMR` for source-relevant work,
  so pure staged deletions do not force the relevant changed checks.
- Husky has no `commit-msg` hook; conventional-commit convention is
  documented but not enforced.
- Tailwind v4 is in use, but no v4-aware Tailwind ESLint plugin is wired
  up (upstream `eslint-plugin-tailwindcss` still has partial v4 support;
  see Leaf 26).
- Missing adjacent sensors: spell-check, ASCII/smart-character check for
  hot docs, staged blob-size policy, package manifest policy, knip
  unused-export sensor, and `docs/ai-harness.md` freshness.

## Known AI Footguns And Owners

- Mocked database in tests: deferred until a sharper policy can name the
  replacement helper family (`createTestApp`, `cleanDb`, `createTestUser`,
  `test-db`, or a module-specific pure resolver seam). Tracked here so it
  does not get lost. Revisit after a mocked-DB/prod-divergence postmortem,
  when a module family has a named replacement helper, or when newly added
  mocked-DB tests make the drift visible again.
- `as X` type assertions outside sanctioned boundaries: Leaf 12.
- `process.exit(...)` outside CLI entry points: Leaf 11.
- Raw `fetch(...)` bypassing tRPC/client helpers: Leaf 11.
- Swallowed console-only catches: already linted (`no-swallowed-errors`).
- Async callbacks passed to array methods: already linted
  (`no-async-array-callbacks`).
- Broadcast inside a Prisma transaction: already linted
  (`no-broadcast-in-transaction`).
- Socket broadcasts bypassing the registry: already linted
  (`socket-registry-broadcasts`).
- tRPC routers missing shared input/output schemas: already linted
  (`strict-trpc-input`, `trpc-shared-input-schema`,
  `trpc-shared-output-schema`, `trpc-require-output-schema`).
- `expect(...success).toBe(true)`-style Zod parse assertions: Leaf 15.
- Focused/skipped tests checked in: Leaf 3.
- Vacuous conditional expectations that can silently skip a test premise:
  Leaf 3b, using the mixed `vitest/no-conditional-expect` inventory recorded
  in `lint-hardening/evaluation-verdicts.md`.
- Magic numbers in rules tables and oversized files: already linted
  (`no-magic-numbers` with reference-table exception, `local/max-lines`),
  but Leaf 1 decides whether warning behavior becomes a hard gate.
- Inaccessible JSX (clickable `div`, missing `alt`, invalid ARIA, unlabeled
  controls): Leaf 5.
- Missing React keys, useState setters used as state, unstable nested
  components: Leaf 13.
- React-hook purity, set-state-in-effect/render, refs misuse: Leaf 14.
- TanStack Query key dependency omissions, whole query/mutation result
  objects in React dependency arrays, unstable `QueryClient` construction,
  and query functions returning `void`: Leaf 6.
- Non-exhaustive `switch` over a discriminated union after a new variant
  is added: Leaf 9 (`switch-exhaustiveness-check`).
- Truthiness bugs on nullable/numeric/string values: Leaf 9
  (`strict-boolean-expressions`).
- Constant binary expressions, `await` in a loop where `Promise.all` is
  correct, parameter reassignment, `parseInt` without radix: Leaf 10.
- AI-generated dead exports / orphan helper files / unused workspace
  dependencies: Leaf 7 (`knip` sensor).
- Brittle regexes (catastrophic backtracking, misleading character
  classes): Leaf 21.
- Direct `process.env`, direct clocks, and raw timers in deterministic
  code: deferred until sanctioned helpers exist.
- Re-implementing existing utilities: out of scope for lint; use
  `code:intel` and discovery instead. Knip (Leaf 7) catches the
  *dead-helper* side.

Anything not on this list is either out of scope or unknown — if a new
footgun shows up in a postmortem, add it here before writing a rule for
it.

## Leaf Index

### Core gates and correctness

1. `lint-hardening/01-zero-warning-lint-gate.md` — clean the current
   warning baseline and make warning behavior deterministic.
2. `lint-hardening/02-changed-gate-content-correctness.md` — make
   `lint:changed`, `verify:changed`, and pre-commit verify the staged
   commit content.
3. `lint-hardening/03-vitest-test-quality-rules.md` —
   `@vitest/eslint-plugin` first; Testing Library and jest-dom are
   separate scoped follow-up slices.
3b. Leaf 3b: vacuous-conditional-expect bugs — revisit the mixed
   `vitest/no-conditional-expect` inventory from
   `lint-hardening/evaluation-verdicts.md` and fix silent-pass assertion
   branches without turning legitimate parse/concurrency patterns into churn.
4. `lint-hardening/04-eslint-comments-hygiene.md` —
   `@eslint-community/eslint-plugin-eslint-comments` plus
   `reportUnusedDisableDirectives`.

### Accessibility and query plugins

5. `lint-hardening/05-jsx-a11y.md` — `eslint-plugin-jsx-a11y` for
   client JSX (high leverage, well-scoped).
6. `lint-hardening/06-tanstack-query-plugin.md` —
   `@tanstack/eslint-plugin-query`.

### Structural inventory and coverage

7. `lint-hardening/07-knip-unused-export-sensor.md` — workspace
   dead-export and unused-file scan.
7b. Leaf 7b: dead-export cleanup sweep — triage the deferred knip unused
   exports and unused exported types one finding at a time; do not bulk-delete
   by report alone.
8. `lint-hardening/08-scripts-eslint-coverage.md` — expand ESLint over
   the rest of `tsconfig.scripts.json`'s TS surface.

### Type-safety and primitive tripwires

9. `lint-hardening/09-ts-eslint-stricter-optins.md` —
   `switch-exhaustiveness-check`, `strict-boolean-expressions`,
   `prefer-readonly`, `consistent-type-exports`, `promise-function-async`.
10. `lint-hardening/10-builtin-ai-footgun-rules.md` —
    `no-constant-binary-expression`, `no-await-in-loop`, `no-param-reassign`,
    `no-self-compare`, `no-template-curly-in-string`, `no-unreachable-loop`,
    `default-case-last`, `radix`, `dot-notation`.
11. `lint-hardening/11-restricted-primitives.md` — named-path primitive
    bans, starting with `process.exit(...)`.
12. `lint-hardening/12-type-assertion-boundary-lint.md` — enforce the
    existing AGENTS.md type-assertion boundary policy.

### Broader React surface and assertion polish

13. `lint-hardening/13-eslint-plugin-react.md` — main
     `eslint-plugin-react` correctness subset (style/noise risk; inventory
     first).
14. `lint-hardening/14-react-hooks-broadened.md` — broadened
     `eslint-plugin-react-hooks` for React 19 / compiler-era checks
     (cleanup-heavy; inventory per rule).
15. `lint-hardening/15-assertion-failure-quality.md` — richer
    parse/result assertion helpers before considering a local lint rule.

### Suppressions, data-file lint, policy sensors, and regexp

16. `lint-hardening/16-suppression-register.md` — current-state register
    for TypeScript and Stryker suppressions.
17. `lint-hardening/17-json-lint-eslint-json.md` — `@eslint/json` for
    JSON/JSONC validation.
18. `lint-hardening/18-structural-sensors.md` —
    ASCII/smart-character, blob-size, spell-check, harness-inventory.
19. `lint-hardening/19-package-dependency-policy.md` — manifest and
    dependency policy plus a possible `import-x/no-extraneous-dependencies`
    companion.
20. `lint-hardening/20-commitlint-enforcement.md` — conventional commit
    enforcement via Husky `commit-msg`.
21. `lint-hardening/21-regexp-plugin.md` — `eslint-plugin-regexp`
    recommended set, after scripts coverage or scoped to already-linted TS.

### Local-rule infrastructure (carried over from earlier evaluations)

22. `lint-hardening/22-llm-core-rule-message-guidance.md` — make
    `Why:` / `How to fix:` rule diagnostics a tested convention.
23. `lint-hardening/23-llm-core-generated-lint-guidance-spike.md` —
    spike generating a sibling lint-rules doc from rule metadata so
    `docs/ai-harness.md` cannot drift from rule code.
24. `lint-hardening/24-llm-core-parked-rules-followups.md` — two small
    `.sort()` comparator fixes surfaced by the LLM-core parked-rules
    audit.
25. `lint-hardening/25-diagnostic-rule-metadata.md` — machine-readable
    metadata after at least one new rule or sensor lands. Pairs with
    Leaf 23.

### Deferred / explicit no-go

26. `lint-hardening/26-tailwind-v4-status.md` — informational; defer
    Tailwind lint until v4-aware plugins stabilise.
27. `lint-hardening/27-broad-plugin-evaluations.md` — `unicorn`,
    `sonarjs`, `promise` and similar broad presets — cherry-pick only,
    do not adopt wholesale.

## Suggested Promotion Order, Not A Queue

This order is a *suggestion*, not a queue. Pick the next leaf based on
current evidence (what's broken now, what an agent just got wrong, what
inventory is small enough to land in a single PR). A lower number does not
mean "must do next", and an empty `NEXT.md` does not authorize pulling from
this list without a human asking for the next lint-hardening iteration.
Several leaves below are explicit evaluations and may end with a "reject"
verdict. That is a successful outcome, not a skipped step. Before
re-evaluating a rule or
plugin, check `lint-hardening/evaluation-verdicts.md` for prior verdicts and
revisit triggers.

1. **Leaf 1**: zero-warning lint gate cleanup. Blocks meaningful
   rollout of anything that lands at `warn` first and unlocks the later
   plugin leaves that rely on deterministic warning behavior.
2. **Leaf 2**: changed-file lint and pre-commit content correctness. This is
   independent of Leaf 1 and can run in parallel with it when two sessions are
   available; use separate branches/sessions because both can touch shared
   verification scripts and package scripts.
3. **Leaf 3** (Vitest first, then Testing Library + jest-dom as scoped
   follow-ups): high-signal for AI-generated tests; cleanest inventory
   profile of the test-quality leaves.
   **Leaf 3b** can be promoted as a thin follow-up when
   `no-conditional-expect` silent-pass bugs are the current evidence.
4. **Leaf 4** (eslint-comments hygiene): cheap, independent, and useful
   before React/Query/TypeScript plugin rollouts create new scoped disables.
5. **Leaf 5** (jsx-a11y): high-leverage, well-scoped accessibility
   lint. Promote ahead of the broader React leaves; its rule set is the most
   defensible of the React surface.
6. **Leaf 6** (TanStack Query): correctness-focused plugin with a
   small recommended set; verify rule coverage against the table in the
   leaf before promotion.
7. **Leaf 7** (knip): moved earlier as an inventory sensor because dead
   exports and unused dependencies can otherwise add noise to script and
   type-assertion hardening.
8. **Leaf 8** (scripts ESLint coverage): close the lint hole over
   `scripts/**/*.ts` so later leaves don't have to re-explain why
   findings get hidden.
9. **Leaf 9** + **Leaf 10**: typescript-eslint stricter opt-ins and
   core AI-footgun rules. Different rule namespaces; can run in
   parallel only in separate branches/sessions because both likely touch
   `eslint.config.js` and cleanup surfaces.
10. **Leaf 11**: restricted `process.exit(...)`, then maybe raw
   `fetch(...)`.
11. **Leaf 12**: type-assertion boundary lint. Can move ahead of Leaf 11
    if Leaf 11 stalls on missing helper boundaries.
12. **Leaf 13** (`eslint-plugin-react` correctness subset): inventory
    first; expect a "subset" outcome. Promote only the rules whose
    findings explain a real bug.
13. **Leaf 14** (broadened `react-hooks`): cleanup-heavy. Inventory
    per rule; expect rule-by-rule promotion rather than wholesale
    adoption.
14. **Leaf 15**: assertion-quality helpers for Zod/result-style tests.
15. **Leaf 16**: broader current-state suppression register.
16. **Leaf 17**: `@eslint/json`. Small footprint, helps Leaf 19.
17. **Leaf 18**: structural sensors, starting with
    ASCII/smart-character and blob-size checks.
18. **Leaf 19**: package manifest policy and dependency-policy
    placement.
19. **Leaf 20**: commitlint.
20. **Leaf 21**: regexp plugin (low priority).
21. **Leaf 22** + **Leaf 23**: local-rule message-guidance tests and
    the generated lint-guidance spike. Leaf 23 is a spike; if it sticks, Leaf
    25 should consume its outcome instead of inventing a second metadata layer.
22. **Leaf 24**: the two `.sort()` comparator fixes (can be folded
    into any nearby PR).
23. **Deferred Leaf 11 bits**: direct `process.env`, direct timers,
    and clock-helper restrictions after helper boundaries exist.
24. **Leaf 25**: diagnostic/rule metadata. Promote only after deciding
    whether Leaf 23 was kept, dropped, or superseded.
25. **Leaf 26**: revisit Tailwind v4 plugins when one stabilises.
26. **Leaf 27**: any time a *specific* unicorn/sonarjs/promise rule
    becomes worth cherry-picking, evaluate per the leaf's protocol —
    not by adopting a preset.

## Adjacent Active Work

These workstreams are lint-related but live elsewhere because they have
authoritative provenance there. Treat them as inputs to this backlog,
not duplicates.

- `docs/agent_notes/in_progress/eslint-llm-core-evaluation.md` —
  evaluation of `eslint-plugin-llm-core`. Six rules already landed
  (`local/no-llm-artifacts`, the core-rule companion set,
  `local/no-async-array-callbacks`, `local/no-swallowed-errors`, plus
  policy refinements). Remaining parked items: rule-message guidance tests
  (Leaf 22) and the generated lint-guidance spike (Leaf 23).
- `docs/agent_notes/in_progress/eslint-llm-parked-rules-verification.md`
  — audit of six upstream rules deferred or rejected. Re-read before
  considering any of those rules. Leaf 24 carries the only remaining
  hand-fix follow-ups.
- `docs/agent_notes/in_progress/eslint-require-atomic-updates.md` —
  landed. `require-atomic-updates` is enabled globally; the two server
  concurrency hazards and two e2e test-state issues are fixed. Listed
  here for provenance; no upcoming work.
- `docs/agent_notes/in_progress/ai-drift-sensors.md` — conceptually
  adjacent (both target LLM-specific code drift). Drift sensors run as
  separate report-only checks rather than ESLint rules; do not fold
  into this backlog.

## Common Verification

- `bun run verify:changed`
- `bun run lint` when touching `eslint.config.js`, shared lint rules,
  or cache invalidation behavior
- `bun run lint -- --max-warnings=0` once Leaf 1 lands; useful as an
  inventory probe before then
- `bun run typecheck`
- `bun run test:scripts:changed` when touching `scripts/`, lint
  wrappers, pre-commit, or structural sensors
- `bun run vitest run --project=eslint-rules` when touching local
  ESLint rules
- `bun run drift:ai --scope current` when touching suppression policy
  or adding a structural sensor
- Targeted package tests for any cleanup performed to satisfy a new
  rule

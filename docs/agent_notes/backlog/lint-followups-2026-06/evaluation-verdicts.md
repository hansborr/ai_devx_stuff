# Lint Followups Evaluation Verdicts

Status: Active verdict register for `lint-followups-2026-06/` — not a
workable leaf; append entries as leaves produce verdicts.
Created: 2026-06-12

The predecessor register lived in
`docs/agent_notes/backlog/lint-review-2026-06/evaluation-verdicts.md`
(June 2026 entries: import-cycle detection, e2e selector plugin overlap,
drift-ai vitest pinning, drift-ai CLI policy, type-assertion boundary
narrowing, intentional ratchets). Leaf 01 archived that folder on
2026-06-12; the entries remain available in git history — do not recreate
them here. Summary: `../../finished_work/lint-review-2026-06.md`.

## Entries

### 2026-06-13 — useEffect guardrails Rec 1: react-hooks/set-state-in-effect — RATCHET ADOPTED (no-new floor)

- Verdict: the Leaf 14 (2026-05-16) and Leaf 15 (2026-05-19) **defer-for-error**
  verdicts STAND — `react-hooks/set-state-in-effect` is not promoted to a
  normal-lint `error`, and the 24 accepted sites are not rewritten. This entry
  adopts a *different* enforcement tier: a `no-new` message-count ratchet that
  freezes the current floor so finding #25 fails at commit time while cleanup
  proceeds opportunistically. It does not overturn the error-tier defer.
- Ratchet: `ratchet/react-hooks-set-state-in-effect-client`
  (`react-hooks/set-state-in-effect`, third-party `eslint-plugin-react-hooks`
  7.1.1, `pluginExport: "default"`, `minimal-ts`, `no-new`, `message-count`,
  `repairKind: "manual"`). Scope is the production client glob
  `clientSourceFiles` (`packages/client/src/**/*.{ts,tsx}`) with
  `clientTestAndHelperSourceFiles` ignored — the same boundary as the Leaf 15
  inventory.
- Baseline: 23 findings across 22 files (isolated ratchet-runner count,
  consistent with the ~24 Leaf 15 inventory; the small delta is expected
  because the runner's isolated `minimal-ts` config differs slightly from the
  full type-aware normal-lint pass that produced the inventory estimate).
  `lint:ratchet` green (0 regressions, 0 improvements).
- Red-green probe: a synthetic synchronous `setState`-in-effect in an in-scope
  production client file was reported by `lint:ratchet` as exactly 1 blocking
  regression on `ratchet/react-hooks-set-state-in-effect-client` (count 1 vs
  committed 0; exit 1); reverting the probe returned the gate to green.
- Normal lint keeps `"react-hooks/set-state-in-effect": "off"` in
  `eslint-config/client-configs.js` (the ratchet is the owner; avoids
  double-reporting) with a comment pointing at the ratchet id. Drain path is
  opportunistic: when a dialog/state refactor lands, the touched findings drain
  and `lint:ratchet:update` tightens the floor monotonically. No
  `zeroBaselineDisposition` yet — the baseline is non-zero, so the ratchet stays
  out of the zero-baseline audit until drained.

### 2026-06-12 — Leaf 10: first-party ai-footguns semgrep pack — DEFER (0 rules; lane stays opt-in)

- Verdict: do not build the pack now; land 0 rules. This is a value-based
  defer, NOT a kill-criterion reject and NOT lane retirement — the opt-in
  `ln-candidates` semgrep prototype lane is sound and unchanged.
- Evidence hunt: every AI-footgun class with a named in-repo incident is
  already enforced at ESLint `error`, repo-wide, on every commit — empty /
  log-only catch (`local/no-swallowed-errors`), LLM edit-note artifacts
  (`local/no-llm-artifacts`), and dropped async array callbacks
  (`local/no-async-array-callbacks`) (all three at `error` in
  `eslint-config/code-quality-configs.js` and `local-rule-authoring-configs.js`;
  LOG 2026-05-11). A semgrep rule for any of these is pure redundancy with a
  coarser engine — anything it would flag, ESLint already blocked pre-commit.
- Rejected candidates (no citable in-repo incident, per the leaf's
  evidence gate): git conflict markers (pickaxe `git log --all -G'^<<<<<<< '`
  finds nothing; the JSON merge driver already prevents baseline-marker
  conflicts structurally), stubbed-success handlers, hardcoded secrets.
- Multi-language reach — semgrep's headline differentiator over first-party
  ESLint — does not apply: Musi is 100% TypeScript (`git ls-files '*.go'` = 0).
- Kill-criterion prediction (applied mechanically): only `ai-footgun-empty-catch`
  clears the sensitivity bar (a `try { ... } catch ($E) {}` fixture; `semgrep
  --test` on the pinned engine v1.165.0 verified the mechanism fires). Its
  specificity is ~0 live findings on Musi (already ESLint-gated). Because >=1
  rule can pass, the criterion does NOT mandate lane retirement — consistent
  with the leaf's "0 live TP is the expected healthy state, not a retire
  signal." The rule is still not worth landing: it duplicates a precise ESLint
  rule with a coarser pattern and adds a second engine + manifest + fixtures to
  maintain for zero marginal catch.
- Structural mismatch: the advisory lane withholds rendered rule messages by
  default (`--include-rule-messages`, secret-leak guard), so the leaf's "repair
  text matching the advisory format" goal is muted even if a rule landed.
- Revisit trigger: a future named footgun incident in a class ESLint cannot
  express (e.g. a genuine cross-file/multi-language pattern) or Musi gaining a
  non-TS surface. Until then, new first-party footgun rules belong on the
  ESLint local-rule path; `watchlist.md` already routes new bug classes there.

### 2026-06-12 — Leaf 07: strict-boolean-expressions server slice — SLICE LANDED (zero floor)

- Fresh inventory (probe: the shared-slice `ruleOptions` from
  `ratchet/strict-boolean-expressions-shared`, scoped to
  `packages/server/src` via a scratch type-aware config; no tracked file
  touched): **149 findings across 61 files**. Per top-level dir: `routers`
  57, `services` 44, `seed` 26, `utils` 14, `socket` 3, `routes` 2, `trpc`
  2, `config` 1 (`prisma`/`generated`/`test` clean). Dominant shape:
  `conditionErrorNullableString` 100 (67%) — the `string | undefined` /
  nullable-Prisma-field truthiness bug the leaf predicted — then
  `conditionErrorOther` 19, `conditionErrorString` 15, the rest ≤4 each.
- No whole top-level dir is drainable-to-zero in one run. The smallest
  meaningful subtree was `services/encounter-combat/` (7 production files,
  **1 finding**): `combat-log.ts` `if (input.cursor)` on a
  `string | undefined` cursor. Drained to
  `input.cursor !== undefined && input.cursor !== ""` — preserves the
  original empty-as-absent semantics (a bare `!== undefined` would feed
  `new Date("")` (Invalid Date) to Prisma); pinned by a new
  `encounter-combat-logs.test.ts` regression ("treats an empty cursor as no
  cursor").
- Landed `ratchet/strict-boolean-expressions-server-encounter-combat` — a
  `no-new` zero floor mirroring the shared ratchet's option shape, scoped to
  `packages/server/src/services/encounter-combat/**`, disposition
  `intentional-ratchet-only` (normal ESLint keeps the rule off). Registry +
  `harness.controls.json` + baseline (`items: {}`, purely additive) +
  regenerated controls doc. `lint:ratchet:check-registry` (10 ratchets),
  `lint:ratchet:zero-baseline` (new row `intentional-ratchet-only`, 0
  lifecycle actions) green.
- Glob note: the server names test helpers `*-test-helper.ts` (hyphen), not
  shared's `*.test-helper.ts` (dot) — the server ignores use the hyphen form
  so `services/level-up/level-up-test-helper.ts` stays out of scope.
- Remaining server SBE debt (148 findings after the slice drain) is the
  candidate pool for future slices, smallest-clean-subtree first:
  `socket/` (3), `trpc/` (2), `routes/` (2) are the next single-run targets;
  `routers/`/`services/`/`seed/` are multi-run drains. Future leaves should
  re-probe (counts drift) before slicing.
- Stale leaf refs corrected: `bun run --filter @musi/server test` does not
  exist (no `test` script in the server package) — the working command is
  the root `bun run test:server`.

### 2026-06-12 — Leaf 03g: selector ratchet retirement — PROMOTED / RETIRED

- The three e2e selector ratchets adopted by the prior pack's Leaf 04
  (`ratchet/local-e2e-prefer-role-selectors` at 100 findings,
  `ratchet/playwright-no-nth-methods-e2e` at 38,
  `ratchet/playwright-prefer-native-locators-e2e` at 34 — 172 findings
  across 21 files on 2026-06-12) drained to zero via leaves 03a-03f on
  2026-06-12 and are now retired from the registry per the
  zero-baseline lifecycle in `docs/guides/lint-ratchet.md`.
- Normal ESLint owns the floor: all three rules are unconditional `error`
  across `e2e/**` (45 files) with no debt-file overrides left (the empty
  override sets were removed in 03f). The zero-baseline audit reported
  `normal-error` same-options coverage for all three rows before removal,
  so this is lifecycle step 3 (remove entry, update baseline), completing
  the `promote-to-normal-lint` dispositions recorded in 03f.
- The baseline removal is recorded in `lint-ratchet.debt-log.jsonl` via
  `lint:ratchet:update --allow-worse --reason` (the documented path for
  intentional registry removals; the run that actually changed the
  baseline carries the durable reason).
- `drift:e2e` (`scripts/drift/locator-usage.ts`) stays as the report-only
  raw-locator sensor and now reports 0 raw `.locator(` calls; its
  `debtFileCount` field retired with the override sets (report schema 1 →
  2) because the count no longer has a source of truth.
- Probes verified before closing: a `page.locator("#probe")` and a
  `.first()` in two different e2e files each fail `bun run lint` directly;
  both reverted.

### 2026-06-12 — Leaf 05: runtime import-cycle floor — IMPLEMENTED (lint lane)

- Placement (pre-decided at pack review): an "import cycles" lane in the
  lint composite running `drift:ai --scope current --check import-cycles
  --fail-on-runtime-cycles`. One correction to the pack's rationale: the
  `lint` *step* is in all four generated step sets, but it maps to two
  scripts — `scripts/lint.sh` (verify, verify:parallel, CI) and
  `scripts/lint-changed.sh` (verify:changed, pre-commit) — so the lane was
  wired into both (both the changed and full-fallback paths). The lane is
  always whole-tree (`--scope current`) in every caller: a cycle is a
  global property and the detector is cheap, so the floor is identical
  everywhere and has no changed-scope blind spots.
- Sensor switch: the sensor had no "fail on runtime cycles only" mode, so
  `--fail-on-runtime-cycles` was added to `scripts/drift-ai/`. It requires
  `--check import-cycles` (or `all`) at parse time, exits 1 on any
  import-cycles finding not labeled `details.typeOnly: true` (genuine
  runtime cycles and the could-not-build-graph diagnostic both count), and
  fails closed when the check skips — a gate that never inspected the
  graph must not certify zero. Type-only SCCs render but never gate. A red
  gate prints a why-red line to stderr (runtime cycles vs failed-closed
  skip) so the lane failure is self-explanatory without corrupting JSON
  stdout consumers.
- Subagent review fallout (fixed before landing): the lane initially
  invoked `drift-ai.ts` directly, which broke the lint-wrapper sandbox
  smoke tests (`scripts/tests/test-lint-changed.sh`,
  `test-lint-dist-preflight.sh`) whose fixture repos have no drift-ai or
  node_modules. The lane is now its own stubbable wrapper,
  `scripts/lint-import-cycles.sh` (npm: `lint:import-cycles`), stubbed in
  those sandboxes exactly like `lint-config-sensors.sh`; the smoke tests
  also pin that the floor runs on a no-op lint:changed and that a lane
  failure fails the composite. The graph-error diagnostic's hint no longer
  claims "report-only" (it gates under the flag).
- Runtime cost: detector 963–1010ms self-reported check time, ~1.25s lane
  wall (2017 files). Full `bun run lint` is ~60s dominated by the ESLint
  lane, so the new lane is entirely parallel-masked; in `lint:changed` the
  worst case adds ~1.3s to an otherwise no-op lint, which pre-commit's
  typecheck/test steps dwarf.
- Probe (the prior verdict's shape): `packages/shared/src/cycle-probe-a.ts`
  <-> `cycle-probe-b.ts` runtime cycle. Lane alone exited 1 with
  `WARN import-cycles: packages/shared/src/cycle-probe-a.ts — part of a
  circular import among 2 files` plus the FIX repair text; full
  `bun run lint` failed with "lint: import cycles failed with exit 1"
  while the 19 type-only findings stayed non-gating. Probe reverted; lane
  and composite green again (exit 0, 19 type-only findings still
  reported).

### 2026-06-12 — Leaf 06: testing-library + jest-dom for client tests — SPLIT (testing-library ADOPTED, jest-dom REJECTED)

- Probe: both plugins' recommended flat configs
  (`eslint-plugin-testing-library@7.16.2` `flat/react`,
  `eslint-plugin-jest-dom@5.5.0` `flat/recommended`) run against client test
  files via a temporary scoped block in `eslint-config/test-configs.js`.
  Client tests are heavily Testing-Library-based: 190 `.test.tsx` (184 import
  `@testing-library/react`), with `screen.` 3546x, `getBy` 3052x, `userEvent`
  786x, `waitFor` 160x — so both plugins target live patterns, not a no-op.
- **jest-dom: REJECTED — incompatible with this repo's ESLint 10.4.0.** The
  latest published release is 5.5.0 (confirmed via `npm view`), whose peer
  range stops at eslint 9 (`^6.8.0 || ^7.0.0 || ^8.0.0 || ^9.0.0`) and whose
  rules call `context.getSourceCode()`, an API ESLint 10 removed. The probe
  hard-crashed (`TypeError: context.getSourceCode is not a function`) in
  `jest-dom/prefer-to-have-class`. 7 of 11 rules use the removed
  `getSourceCode`/`getScope` (prefer-empty, prefer-in-document,
  prefer-to-have-attribute, -class, -style, -text-content, -value), and the
  most valuable rule (prefer-in-document) is among the broken ones, so partial
  adoption of the 4 working rules has low value. The dependency was removed
  (`bun remove eslint-plugin-jest-dom`). Revisit only when a jest-dom release
  migrates off the removed API and declares an eslint 10 peer.
- **testing-library: ADOPTED**, scoped to `packages/client/src/**/*.test.tsx`
  (block in `eslint-config/test-configs.js`). 7.16.2 declares `eslint ^10` as a
  supported peer and ran clean on ESLint 10 (no crash). Of the 22 `flat/react`
  rules, 17 were already clean; within `.test.tsx` scope 4 carried debt and 1
  (`no-wait-for-multiple-assertions`) had its only finding in a `.test.ts`:
  - `no-node-access` — 121 findings / 38 files — ratchet floor.
  - `render-result-naming-convention` — 46 / 9 — REJECTED (off).
  - `no-container` — 25 / 15 — ratchet floor.
  - `prefer-screen-queries` — 6 / 2 — ratchet floor.
- Adopted at `error`: the 18 clean rules (the `flat/react` set minus the 4 debt
  rules), with the one recommended-`warn` rule (`no-debugging-utils`) promoted
  to error for a uniform floor. `bun run lint` stays green (exit 0).
- Ratcheted (message-count, no-new, minimal-ts third-party):
  `ratchet/testing-library-no-node-access-client-tests` (121),
  `ratchet/testing-library-no-container-client-tests` (25),
  `ratchet/testing-library-prefer-screen-queries-client-tests` (6). All three
  are implementation-detail bug-class rules (querying the DOM / render container
  directly instead of via Testing Library). Disposition `promote-to-normal-lint`;
  drain follow-up tracked in `watchlist.md`. The isolated ratchet runner's
  baseline matched the probe counts exactly (152 total). `lint:ratchet` green
  (0 regressions); the three are non-zero so they stay out of the
  zero-baseline audit until drained.
- Rejected rule inside the adopted plugin: `render-result-naming-convention`
  (46 findings). The flagged names are varied and ad-hoc (`handlers` 21,
  `props` 20, `result` 5) — a pure render-result naming/readability convention,
  not one of the bug classes this evaluation targeted (implementation-detail
  queries, non-retrying queries, missing await, weak assertions). Draining is
  rename churn with no bug-class payoff, so it is off rather than ratcheted (a
  `promote-to-normal-lint` floor would imply a drain intent we do not hold).
- Scope note: the adopted block and all three ratchets are `.test.tsx` only,
  per the leaf scope. Client hook tests in `.test.ts` (`renderHook`) are
  deliberately out of scope; the one `.test.ts` finding observed was
  `no-wait-for-multiple-assertions` in
  `packages/client/src/hooks/character-sheet/use-weapon-masteries.test.ts`.
  Broadening the block + ratchets to `.test.ts` is a low-cost future option,
  folded into the drain follow-up.
- Probe timing: the testing-library-only scoped probe over 257 client test
  files ran in ~11.8s (full type-aware lint pass; the rules themselves are
  AST-only minimal-ts). Full `bun run lint` stayed ~56s (the new rules are
  ESLint-lane-masked). Probe block reverted to the final adopted block.

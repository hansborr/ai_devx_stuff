# Lint Review Evaluation Verdicts

Status: Active verdict register for `lint-review-2026-06/` — not a workable
leaf; append entries as leaves produce verdicts
Created: 2026-06-11

Use this file for new adopt/defer/reject decisions that come from the unified
June lint-review queue. Do not recreate the old historical verdict archive;
older decisions are available in git history before the legacy lint folders
were removed.

## Entries

### 2026-06-12 — Leaf 05: import-cycle detection — ADOPT REPORT-ONLY / REJECT ESLINT RULE

- Adopt the existing `drift:ai --scope current --check import-cycles` adapter as
  the import-cycle detector. It is a `ts-morph`/TypeScript-resolution sensor over
  the configured repo roots, honors per-package tsconfig discovery, separates
  runtime cycles from type-only SCCs, and stays off the default `drift:ai` run.
- Current inventory on the configured roots is 21 findings in 967 ms detector
  time (1.214 s shell wall): 2 runtime cycles and 19 type-only cycles. The same
  detector on `packages/{shared,server,client}/src` reports 9 findings in
  775 ms detector time (1.029 s shell wall), including 1 runtime cycle. A
  deliberate two-file runtime cycle probe under `packages/shared/src` was
  detected as 1 circular-import finding in 126 ms and then reverted.
- Keep the detector report-only and out of `verify` for now. Existing findings
  mean `--fail-on-findings` would block immediately, and the structural-sensor
  precedent says gate only after low-noise report-only output and repair text
  exist. The next promotion point is a focused cleanup or baseline policy for
  runtime cycles, not a blind verify slot.
- Reject `import-x/no-cycle` for this repo's gate. A probe using the repo ESLint
  config plus `import-x/no-cycle` on package source took 41.945 s at
  `maxDepth: 1` and 42.117 s at `maxDepth: 3`, with no findings. A second
  depth-1 run using `import-x`'s resolver with TS extensions still took
  39.140 s and produced no findings, so it is slower and lower-signal than the
  existing sensor.

### 2026-06-12 — Leaf 04: e2e selector plugin overlap — ADOPT/PARTIAL REJECT

- `ratchet/local-e2e-prefer-role-selectors`: adopt as the authoritative
  Musi raw-locator floor. Current inventory is 100 findings across the 19
  legacy selector files, and `minimal-ts` reaches the syntax-only local rule.
- `playwright/no-nth-methods`: adopt as
  `ratchet/playwright-no-nth-methods-e2e`. Current inventory is 38 findings
  across 13 files; clean e2e files now keep the rule at normal-lint `error`.
- `playwright/prefer-native-locators`: adopt as
  `ratchet/playwright-prefer-native-locators-e2e`. Its 34 current findings
  are a subset of the raw-locator pool, but it adds useful specificity for
  selectors that can become `getByTestId` or another native locator; it also
  catches same-count churn from generic CSS locator debt to native-locator
  debt.
- `playwright/no-raw-locators`: reject as a separate ratchet. Probe count was
  97 findings versus the local rule's 100, with no extra files or messages;
  the local rule is stricter and points at the Musi e2e guide. The explicit
  `off` switch was removed instead of preserving a duplicate disabled rule.

### 2026-06-12 — Leaf 03e: drift-ai vitest option-pinning ratchets — KEEP

- `ratchet/vitest-expect-expect-drift-ai-tests` (pins
  `assertFunctionNames: ["expect"]`) and
  `ratchet/vitest-valid-expect-drift-ai-tests` (pins `maxArgs: 2`): keep as
  `narrow-floor` different-options ratchets. Both pin stricter options than
  the resolved plugin defaults that normal Vitest lint applies, so draining
  them into normal lint would either loosen the drift-ai floor or force the
  stricter options on every unit test. These are the pack's canonical
  different-options examples; Leaf 08 keeps the expect-expect allowlist
  independent of the script-tests allowlist on purpose.

### 2026-06-12 — Leaf 03e: drift-ai CLI lint policy — KEEP (relaxed options)

- The drift-ai family (implementation and tests) keeps a deliberate policy
  block in `eslint-config/script-configs.js`:
  `restrict-template-expressions` with `allowNumber: true`, `max-params`
  `{ max: 6 }`, and `no-magic-numbers` off. Probe evidence (2026-06-12):
  going strict would mean ~327 `String(...)` wrappers across 80 files, ~152
  named scoring constants, and ~30 function-signature refactors in a
  metrics/reporting CLI where numeric interpolation is the idiom — churn
  that would make the code worse, with no ratchet coverage lost (no drift-ai
  ratchet ever pinned these rules). The blanket test-file relax block was
  NOT kept: drift-ai tests now meet package-test policy
  (`explicit-function-return-type`, `no-unsafe-assignment`,
  `no-dynamic-delete`, `restrict-template-expressions` beyond numbers) via
  fixes, a typed `stringContaining` matcher seam
  (`scripts/drift-ai/matcher.test-helper.ts`), and `vi.stubEnv` for env
  save/restore.

### 2026-06-12 — Leaf 03l: local type-assertion boundary ratchet — KEEP/NARROW

- `ratchet/local-type-assertion-boundary`: keep as a zero `narrow-floor`.
  Normal ESLint now enforces `local/type-assertion-boundary` on e2e and
  maintained `scripts/**/*.ts`, but package TypeScript remains ratchet-only for
  this local rule. The ratchet was narrowed to ignore the same script
  fixture/config paths as normal lint (`scripts/codemods/fixtures/**`,
  `scripts/drift-ai/fixtures/**`, `scripts/fixtures/**`,
  `scripts/harness-audit/fixtures/**`, `scripts/logs-audit/fixtures/**`, and
  `scripts/vitest.config.ts`) so fixture snapshots do not carry runtime-script
  policy.

### 2026-06-12 — Leaf 03l: remaining intentional/different-option ratchets — KEEP

- `ratchet/strict-boolean-expressions-shared`: keep as an
  `intentional-ratchet-only` shared-package zero floor. Normal ESLint still
  keeps `@typescript-eslint/strict-boolean-expressions` off project-wide, so
  deleting this ratchet would remove the only guard for the shared production
  slice.
- `ratchet/vitest-expect-expect-script-tests` and
  `ratchet/vitest-valid-expect-script-tests`: keep as `narrow-floor`
  different-options ratchets. Normal Vitest lint is already enabled for these
  script tests, but these two ratchets pin the selected helper allowlist and
  `maxArgs: 2` option shape for the singleton script-test family without
  changing options for every test file in the repo.

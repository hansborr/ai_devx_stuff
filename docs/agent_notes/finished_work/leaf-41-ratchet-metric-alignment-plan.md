# Leaf 41: Ratchet Metric Alignment Plan

Date: 2026-05-20

Archived: 2026-05-21 after Batch 1 `effective-line-count` and Batch 2
`complexity-severity` both landed. See
`lint-hardening-leaf-41-metric-batch-1-effective-line-count.md` and
`lint-hardening-leaf-41-metric-batch-2-complexity-severity.md`.

## Summary

This is a plan-only handoff for aligning the lint ratchet metrics that are
currently weaker than their names imply. No runner, registry, baseline, rule, or
production source changes land in this exec.

The confirmed mismatch is limited to rules where one diagnostic carries a
numeric severity that can worsen without increasing the number of diagnostics:

- `local/max-lines`: one diagnostic per over-limit file.
- core `complexity`: one diagnostic per over-complex function.

Do not generalize this to every `message-count` ratchet. For bug-class and
finding-class rules, each new violation is already a separate diagnostic, so
`message-count` is still aligned with the broad-shallow ratchet purpose.

The current baseline format is version 1 and stores per-file payloads as
`items: { "path": { "count": N } }`. It does not store effective line counts,
complexity values, or per-function severity data today.

## 1. Ratchet Metric Audit

All 25 current ratchets use `message-count`. The committed baseline totals 77
current findings. The table below classifies every registry entry.

| Ratchet ID | Current metric | Recommended metric | Baseline summary | Notes |
|---|---|---|---|---|
| `ratchet/core-complexity-codemods` | `message-count` | `complexity-severity` | 24 messages across 6 files: `concurrency-guard.ts` 2, `expand-barrel.ts` 8, `lib/trpc-shared-schema.ts` 7, `structured-logging-fix.ts` 3, `trpc-shared-input.ts` 2, `trpc-shared-output.ts` 2. Live max observed complexity: 22. | Candidate. ESLint JSON does not expose a `data` object, but the message is parseable per diagnostic, e.g. `Function 'parseArgs' has a complexity of 13. Maximum allowed is 10.` |
| `ratchet/core-complexity-drift-ai` | `message-count` | `complexity-severity` | 10 messages across 5 files: `drift-ai.ts` 4, `comments.ts` 1, `duplicates.ts` 1, `ghost-files.ts` 2, `suppressions.ts` 2. Live max observed complexity: 49. | Candidate. Same parseable core-rule message shape. |
| `ratchet/core-complexity-eslint-rules` | `message-count` | `complexity-severity` | 3 messages across 3 files: `strict-trpc-input.js` 1, `structured-logging.js` 1, `type-assertion-boundary.js` 1. Live max observed complexity: 15. | Candidate. Same parseable core-rule message shape. |
| `ratchet/core-no-magic-numbers-eslint-rules` | `message-count` | `message-count` | 2 messages in `eslint-rules/type-assertion-boundary.js`. | Fine. Each numeric literal finding is a separate diagnostic, so new or additional findings increase count. |
| `ratchet/local-max-lines` | `message-count` | `effective-line-count` | Zero baseline: 0 files, 0 messages. | Candidate for consistency and future-proofing. Metric is moot while zero, because any over-limit file fails immediately, but if debt is ever accepted with `--allow-worse`, it should store `lines`. |
| `ratchet/local-max-lines-code-intel` | `message-count` | `effective-line-count` | Zero baseline: 0 files, 0 messages. | Candidate for consistency and future-proofing. Metric is moot while zero for the same reason as above. |
| `ratchet/local-max-lines-codemods` | `message-count` | `effective-line-count` | 6 messages across 6 files, count 1 each. Live effective lines observed: `concurrency-guard.ts` 804, `expand-barrel.ts` 1026, `lib/trpc-shared-schema.ts` 783, `structured-logging-fix.ts` 491, `trpc-shared-input.ts` 346, `trpc-shared-output.ts` 353. | Candidate. The local rule passes `data.actual`, and ESLint JSON exposes the actual count only through the interpolated message text. No independent re-count is required if the runner parses that text. |
| `ratchet/local-max-lines-drift-ai` | `message-count` | `effective-line-count` | 6 messages across 6 files, count 1 each. Live effective lines observed: `drift-ai.ts` 1060, `config.ts` 466, `duplicates.ts` 422, `ghost-files.ts` 579, `harness-freshness.ts` 332, `suppressions.ts` 420. | Candidate. Same local-rule message payload shape. |
| `ratchet/local-max-lines-generate-harness-controls` | `message-count` | `effective-line-count` | 1 message in `scripts/generate-harness-controls.ts`. Live effective lines observed: 386. | Candidate. Same local-rule message payload shape. |
| `ratchet/local-max-lines-logs-audit` | `message-count` | `effective-line-count` | 1 message in `scripts/logs-audit.ts`. Live effective lines observed: 685. | Candidate. Same local-rule message payload shape. |
| `ratchet/local-max-lines-runtime` | `message-count` | `effective-line-count` | 3 messages across 3 files, count 1 each. Live effective lines observed: `harness-check.ts` 441, `lint-ratchet-baseline.ts` 857, `lint-ratchet.ts` 846. | Candidate. Same local-rule message payload shape. |
| `ratchet/local-type-assertion-boundary` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Each assertion-boundary violation is its own diagnostic; zero baseline makes the metric moot today. Stronger metric would add noise without benefit. |
| `ratchet/regexp-no-unused-capturing-group-eslint-rules` | `message-count` | `message-count` | 2 messages across 2 files: `no-barrel.js` 1, `structured-logging.js` 1. | Fine. Each unused capturing group finding is a separate diagnostic. |
| `ratchet/regexp-no-useless-non-capturing-group-eslint-rules` | `message-count` | `message-count` | 1 message in `eslint-rules/no-llm-artifacts.js`. | Fine. Each useless non-capturing group finding is a separate diagnostic. |
| `ratchet/strict-boolean-expressions-shared` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Each expression finding is a separate diagnostic; zero baseline makes the metric moot today. Stronger metric would add noise without benefit. |
| `ratchet/typescript-eslint-no-misused-promises-codemod-tests` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Bug-class rule; every offending promise misuse is its own diagnostic. Zero baseline makes the metric moot. |
| `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Bug-class rule; every offending promise misuse is its own diagnostic. Zero baseline makes the metric moot. |
| `ratchet/typescript-eslint-only-throw-error-codemod-tests` | `message-count` | `message-count` | 7 messages across 4 files: `concurrency-guard.test.ts` 1, `expand-barrel.test.ts` 2, `structured-logging-fix.test.ts` 2, `trpc-shared-schema-codemod.test.ts` 2. | Fine. Bug-class rule; every non-`Error` throw finding is its own diagnostic. |
| `ratchet/typescript-eslint-only-throw-error-drift-ai-tests` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Bug-class rule; every non-`Error` throw finding is its own diagnostic. Zero baseline makes the metric moot. |
| `ratchet/vitest-expect-expect-codemod-tests` | `message-count` | `message-count` | 5 messages across 4 files: `concurrency-guard.test.ts` 1, `expand-barrel.test.ts` 1, `structured-logging-fix.test.ts` 1, `trpc-shared-schema-codemod.test.ts` 2. | Fine. Test-quality bug-class rule; each test missing an assertion is a separate diagnostic. |
| `ratchet/vitest-expect-expect-drift-ai-tests` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Test-quality bug-class rule; each test missing an assertion is a separate diagnostic. Zero baseline makes the metric moot. |
| `ratchet/vitest-no-commented-out-tests-eslint-rules-tests` | `message-count` | `message-count` | 1 message in `eslint-rules/test-file-location.test.js`. | Fine. Each commented-out test finding is a separate diagnostic. |
| `ratchet/vitest-no-conditional-expect-eslint-rules-tests` | `message-count` | `message-count` | 5 messages in `eslint-rules/message-guidance.test.js`. | Fine. Each conditional expect finding is a separate diagnostic. |
| `ratchet/vitest-valid-expect-codemod-tests` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Test-quality bug-class rule; every invalid expect finding is a separate diagnostic. Zero baseline makes the metric moot. |
| `ratchet/vitest-valid-expect-drift-ai-tests` | `message-count` | `message-count` | Zero baseline: 0 files, 0 messages. | Fine. Test-quality bug-class rule; every invalid expect finding is a separate diagnostic. Zero baseline makes the metric moot. |

## 2. Implementation Approach

### a. `effective-line-count` for `local/max-lines`

`eslint-rules/max-lines.js` already computes the effective line count and
passes it as `data.actual` in `context.report`. A real ESLint JSON diagnostic
does not include the raw `data` object, but the interpolated message text does
include the count, e.g. `This file has 804 effective lines, above the 300 line
limit`.

Recommended implementation: parse the already-emitted message text in the
runner with a local-rule-specific regex such as:

```text
/This file has (?<lines>\d+) effective lines, above the (?<max>\d+) line limit/u
```

Do not duplicate the rule's `effectiveLines` algorithm in the runner. The local
rule is the source of truth for blank-line/comment behavior, and its
`ruleSourceHash` already invalidates cached findings if the message or logic
changes. The parser should throw a `ConfigError` if a `local/max-lines`
diagnostic for an `effective-line-count` ratchet does not match the expected
message shape.

Baseline storage:

```json
{
  "items": {
    "scripts/codemods/concurrency-guard.ts": {
      "count": 1,
      "lines": 804
    }
  }
}
```

`count` remains the current one-message-per-over-limit-file value. `lines`
stores the current effective line count for that over-limit file.

Comparison:

- A new over-limit file has baseline count 0 and current count 1, so it fails as
  `new-path`, matching current `message-count` behavior.
- An existing over-limit file with current `count > baseline.count` fails as an
  increased count. This should be rare for `local/max-lines`, but keep the
  shared count semantics intact.
- An existing over-limit file with equal count but `current.lines >
  baseline.lines` fails as a severity regression. Add a specific reason such as
  `increased-lines` or a metric-specific detail in the generic regression
  payload.
- A lower `lines` value should be reported as an improvement, so
  `lint:ratchet:check-baseline` can tell the operator to run update after a file
  split or shrink.

Migration:

Use a one-shot committed migration in the implementation batch. Do not
auto-upgrade old baselines during default `lint:ratchet` reads.

The implementation batch should:

1. Add `effective-line-count` as an implemented metric.
2. Switch all `local/max-lines-*` registry entries to that metric.
3. Run `bun run lint:ratchet:update` to rewrite the converted baseline entries
   with `lines`.
4. Commit the source, docs, and baseline update together.

Pre-migration audit for the first baseline rewrite:

The values below were gathered from the current worktree before the
implementation batch by running `bun run lint:ratchet` to refresh the generated
ratchet ESLint configs, then running ESLint with each generated
`ratchet/local-max-lines-*` config and extracting the interpolated
`This file has <N> effective lines` value from the `local/max-lines` diagnostic.
This uses the local rule's own `skipBlankLines: true` and `skipComments: true`
logic instead of a second line-count implementation. `ratchet/local-max-lines`
and `ratchet/local-max-lines-code-intel` were probed too; both have zero
committed items and emitted no current `local/max-lines` diagnostics.

| Ratchet ID | Covered committed item | Audited effective lines |
|---|---|---:|
| `ratchet/local-max-lines-codemods` | `scripts/codemods/concurrency-guard.ts` | 804 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/expand-barrel.ts` | 1026 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/lib/trpc-shared-schema.ts` | 783 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/structured-logging-fix.ts` | 491 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/trpc-shared-input.ts` | 346 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/trpc-shared-output.ts` | 353 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai.ts` | 1060 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/config.ts` | 466 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/duplicates.ts` | 422 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/ghost-files.ts` | 579 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/harness-freshness.ts` | 332 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/suppressions.ts` | 420 |
| `ratchet/local-max-lines-generate-harness-controls` | `scripts/generate-harness-controls.ts` | 386 |
| `ratchet/local-max-lines-logs-audit` | `scripts/logs-audit.ts` | 685 |
| `ratchet/local-max-lines-runtime` | `scripts/harness-check.ts` | 441 |
| `ratchet/local-max-lines-runtime` | `scripts/lint-ratchet-baseline.ts` | 857 |
| `ratchet/local-max-lines-runtime` | `scripts/lint-ratchet.ts` | 846 |

The structural parse used by update mode should tolerate the old
`message-count` entries long enough to regenerate them. During this first
migration, missing `lines` in a committed count-only item should not require
`--allow-worse` only when the newly generated `lines` value is less than or
equal to the audited value above. This guard is load-bearing for
`scripts/lint-ratchet.ts` and `scripts/lint-ratchet-baseline.ts`, which Batch 1
is expected to edit while they are already covered by
`ratchet/local-max-lines-runtime`. If any covered committed item generates a
higher `lines` value, the baseline update must be refused unless the operator
uses `--allow-worse --reason` and records a durable written rationale with the
baseline update explaining that the increase is migration cost rather than
unreviewed drift. Count protection still applies, so a matched zero-baseline
file that newly exceeds the line limit remains a normal `new-path` regression.
After migrated, any generated baseline with a higher `lines` value must be
refused unless the operator passes `--allow-worse --reason`.

### b. `complexity-severity` for core `complexity`

A real core `complexity` JSON diagnostic does not expose the raw rule `data`
object. It does expose a parseable message string per offending function:

```text
Function 'parseArgs' has a complexity of 13. Maximum allowed is 10.
```

The same JSON diagnostic also includes `line`, `endLine`, `nodeType`, and
`messageId: "complex"`. That is enough for a practical severity metric without
reimplementing ESLint's cyclomatic-complexity visitor.

Recommended implementation: parse the core-rule message, not the AST. The
parser should extract:

- function label from the message prefix, for example `Function 'parseArgs'`.
- actual complexity, for example `13`.
- maximum allowed complexity, for example `10`.
- diagnostic location and `nodeType` from the ESLint message object.

Baseline storage:

```json
{
  "items": {
    "scripts/codemods/concurrency-guard.ts": {
      "count": 2,
      "maxComplexity": 15,
      "perFunction": [
        {
          "line": 201,
          "nodeType": "FunctionDeclaration",
          "label": "Function 'parseArgs'",
          "complexity": 13
        },
        {
          "line": 733,
          "nodeType": "FunctionDeclaration",
          "label": "Function 'patternCFinding'",
          "complexity": 15
        }
      ]
    }
  }
}
```

Comparison:

- Preserve `count` semantics. A new over-complex function increases the file's
  count and fails as current ratchets do today.
- Fail when `current.maxComplexity > baseline.maxComplexity`.
- Also compare the sorted descending complexity vector for each file. If any
  current vector position is greater than the baseline vector at the same
  position, fail even when the count is unchanged. This catches cases such as
  `[15, 13]` becoming `[15, 14]`.
- Use `perFunction` for better diagnostics and for exact matches by
  `label + nodeType + line` when available. If exact matching is ambiguous
  because functions moved, the vector comparison is still the enforcement
  backstop.

This is better than a file-level max-only metric because it catches non-maximum
functions getting worse. It is still much smaller than an AST recomputation leaf
and stays tied to ESLint's own complexity implementation.

If the core message format changes after an ESLint upgrade, the parser should
fail loudly with a `ConfigError`; the core `ruleSourceHash` already includes the
installed ESLint version, so upgrades also force baseline review.

Migration is the same one-shot committed migration pattern as
`effective-line-count`: add metric support, switch the three
`core-complexity-*` registry entries, run `bun run lint:ratchet:update`, and
commit the new severity payload.
Missing `maxComplexity` / `perFunction` in old committed entries is tolerated
only during the first update migration when count is not worse.

### c. Runner and Baseline Implications

Files expected to change during implementation:

- `scripts/lint-ratchet-config.ts`: extend `LintRatchetMetric`; switch the
  relevant ratchet entries to `effective-line-count` and
  `complexity-severity`.
- `scripts/lint-ratchet.ts`: extend `ESLintMessage` if needed; add
  metric-aware collection; parse numeric severities from diagnostic messages;
  carry metric payload into `LintRatchetCurrentItem`; update user-facing
  regression text so severity regressions explain the numeric ceiling.
- `scripts/lint-ratchet-baseline.ts`: widen baseline/current item types; extend
  metric validation; parse, validate, normalize, and format metric-specific
  item fields; compare count and severity; include metric-specific improvement
  reasons.
- `scripts/lint-ratchet-baseline.test.ts`: add focused unit tests for
  parsing/formatting, comparisons, update refusal, and improvements for both
  new metrics.
- `scripts/test-lint-ratchet.sh`: add smoke fixtures that prove severity can
  worsen without a new diagnostic and still fail.
- `scripts/test-fixtures/lint-ratchet/*`: update expected generated-config
  cache identity snapshots if the metric-driven config hash changes the
  hard-coded cache keys. The generated ESLint config bytes should not change
  because the metric does not affect ESLint rule config.
- `lint-ratchet.baseline.json`: implementation batches will rewrite converted
  entries with metric payloads. This plan exec intentionally does not.
- `docs/guides/lint-ratchet.md`, `docs/agent_notes/NEXT.md`,
  `docs/agent_notes/STATUS.md`, and finished-work notes as described below.

Backward compatibility:

- Existing `message-count` baselines remain valid for ratchets that keep
  `message-count`.
- Converted entries require a committed one-shot baseline migration. The
  default gate should not auto-upgrade them silently.
- Structural update mode should parse old count-only entries so migration can
  recover from stale metadata while still rejecting count regressions.

`--allow-worse`:

- In update mode after migration, `--allow-worse --reason` is required for any
  count increase, line-count increase, max-complexity increase, or complexity
  vector increase.
- It is not required solely to populate missing severity fields during the
  first metric migration, provided the generated count is not worse than the
  old committed count. For Batch 1's `effective-line-count` migration, the
  generated `lines` value must also be less than or equal to the
  pre-migration audit table in section 2.a; otherwise the baseline update needs
  `--allow-worse --reason` and a durable written rationale.

## 3. Batch Decomposition

Recommended implementation is two reviewable batches after this plan.

### Batch 1: `effective-line-count` for `local/max-lines`

Scope:

- Add metric support for `effective-line-count`.
- Convert every current `local/max-lines-*` ratchet:
  `ratchet/local-max-lines`, `ratchet/local-max-lines-code-intel`,
  `ratchet/local-max-lines-codemods`, `ratchet/local-max-lines-drift-ai`,
  `ratchet/local-max-lines-generate-harness-controls`,
  `ratchet/local-max-lines-logs-audit`, and
  `ratchet/local-max-lines-runtime`.
- Update the baseline with `lines` values.
- Add unit and smoke coverage for an already-over-limit file growing while the
  diagnostic count stays 1.
- Update `docs/guides/lint-ratchet.md`, `STATUS.md`, `NEXT.md`, and one
  finished-work note.

Dependencies:

- This plan document.
- No dependency on the complexity batch.

Expected diff size:

- Medium. Runner and baseline serializer changes are shared infrastructure, but
  the behavioral surface is one metric and one rule family.

Exit criteria:

- A fixture baseline starts with one over-limit file at `lines=N`; the fixture
  then grows to `lines=N+1`, still emits one diagnostic, and `lint:ratchet`
  fails.
- New over-limit file behavior still fails through the existing count path.
- Shrinking an over-limit file reports an improvement.
- The migrated `ratchet/local-max-lines-*` baseline diff has no generated
  `lines` value above the pre-migration audit table for any covered committed
  item unless that path went through `--allow-worse --reason` with a durable
  written rationale.
- All listed verification gates pass.

### Batch 2: `complexity-severity` for core `complexity`

Scope:

- Add metric support for `complexity-severity`.
- Convert `ratchet/core-complexity-codemods`,
  `ratchet/core-complexity-drift-ai`, and
  `ratchet/core-complexity-eslint-rules`.
- Update the baseline with `maxComplexity` and `perFunction` payloads.
- Add unit and smoke coverage for an already-over-complex function getting more
  complex while the diagnostic count stays 1.
- Update `docs/guides/lint-ratchet.md`, `STATUS.md`, `NEXT.md`, and one
  finished-work note.

Dependencies:

- Batch 1 if it introduces the shared metric-aware item shape and comparator
  helpers. If Batch 1 keeps the helpers too max-lines-specific, Batch 2 should
  first extract small metric-specific comparison helpers before adding
  complexity.

Expected diff size:

- Medium. The code path reuses the metric-aware baseline shape from Batch 1 and
  adds a second parser/comparator.

Exit criteria:

- A fixture baseline starts with one function above the configured complexity
  max; the fixture then increases that function's complexity, still emits one
  diagnostic, and `lint:ratchet` fails.
- A second fixture or unit test proves complexity vector growth is caught when
  count is unchanged.
- A parser-format failure for an unparseable complexity message is covered by a
  focused unit test.
- All listed verification gates pass.

Do not combine these batches. Each should land, receive a separate Codex
review, and merge before the next starts.

## 4. Placement in the Leaf 41 Queue

Recommendation: **Split**.

The audit and plan land now. The implementation batches should be inserted
after the Leaf 38 parser-project decision and before the root/package
`*.config.*` block.

Rationale:

- This preserves the user's broad-shallow-ceilings-first framing better than
  stopping the named queue immediately.
- Leaf 38 is a prerequisite-style parser decision that unblocks multiple
  surfaces; keep it first.
- The metric alignment is not a deep drain. It strengthens existing ceilings so
  they actually mean "no worse than baseline" before the remaining broad
  ceiling work continues.
- Running the alignment before root/package config, ShellCheck, and workflow
  sensors keeps future floor batches from copying or relying on known-weak
  metric semantics.

The live queue should therefore become:

1. Landed child leaf 41d.
2. Leaf 38 parser-project decision.
3. Leaf 41 ratchet-metric alignment batches for `local/max-lines` and
   `complexity`.
4. Root/package `*.config.{ts,mts,cts}` block.
5. Child leaf 41b ShellCheck floor.
6. Child leaf 41c workflow/config sensors.

This is a small departure from "do every broad floor first", but it is not a
cleanup drain. It is ceiling integrity work, and the known weakness is now
concrete enough that future broad work should not proceed for long on the old
metric contract.

## 5. Verification Expectations

Each implementation batch must pass:

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`

Implementation batches will also run `bun run lint:ratchet:update` to perform
the committed baseline migration before the verification gates above.

Batch 1 has one additional baseline-audit gate: after
`bun run lint:ratchet:update`, compare every generated
`ratchet/local-max-lines-*` `lines` value in the baseline diff against the
pre-migration audit table in section 2.a. The batch passes only if every value
is less than or equal to the audited value, or the path has an explicit
`--allow-worse --reason` rationale recorded with the baseline update. This
check must include the ratchet-runner files that the implementation edits,
especially `scripts/lint-ratchet.ts` and
`scripts/lint-ratchet-baseline.ts`.

New focused tests are required:

- `effective-line-count`: a fixture must prove that an already-over-limit file
  can grow, keep exactly one `local/max-lines` diagnostic, and still fail the
  ratchet because `lines` increased.
- `complexity-severity`: a fixture must prove that an already-over-complex
  function can grow, keep exactly one `complexity` diagnostic, and still fail
  the ratchet because complexity increased.
- Baseline unit tests must cover parsing old count-only entries in structural
  update mode, strict parsing of metric-specific fields after migration,
  severity improvements, and `--allow-worse` refusal/acceptance for severity
  regressions.

Zero-baseline ratchets do not need temporary violation probes for the metric
migration itself because no new ratchet is being introduced. If a later batch
adds new zero-baseline ratchets, keep the existing temporary-probe practice.

## 6. Doc and Handoff Updates Expected at Implementation Time

Each implementation batch should update:

- `docs/agent_notes/NEXT.md`: refresh the live queue after the batch lands.
- `docs/agent_notes/STATUS.md`: record the newly landed metric and whether the
  remaining metric batch is still pending.
- `docs/guides/lint-ratchet.md`: document the metric registry, baseline item
  shapes, comparison semantics, migration path, and `--allow-worse` behavior.
- `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`: update rows
  whose `Existing ratchet/floor` cells cite `local/max-lines-*` or
  `core-complexity-*` if the row text needs to distinguish metric semantics.
  Ratchet IDs and status labels should not change solely because the metric
  changes.
- `docs/agent_notes/finished_work/*.md`: create one finished-work note per
  implementation batch, including initial migrated baseline shape, tests, and
  exit path.

The implementation batches should not create source cleanup/drain work. Their
only behavioral goal is to make the existing ratchets enforce "no worse than
baseline" for the two confirmed numeric-severity rule families.

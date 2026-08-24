# 162. Test-orphaning builds a touch index and then rescans full history for every source

Status: Landed on fix/cq-162
Theme: indexed history reuse · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The test-orphaning advisory pays once to index every path’s commit touches, but
then ignores that index when deriving each source row’s recent commit subjects.
For every source it walks the full commit history again and searches each
record’s file list for the same path.

This is avoidable work on an advisory explicitly designed for bounded but large
history. At the configured ceilings, the outer rescan alone can reach roughly
100 million source-to-record iterations before counting the inner file search.
The cost is especially pronounced for low-churn sources because the existing
helper only stops after finding three matching commits.

## Evidence

- `scripts/drift-ai/test-orphaning-analysis.ts:26-44` builds one `touchesByPath` map and passes each source’s `sourceTouches` into `rowForSource`.
- `scripts/drift-ai/test-orphaning-analysis.ts:48-62` records each path’s commit index and date while walking the records once; the list is appended in record order, with index zero representing the newest commit.
- `scripts/drift-ai/test-orphaning-analysis.ts:64-87` uses those indexes for co-change calculations but then constructs `touchesSource` and passes the complete `records` array to `recentSubjects`, whose predicate searches `record.files`.
- `scripts/drift-ai/hotspots-actionability.ts:97-112` scans records linearly and breaks only after reaching the module-private three-subject default at `:21`; a source with fewer than three touches scans the entire history.
- `scripts/drift-ai/test-orphaning-analysis.ts:98-99,135-140` already resolves other row fields through `records[index]`, establishing the index-to-record lookup pattern needed for subjects.
- `scripts/drift-ai/bounded-full-history.ts:28-30,148-153` defaults to 5,000 commits and 20,000 files. If all admitted paths are source candidates, 20,000 × 5,000 permits about 100 million record iterations before the inner `files.some` work.
- `scripts/drift-ai/test-orphaning-advisory.ts:43-55` feeds the bounded-history records into this row builder before threshold filtering; `prototype-subcommand-definitions.ts:34-40` registers it as the on-demand `test-orphaning` prototype advisory.

## Proposed direction

Derive recent subjects from the existing ordered indexes; do not add subject
strings to `FileTouch`, because `records[index]` is already constant-time and
the same pattern supplies row dates.

Add an exported index-based sibling to `recentSubjects` in
`scripts/drift-ai/hotspots-actionability.ts`, such as
`subjectsAtIndexes(records, orderedIndexes, limit = DEFAULT_SUBJECT_LIMIT)`.
In `rowForSource`, pass the indexes from the first limited `sourceTouches`
entries and remove both the `touchesSource` predicate and the full-history
`recentSubjects` call. Since `buildTouchesByPath` appends touches in newest-first
record order, the resulting subjects must preserve the current order and limit.

Use the existing advisory coverage at
`scripts/drift-ai/test-orphaning-advisory.test.ts:152-173`, which already pins
three ordered subjects and their commit-intent overlay. Add a focused case with
unrelated commits around the source touches to prove that the index-based result
matches the former scan and still stops at the shared limit.

## Scope / caveats

- Keep this leaf scoped to test-orphaning. Similar rescans at
  `scripts/drift-ai/ownership-analysis.ts:75` and
  `coldspots-coldspot.ts:161` may adopt the helper later, but are not required
  here.
- Do not enrich every `FileTouch` with a duplicated subject payload or hard-code
  the value `3` in `test-orphaning-analysis.ts`; the default remains owned by
  `hotspots-actionability.ts:21`.
- The 100-million figure is a cap-permitted ceiling, not a typical run. Only
  paths accepted by `parseSourceParts` become rows, and high-churn sources
  currently stop after three matches.
- Preserve advisory rows, ordering, subject limits, commit-intent overlays, and
  output bytes. The change affects lookup strategy only.
- This is an on-demand prototype advisory, not a gate, which bounds its urgency.
  It has no sequencing dependency and does not affect shared, server, or client
  code.

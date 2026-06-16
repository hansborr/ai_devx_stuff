# 02. drift-ai coldspots/hotspots families duplicate loadBaseline, newestTimestamp, updateTimestamp, withContext, and appendRowContext/formatAuthor

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-high · Size: M
Source: drift:ai near-duplicates / near-duplicates-2 (drift-baseline; confirmed by re-reading all cited sites) · Confidence: high

## Problem
Across the drift:ai coldspots/hotspots lens families, several generic, behavior-bearing helpers are copy-pasted verbatim between sibling modules that already cross-import. The duplication is author-acknowledged in-code (`coldspots-aggregate.ts:62` comment "copied from the thrash pattern"; `coldspots-format-sections.ts:1` header "Mirrors `hotspots-format-sections.ts`"). It serves no purpose beyond drift risk — a fix to one copy (e.g. handling a non-finite `Date.parse`, or a new context line) silently skips the others.

Concrete duplicates confirmed:

1. **`loadBaseline`** — byte-for-byte identical in `coldspots.ts:199-211` and `hotspots.ts:157-169`. Same `read` → `JSON.parse` flow, same two `DriftAiError` messages.

2. **`withContext`** (actionability-overlay builder) — identical body in `hotspots-churn.ts:66-81`, `hotspots-fragmentation.ts:109-124`, and `hotspots-thrash.ts:203-215`. All three build `touches = (record) => record.files.some(f => f.path === entry.path)`, then spread `...entry` plus `authors/recentSubjects/commitIntent/inspectCommand/baseline`, using the same inner helpers (`recentSubjects`, `aggregateAuthors`, `shellQuoteArg` already exported from `hotspots-actionability.ts`; `buildCommitIntentOverlay` from `commit-intent.ts`). Only the param/return type names differ. NOTE: `hotspots-suppression-churn.ts:99-114` and `hotspots-coupling.ts:169` are NEAR-variants of this — they differ in `inspectCommand` (suppression-churn injects `-G'<pattern>'`) and/or the touch predicate (coupling uses `touchesBoth` + a `sweepCap` param). They can only be folded if the shared helper parameterizes `touches` and `inspectCommand`.

3. **`appendRowContext` + `formatAuthor`** — byte-identical bodies in `coldspots-format-sections.ts:128-143` and `hotspots-format-sections.ts:152-175`. Same four `lines.push(...)` calls (authors / recent / intent / inspect) and same `${author.name}×${author.commits}`. Differ only in the `entry` param type (coldspots: `ColdspotRow`; hotspots: a 5-way `ChurnHotspot | CouplingHotspot | FragmentationHotspot | SuppressionChurnHotspot | ThrashHotspot` union).

4. **`newestTimestamp`** — byte-identical in `coldspots-aggregate.ts:128-136` and `hotspots-thrash.ts:131-139`. **`updateTouchDates`** — identical body in `coldspots-aggregate.ts:63-70` and `hotspots-thrash.ts:122-129`; differs only in the aggregate param type name (`FileAggregate` vs `ThrashAggregate`, both structurally `{ newestTouchMs, oldestTouchMs }`).

A shared home already exists and is already on the import graph: `hotspots-history.ts` (source of `CommitRecord`, imported by all the cited modules incl. `coldspots-aggregate.ts:7`) and `hotspots-actionability.ts` (already imported by all four hotspot lens files).

## Evidence
- `scripts/drift-ai/coldspots.ts:199-211` — `loadBaseline`, byte-identical to hotspots copy.
- `scripts/drift-ai/hotspots.ts:157-169` — `loadBaseline` duplicate (verified identical).
- `scripts/drift-ai/hotspots-churn.ts:66-81` — `withContext`; identical body in fragmentation (109-124) and thrash (203-215).
- `scripts/drift-ai/hotspots-fragmentation.ts:109-124` — `withContext` duplicate.
- `scripts/drift-ai/hotspots-thrash.ts:203-215` — `withContext` duplicate.
- `scripts/drift-ai/hotspots-suppression-churn.ts:99-114` — near-variant `withContext` (custom `-G` inspectCommand).
- `scripts/drift-ai/hotspots-coupling.ts:169` — near-variant `withContext` (`touchesBoth` + `sweepCap`).
- `scripts/drift-ai/coldspots-format-sections.ts:128-143` — `appendRowContext` + `formatAuthor`, byte-identical bodies to hotspots copy.
- `scripts/drift-ai/hotspots-format-sections.ts:152-175` — `appendRowContext` + `formatAuthor` (entry is a 5-way hotspot union).
- `scripts/drift-ai/coldspots-aggregate.ts:128-136` / `:63-70` — `newestTimestamp` / `updateTouchDates`; `:62` carries the "copied from the thrash pattern" comment.
- `scripts/drift-ai/hotspots-thrash.ts:131-139` / `:122-129` — `newestTimestamp` / `updateTouchDates` originals.

## Proposed fix
TDD: add/extend the colocated `*.test.ts` for whichever shared module gains each helper, then point the duplicate call sites at it and delete the copies. Affected existing tests to re-run: `hotspots-actionability.test.ts`, `hotspots-churn.test.ts`, `hotspots-fragmentation.test.ts`, `hotspots-thrash.test.ts`, `hotspots-suppression-churn.test.ts`, `hotspots-history.test.ts`, `coldspots-coldspot.test.ts` (run via `bun run test:scripts:file -- <file>`).

1. **`loadBaseline`** — move to a shared spot (e.g. a small `drift-ai-cli.ts` helper, or `hotspots-history.ts`). Export once, import in both `coldspots.ts` and `hotspots.ts`, delete both copies. Keep the exact `DriftAiError` messages.

2. **timestamp helpers** — move `newestTimestamp(records)` and a generic `updateTouchDates(agg, record)` into `hotspots-history.ts` (alongside `CommitRecord`). Type `updateTouchDates` against a structural `{ newestTouchMs: number | null; oldestTouchMs: number | null }` so both `FileAggregate` and `ThrashAggregate` satisfy it. Import into `coldspots-aggregate.ts` and `hotspots-thrash.ts`; delete the local copies (and drop the "copied from the thrash pattern" comment).

3. **`withContext`** — add a generic `withActionabilityContext<C extends { path: string }>(candidate, records, opts)` to `hotspots-actionability.ts`, parameterizing the touch predicate and `inspectCommand` so it covers all five lenses: default `touches = (r) => r.files.some(f => f.path === candidate.path)` and `inspectCommand = git log --oneline -- <quoted path>` (churn/fragmentation/thrash), with overrides for suppression-churn's `-G'<pattern>'` inspectCommand and coupling's `touchesBoth`/`sweepCap`. Have each lens call it and spread the result over its own hotspot type. If coupling's two-file predicate makes the generic ungainly, scope this step to the 3 identical sites (churn/fragmentation/thrash) plus suppression-churn and leave coupling as-is — note that in the PR.

4. **`appendRowContext` + `formatAuthor`** — move both into a shared `format-row-context.ts` keyed on a structural `RowContextLike` interface (`{ authors: HotspotAuthor[]; recentSubjects: string[]; commitIntent: ...; inspectCommand: string }`). Import from both `coldspots-format-sections.ts` and `hotspots-format-sections.ts`; delete the copies. `formatCommitIntentOverlay` is already imported in both, so the move is mechanical.

## Verification / caveats
- False-positive risk: low. Bodies were re-read and confirmed identical (or, for `withContext`/`updateTouchDates`, identical save the param type name).
- Scope boundary: `hotspots-coupling.ts:169` and `hotspots-suppression-churn.ts:99` are NOT verbatim duplicates — do not assume a blind merge is safe. Either generalize the shared helper to absorb their `touches`/`inspectCommand` differences or explicitly exclude coupling and say so in the PR.
- The structural-typing approach (steps 2 & 4) avoids importing concrete lens types into shared modules, keeping the `shared → server → client`-style layering of `hotspots-history.ts`/`hotspots-actionability.ts` clean. Prefer a structural interface over widening to the 5-way hotspot union, which would re-introduce coupling.
- Behavior must be byte-identical: these helpers feed deterministic text/JSON report output that golden tests assert on. Confirm no snapshot drift after the refactor.
- This is backlog prep only — nothing here is implemented.

# 22 — Reporting trust pass (findings-first, summary, chunk labels, skip reasons)

Status: Done
Track: A (architecture / single report)
Size: small–medium
Depends on: 21 (CheckOutcome / `skippedChecks: {check, reason}[]` / schemaVersion bump)
Blocks: none

## Goal

Fix the reporting trust gaps so the **with-findings** and **machine** output
paths are as informative as the clean path. The headline win is JSON
scope-trimming: on OpenClaw `--format json` is **1.68 MB and 64% of it is the
bare-path `scope` array** (~14,923 paths) while findings are ~12% — an agent
piping this to a model burns its window on a file inventory before seeing a
single finding.

## Background

Read [`01-shared-context.md`](./01-shared-context.md) and
[`02-seam-map.md`](./02-seam-map.md) first. Deeper rationale + before/after
mockups: `../drift-ai-review/ux-reporting.md` (H1, H2, H3, M1, M2) and
`../drift-ai-improvements.md` Part A (A1–A5).

This task consumes task 21's outputs: the `CheckOutcome` union, the upgraded
`skippedChecks: { check: DriftCheckId; reason: string }[]`, and the bumped
`DRIFT_SCHEMA_VERSION`. The report shape already changed in 21 (skippedChecks);
this task changes what `formatText`/`formatJson`/the chunker do with it.

## Seams to touch

All from seam-map **§6 (Reporting / chunking)**. Re-confirm anchors before
editing (grep the symbol).

- `report-format.ts:21–36` — `formatText`; header builder `formatTextHeader`
  (`:3–19`, including the `skipped:` line at `:15–17`); the clean/empty branch
  (`:23–29`); the `WARN check: file — message` / `FIX:` finding list (`:31–34`).
- `report-builder.ts:174–185` — `DriftReport` object construction; **the
  scope-then-findings key order** (`scope` at `:183`, `findings` at `:184`) that
  makes `--format json | head` show zero findings.
- `chunks.ts:5–36` — `groupFindingsForChunks` (groups by check via
  `groupFindingsByCheck`, slices at `chunkSize`, sets chunk `check = first.check`
  at `:31`). `chunkFilename` at `:85–87`
  (`${String(index).padStart(3,"0")}-${check}.json`). The per-chunk `check` field
  lives on `DriftFindingChunk` (`types.ts:42–53`) and `DriftChunkManifestEntry`
  (`types.ts:55–60`).
- `report-output.ts:23–38` — `writeReportOutputs`; the JSON-without-output-path →
  stderr-warn branch (`:33–35`).
- `cli-args.ts:24–39` — usage text (add `--include-scope`).

## What to do (mapped to ux-reporting findings)

### A1 — findings-first JSON, opt-in full scope (the headline win)
- In the `DriftReport` construction (`report-builder.ts:174–185`), emit `findings`
  **before** `scope`. `JSON.stringify` preserves insertion order, so this alone
  makes `--format json | head` surface signal.
- Make the full `scope` array **opt-in** behind a new `--include-scope` flag.
  By default omit the array and always emit `scopeCount: number`. The detector
  still computes scope internally — this is purely what `formatJson` writes.
- **Quantify the win in the PR/handoff:** measure `--format json | wc -c` on
  OpenClaw current scope before/after. Expect the payload to drop from ~1.68 MB
  to roughly the findings + header (the 64% scope array gone). Document the
  before/after byte counts.
- `cli-args.ts` usage: document `--include-scope` (off by default).

### A2 — findings summary (text + JSON)
- Text: add a `findings: N (duplicates X, ghost-files Y, comments Z, ...)` line to
  the header (alongside `scope:`/`skipped:`), so the with-findings path is at
  least as informative as the clean path's `OK: no findings from checks: ...`.
- JSON: add a `summary` object, e.g.
  `{ "total": N, "byCheck": { "duplicates": X, "ghost-files": Y, ... } }`.
  Only count checks that actually ran (skipped checks are reported separately via
  A4). Include ran checks with `0` findings in `byCheck`; omit skipped checks.
  Place `summary` near the top, before `findings`.

### A3 — chunk label truthfulness
- Today a size-slice can straddle check groups, so `001-duplicates.json` can hold
  ghost-files/comments findings and the manifest mislabels it.
- **Fix: chunk strictly per-check** — start a new chunk at every check boundary
  even below `chunkSize`, so a chunk never mixes checks and the `check` label +
  `NNN-<check>.json` filename are truthful. This is the most useful shape for
  "read the ghost-files chunk" agent handoff.
- Per-finding `check` fields are already correct inside the chunk; only the
  chunk-level label/filename is wrong.

### A4 — render skip reasons + fix the suppressions dead-end (M1)
- Consume task 21's `skippedChecks: { check, reason }[]`. Render the reason in
  text (e.g. `skipped: suppressions — only runs in changed scope`) and keep the
  structured `{check, reason}` in JSON.
- Fix the `--check suppressions --scope current` **contradictory dead-end**:
  today it prints both a `skipped:` line and `drift:ai: no implemented checks
  selected.` When `enabledChecks` is empty *because everything requested was
  skipped for the scope* (vs. genuinely unimplemented), say so — e.g.
  `drift:ai: suppressions is only available in changed scope; nothing to run.`
  The reason is already known from `skippedChecks`.

### A5 — same-file clone label (M2)
- When a duplicate's two sides are the **same file**, the current rendering reads
  like broken math: `monster-form-fields.tsx:436-474 — duplicates
  monster-form-fields.tsx:435-474`. Detect `primary.name === secondary.name` in
  the duplicates finding builder (`buildDuplicatesFindings`, seam-map §2 /
  `duplicates.ts`) and render a distinct message, e.g.
  `repeats within the same file at lines 435-474 (39 lines)`. This is a
  finding-builder wording change, not detector logic. Pair it with a tailored
  FIX hint ("extract the repeated block into a local component/helper") since the
  generic "reuse the existing helper" hint is wrong for a self-repeat (ux L4).

## Locked decisions

- **Chunking:** chunk strictly per check. Do not add neutral mixed-check chunk
  filenames or a `"mixed"` chunk type.
- **Summary JSON:** emit
  `{ total, byCheck: Record<DriftCheckId, number> }`; include only ran checks,
  including ran checks with `0` findings. Skipped checks stay in `skippedChecks`.
- **`--include-scope`:** JSON-only. Text output remains unchanged except for the
  new `findings:` summary line.

## Testing

- **Add a dedicated `chunks.ts` test** (none exists today): `chunkIndex` /
  `chunkCount` math, `orderedChunkChecks` / extras ordering, and the **A3
  boundary case** (a chunk never mixes checks under per-check chunking). Cover
  empty, single-oversized, and multi-check inputs.
- Unit tests for: the `summary` object/line (A2), skip-reason rendering + the
  suppressions dead-end message (A4), and the same-file-clone message + hint (A5).
- Optionally a focused `report-output.ts` test for the JSON-without-output-path
  stderr branch (`:33–35`).
- **OpenClaw validation (read-only):** run current scope `--format json` before
  and after; record `wc -c` and the scope-array share. Expect the payload to
  shrink dramatically once `scope` is opt-in (per 01-shared-context: ~1.68 MB,
  64% scope). Confirm `--include-scope` restores the full array. Confirm
  `--format json | head` now shows findings, not paths.
- Run the full drift-ai suite + `bun run verify:changed` with changes staged.

## Out of scope

- `--fail-on-findings` / opt-in non-zero exit (A6) — that is task 50.
- The `CheckOutcome` union and `skippedChecks` shape themselves — produced by
  task 21; this task only renders them.
- Normalizing the per-check finding shape / documenting it (ux M3) and the
  duplicates `relatedFiles` polish (ux L3) — optional follow-ups, not required
  here.
- Wiring `harness-freshness` into `--format`/`--output`/chunks (ux L1) — separate.

## Done notes

- JSON rendering now emits `summary`, then `findings`, then `scopeCount`; the full
  `scope` array is omitted unless `--include-scope` is passed.
- OpenClaw current-scope JSON (`--root src --root packages --root apps --root
  extensions --root ui --root config`) dropped from **1,673,333 bytes** to
  **217,984 bytes** by default. `--include-scope` restored the full payload at
  **1,673,613 bytes**.
- Text reports include a `findings:` summary line. Skip reasons render in text,
  and `--scope current --check suppressions` now says suppressions is only
  available in changed scope instead of reporting that no implemented checks were
  selected.
- Chunk files are strictly per-check, with dedicated coverage in
  `scripts/drift-ai/chunks.test.ts`.
- Same-file duplicate findings now use local-repeat wording and a local
  extraction hint.
- Verification: full drift-ai suite passed via
  `bun test scripts/drift-ai.test.ts scripts/drift-ai/*.test.ts`; staged
  `bun run verify:changed` passed.

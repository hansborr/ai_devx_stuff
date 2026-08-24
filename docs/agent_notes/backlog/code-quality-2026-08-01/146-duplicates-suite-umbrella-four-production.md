# 146. `duplicates.test.ts` hides three production modules’ tests inside one umbrella suite

Status: Landed on fix/cq-146
Theme: discoverable test ownership · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/drift-ai/duplicates.test.ts` began as the suite for `duplicates.ts`,
but it is now also the central test authority for runner orchestration,
duplicates plugin wiring, and JSCPD binary resolution. Contributors changing
`duplicates-runner.ts`, `duplicates-check.ts`, or `jscpd-bin.ts` must know that
their focused tests live under another production module's filename.

The 1,039-line umbrella also accumulates unrelated imports and setup. A focused
runner change loads parsing fixtures and plugin construction; a binary resolver
change shares a file with current-scope duplicate analysis. Filename-based
discovery and code-intel covering-test lookup do not reveal the intended
subject ownership cleanly.

The existing describe boundaries already separate the four authorities, so
this can be repaired by relocating intact blocks without reorganizing
production code or changing assertions.

## Evidence

- `scripts/drift-ai/duplicates.test.ts:7-39` — the import header reaches ten
  distinct relative modules, spanning the duplicates core, runner,
  `duplicatesCheck`, `resolveJscpdBin`, CLI/config construction, matching, and
  detector scope.
- Re-derived from `scripts/drift-ai/duplicates.test.ts`: the file is 1,039
  lines with 11 describe blocks and 53 test declarations—52 plain `it`
  declarations and one parameterized `it.each` table.
- `scripts/drift-ai/duplicates.test.ts:94-472` — six describes cover the
  contracts owned by `duplicates.ts`: report parsing, configuration,
  normalization, changed-file filtering, finding construction, and scope
  mapping.
- `scripts/drift-ai/duplicates.test.ts:474-927` — `runDuplicatesCheck` and
  `defaultJscpdRunner` occupy 454 lines and exercise runner orchestration,
  warning behavior, subprocess arguments, and timeout handling.
- `scripts/drift-ai/duplicates.test.ts:929-947` — a separate describe exercises
  `duplicatesCheck.runWithSelectedConfig`, while its input factory lives at
  `:69-91`.
- `scripts/drift-ai/duplicates.test.ts:963-1030` — six cases are the complete
  subject-matched coverage for `resolveJscpdBin`; no
  `jscpd-bin.test.ts` currently exists.
- `scripts/drift-ai/duplicates.test.ts:1032-1039` — the final
  `JSCPD_SUPPORTED_EXTENSIONS` describe belongs to `duplicates.ts`, not the
  runner or binary resolver.

## Proposed direction

Split the existing describe blocks into production-module-matched sibling
suites. Keep all test bodies, names, parameter rows, and assertions unchanged.

1. **Create only the necessary shared helper seam.** Move
   `currentDetectorScope` (`duplicates.test.ts:65-67`) into
   `scripts/drift-ai/duplicates.test-helper.ts`, because the moved runner and
   plugin suites both consume it. Move `changedDetectorScope`
   (`duplicates.test.ts:61-63`) with `duplicates-runner.test.ts`; only the
   runner tests consume it. The retained core tests consume neither helper. The `.test-helper.ts`
   suffix is required so the file retains the repository's test-only
   type-assertion treatment.

   Keep `readFixture`, `makeClone`, and `parsedReport` with
   `duplicates.test.ts`; they serve only the retained core blocks. Helpers with
   one consuming suite move with that suite rather than growing the shared
   helper.

2. **Create `duplicates-runner.test.ts`.** Move the
   `runDuplicatesCheck` and `defaultJscpdRunner` describes at `:474-927`.
   Although `outputDirFromArgs` and `flagValue` are lexically located at
   `:949-961`, their only consumers are the runner tests at `:859` and
   `:889-891`, so move both helpers with this suite. Repartition the
   `duplicates-runner.ts`, matcher, filesystem, and runner-type imports here.

3. **Create `duplicates-check.test.ts`.** Move only the
   `"duplicates check service wiring"` describe at `:929-947` and its
   `makeDuplicatesPluginInput` factory at `:69-91`. Import
   `currentDetectorScope` from the new test helper; keep CLI/config and
   `CheckRunInput` dependencies local to this suite.

4. **Create `jscpd-bin.test.ts`.** Move the `resolveJscpdBin` describe at
   `:963-1030` and only its path and resolver dependencies.

5. **Leave `duplicates.test.ts` authoritative for `duplicates.ts`.** Retain
   `:94-472` and the `JSCPD_SUPPORTED_EXTENSIONS` block at `:1032-1039`, then
   prune imports that moved to the three sibling suites.

The relocation must remain reviewable as pure motion. Across the four suites,
retain all 11 describes and all 53 test declarations, including every row of
the existing `it.each` table. Each suite can be addressed through the existing
`bun run test:scripts:file -- <file>` command.

## Scope / caveats

- No production file changes are in scope. Do not restructure
  `scripts/drift-ai/`, rename production modules, or alter duplicate detection,
  JSCPD invocation, plugin selection, or binary resolution.
- Keep the existing `scripts/drift-ai/fixtures/` layout. `readFixture` stays in
  `duplicates.test.ts` unless an intact moved block is found to consume it.
- New scripts Vitest files are auto-discovered. No
  `harness.controls.json`, generated coverage-map, config-surface, or
  smoke-subject registration should be added.
- Shared helpers require at least two consuming suites. In particular,
  `outputDirFromArgs` and `flagValue` belong in `duplicates-runner.test.ts`,
  not the shared helper, on the pinned tree.
- Import repartitioning can expose unused imports even when the moved bodies are
  unchanged; clean those imports without opportunistic test rewrites.
- **CQ25-155 is a do-not-reopen on splitting root
  `scripts/drift-ai.test.ts` only and does not cover this file.** The dropped
  step in
  [34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md) concerned a different
  2,765-line barrel whose proposed split was pure motion without the claimed
  subject-colocation benefit. Here, independently named production modules
  have their covering suites hidden under `duplicates.test.ts`, which is the
  discovery cost this split repairs.

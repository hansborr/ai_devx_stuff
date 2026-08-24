# 166. Valid triage-report scenarios repeat transport envelopes instead of their deltas

Status: Landed on fix/cq-166
Theme: typed fixture builders · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The valid-contract portion of `triage-report.test.ts` repeatedly inlines complete drift, Semgrep, and Dolos transport objects. The behavior under test is usually a particular row, merge, or policy decision, but contributors must scan past schema versions, advisory headers, lane names, and empty metadata arrays to find that delta.

This makes scenario intent harder to review and turns transport-contract maintenance into many synchronized fixture edits. Some repetition is intentional in parser-rejection tests, where the malformed raw object is itself the subject; the valid scenarios do not need that representation.

## Evidence

- `scripts/drift-triage/triage-report.test.ts` is exactly 1,144 lines. Valid `buildTriageReport` scenarios occupy `:12-978`, while raw `parseTriageInput` rejection scenarios occupy `:980-1125`.
- A full-file count finds 25 `schemaVersion: 4` properties, 15 advisory envelopes, 15 prototype lane properties, 14 empty `prerequisites`, 14 empty `degradations`, and 13 empty `caps` arrays in `scripts/drift-triage/triage-report.test.ts`.
- Of those totals, the valid-contract block at `scripts/drift-triage/triage-report.test.ts:12-978` contains 20 schema-version properties, 12 advisory/lane envelopes, 11 empty `prerequisites`, 11 empty `degradations`, and 10 empty `caps` arrays. The larger totals must not be used to justify rewriting malformed-contract cases.
- Two adjacent Semgrep scenarios repeat the full advisory shape at `scripts/drift-triage/triage-report.test.ts:57-105` and `:111-150`, even though their relevant differences are the rows.
- One test already introduces local `dolosRow` and `dolosInput` builders at `scripts/drift-triage/triage-report.test.ts:837-859`, but their scope prevents reuse by the rest of the file.
- Existing contract types already model drift reports, Semgrep rows, Dolos rows, and both advisory envelopes at `scripts/drift-triage/triage-report-contracts.ts:7-29`, `:45-83`, and `:85-107`.

## Proposed direction

Add typed `driftInput`, `semgrepInput`, `dolosInput`, and row-builder helpers inside `triage-report.test.ts`, then rewrite valid-contract cases to state only their per-case deltas.

Place the builders near the existing `input` helper at `scripts/drift-triage/triage-report.test.ts:8-10` and type their rows and overrides from `triage-report-contracts.ts`. Keep routing the constructed objects through `input` and `parseTriageInput`; the abstraction must reduce fixture noise without bypassing the parser exercised by the suite.

Promote the local Dolos builders at `:837-859` into this shared file-local vocabulary and add equivalent defaults for drift and Semgrep rows. Allow explicit typed overrides for semantically relevant fields such as caps, prerequisites, scan provenance, section totals, and input paths.

## Scope / caveats

- Leave the malformed-contract cases at `scripts/drift-triage/triage-report.test.ts:980-1125` as explicit raw objects. Their omissions, invalid values, and contradictory totals are the assertions.
- Do not move these test-data builders into production modules or change the production transport contracts.
- Defaults must cover only valid, irrelevant envelope values. A scenario that exercises a non-empty cap, degradation, prerequisite, skipped-check list, or coverage field must continue to spell out that value.
- Retain direct coverage of `parseTriageInput`; returning pre-parsed `TriageInput` objects from the builders would weaken the suite.

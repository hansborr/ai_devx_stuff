# 13 - harness:audit fusion consumer

Status: Done
Track: Dg
Size: medium
Depends on: 11, 12
Blocks: 14

## Goal

Add `bun run harness:audit`, a report-only command that consumes shared
diagnostics envelope files and renders one bounded human and JSON report.

## Background

The useful harness pattern here is not another AI reviewer. It is a boring spine:
multiple deterministic tools emit one schema, then one consumer validates and
summarizes the envelopes for scheduled or manual review.

`lint:ratchet` already emits this exact `HarnessDiagnostics` envelope today
(`scripts/lint-ratchet-output.ts`, env `HARNESS_DIAGNOSTICS_OUTPUT`) and is
already a first-class `tool` id, so it needs no projection task. Build and
validate the consumer against `lint:ratchet` plus the `drift:ai` and
`logs:audit` envelopes from tasks 11 and 12 so the scheduled lane has the full
producer set on day one. The consumer stays report-only even when an input
envelope carries `block`-severity findings; it summarizes, it never gates.

## Seams to touch

- `package.json`
- a new script such as `scripts/harness-audit.ts`
- tests beside the new script
- `docs/ai-harness.md`
- `scripts/test-test-scripts.sh`, only if changed-file selection needs a smoke
  update.

## What to do

1. Add `bun run harness:audit` with positional envelope-file inputs,
   `--format text|json`, and optional `--output <path>` if that matches nearby
   script patterns.
2. Read envelope files passed via CLI first (e.g. run a producer with
   `HARNESS_DIAGNOSTICS_OUTPUT=path`, then pass `path` to `harness:audit`).
   Exercise the live `lint:ratchet`, `drift:ai`, and `logs:audit` envelope
   shapes where practical. Do not run child producer commands in this first
   slice.
3. Validate every envelope with `harnessDiagnosticsSchema`.
4. Render a concise report grouped by tool, with totals and per-control counts.
5. Distinguish findings, skipped checks, and infrastructure failures.
6. Keep report-only semantics: findings do not fail the command; malformed
   envelopes and failed child commands do.
7. Document that this is an artifact generator, not an edit-loop gate.

## Testing

- Unit-test the formatter with clean, findings, skipped, and malformed envelope
  fixtures.
- Include a real `lint:ratchet` envelope fixture so multi-tool grouping is
  exercised against an existing producer, not only the new ones.
- Add a CLI smoke using fixture envelope files or stubbed child commands.

## Out of scope

- GitHub Actions scheduling.
- PR comments.
- Running child producer commands; split that if file-input consumption proves
  useful.
- Promoting findings to failures.
- Adding new drift checks.

## Outcome (Done 2026-06-03)

Landed `bun run harness:audit` as `scripts/harness-audit.ts` plus
`scripts/harness-audit.test.ts` (23 Vitest cases).

- Positional envelope-file inputs, `--format text|json`, optional `--output
  <path>` (mirrors `scripts/harness-emit-envelope.ts`). No child producer
  commands are run in this slice.
- Every input is validated with `harnessDiagnosticsSchema`. The report groups
  findings by tool with totals and per-control severity counts; envelopes that
  share a tool id merge into one group listing every source file. `block`/`warn`
  are findings, `info` is the skipped/non-result tier, and unreadable/malformed
  inputs are a separate "infrastructure failures" section.
- Report-only: findings (even `block`) never change the exit code; only an
  unreadable or malformed envelope (or an unwritable `--output`) exits 2. A
  footer and `--help` state it is an artifact generator, not an edit-loop gate.
- Fixtures under `scripts/harness-audit/fixtures/`: a real captured clean
  `lint:ratchet` envelope, a real-shaped `lint:ratchet` findings envelope, a
  real captured `logs:audit` findings envelope, real/real-shaped `drift:ai`
  skipped + warn envelopes, and a malformed `.txt`. The CLI smoke reads real
  fixture files through the default fs reader.
- Registered `sensor/harness-audit` in `harness.controls.json` (regenerated
  `docs/generated/harness-controls.md`) so `harness:check` parity passes, added
  the inventory row + diagnostics-gap update in `docs/ai-harness.md`, and added
  coverage-map rows (entrypoint, test, fixtures glob).

Follow-up left for task 14: a scheduled lane can run the producers with
`HARNESS_DIAGNOSTICS_OUTPUT=<path>` and feed those files to `harness:audit`.

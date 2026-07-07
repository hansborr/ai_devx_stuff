# 40. Dedupe ratchet `--allow-worse` boilerplate

Status: Done — implemented on lane/lint-msg-ratchet-fix.
Lens: ratchet · Area: noise · Severity: med · Size: S-M · Confidence: med-high
Theme: per-finding-repetition · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Every regression finding's `howToFix` embeds the full ~150-char
`` or run `bun run lint:ratchet:update -- --allow-worse --reason "<...>"` ``
fallback. A 20-file regression prints 20 near-identical copies; the
placeholder boilerplate dominates the output while the per-finding signal
(file, rule, delta) drowns. Separately, `baseline-update.ts` duplicates the
same fallback text across three refusal branches with slightly different
lead-ins.

## Evidence
- `scripts/lint-ratchet/diagnostics.ts:44-72` — the three metric-variant
  fix texts, each embedding the full allow-worse command.
- `scripts/lint-ratchet/baseline-update.ts:97-103,129-146` —
  `formatOrphanFailure` + two `resolveRetire` branches, three copies of the
  same suffix.
- `scripts/lint-ratchet/recovery-command.ts` — the single-sourced command
  constants (the right mechanism; the issue is per-finding placement).

## Proposed direction
(a) State the allow-worse escape hatch once per run — in the stderr
summary/footer (`default-mode.ts`) and/or one envelope-level note — and
shorten each finding's `howToFix` to the finding-specific action ("reduce
from N back to baseline M").
(b) Factor the three `baseline-update.ts` lead-ins over one
`orphanAcceptanceSuffix()` helper.

## Scope / caveats
- Design tension to resolve explicitly: harness-diagnostics findings may be
  consumed individually (JSON), where a per-finding `howToFix` is meant to
  be self-contained. Options: keep the command in the *first* finding only;
  or keep a short per-finding form ("…or accept debt — see run summary")
  with the full command once. Record the choice in this leaf.
- Update `lint-ratchet-report.ts` rendering and its fixtures
  (`scripts/fixtures/lint-ratchet-report/`).

## Implementation
Choice: each regression finding now keeps the file-specific fix and points to
the run summary recovery command if the new debt is intentional. The full
`--allow-worse --reason` command is printed once in default-mode stderr and in
the report footer. `baseline-update.ts` also routes update refusal suffixes
through one helper so orphan/removal messages stay consistent.

Focused coverage: `lint-ratchet-baseline.test.ts`,
`lint-ratchet-output.test.ts`, `lint-ratchet-report.test.ts`,
`scripts/fixtures/lint-ratchet-report/lint-ratchet-report-regression.json`.

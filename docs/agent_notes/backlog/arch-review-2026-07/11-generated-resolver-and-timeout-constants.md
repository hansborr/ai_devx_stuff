# 11. Emit resolver dispatch + hook timeout constants into generated shell

Status: Done — implemented 2026-07-07 on branch
`chore/arch-11-generated-constants`.
Commits: `942e6c94` (`fix(harness): generate dynamic resolver dispatch`) and
`d6867b56` (`fix(harness): generate hook timeout constants`).
Size: S-M · Severity: med · Risk: low-medium, mostly mechanical
Source: 00-report.md T3 / A2 (the piece not folded elsewhere — see
01-promotion-map.md for the T2 and T4 folds)

## Problem

Two TS↔bash contracts are reconciled by tripwire instead of single-sourced:

- Dynamic slot resolvers are declared in TS
  (`scripts/harness/verify-step-schema.ts` `VERIFY_STEP_DYNAMIC_RESOLVERS`)
  and implemented as bash `case` arms in
  `scripts/verify/steps-lib.sh:155-169`; the only guard is
  `harness-check.ts:251-270` doing a substring match on a close-paren.
- Hook watchdog timeouts are duplicated between shell and manifest,
  reconciled by `checkHookTimeoutConstants` (`harness-check.ts:393`).

## Scope

Emit both into generated bash the shells source — `steps.generated.sh`
already emits `MUSI_VERIFY_SLOT_DYNAMIC`, so the pattern is established; a
generated constants file does the same for timeouts. Converts
reconciled-by-test into impossible-by-construction. Retire (or downgrade to
freshness checks) the two harness-check reconciliation checks they replace.

## Done criteria

- Resolver dispatch and timeout constants have one authoritative source; the
  bash copies are generated with `--check` freshness like the house style.
- The old substring-match and constant-comparison tripwires are removed or
  reduced to generated-freshness assertions.

## Verification

- `bun run harness:check` green; focused generator tests; a pre-commit run
  exercising a dynamic slot.

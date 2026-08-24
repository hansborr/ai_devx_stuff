# 206. Single-source memory-wait timeout validation across verification entry paths

Status: Landed on fix/cq-206
Theme: Memory-wait timeout validation diverges across verify entry paths · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`MUSI_VERIFY_MEMORY_WAIT_TIMEOUT` has different validation contracts depending
on how verification is entered. Parallel verification and direct-tool
admission accept any digit string, including values outside the integer range
that Bash arithmetic can safely consume. Pre-commit alone normalizes and
bounds the value before applying its own shorter policy cap.

A sufficiently large decimal can therefore pass initial validation and reach a
numeric comparison that cannot represent it reliably. The same operator
setting is safe or unsafe depending on its entry path, and future changes must
keep the validators synchronized manually.

## Evidence

- `scripts/verify/steps-lib.sh:257-263` — the parallel pending-slot scheduler
  rejects non-digits but accepts every non-empty digit string.
- `scripts/verify/steps-lib.sh:310-311` — that accepted value is later used as
  the right operand of a Bash numeric comparison.
- `scripts/lib/tool-memory-admission.sh:33` and
  `scripts/lib/verify-engine.sh:758` — direct-tool and serial admission both
  call `musi_memory_budget_wait_and_reserve`.
- `scripts/verify/memory-budget.sh:436-461` — that function repeats the
  digit-only validation and then feeds the value to the same kind of
  elapsed-time comparison.
- `.husky/pre-commit:315-335` — pre-commit separately validates digits, strips
  leading zeroes, and rejects normalized values above
  `9223372036854775807`.
- `.husky/pre-commit:336-345` — only after that range check does pre-commit
  apply its distinct 30-second policy cap and export the timeout.

## Proposed direction

Add one small Bash parser beside `scripts/verify/memory-budget.sh`, in a
separately sourceable sibling library so pre-commit can use it before slot
preparation. The parser should accept non-empty decimal whole seconds,
normalize leading zeroes, compare decimal length and lexical value against the
supported signed-integer maximum without first invoking shell arithmetic, and
return the normalized value.

Use that parser from both scheduling forms:
`musi_drain_memory_pending_slots` in `steps-lib.sh` and
`musi_memory_budget_wait_and_reserve` in `memory-budget.sh`. Have pre-commit
call the same parser, then apply its existing 30-second cap as a separate
policy step.

Add boundary coverage for empty and non-digit input, leading zeroes, zero, the
maximum supported value, and values one digit or one unit beyond the maximum.
Exercise the shared behavior through the existing verify and direct-tool
memory-admission tests, while keeping pre-commit coverage for normalization
and the independent cap.

## Scope / caveats

- Preserve pre-commit's 30-second cap as a distinct policy layer; do not bake
  it into the shared parser or impose it on direct verify and direct-tool
  entry paths.
- Reject every value that Bash numeric comparisons cannot safely consume, and
  ensure range checking itself does not parse the untrusted decimal
  arithmetically.
- Preserve the current defaults, whole-second semantics, timeout behavior, and
  valid-input diagnostics apart from sharing validation.
- [110-parallel-verify-dependencies-hidden.md](./110-parallel-verify-dependencies-hidden.md)
  covers artifact dependency data in the parallel scheduler and explicitly
  separates memory-scheduler hygiene. This leaf does not extend or redesign
  that dependency work.
- No prior-pack record covers memory-wait timeout validation across these
  entry paths.

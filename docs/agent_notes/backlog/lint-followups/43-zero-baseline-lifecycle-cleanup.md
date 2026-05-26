# Zero-Baseline Lifecycle Cleanup

Status: Parked
Source: zero-baseline audit automation review follow-up, 2026-05-25

## Context

`bun run lint:ratchet:zero-baseline` is now available as report-first audit
automation. It validates the committed baseline, finds drained ratchets, checks
their normal ESLint resolved-rule coverage, and names the lifecycle action to
take.

Current audit output:

- Zero-baseline ratchets: 44
- Normal-lint error coverage: 8
- Documented ratchet-only lifecycle: 0
- Needs lifecycle action: 36

## Scope

Decide the lifecycle path for the remaining rows instead of treating the audit
command as cleanup by itself. For each zero-baseline ratchet, either:

- promote matching rule/options to normal ESLint at `error` and remove the
  ratchet;
- narrow or retire a ratchet already covered by normal lint;
- add `zeroBaselineDisposition` metadata with a durable blocker and exit path;
- intentionally keep a narrow ratchet-only floor and document why normal lint
  is not the owner.

Do not batch all 36 rows blindly. Split by rule family or file surface so each
change can review normal ESLint scope, ignored files, parser setup, and any
unrelated findings exposed by promotion.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update` after removing or changing ratchets
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint

# 15. Rule-source drift is classified by regexing human error text — brittle recovery guidance

Status: Done — implemented on fix/lint-ratchet-correctness-lane.
Lens: ratchet · Area: validation errors · Severity: low · Size: S · Confidence: high
Theme: robustness · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`rule-source-drift.ts` decides whether a baseline validation failure is
rule-source drift (which has dedicated recovery guidance: re-run update after
a rule edit) by string-matching the human-readable validation message. Any
rewording of the validation text silently downgrades drift to the generic
invalid-baseline path, and the user loses the targeted "your rule changed,
run update" guidance. Message text is currently doing double duty as an API.

## Evidence
- `scripts/lint-ratchet/rule-source-drift.ts:12-25` — string-match classification. Verified 2026-07-04.
- `scripts/lint-ratchet/baseline-validation.ts:47-50` — the message being matched; `scripts/lint-ratchet/default-mode.ts:41-55` — consumer.

## Proposed direction
Give validation failures a structured shape: `{ code: "rule-source-drift" |
"config-hash-mismatch" | ..., message }` (or typed error subclasses), and
classify on `code`. Keep messages free to improve. Add a test that fails when
someone adds a new validation failure without a code.

## Scope / caveats
- Pure refactor of an internal seam; no behavior change intended — pin with
  existing tests.
- One commit.

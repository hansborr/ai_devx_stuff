# 44. Manifest `dynamic` resolver ids bind to steps-lib.sh cases only by convention

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: verify-pipeline · Area: harness-generation · Severity: low-med · Size: S · Confidence: med
Theme: implicit-invariants · Source: harness review 2026-07-06 (Sonnet breadth, generator sub-audit)

## Problem
`verify-step-schema.ts` validates a slot's `dynamic` field against the
enum `VERIFY_STEP_DYNAMIC_RESOLVERS` (`precommit-test-timings`,
`staged-script-classifier`), but the behavior each id names lives in
hand-written shell `case` arms in `scripts/verify/steps-lib.sh`. The
binding is convention-only: a renamed/removed `case` arm falls through
the `:-}` default silently, no generator or `harness:check` failure. The
schema also documents `condition` as prose-only — behavior drift between
a slot's `condition` text and the shell is likewise undetectable.

## Evidence
- Enum: `scripts/harness/verify-step-schema.ts` (`VERIFY_STEP_DYNAMIC_RESOLVERS`);
  prose-only `condition` note at `:24-25`.
- Shell dispatch: `scripts/verify/steps-lib.sh:151-159` — unmatched key
  falls through quietly.

## Proposed direction
Cheapest: a `harness-check.ts` (or generate-verify-steps test) probe that
greps `steps-lib.sh` for a `case` arm per enum member and fails on a
missing one — crude but drift-proof in the common rename case. Add
cross-reference comments on both sides regardless. For `condition` prose,
a comment noting it is documentation-only already exists in the schema;
mirror it in the manifest controls so editors see it.

## Scope / caveats
Do not over-engineer: a literal-string presence check is enough; parsing
shell for semantics is out of scope. One commit.

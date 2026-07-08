# 60. Coverage-map checker never flags contradictory rows — a file is both `excluded` and `linted` today

Status: Done — conflicting-coverage finding landed; live `eslint-rules/vitest.config.ts` and broad `test/**` map contradictions fixed.
Lens: inventory · Area: coverage map · Severity: med · Size: M · Confidence: high
Theme: inventory-honesty · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The checker validates rows independently: stale paths, unknown ratchet ids,
invalid status words, and files matched by *no* row. A file matched by two
rows with contradictory statuses passes silently — and a live instance
exists: `eslint-rules/vitest.config.ts` is `excluded` at
`lint-coverage-map.md:342`, `linted` at `:398`, with prose at `:64` asserting
it "remains excluded" — while `--print-config` shows it is actually
lint-reachable. The map is the inventory the ratchet leans on for its
"every maintained surface has an owner" claim (harness-review leaf 71
tightened the *claim wording*; the checker still can't see contradictions).

## Evidence
- `docs/generated/lint-coverage-map.md:62-64,342,398` — the live contradiction. Verified 2026-07-04 (including reachability probe).
- `scripts/lint-coverage-map-check-findings.ts:37-128` — finding kinds enumerated; `collectUnaccountedFileFindings:119-128` only flags zero-match files. Verified.

## Proposed direction
Add a `conflicting-coverage` finding: for every tracked file matched by more
than one row, the matched rows' statuses must be *compatible* (define the
compatibility table explicitly: e.g. `linted+ratcheted` compatible,
`excluded` compatible with nothing except `not-code`… encode, don't prose).
Fix the vitest.config.ts rows (decide which status is true — reachability
says `linted`) and correct the stale prose in the same commit. Consider also
verifying row *file counts* if rows carry them (part of the leaf-71
follow-through; check what remains claimed-but-unchecked).

## Scope / caveats
- Multi-row matching is legitimate (family row + specific row); the
  compatibility table is the design decision — keep it small and documented
  in the checker.
- One commit: checker + map fix + tests.

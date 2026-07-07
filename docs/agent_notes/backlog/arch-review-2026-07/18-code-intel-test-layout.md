# 18. Split code-intel's root test file into co-located suites

Status: Pending
Size: S-M · Severity: low
Source: 00-report.md T6/Tier 3 (test-layout inconsistency)

## Problem

drift-ai and lint-ratchet co-locate ~1:1 tests; code-intel concentrates 2437
lines in root `scripts/code-intel.test.ts` plus one in-dir `.spec.ts`.

## Scope

- Split root `scripts/code-intel.test.ts` into co-located
  `scripts/code-intel/*.test.ts` suites along the module seams.
- Standardize `.test.ts` vs `.spec.ts` within the code-intel family while in
  there.
- Mechanical move: no assertion changes; keep any shared fixtures/helpers in
  one obvious place.
- Check the memory/gotcha surface first: moved test files may need
  registration updates (path-policy subjects, coverage-map rows) — sweep the
  same registries a new script test needs.

## Verification

- `bun run test:scripts:file -- <each new file>` green; full scripts test
  slot green; `bun run harness:check` green if any registry rows moved.

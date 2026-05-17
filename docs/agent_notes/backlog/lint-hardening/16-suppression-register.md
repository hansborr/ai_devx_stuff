# Leaf 16: Suppression Register

Status: Hard-gate landed (2026-05-16)
Depends on: early lint leaves preferred

## Problem

Musi already gates ESLint-disable hygiene and reports newly added TypeScript and
Stryker suppressions through `drift:ai --check suppressions`. It does not have
a current-state register for all TypeScript and Stryker suppressions with
grouping, `missing-only`, and checked-mode semantics.

## Decision

Keep `eslint-disable-register` as the ESLint-disable hard gate. Add a separate
broader scanner for `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, and
Stryker suppressions.

Do not fold every suppression dialect into one tool. Two narrow tools with
overlapping inputs but distinct ownership are better than one broad tool that
must model every suppression dialect edge case.

Do not extend `drift:ai` into the current-state register by default.
`drift:ai` is a multi-detector aggregator for audit and diff-scoped checks; a
suppression register is a single concern.

## Responsibility Table

| Surface | Tool | Responsibility |
|---|---|---|
| Broad or malformed ESLint disables | `scripts/eslint-disable-register.sh` | Hard gate for ESLint-disable shape and broad-disable allowlists. |
| Newly added suppressions in changed work | `bun run drift:ai --check suppressions` | Diff-scoped/report-oriented signal for agents reviewing current work. |
| Current-state TypeScript and Stryker suppressions | This leaf's new register | Inventory, grouping, reason-text policy, JSON/missing-only output, and eventual checked mode. |

Keep these responsibilities separate unless a later maintenance problem proves
the split is causing drift.

## Candidate Work

- Build a new script such as `scripts/suppression-register.sh`.
- Scan current-state `@ts-*` and Stryker suppressions, modelled on the existing
  `eslint-disable-register` shape.
- Reuse `drift:ai` parser code where practical, but keep the user-facing tool
  narrowly owned.
- Emit readable text on stdout by default, stderr only for warnings/pointers,
  `--format json`, optional `--output`, and non-failing findings while
  report-only.
- Add a separate checked mode or wrapper only after the baseline is clean.
- Strongly discourage `@ts-ignore` in favor of `@ts-expect-error`.
- Require reason text after `--` for `@ts-expect-error`, `@ts-ignore`,
  `@ts-nocheck`, and Stryker suppressions.
- Consider an allowlist for file-level `@ts-nocheck`, similar to broad
  `eslint-disable` allowlists.

## Implementation Result

Leaf 16 v1 landed `scripts/suppression-register.sh` as a pure-shell
current-state scanner for TypeScript and Stryker suppressions, plus
`scripts/test-suppression-register.sh` and `scripts/test-scripts.sh` smoke
wiring.

The v1 script was report-only: it printed policy warnings and always exited 0
while the baseline was cleaned.

The hard-gate flip landed in the close-out leaf after the separator migration
cleared the baseline policy warnings. The register now prints `FAIL:` for the
four policy violations, exits 1 when any are present, and is wired into
`scripts/doctor.sh` next to `eslint-disable-register`.

The v1 policy checks are:

- missing `-- reason` text;
- `@ts-ignore` deprecation in favor of `@ts-expect-error`;
- `@ts-nocheck` outside the local allowlist;
- broad `Stryker disable` instead of `Stryker disable next-line`.

Baseline counts and policy-warning sites are captured in
`docs/agent_notes/finished_work/lint-hardening-leaf-16-suppression-register-baseline.md`.

## Followups

- Migrate any future or reintroduced `@ts-ignore` sites to
  `@ts-expect-error`.

## Eventual End State

`eslint-disable-register` and the new TypeScript/Stryker scanner run
independently from `verify:changed` and pre-commit. Only consider merging them
later if there is evidence the two-tool shape has caused drift, and only after
both have equivalent shell-test coverage.

Keep the diff-scoped `drift:ai --check suppressions` report-only until current
state and changed-state behavior are both low-noise.

## Verification

- `bun run test:scripts:changed`
- Targeted script tests for text, JSON, `missing-only`, output file, and checked
  mode behavior when added.
- `bun run drift:ai --scope current`
- `bun run verify:changed`

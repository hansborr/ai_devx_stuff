# Scope Flaky-Test Guidance to Evidence

Status: Proposed — revise before promotion; structured registry contract required
Date: 2026-07-21
Priority: P2-P3

## Problem

Every failed wrapped script whose name contains `test` or `e2e` receives the
same flaky-test note, including deterministic unknown-option and configuration
failures. `failure-guidance.sh` has known-token matching, but no independent
load/isolation matcher, and its token source currently includes closed registry
entries.

## Scope

- Give each observed-flaky entry explicit active/closed status and a structured
  signature subsection. Do not infer lifecycle from the first prose paragraph
  or treat arbitrary headings/bullets as match tokens. Closed entries must not
  match future output.
- Emit flaky advice only for an active known signature. This leaf does not infer
  load/isolation from a bare transcript; a future structured event may add a
  broad-suite-failure-plus-isolated-pass signal. A bare timeout is insufficient
  evidence.
- Reuse one shared matcher from live wrapped-command, cached replay, and
  pre-commit summary paths rather than growing parallel heuristics.
- Unclassified failures omit the flaky note and retain neutral ordinary failure
  guidance; do not label ambiguity itself as likely flakiness.

## Acceptance

- Unknown-option, parse, and deterministic configuration failures omit the
  flaky note.
- Active known-flaky signatures retain conditional advice; closed registry
  entries and bare load/timeout wording do not.
- Live, cached replay, and pre-commit fixtures pin both positive and negative
  cases, including the neutral unclassified default.

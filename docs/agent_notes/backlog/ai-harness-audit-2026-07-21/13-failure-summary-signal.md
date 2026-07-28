# Make Commit Failure Summaries Fair

Status: Accepted after adversarial review — pair implementation with leaf 11
Date: 2026-07-21
Priority: P2

## Problem

`ai_precommit_failure_summary` collects up to 30 lines per failed slot, then
keeps only the first 80 globally. Three failures—or one large ratchet report—can
remove later task sections and their log paths. The truncation suffix tells the
agent to read "referenced" logs even when the references were cut.

## Scope

- Reserve structural budget first for the failed list, general pre-commit log
  directory, and every task heading/path; fair-share only the remaining excerpt
  lines.
- Prefer a simple per-task budget calculated after structural reservation over
  a redistribution algorithm; minimum visibility matters more than perfectly
  spending every remaining line.
- Preserve the ratchet recovery footer even when its excerpt is truncated and
  reference `ratchet-diagnostics.json` directly, or provide the exact command
  that renders it.
- Define the configured line cap as total physical output, including blank
  separators and the truncation suffix.

## Acceptance

- Ordered three- and five-failure fixtures retain every task and path within the
  total physical-line cap; the three-failure case includes an oversized ratchet
  report.
- A long ratchet excerpt cannot starve later failures or remove its recovery
  footer/artifact reference.
- Missing-log fixtures retain structural references and actionable fallback
  guidance.

Flaky-note specificity is independent lower-priority work in leaf 19.

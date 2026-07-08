# 16. agent_notes: light tooling, not a database

Status: Done — implemented 2026-07-07.
Commits: `94fec547` (`feat(backlog): add advisory metadata lint`);
`7c136aad` (`chore(docs): move generated notes out of agent tree`).
Size: S-M · Severity: low-med
Source: 00-report.md T7 / B4

## Problem

`docs/agent_notes/` is a well-documented append-only knowledge base (57
backlog + 62 finished notes at survey time) with zero enforcement tooling —
no staleness lint, no front-matter validation — and two large *generated*
docs (`lint-coverage-map.md`, 124 KB; `observed_flaky_tests.md`) live inside
the hand-authored tree where they read as curated context.

## Scope

- A `backlog:lint` script that validates Status/Date front-matter on backlog
  notes and flags items stale past N months (advisory, not a gate — match the
  doc-length-policy posture).
- Move the two generated docs out of the hand-authored tree (e.g. under a
  `generated/` subtree or next to their generators) and update their
  generators + any prose references.
- The folder's schema is good; enforce it lightly, don't redesign it.

## Verification

- `backlog:lint` runs clean on the current tree (or its findings are fixed in
  the same slice); generators still write their outputs;
  `bun run harness:check` green if any manifest surface moves.

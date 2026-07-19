# Harness Audit 2026-07 — Pack Summary

Status: Archive summary written at pack close-out (2026-07-19). The pack
folder `docs/agent_notes/backlog/harness-audit-2026-07/` was deleted after
both waves drained (wave 1 and wave 2 both landed 2026-07-14, merges
`ad334a9a` / `801881ff`; index reported 46 Done rows, no Open/Ready/Partial).
The individual leaves and the sources-and-verdicts reconciliation record are
in git history before the folder was removed.

## What the pack was

Six audit lanes at HEAD `14106498` (five Codex consults in isolated
provisioned worktrees plus one Grok 4.5 first-contact lane), each followed by
an independent adversarial verifier: 21 confirmed, 17 amended, 0 rejected
findings. Risk clusters: gates that could fail open or hang, the paved
worktree path breaking on fresh template fingerprints, cross-harness
protections drifting apart silently, and public-showcase credibility (lint
claims running ahead of enforcement, first-contact docs serving product
visitors better than harness visitors).

## Durable constraints carried forward

- Gate scripts must fail closed: a failed `git diff` must not produce a valid
  clean-tree fingerprint, selector crashes must not read as empty successful
  selections, and verify timeouts must complete with 124 rather than hang.
- Force-updating branches/tags is now guarded across harnesses, not only in
  Claude policy; keep new guard work cross-harness from the start.
- Shim validation checks bodies, not just file presence; the tracked Codex
  session-state shim contradiction was resolved in-tree.

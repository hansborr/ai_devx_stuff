# Harness Explore 2026-07 — Pack Summary

Status: Archive summary written at pack close-out (2026-07-19). The pack
folder `docs/agent_notes/backlog/harness-explore-2026-07/` was deleted after
all 14 surviving leaves reached Done (largely via the
`sequential-drain-2026-07` phases 1–3; corroborating merges include
`49ae4a8e`, `36dc65d0`, `74e87e79`, `272c8feb`, `3e6fa119`, `a23c2840`).
Leaves and the adversarial triage record (3 confirmed / 14 amended /
5 rejected) are in git history before the folder was removed.

## What the pack was

A 2026-07-11 read-only exploration of the lint stack, the verify/commit-gate
pipeline, and the harness-controls meta-tooling. Three themes, all since
drained: mitigations that didn't follow the tool (heap policy only at gate
boundaries, an unsalted lint-agent cache), hand-maintained lists next to a
generator culture (staleness regex, allowlists, exempt scripts, the coverage
map — now manifest-derived), and duplication across gate scripts
(changed-file collection, hook trios — now shared).

## Durable constraints carried forward

- Generated-surface staleness patterns derive from the manifest; do not
  reintroduce hand-kept regex/allowlists beside a generator that already
  knows the answer.
- The lint-agent ESLint cache is salted; cache-key changes must keep config
  identity in the salt.
- Gate timing constants live in `scripts/lib/verify-metadata.sh` (all
  consumers source it) — name new timing knobs there, not inline.

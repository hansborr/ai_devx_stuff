# drift:ai Findings — Pack Summary

Status: Archive summary written at pack close-out (2026-06-20). The pack
folder `docs/agent_notes/backlog/drift-ai-findings/` was deleted after all 31
findings were closed and landed on `main`. The individual finding leaves and
the advisory note are available in git history before the folder was removed.

## What the pack changed

Triage of the first `drift:ai --scope current` report: 31 findings
(20 tooling/dogfood, 11 product), no `bug`-severity. All are closed:

- 30 actionable quality fixes implemented — 9 tooling findings on
  `chore/driftai-audit`, then the remaining 21 (10 tooling + 11 product) on
  `feat/drift-ai-findings-2026-06`, merged in `543e7462`.
- 1 documented won't-fix false positive (finding 07): the proposed
  `HARNESS_DIAGNOSTICS_OUTPUT` dedup was rejected because it would cross
  lint-ratchet's enforced portable-runtime import boundary.
- `detector-noise-tuning.md` was advisory (detector calibration), not an
  actionable code issue.

Representative fixes: a shared tool `--version` parser
(`scripts/drift-ai/tool-version.ts`) deduped out of the dolos/semgrep output
paths; a shared map-layer mutation hook
(`packages/client/src/hooks/use-map-layer-mutations.ts`) replacing the fog/
drawing duplicates; and the `BYTES_PER_MB` copies collapsed onto
`MAP_IMAGE_BYTES_PER_MB` from `@musi/shared`.

## Where the details live

- The 31 findings, the index decision table, and the per-finding verification
  commands: git history before the folder removal.
- This is the dup/dead-code lane that the `../backlog/codebase-audit/`
  maintainability audit explicitly excludes.

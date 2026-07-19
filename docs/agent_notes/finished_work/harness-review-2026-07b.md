# Harness Review 2026-07b — Pack Summary

Status: Archive summary written at pack close-out (2026-07-19). The pack
folder `docs/agent_notes/backlog/harness-review-2026-07b/` was deleted after
verification that every leaf's work is on `main` — all five `fix/hr07b` lane
merges and all 20 mapped leaf commits are ancestors of `main`, with the
implementations confirmed in-tree (`ai_clamp_timeout_below_harness` in
`scripts/ai-hooks/common.sh`, `AI_POLICY_GIT_GLOBAL_OPTS` in `policy.sh`,
`process-runner.sh` removed, the `land.sh` `harness:check` gate). The index's
"Open — leaf says not implemented" rows were stale, not the tree. Leaves and
the sources-and-verdicts record are in git history before the folder was
removed.

## What the pack was

The 2026-07-06 AI-harness deep dive: five parallel Sonnet audit agents into
nine sub-reports, adversarially verified by a Codex consult (7 CONFIRMED /
5 PARTLY / 0 REFUTED, plus 2 Codex-original findings). Second pack of the
month, de-duplicated against `harness-review-2026-07`. Tracks: policy
guards (protected-files Bash-write bypass, DB CLI anchoring, git
global-options bypass, worktree-loss parity), quiet-wrapper timeout/orphan
handling, stop/session policy, verify pipeline, agent-cli, docs hygiene.

## Durable constraints carried forward

- What the review found *sound* and should not be re-audited from scratch:
  instruction files (zero false claims), the generation spine (byte-exact
  `--check`s, injection-hardened quoting, script-existence cross-checks),
  lock/atomic-write discipline across `ai-hooks`, and the agent-cli suite.
- Quiet-wrapper watchdogs stay clamped below the hook timeout
  (`ai_clamp_timeout_below_harness`); new wrappers must reuse it.
- Destructive-git policy matching must keep covering global options
  (`AI_POLICY_GIT_GLOBAL_OPTS`).

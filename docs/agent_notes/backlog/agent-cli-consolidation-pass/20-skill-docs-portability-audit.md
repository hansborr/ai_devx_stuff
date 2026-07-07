# 20. Skill docs: prerequisite audit, mirror ruling, lore re-audit

Status: Implemented 2026-07-07
Size: S-M · Depends on: after 10–13 and after 21 (prunes lore the wrapper
then enforces structurally; audits the docs in leaf 21's new shape)
Source: consolidation items 5 + 6 + 7, plus the Tier-3 version-pin note and
two burn-in incidents from the pack index

## Scope

1. **Re-audit SKILL.md against the hardened wrapper** (item 6). The doc
   carries operational lore (dead-run signature, waiting-loop anchors, lock
   semantics) that duplicates wrapper behavior in prose; prune only what the
   wrapper now enforces structurally — keep caller-facing lore that exists for
   orchestrators who cannot observe wrapper internals. As of the 2026-07-06
   survey the prose **held** against the wrapper; the risk is drift.
2. **Mirror structure** — superseded by leaf 21 (owner reopened the
   byte-identical invariant 2026-07-07). The abandoned
   `CLAUDE-SPECIFIC.md` / `CODEX-SPECIFIC.md` direction did not ship; leaf 21
   selected inline harness-specific marker blocks inside each tree's
   `SKILL.md`. This audit ran against that implemented structure: shared core
   byte-identical across `.claude` and `.codex`, with only the marked
   harness-specific block permitted to differ. Do not restate caveats in the
   shared core that belong in a harness-specific block.
3. **Prerequisite audit** (item 7). SKILL.md documents only "target CLI on
   PATH", but the wrapper also depends on git, GNU-ish `realpath -m`, `flock`
   (worktree lock), optionally `setsid`, and `python3` (claude path).
   Document required vs. gracefully-degraded vs. repo-local so a consumer
   learns the prerequisites from the skill, not from a failed run. Include a
   version-drift note for the model/CLI pins in the references
   (`gemini-3.5-flash`, CLI versions) — they date fast in a public reference.
4. **ShellCheck coverage confirmation** (item 5). The wrapper is already
   ShellCheck-gated (`scripts/path-policy/path-policy.ts:164` includes
   `.claude/skills/**/*.sh`; the lint slot runs it in verify and pre-commit).
   Do **not** add a skill-specific verify slot (repo coupling). Verify the
   coverage held through any file moves from leaves 12–13, and document the
   standalone consumer command
   (`shellcheck .claude/skills/agent-cli/scripts/agent-run.sh`) in the skill.
5. **Burn-in incident guidance** (from the pack index):
   - Add commit-guard queuing to the SKILL.md lifecycle step 5 waiter
     guidance: with parallel lanes sharing a git dir, "No commit landed" /
     "Another git commit in progress" is a normal queued state — verify via
     HEAD advancement, not the wrapper's first message.
   - Mark repo-local references as repo-local (per-worktree provisioning,
     `scripts/land.sh`, fast-commit), including the seed-inputs provisioning
     order note (`shared build` before `worktree:init` when seed inputs
     changed), so a ported copy reads cleanly.

## Done criteria

- SKILL.md/references re-audited; the mirror invariants as redesigned by
  leaf 21 green.
- Prerequisites and version-drift note documented in the skill itself.
- ShellCheck coverage confirmed; standalone command documented.
- Waiter guidance names commit-guard queuing; repo-local markers in place.

## Verification

- `bash scripts/tests/test-skill-dispatch-wrappers.sh` (mirror invariants)
  green; lint lane green.

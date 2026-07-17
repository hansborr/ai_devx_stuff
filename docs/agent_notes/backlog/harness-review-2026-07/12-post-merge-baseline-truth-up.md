# 12. Merges skip pre-commit, so a merged-in wrong baseline is only caught in CI — add a post-merge baseline truth-up

Status: Done — `.husky/post-merge` calls the baseline truth-up script (`1b732828`).
Lens: ratchet · Area: hooks · Severity: med-high · Size: S-M · Confidence: high
Theme: baseline-merge-conflicts · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Merge commits never run pre-commit (git has no pre-merge-commit path here — verified: `.husky/` contains only `_`, `commit-msg`, `post-checkout`, `post-merge`, `pre-commit`), and `.husky/post-merge` only runs the worktree drift hook. `scripts/land.sh` runs full `verify` on the *branch tip* and then merges `--no-ff` — the merge *result* is never verified locally. So any merge that produced a wrong baseline — the leaf-10 semantic driver taking a min floor the merged code no longer meets, a contributor resolving a conflict by hand, or a clone without the driver (leaf 11) committing a mangled union — sails through locally and is only caught by CI on push. Locally you find out at the *next* unrelated commit, when pre-commit's ratchet slot fails on someone else's merge.

## Evidence
- `/workspace/.husky/post-merge:2-3` — sole content: `musi_worktree_drift_hook "post-merge" "$@"`. No ratchet involvement.
- `/workspace/scripts/land.sh:12-13,38-47` — "The merge deliberately skips the pre-commit hook (git does not run it for merge commits)"; verify runs on `$branch` before the merge, so a moved `main` means the merge result itself is unverified.
- `/workspace/.github/workflows/ci.yml:79-85` — the CI backstop: `bun run lint:ratchet` (default symmetric gate) plus `lint:ratchet:zero-baseline` run on PRs and on push to `main`. This is the check that catches a wrong baseline on the merge result today.
- `/workspace/scripts/lint-ratchet/modes.ts:178-187` — `--check-baseline` re-collects and asserts both directions clean (full ESLint run, tens of seconds); `lint-ratchet-check-registry.ts:149-160` — the registry preflight is the cheap no-ESLint sanity layer.
- `/workspace/scripts/lint-ratchet/baseline-validation.ts:35,46-49` — hash staleness is detectable from a plain parse (no ESLint), giving a genuinely cheap "definitely stale" signal.

## Proposed direction
Extend `.husky/post-merge`: when the just-completed merge touched `lint-ratchet.baseline.json` (`git diff --name-only ORIG_HEAD HEAD -- lint-ratchet.baseline.json`, guarded for ORIG_HEAD absence), run the cheap layer first — structural parse + registry/hash validation (no ESLint). If that flags staleness, or if a `MUSI_RATCHET_POSTMERGE=full` opt-in is set, run `bun run lint:ratchet:check-baseline` on the merge result. On failure print ONE loud, single-action instruction: `merge produced a stale ratchet baseline — run: bun run lint:ratchet:update, review the diff against both parents, then git commit --amend`. Where the truth-up is safe to automate (update produces a strictly-lower baseline and no `--allow-worse` is demanded), optionally auto-run `lint:ratchet:update` and print the amend instruction. Keep the hook advisory: post-merge cannot fail the merge, so its job is to make the problem visible *now* instead of at the next commit or in CI. Also state the CI backstop explicitly in `docs/guides/lint-ratchet-merges.md` (currently implied, never stated).

## Scope / caveats
- git only runs post-merge for merges that complete without stopping; today the refuse-driver stops the merge, so this hook mostly fires for driverless/textual and `--no-ff` clean merges. Once leaf 10 lands (exit-0 semantic merges), post-merge becomes the primary truth-up seam — this leaf is conceptually paired with 10 but valuable standalone for the land.sh `--no-ff` path.
- Do not unconditionally run the full ESLint collection in post-merge; merges of unrelated work would pay tens of seconds. The cheap-parse-first tiering above keeps the common case near-free.
- One small commit: hook edit + a fixture-level test if the worktree-drift-hook harness pattern allows, plus the guide sentence naming CI as the backstop.

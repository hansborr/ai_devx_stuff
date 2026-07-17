# 57. Nothing guards a direct git push of a fast-commit branch whose tip never saw a full verify; add a cheap pre-push freshness backstop

Status: Done — `.husky/pre-push` fast-commit backstop checks verify evidence and points at `land.sh`.
Lens: hooks · Area: git-hooks · Severity: med · Size: S · Confidence: high
Theme: push-gate-backstop · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Fast-commit mode deliberately skips the slow `test`+`scripts` slots on every commit; the designed backstop is `scripts/land.sh`, which runs the full sequential `verify` before merging. But `land.sh` is a convention, not a wall: a plain `git push` of a fast-committed feature branch publishes commits whose tips were never fully verified, and merge commits skip pre-commit entirely (there is no `pre-merge-commit` hook — verified absent). The agent-policy layer only blocks pushes *to main*; feature-branch pushes are free. For a repo whose stated goal is being a public reference harness, silently relying on remote CI as the only backstop is the worst of the available options — the gap should either be closed locally or documented as a deliberate CI-shaped decision.

## Evidence
- `.husky/` contains exactly `_`, `commit-msg`, `post-checkout`, `post-merge`, `pre-commit` — **no `pre-push`, no `pre-merge-commit`** (verified by listing).
- `scripts/verify/steps-lib.sh:117-138` — fast-commit marker `"$common_dir/musi-fast-commit"` skips the `test`/`scripts` slots with a stderr note.
- `scripts/land.sh:38-43` — the intended backstop: full `NODE_OPTIONS="--max-old-space-size=6144" bun run verify`, then `git merge --no-ff` "skips pre-commit by design" (its own words). Nothing forces a branch through `land.sh` before `git push`.
- State to reuse already exists: `.husky/pre-commit:244-262` — success-marker machinery (`musi_success_marker_matches` on HEAD + relevant-input hash, 120s window; `musi_try_verify_marker_bridge` accepts a fresh manual full-verify marker). `scripts/lib/verify-metadata.sh:295-320` — `ai_precommit_fingerprint` folds `fast-commit=1` into the fingerprint, so recorded verification state distinguishes fast runs from full ones; the verify wrapper meta (`meta/wrapper.json`, read by `scripts/ai-hooks/stop-policy.sh:581-653`) records mode/head/exit.
- `scripts/ai-hooks/policy.sh:112-135` — pushes to main/master are blocked for agents; feature-branch pushes are not (correctly), so the hook layer does not cover this gap.

## Proposed direction
Add a cheap, metadata-only `.husky/pre-push` (seconds, no test execution):
1. If the fast-commit marker is present **or** any commit being pushed was created in fast-commit mode, look for evidence of a full verification at (or covering) the tip: a fresh full-verify success marker / `wrapper.json` with a full (non-fast) mode, matching HEAD per the existing `musi_success_marker_matches` semantics.
2. If none: refuse with a message naming the two sanctioned outs — `bash scripts/land.sh` (full verify + merge) or `NODE_OPTIONS="--max-old-space-size=6144" bun run verify` then re-push — plus the standard `--no-verify` caveat that the bypass-guard hook blocks it for agents anyway.
3. Non-fast-commit branches pass through untouched (pre-commit already ran the full slot set per commit).
Alternative (acceptable but weaker): a documented decision in `docs/agent_notes/DECISIONS.md` + `AGENTS.md` that protected CI checks are the load-bearing backstop — only if CI actually enforces full verify on push, which must be verified, not assumed.

## Scope / caveats
The hard part is step 1's "was this tip fast-committed?" — prefer reading recorded verify metadata over guessing from commit contents; if per-commit provenance proves unreliable, degrade to the simpler rule "marker currently present ⇒ require fresh full-verify evidence before push", which covers the real workflow (the marker stays on for the life of a cheap-commit branch). Keep it advisory-fast: no network, no test runs, <2s. Remember hooks bind humans too — the message must make the intended path obvious. One commit: hook + a smoke test following the `scripts/tests/test-*.sh` registration checklist (path-policy subjects, query run-order, ALL_SMOKE_TESTS).

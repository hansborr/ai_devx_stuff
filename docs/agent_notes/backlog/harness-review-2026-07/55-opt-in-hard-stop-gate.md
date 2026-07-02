# 55. Every Stop condition self-suppresses after one or two nudges; add an opt-in hard-stop mode that keeps blocking while the health gate is red

Status: Done — opt-in hard-stop mode implemented 2026-07-02.
Lens: hooks · Area: hooks-stop · Severity: med · Size: M · Confidence: med
Theme: stop-gate-enforcement · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
The Stop hook technically blocks (exit 2 with the reason on stderr), but every message source is designed to give up: the uncommitted-changes reminder fires once per change set, the verify/e2e/async statuses at most twice, and each has a `.no-stop-*` kill-switch. So "stop again" is always a valid way to finish with a dirty tree or a red cached `verify:changed` — by design, and rightly so for the interactive and autonomous-overnight workflows. But 2026 practice (Anthropic's long-running-agents guidance and the ecosystem patterns collected in the repo's own research) treats a Stop hook that runs the real health gate as the strongest harness primitive available. For runs where the operator *wants* "do not finish until green" — unattended drains, land-ready polish passes — there is currently no way to opt into that strength.

## Decision

Implemented as a strictly opt-in per-worktree hard-stop marker:
`$(git rev-parse --git-dir)/musi-stop-hard`. Automation never creates the
marker, and the default Stop behavior remains advisory/throttled.

When the marker exists, the main Stop policy keeps blocking on the two selected
conditions only:

- uncommitted changes, ignoring the one-shot dirty-tree reminder marker;
- cached failing `verify`, `verify:changed`, or pre-commit metadata, ignoring
  the verify repeat counter.

Existing kill switches still win: `.no-stop-uncommitted` suppresses the dirty
condition, and `.no-stop-verify-changed` / `.no-stop-verify` suppress cached
verify. The e2e, async-verify, and changed-file lint-warning reporters stay
advisory and keep their existing counters even in hard mode. The main Stop
wrapper now passes through when `stop_hook_active` is true; Claude Code's
current hooks guide documents an 8-consecutive-block safety override, so the
repo does not try to fight the platform cap.

## Evidence
- `scripts/ai-hooks/stop-reminder.sh:17-20` — exits 2 with the composed reason; so the mechanism is a genuine block, the *softness* comes entirely from self-suppression.
- Self-suppression, verified: one-shot marker per (fingerprint, branch) for the commit reminder (`scripts/ai-hooks/stop-policy.sh:136-143`); counters capped at `AI_STOP_*_MAX_NOTIFY` (default 2) for e2e/async/verify (`:8-15`, `:248-252`, `:416-419`, `:629-633`); kill-switches `.no-stop-uncommitted`, `.no-stop-e2e`, `.no-stop-async-verify`, `.no-stop-verify-changed`, `.no-stop-verify` (`:7-14`).
- `scripts/ai-hooks/stop-reminder.sh` does **not** check `stop_hook_active` — safe today only because of the counters; any hard mode must add the check.
- `docs/agent_notes/harness-engineering-research/12-custom-hooks.md` §2 — the Stop-gate pattern ("run the gate once per turn before the agent is allowed to finish") and the loop-guard discussion. Note a freshness conflict: that doc (line 213) recorded the "8-consecutive-block force-end" as *not shipped*, while the official docs as of this review (code.claude.com/docs/en/hooks, web-verified 2026-07-01) document force-ending after 8 consecutive Stop blocks. Re-verify at implementation time and update the research doc's freshness section either way; the design below is safe under both.
- Opt-in marker style to mirror: `musi-fast-commit` in the git common dir (`scripts/verify/steps-lib.sh:117`).
- Memory/workflow constraint: overnight autonomous runs (see docs/agent_notes backlog workflow notes) rely on Stop being soft — hard mode must never become the default.

## Proposed direction
Add an opt-in hard mode — `MUSI_STOP_HARD=1` env or, better matching house style, a `musi-stop-hard` marker file in the git common dir (worktree-shared, `rm` to disable) — that changes selected conditions from throttled-advisory to persistently blocking:
- cached failing `verify:changed`/pre-commit (`ai_stop_verify_status` result, ignoring its counter);
- uncommitted source changes (`ai_stop_commit_reminder` condition, ignoring its one-shot marker).
In hard mode: check `stop_hook_active` and pass through when set (the documented loop guard); keep messages identical plus a "hard-stop mode is on (marker: <path>)" trailer so the agent knows why stopping is refused and how the operator disables it. Everything else (e2e, async) stays advisory even in hard mode.

DESIGN GATE — decide before implementing: (1) exact condition set (is uncommitted-changes too aggressive for review-only sessions in a hard-mode worktree?); (2) interaction with existing counters/kill-switches — proposal: hard mode ignores counters but still honors `.no-stop-*` kill-switches so a wedged loop has a local out; (3) behavior under the platform's consecutive-block force-end (8 per current docs): the gate must degrade to advisory rather than fight it; (4) explicit non-interaction with the overnight workflow (hard mode is per-worktree opt-in, never set by automation).

## Scope / caveats
Do not implement ahead of the design gate. Keep hard mode entirely inside `stop-policy.sh`/`stop-reminder.sh` — no schema or wiring changes needed (the Stop event is already wired). Extend `scripts/ai-hooks/test-stop-policy.sh` with hard-mode on/off, `stop_hook_active`, and kill-switch-precedence cases. One commit once designed; the design note itself can land as a docs commit first.

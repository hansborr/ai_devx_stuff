# AI Harness Follow-ups

Status: Parked, conditional follow-ups
Last triaged: 2026-05-10
Source: `../finished_work/ai-harness-improvements.md`

The broad harness plan is mostly landed: the harness map, focused guides,
repo-owned lint sensors, codemods, cached-verify Stop replay, `code:intel` v1,
and module `Concepts:` breadcrumbs exist. Keep this note short and promote
only one concrete leaf at a time.

Execution note 2026-06-01: overlapping diagnostics, slow-drift, behavior
confidence, and `logs:audit` follow-ups have been split into task files under
`harness-review-tasks/00-index.md`. Prefer that folder when promoting reviewed
harness work.

## Active Leaf Elsewhere

No AI-harness leaf is currently promoted from this note. The 5e/5.5e rules
logic guide landed (BatonLoop queue is complete).

## Remaining Work

- Add JSON output for one diagnostic command only when there is a concrete
  hook or dashboard consumer. Candidates remain `verify:logs`, `doctor`,
  `module:index:check`, `db:migration-safety`, and script smoke tests.
- Add reviewed behavior fixtures for Character Live-State and other high-risk
  workflows as they are scoped.
- Evaluate the parked lint-hardening plan in
  `lint-hardening/00-context-and-rollout.md` one leaf at a time. The first candidate
  is adding a scoped Vitest ESLint plugin configuration for test-quality rules;
  follow-ups include restricted primitive tripwires, stronger suppression
  hygiene, assertion-quality helpers, warning cleanup, and rule metadata.
- Add slow drift reports only after the fast harness stays mapped and stable:
  dead exports, import cycles, stale module docs, changed behavior without a
  nearby test, mutation testing for `packages/shared/src/rules/`, and
  flake/timing trends. AI-specific duplicate/ghost/comment drift sensors now
  live as the report-only `bun run drift:ai` command, mapped in
  `../../ai-harness.md`; promoting any subcheck into a gate is gated on the
  current noise profile. Drift sensors work is complete.
- Consider a Musi-specific inferential reviewer only after deterministic
  checks pass; it must complement, not replace, lint/typecheck/tests.

## Non-Goals

- Do not grow `AGENTS.md` into a cookbook.
- Do not turn Stop hooks into a second pre-commit.
- Do not gate pre-commit on slow graph scans, mutation tests, or broad AI
  review.

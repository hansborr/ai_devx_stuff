# AI Harness Follow-ups

Status: Parked, conditional follow-ups
Last triaged: 2026-05-10
Source: `../finished_work/ai-harness-improvements.md`

The broad harness plan is mostly landed: the harness map, focused guides,
repo-owned lint sensors, codemods, cached-verify Stop replay, `code:intel` v1,
and module `Concepts:` breadcrumbs exist. Keep this note short and promote
only one concrete leaf at a time.

## Active Leaf Elsewhere

No AI-harness leaf is currently promoted from this note. The 5e/5.5e rules
logic guide landed through `docs/agent_notes/in_progress/batonloop-queue.md`.

## Remaining Work

- Add JSON output for one diagnostic command only when there is a concrete
  hook or dashboard consumer. Candidates remain `verify:logs`, `doctor`,
  `module:index:check`, `db:migration-safety`, and script smoke tests.
- Add reviewed behavior fixtures for Character Live-State and other high-risk
  workflows as they are scoped.
- Add slow drift reports only after the fast harness stays mapped and stable:
  dead exports, import cycles, stale module docs, changed behavior without a
  nearby test, mutation testing for `packages/shared/src/rules/`, and
  flake/timing trends. AI-specific duplicate/ghost/comment drift sensors now
  live as the report-only `bun run drift:ai` command, mapped in
  `../../ai-harness.md`; promoting any subcheck into a gate is gated on the
  Leaf 6 evaluation in `../in_progress/ai-drift-sensors.md`.
- Consider a Musi-specific inferential reviewer only after deterministic
  checks pass; it must complement, not replace, lint/typecheck/tests.

## Non-Goals

- Do not grow `AGENTS.md` into a cookbook.
- Do not turn Stop hooks into a second pre-commit.
- Do not gate pre-commit on slow graph scans, mutation tests, or broad AI
  review.

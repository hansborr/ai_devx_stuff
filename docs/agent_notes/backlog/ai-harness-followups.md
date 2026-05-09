# AI Harness Follow-ups

Status: Parked, conditional follow-ups
Last triaged: 2026-05-08
Source: `../finished_work/ai-harness-improvements.md`

The broad harness plan is mostly landed: the harness map, focused guides,
repo-owned lint sensors, codemods, cached-verify Stop replay, `code:intel` v1,
and module `Concepts:` breadcrumbs exist. Keep this note short and promote
only one concrete leaf at a time.

## Active Leaf Elsewhere

`NEXT.md` currently promotes `docs/guides/add-module-doc.md`. Do not promote
another AI-harness leaf until that lands or is retiered.

## Remaining Work

- Add a narrow guide for touching 5e/5.5e rules logic. Pair it with
  `docs/SRD_CC_v5.2.1.pdf`, `packages/shared/rules/`, and the required shared
  rules tests.
- Improve migration-safety output before adding any Stop or commit wiring that
  needs to distinguish acknowledged findings from actionable warnings.
- Add JSON output for one diagnostic command only when there is a concrete
  hook or dashboard consumer. Candidates remain `verify:logs`, `doctor`,
  `module:index:check`, `db:migration-safety`, and script smoke tests.
- Add reviewed behavior fixtures for Character Live-State, encounter
  transitions, authorization `NOT_FOUND` cases, and SRD/homebrew mapper
  provenance.
- Add slow drift reports only after the fast harness stays mapped and stable:
  dead exports, import cycles, stale module docs, changed behavior without a
  nearby test, mutation testing for `packages/shared/rules/`, and flake/timing
  trends.
- Consider a Musi-specific inferential reviewer only after deterministic
  checks pass; it must complement, not replace, lint/typecheck/tests.

## Non-Goals

- Do not grow `AGENTS.md` into a cookbook.
- Do not turn Stop hooks into a second pre-commit.
- Do not gate pre-commit on slow graph scans, mutation tests, or broad AI
  review.

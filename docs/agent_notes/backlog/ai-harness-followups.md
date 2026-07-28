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

- ~~Add JSON output for one diagnostic command~~ — done. All four named
  candidates now emit a harness-diagnostics envelope: `verify:logs --json`
  (`scripts/verify-logs.sh`), `doctor --json` (`scripts/doctor.sh`),
  `module:index:check --json` (`scripts/generate-module-index.sh`), and
  `db:migration-safety --json` (`scripts/migration-safety-scan.sh`). Only
  script smoke tests are still without a JSON mode.
- Add reviewed behavior fixtures for Character Live-State and other high-risk
  workflows as they are scoped.
- Use `docs/agent_notes/finished_work/lint-followups-2026-06.md` when promoting
  any remaining lint follow-up. The closed pack carried the e2e selector debt
  drain, the runtime import-cycle fix and gate decision, and the promoted
  test-quality, strict-boolean, max-lines policy, and doctor-parity leaves; its
  original leaves, watchlist, and verdict register now live only in git history.
- Add slow drift reports only after the fast harness stays mapped and stable.
  Most of the original list has since landed: dead exports
  (`sensor:knip-unused-exports` plus the `drift:ai` knip pass-through), import
  cycles (`lint:import-cycles`), stale module docs (`module:index:check` and
  the `drift:ai coldspots` stale-markers lens), and mutation testing for
  `packages/shared/src/rules/` (`stryker.config.mjs`, since broadened past the
  rules-only pilot). Still open: changed behavior without a nearby test, and
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

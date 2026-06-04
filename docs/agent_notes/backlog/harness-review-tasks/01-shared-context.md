# Harness Review Tasks - Shared Context

Read this once before implementing any task in this folder.

## Source Material

Primary Musi review:

- `docs/agent_notes/harness-review-2026-05/00-overview.md`
- `docs/agent_notes/harness-review-2026-05/01-current-state-and-audit.md`
- `docs/agent_notes/harness-review-2026-05/03-recommendations.md`
- `docs/agent_notes/harness-review-2026-05/04-rejected-and-deferred.md`

Secondary pattern source:

- `/workspace/tmp/ma-toki/docs/harness-research/README.md`
- `/workspace/tmp/ma-toki/docs/harness-research/RECOMMENDATIONS.md`
- `/workspace/tmp/ma-toki/docs/harness-research/10-awesome-harness-survey.md`

The Musi review wins when the two disagree. The ma-toki folder is a pattern
source from another stack, not a direct implementation plan.

## Preserve These Rules

1. **Report-only first.** New broad sensors start report-only and must state a
   noise budget or kill criterion before promotion.
2. **Evidence, not verdicts.** `drift:ai`, graph sensors, slow lanes, and
   semantic reports show evidence. They must not auto-fix, auto-open PRs, or
   silently classify findings as ignorable.
3. **Guides stay small and routed.** Do not grow `AGENTS.md` into a cookbook.
   Add only pointers every agent needs, and put detail in task guides,
   `MODULE.md`, generated docs, or skills.
4. **Use existing harness primitives.** Prefer `scripts/ai-hooks/`,
   `harness.controls.json`, shared Zod schemas, package scripts, and generated
   docs over parallel registries.
5. **Preserve adapter parity.** Shared behavior belongs in `scripts/ai-hooks/`;
   `.claude/` and `.codex/` stay thin unless a feature is genuinely
   adapter-specific.
6. **Use TDD.** Add or update focused script, Vitest, or shell tests in the same
   commit as behavior changes.

## Verification Defaults

For docs-only tasks:

- `bun run module:index:check` if `MODULE.md` files change.
- `bun run docs:harness-controls:check` if harness inventory docs change.
- `bun run harness:check` if `harness.controls.json` changes.

For TypeScript script changes:

- Run the focused Vitest file(s), usually with `bun run test -- <files>`.
- Run the corresponding shell smoke test if the command has one.

For hook changes:

- Run the focused hook test file when available.
- Run `bash scripts/ai-hooks/test.sh` only when shared hook helpers or aggregate
  behavior change.

For final changed verification:

- Stage only intended source-relevant changes.
- Run `bun run verify:changed`.

## Task File Convention

Each task uses:

```text
# <id> - <title>
Status / Track / Size / Depends on / Blocks

## Goal
## Background
## Seams to touch
## What to do
## Testing
## Out of scope
```

If a task reaches across more files than expected, stop and split it rather than
turning the task into a multi-commit change.

## Existing Backlog Relationship

This pack folds selected work from existing AI-harness backlog notes into
commitable leaves. Do not delete the older notes while implementing a leaf
unless the leaf explicitly says to update or supersede them. They remain useful
as rationale and history.

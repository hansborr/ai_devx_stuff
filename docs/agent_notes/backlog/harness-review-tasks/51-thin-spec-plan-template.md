# 51 - Thin spec/plan template

Status: Parked
Track: G (governance/refinement)
Size: small-medium
Depends on: none
Blocks: none

## Goal

Add a lightweight in-progress note template for non-trivial work: scope,
acceptance, cross-package contract, discovery, and verification.

## Background

The review rejected heavy spec-driven development for Musi but endorsed a thin
plan for work that crosses package boundaries or has ambiguous acceptance. The
template should help agents start with the right seams without making simple bug
fixes bureaucratic.

## Seams to touch

- `docs/agent_notes/README.md`
- A new template under `docs/agent_notes/`, if useful
- `AGENTS.md`, only if a one-line pointer is needed

## What to do

1. Add a compact template for `docs/agent_notes/in_progress/<task>.md`.
2. Include sections for:
   - scope and non-goals;
   - acceptance checks;
   - shared/server/client contract impact;
   - required discovery commands such as `rg` or `bun run code:intel`;
   - verification plan.
3. State when the template is unnecessary: trivial docs edits, single-file
   fixes, or tasks with a fully specified existing leaf.
4. Keep the template short enough to copy without pruning.

## Testing

- Docs-only. Run markdown formatting if the repo has a changed-docs formatter.

## Out of scope

- Requiring a spec for every task.
- Adding hook enforcement.
- Replacing existing backlog task-file conventions.

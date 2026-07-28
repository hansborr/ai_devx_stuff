# Correct Migration and Prisma Hook Guidance

Status: Accepted after adversarial review — not promoted
Date: 2026-07-21
Priority: P1

## Problem

The PostgreSQL denial message in `scripts/ai-hooks/policy.sh` tells agents to
use `db:push` "for schema." `AGENTS.md`, the migration guide, and the protected
schema advisory require `db:migrate` for committed schema work and reserve
`db:push` for local/disposable state. The manifest also says the Prisma hook
warns when generation was not rerun, while the hook actually auto-generates
and blocks on failure.

## Scope

- Give repair text by intent: committed schema change -> `db:migrate`;
  disposable/local sync -> `db:push`; seed -> `db:seed`; other database work ->
  sanctioned Prisma/repo scripts.
- Update the Prisma hook principle/generated controls to describe automatic
  generation and failure behavior. Successful generation continues without
  agent guidance but currently logs a success line to stderr; removal of that
  line is owned by the active P3/S configuration cleanup in leaf 14. The shared
  body emits a blocking result on failure, while Copilot delivers the same
  reason as post-edit `additionalContext` because the edit already occurred.
  Its repair metadata stays `manual`, because automatic generation can fail and
  the remaining repair requires an explicit command or code change.
- Regenerate maintained harness docs.

## Acceptance

- Policy tests assert migration guidance and reject generic "db:push for
  schema" wording.
- The manifest principle and generated harness-controls projection say
  "automatically regenerate" and accurately describe per-adapter failure
  delivery.
- End-to-end Claude, Codex, and Copilot assertions pin all four intent-specific
  branches survive adapter translation. Keep exact remedy wording centralized
  in shared policy tests rather than cloning phrase-coupled assertions three
  times.

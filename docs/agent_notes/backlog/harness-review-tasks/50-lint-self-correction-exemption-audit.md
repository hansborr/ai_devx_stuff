# 50 - Lint self-correction exemption audit

Status: Parked
Track: G (governance/refinement)
Size: medium
Depends on: none
Blocks: none

## Goal

Audit lint rules and ratchet exemptions where the harness has enough guidance
for agents to self-correct, then split any concrete adoptions into separate
lint backlog leaves.

## Background

The review endorsed Musi's lint-heavy harness but cautioned against accumulating
permanent carve-outs after guidance and repair text improve. This task is an
inventory pass, not a mass lint adoption.

## Seams to touch

- `eslint.config.js`
- `eslint-rules/`
- `docs/guides/local-eslint-rules.md`
- `docs/guides/lint-ratchet.md`
- `docs/agent_notes/backlog/lint-followups/`
- `docs/agent_notes/backlog/lint-system-improvements/`

## What to do

1. Inventory active rule suppressions, disabled rule families, and ratchet
   exceptions that were justified by weak repair loops.
2. For each candidate, check whether current diagnostics now include clear
   repair guidance, focused tests, and a low-noise path.
3. Record one of: keep deferred, adopt now, or split a future leaf.
4. If an adoption is truly tiny, land it in the same commit only when it is
   green and not entangled with unrelated lint debt.
5. Update the canonical lint backlog rather than creating duplicate queues.

## Testing

- Run the exact lint or ratchet command touched by any adopted slice.
- If this remains docs-only, no code verification is required beyond markdown
  formatting.

## Out of scope

- Broad lint-drain work.
- New local ESLint rules.
- Changing ratchet policy without a separate implementation leaf.

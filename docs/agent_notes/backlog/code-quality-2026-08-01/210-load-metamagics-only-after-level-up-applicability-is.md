# 210. Load metamagics only after level-up applicability is established

Status: Not started
Theme: Level-up queries metamagics before deciding whether metamagic applies · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The level-up orchestrator loads a character's existing metamagics before the
Sorcerer-specific validator decides whether metamagic selection applies.
Consequently, every non-applicable level-up — every non-Sorcerer level and
every Sorcerer level that is not a metamagic-choice level — performs a
transaction-scoped query whose result is immediately discarded.

The applicability rule and the conditionally needed data are owned by different
layers. Contributors changing the Sorcerer progression must coordinate those
layers to avoid either unnecessary reads or validation with missing state.

## Evidence

- `packages/server/src/services/level-up/level-up.ts:33-65` — the service owns
  one transaction and loads the character before running level-up validation.
- `packages/server/src/services/level-up/level-up.ts:69-79` — inside every
  transaction it queries `characterMetamagic.findMany`, maps the rows, and only
  then calls `validateMetamagicChoices`.
- `packages/server/src/services/level-up/sorcerer.ts:24-30` — the
  Sorcerer-specific validator returns `null` before inspecting choices unless
  the target class is Sorcerer at a metamagic-choice level.
- `packages/server/src/services/level-up/sorcerer.ts:32-65` — existing
  metamagics are needed only after applicability is established, for duplicate
  and total-slot validation.

## Proposed direction

Add an async Sorcerer-specific resolver beside the pure validator. Give it the
transaction client, character id, target class id, new class level, and
submitted metamagic ids.

Order the resolver deliberately:

1. Check the existing Sorcerer and metamagic-level applicability predicates.
   Return `null` immediately when either predicate is false.
2. Only for an applicable level, load the character's existing metamagic ids
   through the supplied transaction client.
3. Delegate choice validation to the existing pure validation logic so its
   required-choice, unknown-option, duplicate-choice, and slot-limit results
   remain unchanged.

Replace the unconditional query and validator call in `performLevelUp` with
that resolver, keeping it inside the existing transaction. Add focused
Sorcerer resolver tests proving that the query is untouched for a non-Sorcerer
and a non-metamagic Sorcerer level, runs once for an applicable level, and
preserves the current error messages and validated result.

## Scope / caveats

- Preserve all current tRPC error codes and messages, the transaction boundary,
  and the ordering of the surrounding level-up validation and writes.
- Do not change Sorcerer progression levels, metamagic slot counts, choice
  limits, or the persistence performed by `applyMetamagicChoices`.
- CQ25-25 in
  [code-quality-2026-07-25/07-PLAN.md](../code-quality-2026-07-25/07-PLAN.md)
  already schedules `newClassLevel` ownership and other level-up type/test
  cleanup. Reuse that field if it lands first; this proposal owns only the
  conditional existing-metamagic query.
- [029-one-metamagic-constant-controls-two.md](./029-one-metamagic-constant-controls-two.md)
  separates the per-cast cap from the level-up picks constant and explicitly
  excludes level-up selection semantics. Do not fold either constants change
  into this query-ownership proposal.

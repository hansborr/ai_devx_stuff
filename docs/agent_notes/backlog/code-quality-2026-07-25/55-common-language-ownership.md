# 55. `character.create` produces a character without Common unless the wizard is the caller

Status: **Done 2026-07-28** on branch
`feat/cq-common-language-ownership` (`0d97cfa3a`, `50cfd2479`, `bc39286cc`,
`133edc7fd`; review fixes `c77734de5`, `1c5019fb9`, `96e71b9e6`); see
[Landed](./00-index.md#landed). Common is now an SRD-sourced shared rule
enforced by the server for every `character.create` caller, existing
inconsistent rows are backfilled, and the redundant client payload injection
is removed.
Theme: SRD rules owned by the server, not the client that happens to call it · Area: shared + server (+ client cleanup) · Severity: low · Size: M

Source: client-cluster pre-merge panel and adjudication, 2026-07-27 (the deferral
recorded in [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md), "Second landing
outcome — review dispositions") · Confidence: high

**Evidence in this leaf is pinned to `709b27668` (`feat/cq-slice-h`), not the
pack's `883d48bf`.** All five panelists on the slice-H review independently
re-verified the client-only-writer claim; the adjudicator confirmed the server
derivation and the de-duplication rule. The implementation re-verified every
anchor against the 2026-07-28 live tree: all cited files and symbols remain at
the named paths. One wording correction was necessary: `character.create` is a
`protectedProcedure`, not an unauthenticated public procedure. It is still the
shared authenticated mutation boundary described below.

## Problem (pre-change state at `709b27668`)

SRD 5.2.1 (*Languages*) states that every player character knows Common. The
only thing in the system that makes that true is a line of client code.

`packages/client/src/components/character-create/create-character-input.ts`
injects `{ type: "language", name: "Common" }` into the proficiencies it builds,
and it is the **only** writer of that value anywhere in the repo. The server's
`deriveProficiencies`
(`packages/server/src/services/character-create-helpers.ts`) derives class
saving throws, armour, weapons and tools plus background skills and tool — it
never derives a language.

`character.create` (`packages/server/src/routers/character.ts`) is an
authenticated mutation that forwards any schema-valid input to the service. So
any caller that is not the creation wizard — a seed, an import path, an e2e
helper, a future API consumer, a second client — creates a character that does
not know Common, and nothing rejects it.

This is not a live production defect today: the wizard is the only caller, and
it injects. It is a rule living one layer too high, where it is one new caller
away from being silently wrong.

## Evidence (pre-change state at `709b27668`)

- Client injection, sole writer:
  `packages/client/src/components/character-create/create-character-input.ts`
  (the `buildProficiencies` helper). `grep -rn '"Common"' packages/` returns no
  other producer of a language proficiency.
- Server derivation, no language:
  `packages/server/src/services/character-create-helpers.ts`,
  `deriveProficiencies` — savingThrow, armor, weapon, tool, skill only.
- Authenticated forwarding mutation: `packages/server/src/routers/character.ts`,
  `character.create`.
- The two halves compose safely in either order: the same service
  de-duplicates merged proficiencies by `type:name`, so a server-side
  derivation is a no-op for wizard-created characters and the client injection
  can be removed later, or left as display provenance, without a flag day.

## Proposed direction

This is a rules change and must follow
[`docs/guides/change-rules-logic.md`](../../../guides/change-rules-logic.md):

1. An SRD-sourced helper in `packages/shared/src/rules/`, with a shared test
   written first, that names Common as a universal starting language.
2. Compose it into `deriveProficiencies` so the server owns the invariant.
3. Boundary tests at the service and the router: a direct `character.create`
   with no client-supplied languages yields a character that knows Common.
4. Then, and only then, decide whether to delete the client injection.

## Decided and landed outcome

The owner ruled that existing characters **must be backfilled**, even though
there are no production rows worth preserving. Migration
`20260728154301_backfill_common_language` inserts one proficient Common-language
row for every character lacking one. Its `NOT EXISTS` predicate and unique-key
`ON CONFLICT` guard make it idempotent and safe to re-run without replacing or
duplicating an existing row.

Common identity is deliberately exact and byte-for-byte. Caller or imported
labels such as `"common"` and `" Common"` remain distinct proficiencies, and
the server and migration add canonical `"Common"` alongside them. This matches
the existing contract: proficiency names are open strings, the merge key is
exact `type:name`, and the database unique key is case-sensitive. Normalizing
that shared key would silently change every proficiency type and rewrite
custom/imported labels beyond this leaf. Server tests pin both case and
whitespace variants, and the migration comment records the same irreversible
choice.

The repository has no convention for executable per-migration behavior tests,
so no bespoke migration harness was introduced for this leaf. Instead, the
migration was applied to the provisioned worktree database with two deliberate
pre-migration fixtures: one character without Common and one with Common.
After application both had exactly one Common row; executing the migration SQL
again through Prisma preserved the same ids and counts. The migration safety
scanner reported no destructive operations.

The shared helper is
`packages/shared/src/rules/starting-languages.ts`, composed by
`deriveProficiencies`. Focused helper coverage proves caller-supplied expert
Common remains exactly one expert entry, while a separate derived-only test and
the direct service and router tests prove a caller that supplies no language
receives Common. The previously optional proficiency-create arm was removed:
derivation now always contributes at least Common.

The client injection was deleted deliberately:
`buildCreateInput` now serializes only player choices, leaving enforcement with
the server. Both wizard display sites consume the shared helper rather than
repeating the rule literal, and the proficiency-selection step displays Common
as a default. The review step is narrower: its pre-existing gate hides the
entire Languages summary when the player chooses no additional language, so it
does **not** display Common in that case. That display omission predates this
branch and is a follow-up, not part of this ownership change. A focused
Playwright assertion now proves a wizard-created character displays Common on
the resulting character sheet.

## Why it was not fixed in the client cluster

Q2's charter explicitly forbade touching the injection ("Do **not** 'simplify'
the `Common` language injection; it is SRD behaviour"). Q2 relocated the
pre-existing injection without widening it, which the pack's own rule allows.
Fixing ownership from a client cleanup branch would have meant a shared-rules
change, two server boundaries and a backfill decision, none of which that
branch had standing to make.

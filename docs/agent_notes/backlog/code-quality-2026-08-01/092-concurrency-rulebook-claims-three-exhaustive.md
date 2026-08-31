# 92. The concurrency rulebook opens by declaring its three patterns exhaustive and forbidding a fourth, while its own Serializable-exception section and a production module use a shape those patterns cannot express

Status: Landed on fix/cq-091
Theme: doc taxonomy contradicts itself · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`docs/CONCURRENCY.md` is mandatory pre-reading for every race-sensitive
change (AGENTS.md sends contributors there before expanding any
race-sensitive mutation helper surface). Its opening paragraph makes the
guide's most prominent claim: three patterns cover **every**
concurrency-sensitive write, and when adding a new mutation you should
"pick the pattern that matches — don't invent a fourth." The same
document then dedicates a section — "Serializable isolation exception" —
to two production paths whose invariant is a property of a **set** of
rows, "the one shape Pattern A/B/C cannot express", and
`packages/server/src/utils/prepared-spell-toggle.ts` opens with the same
statement in code: no `version` column to CAS on, no single-row `where`
that can encode "count of sibling rows".

A reader anchored on the opening will misclassify a legitimate,
deliberately-designed production mechanism as exactly the thing they
were told never to invent — and a contributor facing a genuinely
set-level invariant of their own gets steered away from the sanctioned
answer the guide documents 450 lines later. The Scope section does
gesture at the exception in a bullet about non-candidates, but the
headline taxonomy is what people quote and act on, and it is wrong on
its own terms.

## Evidence

- `docs/CONCURRENCY.md:3-7` — "Three patterns cover every
  concurrency-sensitive write in this codebase. When adding a new
  mutation … pick the pattern that matches — don't invent a fourth."
  The pointer that follows is to §"Alternatives considered" on why
  Serializable-*everywhere* was rejected, which reads as reinforcing the
  ban rather than admitting the narrow exception.
- `docs/CONCURRENCY.md:454-460` — §"Serializable isolation exception":
  "Two paths use Serializable. Both are multi-statement
  read-modify-writes keyed off a **set** of rows rather than a single
  row, which is the one shape Pattern A/B/C cannot express."
- `packages/server/src/utils/prepared-spell-toggle.ts:1-18` — the module
  header states the prepared-spell cap is a set-level precondition "and
  none of the three patterns in `docs/CONCURRENCY.md` can express it",
  then points back at §"Serializable isolation exception" for the exact
  boundary. The implementation treats the exception as first-class, not
  as a violation.
- `docs/CONCURRENCY.md:40-46` — the Scope section's "not a gate
  candidate" bullet already acknowledges the `togglePrepared` path holds
  its set-level invariant in a Serializable transaction; the opening
  paragraph is the only place the taxonomy is stated as closed.
- `docs/CONCURRENCY.md:662-663` — the guide's own guidance:
  "Serializable only when the invariant is genuinely set-level" —
  i.e. the fourth mechanism has admission criteria, which the opening
  should surface instead of denying its existence.

## Proposed direction

Amend the `docs/CONCURRENCY.md` opening (lines 3-7) to state three
row-level patterns plus the narrowly-scoped Serializable set-level
exception with a pointer to the existing "Serializable isolation
exception" section, instead of claiming the three patterns are
exhaustive.

Mechanically: keep the "don't invent a fourth" force but scope it to
row-level writes — e.g. "Three patterns cover every *row-level*
concurrency-sensitive write; the one sanctioned departure is the
Serializable set-level exception (§'Serializable isolation exception'),
used only when the invariant is genuinely a property of sibling rows no
single-row `where` can name." The detailed Serializable section and the
`prepared-spell-toggle.ts` implementation are the authority on the
exception's shape and admission bar; the opening should defer to them,
not contradict them. One-paragraph edit, no section restructuring.

## Scope / caveats

- Docs-only: no change to the Serializable section itself, to
  `prepared-spell-toggle.ts`, or to any pattern's mechanics. The
  mechanism is settled; only the opening taxonomy is wrong.
- Out of scope: relitigating whether the exception should exist, or
  expanding its admission criteria — §"Alternatives considered" and
  §"Serializable isolation exception" already own that reasoning.
- [099-concurrency-rulebook-mislocates-participant.md](./099-concurrency-rulebook-mislocates-participant.md)
  is a separate accuracy fix to the same file (participant-policy
  pointers/ordering). The two are distinct claims but can land as one
  documentation pass over `docs/CONCURRENCY.md`; if worked separately,
  avoid concurrent edits to the file.

# 76. Schema tests label durable rationale with opaque audit numbers and line references that have already drifted

Status: Not started
Theme: comment provenance · Area: tests · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Four shared schema test files carry 24 numbered historical annotations that mix
two different things: durable behavioral rationale (which invariant a test pins,
which mutant it kills) and provenance labels — "finding 19", "Finding 14",
"backlog item 35", "mutation-coverage finding 15" — that have no namespace, no
document path, and no stable record id. A contributor reading the comment cannot
tell what "finding 19" is or where to look it up; the number is dead weight that
still demands a moment of archaeology every time the comment is read. Worse, the
raw source-line coordinates some of these comments embed have already gone
stale: two comments in `homebrew.test.ts` point at guards by line number
("L100", "L96") and both guards now sit two lines earlier. The rationale halves
of these comments are genuinely valuable — they explain why an assertion exists
and what regression it blocks — but the numeric halves are unresolvable and, in
the line-reference cases, actively wrong.

## Evidence

- Inventory at the pin: 24 numbered annotations across 4 files —
  `packages/shared/src/schemas/encounter-inputs.test.ts` (8),
  `packages/shared/src/schemas/homebrew.test.ts` (14),
  `packages/shared/src/schemas/map.test.ts` (1),
  `packages/shared/src/schemas/monster.test.ts` (1) — using 9 distinct naked
  identifiers (3, 7, 14, 15, 19, 20, 22, 33, 35), none qualified with a source.
- `packages/shared/src/schemas/encounter-inputs.test.ts:95-96` — a
  self-contained validator rationale ends with the unqualified "(finding 19)";
  the file repeats finding 19 at `:314`, `:540`, `:823`, `:890`, finding 3 at
  `:485` and `:594`, and "backlog item 35" at `:374`.
- `packages/shared/src/schemas/homebrew.test.ts:472-473` — "Finding 14: the
  L100 guard `"ritualAdept" in record || ...`" — but the guard sits at
  `packages/shared/src/schemas/homebrew.ts:98` inside
  `normalizeLegacyClassData`; the line reference has drifted.
- `packages/shared/src/schemas/homebrew.test.ts:518` — "the L96 input guard
  returns array input unchanged" — that guard (the null/non-object/array early
  return) is at `packages/shared/src/schemas/homebrew.ts:94`; drifted too.
- `packages/shared/src/schemas/map.test.ts:18-24` — a multi-line mutation
  rationale (which Stryker mutants the block kills) labeled only "backlog
  finding 20", with no record or document.
- `packages/shared/src/schemas/monster.test.ts:82-85` — a mutation rationale
  labeled "mutation-coverage finding 15", same shape.

## Proposed direction

In the 4 schema test files, keep each behavioral/mutation rationale but delete
the opaque finding/backlog numbers and drifted LNN line references, naming the
guarded schema or helper symbol instead; add a stable document path plus record
id only where provenance still earns its keep.

Mechanics: the landed implementation and the executable assertions are the
authority, so the sweep is comment-only. For the two drifted references in
`homebrew.test.ts` (`:472`, `:518`), replace "the L100 guard" / "the L96 input
guard" with the symbol — the `normalizeLegacyClassData` guards in
`packages/shared/src/schemas/homebrew.ts` — quoting the guard expression where
the comment already does. For the other 22 annotations, drop the trailing
"(finding N)" / "Finding N:" / "backlog item N" label and keep the sentence
that explains the invariant or the mutant being killed; those sentences stand
on their own at every site listed above. A "stable document path plus record
id" (e.g. a `docs/agent_notes/backlog/<pack>/<leaf>.md` path) is only worth
adding where the comment's point is historical provenance rather than test
intent — expect that to be rare or zero in these files.

## Scope / caveats

- Comment-only change: no assertion, fixture, schema, or helper edits. If a
  rationale sentence turns out to describe the code wrongly, fixing the code or
  the assertion is out of scope here.
- Scope is exactly the four `packages/shared/src/schemas/*.test.ts` files
  above. The prior pack's
  [44-comment-archaeology.md](../code-quality-2026-07-25/44-comment-archaeology.md)
  permanently dropped a 60-plus bare-coordinate sweep — that refused sweep's inventory does not include `packages/shared/`, so neither
  it nor the landed carve-outs bars this narrower schema-test sweep or licenses
  expanding it beyond the four files named here. Do not
  grow this leaf beyond the four files.
- Do not blanket-delete comments: every annotation here pairs a number with a
  durable rationale, and the rationale stays. The deletion target is the
  unresolvable identifier and the raw line coordinate, nothing else.

# 17. The participant-stats mutation header misroutes visibility and conditions writes to the wrong concurrency helpers

Status: Not started
Theme: Concurrency-boundary comment accuracy · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server/src/utils/participant-stats-mutations.ts` is the sole
sanctioned escape past `prisma-types.ts`'s type-level ban on
`EncounterParticipant` writes, and its 51-line header is the helper-selection
guide a prior ruling keeps in place permanently because it is among the
highest-value comments in the server. That guide contains three false routing
claims. The shape-2 paragraph says the expected-version helper closes races
for the DM "visibility" edit UI — but `isVisible` is classified non-racing and
is blind-written. The shape-3 paragraph says blind writes are for fields that
"don't come from the DM override UI" — but `encounter.updateParticipant`, the
DM override procedure itself, takes exactly that blind path whenever
`expectedVersion` is omitted. And the `BlindParticipantFields` JSDoc says the
DM conditions write goes through `updateParticipantStatsLocked` — it goes
through `updateParticipantStatsLockedWithExpectedVersion`, whose plain-locked
sibling is only ever called by the damage/spell/turn hot paths.

A maintainer is directed to this header precisely when choosing between the
six helpers at the repo's most carefully guarded write boundary. Following it
as written, they pick or describe the wrong helper — and because
`docs/CONCURRENCY.md` and the encounter-combat MODULE.md describe the routing
correctly, the header is the one authority that disagrees, which is the worst
place for the error to sit.

## Evidence

- `packages/server/src/utils/participant-stats-mutations.ts:26-33` — shape 2
  says `updateParticipantStatsLockedWithExpectedVersion` "Closes cross-session
  lost-update races for the DM HP / conditions / visibility edit UI" (`:32`).
  The visibility claim is false: `isVisible` is in `BlindParticipantFields`
  (`:188`) and classified `"non-racing"` in `PARTICIPANT_FIELD_KIND`
  (`packages/server/src/services/encounter-combat/participant-action.ts:64`).
- `packages/server/src/utils/participant-stats-mutations.ts:35-38` — shape 3
  says `blindUpdateParticipant` covers fields "that don't come from the DM
  override UI" (`:37`). False: `executeParticipantWrite` calls
  `blindUpdateParticipant(prisma, input.id, buildBlindData(input))` on the
  `encounter.updateParticipant` path when `expectedVersion` is absent
  (`participant-action.ts:142`), and `buildBlindData` copies `isVisible`,
  action flags, `name`, `initiative`, `sortOrder` from the DM's input
  (`participant-action.ts:150-159`).
- `packages/server/src/utils/participant-stats-mutations.ts:171-174` — the
  `BlindParticipantFields` JSDoc: "The only writer that touches `conditions`
  is `encounter.updateParticipant` (DM override) via
  `updateParticipantStatsLocked` (version-CAS)". Wrong helper: `conditions`
  is `"racing"` (`participant-action.ts:72`), so
  `assertVersionForRacingFields` forces `expectedVersion`
  (`participant-action.ts:77-93`) and the write lands in
  `updateParticipantStatsLockedWithExpectedVersion`
  (`participant-action.ts:133`).
- The plain `updateParticipantStatsLocked` has exactly three non-test callers
  — `services/combat-actions/turn-transaction.ts:64`,
  `services/spell-casting/combat-transaction.ts:133`,
  `utils/damage-mutations.ts:32` — none of which is the DM override path, so
  the JSDoc's `tickConditions` clause is accurate; only the DM-path helper
  name is wrong.
- The out-of-file descriptions are already correct, so the header is the sole
  outlier: `docs/CONCURRENCY.md:731-743` gives the two-path routing (CAS via
  `updateParticipantStatsLockedWithExpectedVersion` for `currentHp`, `tempHp`,
  `conditions`, death saves; blind via `blindUpdateParticipant` for
  `isVisible` and the other metadata), `docs/CONCURRENCY.md:757-758` states
  the client omits `expectedVersion` for visibility toggles, and
  `packages/server/src/services/encounter-combat/MODULE.md:105-117` restates
  both branches with the right helper names.

## Proposed direction

Correct every misrouting claim in the `participant-stats-mutations.ts` header
and the `BlindParticipantFields` JSDoc — not just the two most visible
statements — so the repair does not leave the header internally inconsistent
and seed another drift round:

1. Drop "visibility" from shape 2's closed-races list (`:32`); the
   expected-version helper closes the DM HP / conditions edits, and
   visibility belongs with the blind-path metadata.
2. Rewrite shape 3's false clause (`:35-38`): blind writes are for non-racing
   metadata fields, *including* the DM override UI's own writes when
   `expectedVersion` is omitted — the discriminator is the field's
   racing/non-racing classification, not which UI the write comes from.
3. Rename the DM conditions-path helper in the JSDoc (`:171-174`) to
   `updateParticipantStatsLockedWithExpectedVersion`.

Anchor the corrected prose on the already-accurate sources of truth —
`docs/CONCURRENCY.md`'s versioned-writes section (`:731-758`) and
`PARTICIPANT_FIELD_KIND` (`participant-action.ts:58-75`) — rather than
writing fresh prose; before finalizing each corrected sentence, re-read the
code path it describes so the fix is a transcription of verified behavior,
not a new claim. Preserve the header's structure, the "six helpers, four
shapes" taxonomy, and all rationale paragraphs. Comment-only change; no code,
type, or schema movement.

## Scope / caveats

- **Binding ruling (CQ25-103,
  `docs/agent_notes/backlog/code-quality-2026-07-25/CONSTRAINTS.md:38`):**
  trimming the `utils/*-mutations.ts` headers against `docs/CONCURRENCY.md`
  is refused permanently — the header, the doc, and the JSDoc are three
  altitudes of one contract. This leaf is a targeted accuracy correction, not
  the refused trim; do not shorten, restructure, or pointer-ize any paragraph
  while fixing the false statements. The prior pack's keep-verbatim list
  (`docs/agent_notes/backlog/code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md:1031-1038`)
  names `:6-56` and the turn-origin JSDocs; "keep verbatim" barred deletion,
  not factual repair, but everything outside the three false claims stays
  word-for-word.
- No `docs/CONCURRENCY.md` edits: its participant-routing prose is already
  correct at `:175-183` and `:731-758`. Its one stale detail — locating
  `PARTICIPANT_FIELD_KIND` "in `routers/encounter.ts`" (`:745-746`) when the
  map lives in `services/encounter-combat/participant-action.ts:58` — is
  covered by [099-concurrency-rulebook-mislocates-participant.md](./099-concurrency-rulebook-mislocates-participant.md);
  do not fix it here.
- Out of scope: any change to the helpers themselves, to
  `PARTICIPANT_FIELD_KIND`, to `BlindParticipantFields`' member list, or to
  which path any field routes through. The code is the side that is right.
- The `tickConditions` clause of the JSDoc (`:173-174`) is accurate — the
  turn-transaction path does use the plain locked helper. Change only the DM
  path's helper name in that sentence.
- Leaf 007 modifies the same `participant-stats-mutations.ts` header while
  introducing the cascade-origin coordinator: it rewrites the shape-4 block,
  while this leaf corrects shapes 1–3 and the `BlindParticipantFields` JSDoc.
  Either order works, but do not implement the two leaves concurrently.

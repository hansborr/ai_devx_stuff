# Decisions — schemas

Schema/type-domain entries split out of `DECISIONS.md` once it crossed
~400 lines. See `DECISIONS.md` for the full preamble (when to read, when to
add, entry template) and the index of domain files.

---

## Output-schema regression gate walks the Zod tree

Status: Active
Domain: schemas

### Context
`.output(schema)` on hot-path tRPC procedures catches field-shape
regressions at the type boundary. But a procedure that declares
`.output(z.unknown())` or a schema permissive enough to accept `undefined`
at the top level silently neuters the gate — the check passes, the
guarantee is worthless.

### Decision
`app-router.output-coverage.test.ts` recursively walks each procedure's
output Zod tree and rejects `z.any()`, `z.unknown()`, and any schema
accepting `undefined` at the top level. A procedure can opt out of the
gate only via an explicit allowlist in the test file with a comment
explaining why (and those entries need review before they grow).

### Consequences
- Adding a new hot-path procedure without `.output()` fails the gate.
- "Just use `z.unknown()` for now" fails the gate. Define the shape — if
  you can't, the procedure probably shouldn't ship yet.
- Extending the allowlist is a code review signal, not a routine move.

### References
- `packages/server/src/routers/app-router.output-coverage.test.ts`

---

## Combat state: by reference, not copy

Status: Active
Domain: schemas

### Context
`EncounterParticipant` could have held a full HP/AC snapshot of the
character — simpler to render, simpler to query. But then every source
of HP change (resting out of combat, item use, level-up) has to write to
two places, and they drift.

### Decision
`CharacterStats` is the single source of truth for a PC's HP/AC.
`EncounterParticipant` holds only ephemeral combat state (initiative,
turn order, reaction-used, conditions). Monsters and NPCs, which have
no `CharacterStats` row, store HP/AC inline on the participant.

### Consequences
- Combat UI joins through `CharacterStats` for PCs — don't duplicate HP
  onto the participant row.
- A new combat-time field: does it survive the encounter? On
  `CharacterStats`. Does it reset on `endEncounter`? On
  `EncounterParticipant`.
- Concentration is a separate column (`characterStats.concentrationSpellId`),
  not a condition — conditions come and go per-turn, concentration
  persists across combats.

### References
- `docs/architecture-plan.md`
- `AGENTS.md` working model

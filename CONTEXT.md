# Character Live-State Context

> **Scope:** This is a focused orientation note for
> `packages/server/src/services/character-live-state/`, not a repository-wide
> glossary or architecture overview.

## Owned live-state commands

Mutable, play-time state for a Character: stats, HP, conditions, spell slots,
sorcery points, feature uses, and rest outcomes. Character Live-State commands
must enforce character access, use the sanctioned locked mutation helpers for
race-sensitive rows, emit `character:updated` after a committed write, and
record mutation logs consistently for hot paths.

Top-level Character Live-State commands own their write boundary, post-commit
`character:updated` broadcast, and mutation log entry. In-transaction helpers
exist only for compound commands owned by another module; they run inside the
caller transaction, do not log, and return a post-commit side-effect plan for
the outer command to fan out.

## Concentration boundary

Spell casting, concentration replacement, and explicit concentration drops
belong to `packages/server/src/services/spell-casting/`, which owns their
transactions and concentration-state changes. For non-combat casts and
`dropConcentration`, `packages/server/src/routers/cast-spell.ts` owns
authorization and emits the post-commit `character:updated` broadcast; the
spell-casting service itself does not broadcast. Rest may clear concentration
as part of a rest outcome, but Character Live-State does not own the general
concentration command boundary.

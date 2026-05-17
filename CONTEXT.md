# Context

## Character Live-State

Mutable, play-time state for a Character: stats, HP, conditions, spell slots,
sorcery points, feature uses, concentration, and rest outcomes. Character
Live-State commands must enforce character access, use the sanctioned locked
mutation helpers for race-sensitive rows, emit `character:updated` after a
committed write, and record mutation logs consistently for hot paths.

Top-level Character Live-State commands own their transaction, post-commit
`character:updated` broadcast, and mutation log entry. In-transaction helpers
exist only for compound commands owned by another module; they run inside the
caller transaction, do not log, and return a post-commit side-effect plan for
the outer command to fan out.

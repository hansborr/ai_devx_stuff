# Lane 04 — shared package

Status: Dispatch material — not a schedulable note

**Scope.** `packages/shared/src/` in full: Zod schemas, derived types, the
SRD 5.2.1 rules content and rules engine, cross-package contracts, plus the
package's config surface. **Excluding**
`*.test.*`/`*.spec.*`/`*.test-helper.*` files — lane 06 owns test shape
repo-wide; pointer, not finding.

**Emphasis.** Schemas as the contract: places where server or client
re-declare shapes that should derive from shared; schema files organized by
accident rather than domain; rules-engine logic where data tables and logic
are tangled; naming that does not match SRD vocabulary or matches it
misleadingly; barrel/export hygiene; types exported but never consumed
(check with `bun run code:intel -- dependents <file>` — verify the exact
command surface first).

**Known context.** The 2026-07-25 shared cluster is *finished* (21/22
slices) — this package was recently and densely worked, so the bar for
re-reporting is high; prefer findings about what that cluster's shape left
behind or newly-changed code. CONSTRAINTS.md carries schema rulings (e.g.
around legacy persisted homebrew keys) — check before proposing schema
reshapes.

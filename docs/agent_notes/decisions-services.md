# Decisions — services

Service-layer entries split out of `DECISIONS.md` once it crossed ~400
lines. See `DECISIONS.md` for the full preamble (when to read, when to add,
entry template) and the index of domain files.

---

## Service layer: three-tier taxonomy (deep module / flat service / utils)

Status: Active
Domain: services

### Context
`packages/server/src/services/` was a grab-bag. Some files were single
functions used once, others were 400-line facades owning a whole domain.
Without a rule for which is which, every new piece of logic started a
debate about where it belonged.

### Decision
Three tiers, documented in `packages/server/src/services/README.md`:

1. **Deep modules** — one folder per domain, one facade entry point,
   internal helpers hidden (e.g. `combat-actions/`, `spell-casting/`,
   `level-up/`, `character-sheet-hooks/`). Complex multi-step domain
   logic lives here.
2. **Flat services** — single-file services with one clear responsibility
   (e.g. dice, notifications). Promote to a deep module if they grow
   internal surface area worth hiding.
3. **Utils** — stateless helpers with no domain semantics.

The promotion rubric (when to turn a flat service into a deep module)
lives in the services README.

### Consequences
- New complex workflows start as a deep module — don't sprawl them across
  utils + routers.
- Hooks (TanStack Query keys, invalidation) attached to a deep module
  live alongside it, not in a parallel `hooks/` tree.

### References
- `packages/server/src/services/README.md`
- Worked deep-module examples in-tree: `services/combat-actions/`,
  `services/spell-casting/`, `services/level-up/`,
  `services/encounter-combat/`.

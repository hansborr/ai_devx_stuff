# Module Docs Charter

`MODULE.md` files are orientation contracts for code surfaces that are too
large, stateful, or subtle to understand from filenames alone. They should
answer "where do I start, what owns state here, and what must not drift?"

## Concept Breadcrumbs

After the H1, module docs may include one optional `Concepts:` line with a
short comma-separated list of domain terms that should point future agents
toward this module. Keep it to the terms someone would search for, not every
file or symbol name in the directory.

Example:

```md
# campaign combat module

Concepts: initiative, turn order, death saves, combat log
```

## Where Required

Add or keep a `MODULE.md` for:

- Large feature directories with several files, tests, or subdirectories.
- Shared hooks, services, or component folders that hide non-obvious data flow.
- Surfaces that own transactions, cache writes, socket invalidation, optimistic
  updates, store writes, or cross-module contracts.
- Directories that are named in roadmap work as future refactor targets.

Do not add one for a single self-contained file unless it carries invariants
that would otherwise live only in comments. Server flat services may use a
`<name>-MODULE.md` companion when the implementation should stay flat.

## Required Sections

New and refreshed module docs should use these section names unless a section
is genuinely not applicable:

- **Purpose** - what the directory owns and what it deliberately does not own.
- **Data Flow** - important query/mutation/socket/store/transaction flow.
- **External Entry Points** - public hooks, facades, components, router calls,
  or imports used from outside the directory.
- **State Ownership** - cache keys, store slices, DB rows, socket events,
  broadcasts, locks, or optimistic updates owned here.
- **Test Seams** - focused tests, helper seams, mocks, or boundary tests a
  contributor should run or extend.
- **Gotchas** - invariants, deferred work, cross-module dependencies, and
  decisions future contributors are likely to accidentally break.

Short module docs can keep each section to a few bullets. Deep services should
be more explicit about contracts, invariants, and broadcasts.

## Discoverability

Run `bun run module:index` after adding, moving, renaming, or deleting a
`*MODULE.md` orientation file. The generated root `MODULE-INDEX.md` is the
quick cold-start map; the local module doc remains the source of truth.

## Agent Standards Mapping

`MODULE.md` and `<name>-MODULE.md` are this repo's nested-`AGENTS.md`
equivalent: local orientation contracts that agents must read before editing a
feature, service, hook, socket, or other subtle surface. The root `AGENTS.md`
names that convention directly, and `MODULE-INDEX.md` keeps the inventory
browsable without adding generated instruction stubs throughout the tree.

Adopters whose agents rely only on native nested-`AGENTS.md` discovery can emit
short generated `AGENTS.md` files that point to the local `MODULE.md` source of
truth. Musi does not generate those stubs today because the active repo
workflow already loads the root `AGENTS.md` instruction and no `.claude/` or
`.codex/` config depends on native nested-`AGENTS.md` discovery.

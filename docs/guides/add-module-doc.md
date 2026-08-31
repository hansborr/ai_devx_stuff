# Add Or Refresh A Module Doc

Use this path when adding or changing a `MODULE.md` or `*-MODULE.md`
orientation file for a code surface.

1. Read `docs/module-docs.md` first. It is the charter; this guide is only the
   workflow checklist.
2. Read the nearest existing module doc before editing. If no local doc exists,
   inspect one neighboring module doc in the same package for naming, depth, and
   link style.
3. Add or refresh a module doc only when the directory has enough state,
   cross-file flow, contracts, or future refactor weight to help the next
   contributor. Do not add one for a simple single-file surface unless the file
   owns invariants that would otherwise be hidden.
4. Use `MODULE.md` for directory-oriented modules. Use `<name>-MODULE.md` only
   for a flat server service or similar surface that should stay as a single
   source file.
5. Keep the H1 human-readable and stable. After the H1, add one optional
   `Concepts:` line when search terms would help future agents find the module.
   Use short domain terms such as `initiative`, `socket broadcasts`, or
   `optimistic cache`; do not list every file, component, or symbol.
6. Use the standard section names from `docs/module-docs.md`: Purpose, Data
   Flow, External Entry Points, State Ownership, Test Seams, and Gotchas. Omit a
   section only when it genuinely does not apply.
7. In Purpose, state what the module owns and what neighboring module owns the
   adjacent concern. Avoid restating the directory tree.
8. In Data Flow and State Ownership, name the real boundary objects: tRPC
   procedures, services, stores, cache keys, Prisma rows, socket events,
   broadcasts, transactions, locks, or optimistic writes.
9. In External Entry Points, link to facades, hooks, components, router calls,
   or imports that callers should use. Avoid documenting private helper files
   unless using them directly would be a bug. The section is an inventory, not
   a sample: list every export non-test production code imports from outside
   the directory, or state a narrower scope in the section itself. Never list a
   file-private symbol; a composition root nothing outside imports belongs in
   Data Flow instead. Derive the list mechanically rather than from memory:

   ```bash
   # Candidate exports of one file.
   bun run code:intel -- exports <file>
   # Who imports that file, `*.test.ts(x)` excluded.
   bun run code:intel -- dependents <file> --exclude-tests
   # Per symbol: non-test files outside <dir> that name it.
   git grep -lw "<symbol>" -- '<package-src>' \
     ':(exclude)<dir>' ':(exclude)*.test.*' ':(exclude)*.spec.*' \
     ':(exclude)*/test/*' ':(exclude)*test-helper*'
   ```

   The last two pathspecs exclude the test-only modules that live outside
   `*.test.*` — the per-package `src/test/` trees of fixtures and mocks, and
   `*test-helper*` modules — which `--exclude-tests` does not drop either, as
   it matches `*.test.ts(x)` basenames only (`STRICT_TEST_BASENAME_PATTERN` in
   `scripts/lib/path-taxonomy.ts`). `dependents` reports file-level edges, so
   the per-symbol `git grep` is what decides which of a multi-export file's
   symbols earn a row.
10. In Test Seams, name the focused test files, test helpers, mocks, or command
    slices a contributor should run when changing the module.
11. In Gotchas, record invariants and cross-module dependencies that are easy
    to break. Do not add open-ended TODOs; use a locatable issue/PR id, URL, or
    concrete path under `docs/roadmap/` or `docs/agent_notes/` when deferred
    work matters.
12. Keep the doc short enough to scan. Prefer durable contracts and ownership
    rules over churn-prone implementation narration.
13. After adding, moving, renaming, or deleting any `*MODULE.md` file, or after
    changing a module-doc H1 or `Concepts:` breadcrumb, run
    `bun run module:index` and include the generated `MODULE-INDEX.md` update.
    For a doc refresh that leaves indexed paths, headings, and `Concepts:`
    breadcrumbs unchanged, run `bun run module:index:check`.
14. Run `bun run verify:changed` before calling the change done.

Useful checks:

- `bun run module:index` regenerates `MODULE-INDEX.md` from `*MODULE.md`
  headings and `Concepts:` breadcrumbs.
- `bun run module:index:check` fails when `MODULE-INDEX.md` is stale.
- `scripts/tests/test-generate-module-index.sh` covers index generation, concept
  breadcrumb extraction, and drift reporting.

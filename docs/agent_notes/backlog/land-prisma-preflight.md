# land.sh Prisma preflight for migration-carrying branches

Status: Done — 2026-07-19, implemented in this branch (fix/land-gate-footer-prisma).
Date: 2026-07-19
Source: 2026-07-19 drain — landing migration-carrying lane branches cost three
failed land attempts before the manual recipe stabilized. The failure mode and
the manual remedy are documented in
`docs/guides/add-prisma-migration.md` ("Cross-worktree staleness"); this leaf
automates the remedy inside `scripts/land.sh`.
Size: S.

## Evidence

`packages/server/src/generated/` is gitignored, per-worktree state. When
`land.sh --branch <name>` runs from the primary, the full `verify` gate
resolves types against the PRIMARY's generated Prisma client, which knows
nothing about the branch's migration:

- The typecheck slot fails with misleading `TS2345` errors at mapper call
  sites (row contracts missing the new columns) — the errors point at
  innocent files.
- The test slot's dist-preflight has an mtime guard
  (`scripts/prisma-client-freshness.sh`: "schema.prisma newer than generated
  client") that re-trips after ANY checkout/ff that rewrites
  `schema.prisma` — even a content-identical rewrite bumps the mtime.

Each failed attempt costs a partial full-verify (~10–15 min) plus a
diagnosis detour, because nothing in the land output names the real cause.

## Working manual recipe (what the preflight should automate)

1. Park the primary on a throwaway branch at the feature tip
   (`git switch -c chore/land-prep <branch>` — same tree, so the land
   checkout rewrites nothing).
2. `bun run --filter @musi/server prisma:generate`.
3. Land. After any later ff/switch that changes `schema.prisma`,
   regenerate before the next land.

## Proposed fix

In `land.sh`, run `bun run --filter @musi/server prisma:generate`
UNCONDITIONALLY after the exact verify tree is settled, immediately before
`bun run verify`. Two placement constraints, both load-bearing:

- The insertion point is after the prospective MERGE-TREE construction
  (the `git switch --detach` + `--no-ff` merge in diverged-branch mode),
  not merely after the integration-branch checkout — otherwise a diverged
  branch generates from the branch tip and verifies a different merged
  schema.
- Regenerate unconditionally rather than gating on a freshness check:
  generation is seconds against a 10–15 min verify, is deterministic from
  the checked-out schema, and an mtime heuristic cannot prove
  schema-content identity. (`scripts/prisma-client-freshness.sh` is a
  sourced function library — `musi_prisma_client_freshness`, consumed by
  `test-dist-preflight.sh` — not a runnable CLI, and `db-status.ts`
  duplicates the mtime logic rather than wrapping it. It stays as the test
  slot's defensive backstop; it is not this preflight's gate.)

On generation failure: restore the preview, clean up the integration
branch, and exit `1 not-landed` (verify never ran, so `2 verify-failed`
would be wrong — match the sibling `harness:check` preflight) with the
generator's diagnostic retained in the output.

Failure-path drift, addressed explicitly: on a failed verify, land
restores the starting checkout while `src/generated/` still matches the
abandoned tree. This is accepted-because-guarded, not fixed: the restore
rewrites `schema.prisma` (content differs for a migration-carrying
branch), which re-trips the mtime guard and forces regeneration on the
next guarded run. Unguarded consumers (a running dev server, editor
typecheck) see the ahead-of-schema client until then — worth a one-line
note in land's failure output, not worth a second generate on the restore
path.

## Non-goals

Pending DB migrations (`db:migrate` against the per-worktree database, per
`add-prisma-migration.md`) are out of scope — this preflight fixes the
stale-client typecheck/mtime failures only; a land can still burn on an
unapplied migration in the test slot.

## Registration

- Behavior change in `land.sh` → extend `scripts/tests/test-land.sh`.
  Note the freshness check compares `schema.prisma` against the generated
  DIRECTORY mtime (there is no marker file). Fixtures: branch-tip and
  merge-tree placement, missing client, generator failure (asserting the
  `1 not-landed` trailer and cleanup).
- If a new failure token is added to the land trailer vocabulary, check the
  exit-status contract comment at the top of `land.sh` stays truthful.

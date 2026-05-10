# Add A Prisma Migration

Use this path when changing `packages/server/prisma/schema.prisma` or adding
SQL under `packages/server/prisma/migrations/`.

1. Make the Prisma schema change first. Do not use `db:push` for committed
   schema changes; it is not a migration history.
2. Generate a reviewable migration from the repo root:
   `bun run --filter @musi/server db:migrate -- --name <short_snake_name> --create-only`.
3. Inspect the generated `migration.sql` before applying it. Prisma can emit
   data-losing SQL for renames, required columns, relation reshapes, and enum
   or type changes.
4. Rewrite risky SQL into a safer migration when possible:
   add required columns as nullable or with a default before backfilling,
   rename tables or columns instead of dropping and recreating them, copy data
   into replacement tables before dropping old storage, and make type changes
   use a `USING` cast that is valid for every existing row.
5. Apply the migration locally:
   `bun run --filter @musi/server db:migrate`.
6. Regenerate the Prisma client even if `migrate dev` already ran generators:
   `bun run --filter @musi/server prisma:generate`.
7. Run the safety scanner and read the output:
   `bun run db:migration-safety`.
8. If the scanner reports `WARN:`, decide explicitly:
   rewrite the SQL as a safer multi-step migration, or acknowledge the
   intentional destructive operation in
   `packages/server/prisma/migrations/.safety-acknowledged` with the migration
   directory name and a short reviewed reason.
9. Update code, seeds, tests, and shared schemas that depend on the model
   shape. Keep business behavior in server services and router contracts in
   shared Zod schemas.
10. Run `bun run verify:changed` before calling the change done.

The migration safety scanner is warn-only. A zero exit code does not mean every
migration is safe; it means the scanner finished and printed its findings.
Read the `== actionable warnings ==` section first. `WARN:` findings there
need a rewrite or acknowledgement; `INFO:` findings under
`== acknowledged findings ==` are already-reviewed history. `doctor` also runs
the scanner, so unacknowledged destructive operations stay visible during local
review.

Scanner findings to treat as review blockers until resolved:

- `DROP TABLE`: confirm no live data or dependent reads remain, or migrate the
  data first.
- `DROP COLUMN`: confirm the column is already backfilled elsewhere and code no
  longer reads it.
- `ALTER COLUMN ... TYPE`: confirm the cast is total over existing data. Use an
  explicit `USING` clause when the conversion is not trivially safe.
- `ADD COLUMN ... NOT NULL without DEFAULT`: split it into add nullable,
  backfill, then set `NOT NULL`, or add a default that is correct for existing
  rows.

Acknowledgement rules:

- Add one line per migration directory to `.safety-acknowledged`, followed by a
  short reason that explains what was reviewed.
- Acknowledge in the same change as the migration. The allowlist is reviewable
  history, not a way to silence old warnings after the fact.
- Fix stale acknowledgement warnings by correcting the directory name or
  removing the stale line.

Useful checks:

- `bun run db:status` reports connectivity, pending migrations, seed health,
  and Prisma client freshness for the current worktree.
- `bun run db:migration-safety packages/server/prisma/migrations/<migration>`
  scans one migration while iterating.
- `bun run doctor` includes migration safety after the eslint-disable register
  check.

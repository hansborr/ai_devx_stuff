# Devcontainer Fresh-Setup Hardening

Status: Resolved (2026-06-14, branch `fix/devcontainer-fresh-setup`)
Date: 2026-06-15
Source: `doctor` investigation after a host change brought up a fresh devcontainer
that came up half-provisioned and silent about it.

## Resolution

All five issues below are addressed; the env-file/password reconciliation stays
out of scope as noted.

- **#1 swallowed failures / unconditional marker** → `postCreateCommand` now runs
  `.devcontainer/post-create.sh`, which tees every step to
  `/tmp/musi_logs/post-create.log`, tallies critical-step failures, writes
  `.setup-complete` only on full success, and otherwise writes `.setup-failed` and
  exits non-zero. Gating is covered by `scripts/tests/test-post-create.sh`.
- **#2 `@musi/shared` never built** → added as a critical setup step.
- **#3 DB never seeded** → `db:seed` is a critical setup step (seeds are
  upsert-idempotent, safe to re-run).
- **#4 test DBs not provisioned** → `post-create.sh` idempotently (re)creates
  `musi_test` / `musi_test_e2e` via `pgexec.ts` (autocommit, no psql), independent
  of the empty-volume-only initdb hook; `db:status` now reports their presence so
  `doctor` surfaces it.
- **#5 dependency-freshness false "stale"** → `scripts/dependency-freshness.sh` now
  compares a content digest of `bun.lock` recorded by a root `postinstall`
  (`scripts/write-install-digest.sh`) instead of racing mtimes; falls back to the
  legacy mtime check when no digest/marker is available.

## Context

A freshly (re)created devcontainer came up broken in several ways that `bun run
doctor` surfaced but `postCreateCommand` did not. The DB password mismatch that
triggered the investigation is an **env-file concern handled separately** (the
`.devcontainer/.env` `POSTGRES_PASSWORD` / `*_DATABASE_URL` values) and is out of
scope for this item. What's tracked here is the set of repo/container-side gaps
that made a half-working container *look* fine.

`postCreateCommand` (`.devcontainer/devcontainer.json`) is currently:

```
bun install 2>/dev/null; \
bun run --filter @musi/server prisma:generate 2>/dev/null; \
bun run --filter @musi/server db:migrate:deploy 2>/dev/null; \
bunx playwright install chromium 2>/dev/null; \
echo 'postCreateCommand complete ...'; touch /workspace/.setup-complete
```

## Issues (within the container — fixable in-repo)

1. **Setup failures are swallowed and then reported as success.** Every step is
   `2>/dev/null`, and `.setup-complete` is `touch`ed unconditionally at the end.
   When `db:migrate:deploy` failed (it could not connect), the container reported
   "complete" with an empty, unmigrated DB and no error anywhere. Setup should
   fail loudly (or log to a known file) and the completion marker should only be
   written when the critical steps actually succeeded.

2. **`@musi/shared` is never built during setup.** A fresh container has no
   `packages/shared/dist`, so `doctor` FAILs on "shared dist not built" and any
   dist-importing test/consumer breaks until a manual
   `bun run --filter @musi/shared build`. Add the shared build to setup.

3. **The DB is never seeded.** Even on a clean migrate, the dev DB has schema but
   no SRD reference data (`doctor` checks "SRD seed present"; it was absent here).
   Decide whether `db:seed` belongs in `postCreateCommand` (or a documented
   one-liner) so a fresh DB is usable for the app and seed-dependent tests.

4. **Test databases are not reliably provisioned on a fresh volume.**
   `init-test-db.sql` is mounted into `/docker-entrypoint-initdb.d/` and is meant
   to create `musi_test` + `musi_test_e2e` on first init, but on this
   freshly-initialized volume (PG_VERSION written at init time) neither existed —
   both had to be created and migrated by hand. Investigate why the initdb hook
   did not take effect, and make test-DB provisioning reliable and/or
   self-healing in a setup script or `doctor` (the test/e2e DBs are assumed to
   exist by `db:status` and the test harness).

5. **`doctor` dependency-freshness reports a false "stale" after a clean
   `bun install`.** The check is `bun.lock -nt node_modules/.bin`
   (`scripts/dependency-freshness.sh`). `bun install` re-saves `bun.lock` (bumps
   its mtime) even when nothing changed, so the lockfile ends up ~1s newer than
   the `.bin` marker and the check prints "run 'bun install'" — which does not
   clear it (it loops). Make the signal robust: refresh the `.bin` marker on
   install, hash-compare the lockfile, or use a dedicated install-completion
   marker instead of an mtime race.

## Scope

- Harden `postCreateCommand` (or move its body into a tracked
  `.devcontainer/*.sh` setup script) to: not swallow errors, build
  `@musi/shared`, optionally seed, and only mark complete on real success.
- Make test-DB provisioning deterministic (fix the initdb hook and/or add an
  idempotent create+migrate step that runs in setup/doctor).
- Fix the `dependency-freshness` mtime false-positive.
- Keep the env-file/password reconciliation OUT of scope (handled separately).

## Verification

- Recreate the devcontainer from an empty `postgres-data` volume; with no manual
  steps, `bun run doctor` reports green infra (DB connected + migrated + seeded,
  shared dist fresh, deps in sync, test/e2e DBs present).
- Inject a failing setup step (e.g. an unreachable DB) and confirm setup surfaces
  the failure and does NOT write `.setup-complete`.
- After a no-op `bun install`, `doctor` dependency-freshness stays `fresh`.

## Out of scope / already tracked elsewhere

The current `doctor` run also has pre-existing FAILs/WARNs unrelated to container
setup — eslint-disable register (`scripts/drift-ai/suppressions.test.ts`,
`packages/server/src/utils/prisma-types.test.ts`), drift:ai harness freshness,
and knip — which appear to be the focus of the `fix/doctor-hygiene` branch. Not
part of this item.

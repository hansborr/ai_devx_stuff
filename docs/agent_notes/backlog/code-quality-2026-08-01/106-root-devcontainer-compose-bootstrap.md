# 106. Root and devcontainer Compose each mount their own copy of the test-DB init SQL, with nothing keeping the copies equal

Status: Not started
Theme: enforced single-source bootstrap assets · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two Compose stacks bootstrap PostgreSQL test databases from two separate SQL
files that just happen to be identical: root `docker-compose.yml` mounts
`init-test-db.sql` from the repo root, the devcontainer's Compose mounts its own
`.devcontainer/init-test-db.sql` at the same container path. Their equality is
maintained by hand — no check, generator, or even a comment ties them together.
Either copy can be edited alone while both stay syntactically valid, and the
failure mode is quiet: the environments start provisioning different test
databases, surfacing later as vitest or Playwright suites finding a database in
one environment and not the other. The root copy already shows drift-in-meaning:
its header promises a `.devcontainer/post-create.sh` self-healing fallback that
only runs inside the devcontainer, not for the root Compose path.

## Evidence

- `docker-compose.yml:13` — root Compose mounts `./init-test-db.sql` into
  `/docker-entrypoint-initdb.d/` (read-only) on the `db` service.
- `.devcontainer/docker-compose.yml:59` — devcontainer Compose independently
  mounts its local `./init-test-db.sql` at the same container path.
- `init-test-db.sql:1-12` and `.devcontainer/init-test-db.sql:1-12` — both
  12-line files are the same pinned Git blob
  (`083577183b7044314d060e11c051ca3c82954c0e`); `cmp` confirms byte equality.
- `init-test-db.sql:6-7` — the root copy's header names
  `.devcontainer/post-create.sh` as the idempotent re-provisioning fallback — a
  mechanism the root Compose path does not run
  (`.devcontainer/post-create.sh:53-59` documents it; the re-provisioning loop
  over `TEST_DB_NAMES` starts at `:189` — devcontainer-only either way).
- No guard exists: outside this audit's notes, the only references to
  `init-test-db` are the two Compose mounts, the prose comment at
  `.devcontainer/post-create.sh:54`, and `docs/generated/lint-coverage-map.md:365`,
  which merely marks both files `excluded` from the lint surface — nothing
  compares or generates them.

## Proposed direction

Per the agreed disposition: **single-source the `init-test-db.sql` asset where
mount portability permits, or keep both copies and add a cheap byte-equality
drift check (doctor or an existing generated-surface check) so root and
`.devcontainer` bootstrap cannot silently diverge.**

Mechanics for the two options:

1. **Single source.** Point one Compose file at the other's copy — e.g.
   `.devcontainer/docker-compose.yml:59` mounting `../init-test-db.sql`, or
   `docker-compose.yml:13` mounting `./.devcontainer/init-test-db.sql` — and
   delete the duplicate. Weigh this against the portability caveat below before
   choosing it.
2. **Equality check.** Keep both copies and add a byte-equality check
   (`cmp -s init-test-db.sql .devcontainer/init-test-db.sql` with a
   fix-it message naming both paths). The natural home is `scripts/doctor.sh`
   (`bun run doctor`), which is already structured as `check_*` functions
   registered at `scripts/doctor.sh:801-808` and already owns
   environment-bootstrap sanity checks; a generated-surface check is the
   heavier alternative and only worth it if one copy becomes generated.

Either way, fix the root copy's header so its fallback claim matches whichever
environments actually mount it (the `post-create.sh` sentence at
`init-test-db.sql:6-7` is devcontainer-specific).

## Scope / caveats

- **Portability caveat on option 1:** `.devcontainer/README.md:271-283` pitches
  copying the entire `.devcontainer/` directory into another repo as a
  standalone unit. A devcontainer mount reaching up to `../init-test-db.sql`
  breaks that copy-the-directory reuse; the reverse (root Compose reaching into
  `.devcontainer/`) couples the plain root stack to the devcontainer's
  existence. If neither coupling is acceptable, option 2 is the fix — that is
  the "where mount portability permits" clause.
- Out of scope: changing what the SQL provisions (the two `CREATE DATABASE`
  statements), the `post-create.sh` fallback design, and the devcontainer
  quick-start/reuse documentation gaps — those belong to
  [082-devcontainer-quick-start-depends.md](082-devcontainer-quick-start-depends.md),
  which explicitly cedes this compose-duplication finding here. Soft file
  overlap with that leaf only (it rewrites `.devcontainer/README.md` sections
  naming `init-test-db.sql`, adjacent to `.devcontainer/docker-compose.yml:59`);
  different lines and problems, no ordering edge.
- No prior-pack coverage: no 2026-07-25 leaf touches these files or this
  duplication.

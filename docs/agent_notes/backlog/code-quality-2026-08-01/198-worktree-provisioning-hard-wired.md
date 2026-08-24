# 198. Worktree database provisioning must resolve credentials for both supported topologies

Status: Not started
Theme: provisioning credential sources · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Worktree provisioning assumes that every contributor uses the devcontainer
database topology. Its admin-URL resolver unconditionally reads the primary
checkout's `.devcontainer/.env`, even though the repository also supplies a
root Compose setup configured through the root `.env`.

A contributor following the root setup can have valid, reachable PostgreSQL
credentials and still be blocked because a second, unrelated env file is
missing. Copying the devcontainer example merely to satisfy the check is unsafe:
that template names `db:5432`, a hostname intended for communication inside the
container network rather than from the host-side root setup.

The dedicated per-worktree guide compounds the failure by presenting
`worktree:init` and `worktree:new` as self-contained provisioning entry points.
It has no prerequisites section explaining the primary-checkout credential
source or why a populated root `.env` does not currently satisfy that lookup,
leaving contributors who followed the repository's root onboarding path with no
warning before their first worktree command fails.

## Evidence

- `scripts/worktree-db.sh:40-43` — the script header declares
  `.devcontainer/.env` as its sole admin `DATABASE_URL` source.
- `scripts/worktree-db.sh:222-240` — `admin_url()` resolves the primary checkout,
  dies if `<primary>/.devcontainer/.env` is absent, sources only that file, and
  rewrites its `DATABASE_URL` to the `postgres` database. The primary checkout
  comes from `primary_root()` at `scripts/worktree-db.sh:160-168`; the missing
  file and missing-variable failures are at `scripts/worktree-db.sh:228` and
  `scripts/worktree-db.sh:237`, and `db_url()` at
  `scripts/worktree-db.sh:243-247` funnels database helpers through this
  resolver.
- `.env.example:1-13` — the documented root env file contains PostgreSQL
  credentials plus development, test, and E2E URLs on `localhost:8002`.
  `README.md:39` tells contributors to create the root `.env` from that
  template, whose `DATABASE_URL` appears at `.env.example:9`.
- `docker-compose.yml:1-15` — the root database service consumes those root
  credentials and publishes PostgreSQL on host port 8002.
- `.devcontainer/.env.example:10-16` — the devcontainer topology instead uses
  the container-network address `db:5432`.
- `docs/guides/per-worktree-dev.md:6-28` — the guide presents `worktree:init`
  and `worktree:new` as provisioning entry points without documenting the
  exclusive credential lookup. More specifically, its opening at
  `docs/guides/per-worktree-dev.md:3-12` promises automatic database, port,
  Redis, and env-file provisioning without a prerequisites section, and its
  command entries at `docs/guides/per-worktree-dev.md:20-21` read as
  self-contained.
- `.devcontainer/README.md:10-12` — the devcontainer quick start is the only
  documented path that creates the currently required file; its corresponding
  `DATABASE_URL` template is at `.devcontainer/.env.example:14`.
- `scripts/tests/test-worktree-db.sh:15-25` — the shell smoke suite already
  sources `worktree-db.sh`, but its existing `admin_url` uses at `:97-172`
  replace the resolver with a stub rather than exercising source selection.

## Proposed direction

Give `admin_url()` an explicit credential-source precedence:

1. A new dedicated override, such as
   `MUSI_WORKTREE_ADMIN_DATABASE_URL`, wins when set.
2. Otherwise retain compatibility with `DATABASE_URL` from the primary
   checkout's `.devcontainer/.env`.
3. If that file is absent, accept `DATABASE_URL` from the primary root `.env`
   for the repository's root Compose topology.

Resolve the source once, report which source was selected without printing
credentials, and fail with an actionable diagnostic listing the checked
sources. Validate the selected value as a PostgreSQL URL with a non-empty
database component before deriving the `postgres` admin URL or allowing any
database/state write. Keep the root fallback tied to the primary checkout; do
not search arbitrary ancestor or current-worktree env files.

Add focused cases to `scripts/tests/test-worktree-db.sh` for override precedence,
devcontainer compatibility, root-Compose fallback, absent variables, malformed
URLs, and diagnostics that do not expose passwords. Update the script's `Reads`
header and admin-URL comment with the same precedence.

Add an early `Prerequisites` section to `docs/guides/per-worktree-dev.md`
immediately after the introduction and before the `bun run dev` section or any
command table. Document the same override → primary `.devcontainer/.env` →
primary root `.env` precedence established by the script. Distinguish the two
env files and their supported topologies, link `.devcontainer/README.md` rather
than restating its contents, and state that the PostgreSQL server named by the
selected URL must be reachable when `worktree:init` runs. Keep
`scripts/worktree-db.sh` authoritative: the guide should summarize its source
selection and point readers to the script, not independently elaborate the
algorithm.

## Scope / caveats

- The root `.env` is a fallback for the declared root Compose topology, not a
  generic promise that every `DATABASE_URL` found on disk is safe for
  provisioning. Custom setups should use the explicit override.
- URL validation must occur before destructive database commands or allocation
  state writes; it must not log the resolved URL because it can contain a
  password.
- The guide change documents the implemented resolution contract; it must not
  preserve the current devcontainer-only behavior or independently change
  credential resolution.
- Do not restate either env file's contents in the guide. Link the devcontainer
  README and keep the script authoritative so the prerequisites do not drift
  when templates or resolution details change.
- The 2026-07-25
  [worktree state-codec leaf](../code-quality-2026-07-25/29-bash-to-ts-cores.md)
  and its remaining plan slices concern state serialization and file layout.
  Keep this change local to credential resolution and its tests.
- Do not reopen that pack's rejected TypeScript-core extraction or broad
  `worktree-db.sh` decomposition. Neither is needed for this precedence chain.
- No prior-pack record covers the per-worktree prerequisite documentation gap.

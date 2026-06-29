# Per-Worktree Dev Flow

This guide covers the secondary git worktree development path. The shell script
headers remain the authoritative reference for command behavior.

## `bun run dev` In A Linked Worktree

`bun run dev` runs `scripts/dev.sh`. In a secondary git worktree, `main()` calls
`musi_dev_run_worktree_init` before the shared prebuild and workspace dev
servers (`scripts/dev.sh:244-247`). That runs `bun run worktree:init`, which
provisions per-worktree dev/test/e2e databases, server and client ports, a Redis
logical DB index, and the root/client `.env` files for the current worktree.

## `worktree:*` Scripts

The root scripts expose the worktree command surface:

| Command | Use |
| --- | --- |
| `bun run worktree:init` | Idempotently copy `.claude`, allocate ports and a Redis DB, ensure the template DB, clone per-worktree DBs, and write `.env` files. |
| `bun run worktree:new` | Create a secondary git worktree, run `worktree:init` inside it, then print assigned URLs, DB names, Redis DB index, and next commands. |
| `bun run worktree:drop` | Drop the current worktree's allowlisted DBs. |
| `bun run worktree:gc` | Sweep orphan `musi_wt_<slug>*` DBs whose worktrees no longer exist and whose grace period has elapsed; pass `--force` when intentionally overriding the grace period. |
| `bun run worktree:status` | Print current worktree DB, port, and template diagnostics. |
| `bun run worktree:template-refresh` | Rebuild the fingerprinted `musi_template_<hash>` DB via Prisma migrate deploy plus `seedSrd`; pass `--from-musi` when intentionally seeding from the primary DB. |
| `bun run worktree:refresh-data` | Recover from SRD seed drift by rebuilding the template, then applying migrations and SRD seed in place on dev/test/e2e DBs; pass `--destructive` to reclone those DBs from the template and discard local dev data. |

This mirrors the command headers in `scripts/worktree-db.sh:4-27` and the thin
`worktree:new` wrapper in `scripts/worktree-new.sh:1-20`.

## `MUSI_DEV_DRIFT_GATE`

After `worktree:init`, `scripts/dev.sh` checks `MUSI_DEV_DRIFT_GATE`
(`scripts/dev.sh:54-64`):

| Value | Behavior | Use When |
| --- | --- | --- |
| `warn` | Default. Report residual schema, migration, template, or SRD seed drift and continue starting dev. | Normal local development where the warning is actionable but should not block startup. |
| `fail` | Report residual drift and fail the dev startup. | A workflow must stop unless the worktree DB clone matches the checked-out schema, migrations, and SRD seed fingerprints. |
| `off` | Skip the residual drift gate; `0`, `false`, and `skip` are accepted aliases. | You intentionally need dev startup without this gate and will inspect or refresh the worktree separately. |

Unknown values fall back to `warn`.

## Recovery

When `bun run dev` reports residual worktree drift, inspect first:

```bash
bun run worktree:status
```

Then refresh data:

```bash
bun run worktree:refresh-data
```

The default refresh preserves user-created rows while reapplying migrations and
the SRD seed. If you need exact seed parity or want to clear the drift warning,
run `bun run worktree:refresh-data --destructive`; it reclones dev/test/e2e DBs
from the template, discards local dev data, and preserves the existing port and
Redis allocations.

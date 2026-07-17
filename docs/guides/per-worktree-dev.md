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
| `bun run worktree:drop [<path>] [--remove]` | Drop a worktree's allowlisted DBs and release its allocation; `--remove` also removes a clean target worktree while retaining its branch. |
| `bun run worktree:gc` | Sweep orphan `musi_wt_<slug>*` DBs whose worktrees no longer exist and whose grace period has elapsed; pass `--force` when intentionally overriding the grace period. |
| `bun run worktree:status` | Print current worktree DB, port, and template diagnostics. |
| `bun run worktree:template-refresh` | Rebuild the fingerprinted `musi_template_<hash>` DB via Prisma migrate deploy plus `seedSrd`; pass `--from-musi` when intentionally seeding from the primary DB. |
| `bun run worktree:refresh-data` | Recover from SRD seed drift by rebuilding the template, then applying migrations and SRD seed in place on dev/test/e2e DBs; pass `--destructive` to reclone those DBs from the template and discard local dev data. |

This mirrors the command headers in `scripts/worktree-db.sh:4-36` and the thin
`worktree:new` wrapper in `scripts/worktree-new.sh:1-20`.

## Teardown

From the primary checkout, tear down a clean secondary worktree in one command:

```bash
bun run worktree:drop /absolute/path/to/worktree --remove
```

The command checks for uncommitted work before touching any database or state,
drops the target's databases, releases its port and Redis allocation, and then
removes the git worktree. It retains the branch and prints the exact `git branch
-d <branch>` follow-up so you can delete it only after confirming its work is
landed. The no-path form remains available inside a secondary worktree when you
only need to drop its databases and allocation. `--remove` refuses to remove the
worktree that contains the current shell — whether that lane is selected
implicitly (the no-path form) or named explicitly (`.`, or any path that
resolves to it) — and refuses before touching any database or state, so it can
never strand a half-torn lane. Run `--remove` from the primary (or another
worktree) with a path to the lane you want removed.

## `MUSI_DEV_DRIFT_GATE`

After `worktree:init`, `scripts/dev.sh` checks `MUSI_DEV_DRIFT_GATE`
(`scripts/dev.sh:54-64`):

| Value | Behavior | Use When |
| --- | --- | --- |
| `warn` | Default. Report residual schema, migration, template, or SRD seed drift and continue starting dev. | Normal local development where the warning is actionable but should not block startup. |
| `fail` | Report residual drift and fail the dev startup. | A workflow must stop unless the worktree DB clone matches the checked-out schema, migrations, and SRD seed fingerprints. |
| `off` | Skip the residual drift gate; `0`, `false`, and `skip` are accepted aliases. | You intentionally need dev startup without this gate and will inspect or refresh the worktree separately. |

Unknown values fall back to `warn`.

## Multi-Lane Commit Orchestration

When several worktree "lanes" commit in parallel (the drain-lane recipe), their
commits do not run concurrently: `git-commit-quiet.sh` serializes every commit
repo-wide on one Git-common-dir queue lock, so at most one lane's pre-commit runs
at a time. A lane that is parked behind the lock prints a heartbeat to stderr
every ~60s naming the current holder and how many peer lanes are queued (backed
by ticket files under `<queue-lock>.waiters/`); a lane that is not the holder is
waiting, not stuck.

Size and pace lanes with that serialization in mind:

- **Place lane worktrees on the same filesystem as the primary checkout.** This
  lets Bun hardlink packages from its cache instead of copying them, and lets
  provisioning skip rebuilding shared derived outputs when their freshness
  fingerprints already match. In the standard dev environment, use a lane parent
  under `/home/node/persist` for a primary checkout under `/workspace`; choose an
  equivalent same-filesystem parent in other environments. A parent on container
  overlayfs, such as `/home/node/lanes` in the standard dev environment, forfeits
  the cache hardlinks and turns dependency provisioning into a physical copy.
- **Keep fast-commit mode on for lanes** (`touch "$(git rev-parse
  --git-common-dir)/musi-fast-commit"`). It skips the slow `test`+`scripts` slots
  per commit, which is what makes the serialized queue move quickly enough for
  several lanes to share it. Land with `bash scripts/land.sh` (full verify). When
  a lane's own worktree is stale (old `node_modules`, ungenerated Prisma client)
  and you would rather land it from a healthy worktree such as the primary on
  `main`, run `bash scripts/land.sh --branch <lane-branch>` from that clean
  worktree: it verifies the branch tip on a throwaway `land/<lane-branch>`
  integration branch built in the current worktree, then merges the lane branch
  into `main`. Never route around land.sh with a bare `git merge` — that skips
  the full verify the land gate exists to run.
- **Batch each lane's commits** — prefer a few logical-unit commits over
  commit-per-file. Every commit takes a turn in the shared queue, so chatty
  lanes lengthen everyone's wait.
- **Stagger commit points** across lanes rather than having them all reach a
  commit at once; a burst of simultaneous commits just forms a longer queue.
- **Size lane counts to the queue, not the core count.** Because commits
  serialize, doubling the lane count does not double commit throughput; it
  deepens the queue. A handful of lanes is usually the sweet spot.

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

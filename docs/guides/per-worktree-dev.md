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

The template fingerprint and Prisma deploy must read the same migration tree.
Keep `prisma.config.ts`'s `migrations.path` as the literal
`"prisma/migrations"`, written as the file's one line-leading `path:`
assignment and as the first line of the `migrations: {` block; worktree
provisioning fails closed on a different, computed, competing, or misplaced
value instead of caching a template whose migration inputs are only partially
hashed. The check reads formatted code only, so neither a commented-out mention
nor a canonical `path:` under some other key can vouch for the real one.

This mirrors the command headers in `scripts/worktree-db.sh:4-36` and the thin
`worktree:new` wrapper in `scripts/worktree-new.sh:1-20`.

Template seeding runs from `packages/server`, so a package-local
`packages/server/bunfig.toml` is a seed fingerprint input when present. A
top-level Bun `preload` is rejected until its runtime closure is explicitly
covered; otherwise Bun could execute seed inputs before `seed-template.ts`
that the derived import closure never sees. Test-only `[test].preload` settings
do not affect template seeding.

External dependencies are fingerprinted at whole-lockfile granularity: `bun.lock`
and the root `package.json` are hashed as ordinary inputs. Bumping a dependency
the seed never imports therefore rebuilds the template — a deliberate trade,
since deriving the seed's exact dependency subgraph means re-implementing Bun's
private lockfile and store layout, while the extra rebuild is a one-time cost
amortized across every worktree that shares the fingerprinted template.

Seed code may read only statically named, allowlisted environment keys;
`DATABASE_URL` is the current allowlist and is intentionally not fingerprinted
because it selects the per-worktree database rather than seed content. Adding a
new environment-dependent seed branch fails the derived closure check until the
key and its invalidation policy are reviewed and added to the allowlist in
`scripts/worktree-db.sh`. The check is a coarse token scan for
`process.env.<KEY>`, `Bun.env.<KEY>`, and `import.meta.env.<KEY>` reads with a
literal key. It resolves no aliases, so it closes the aliasing routes by
rejecting the tokens themselves: `process`, `Bun`, and `globalThis` may only be
read as a direct static member access, and the process module may only be
loaded as `import * as process from "node:process"` (the form Prisma's
generated client emits). Storing, destructuring, spreading, passing, renaming,
or computed-key-indexing any of them fails closed — and so does an unrelated
local binding that happens to be named `process`. Rename the binding or read the
key directly; the analyzer is not meant to grow to understand it.

The closure's whole policy is the same shape. Every runtime import needs a
static string specifier; a dynamic `import()` must carry exactly that one
argument, so a load that needs import attributes has to be written as a static
import. Bun's loader taxonomy is not modelled at all: the walker resolves
`.ts`, `.tsx`, `.js`, `.mjs`, and `.json`, treats `.json` as a terminal data
input, and hashes-but-never-parses it. The only accepted import attribute is
`with { type: "json" }` on a `.json` specifier — the legacy `assert { type:
"json" }` spelling, any other attribute, and any extension outside that list
fail the walk closed. A seed that needs another
Bun loader should read the file with an explicit filesystem read under a
blanket-hashed root instead.

CommonJS is rejected on sight rather than analyzed: the identifiers `require`
and `createRequire` anywhere in value space, an import of `module`/`node:module`,
an import-equals declaration, a `.cjs`/`.cts` specifier or filename, and any
`import.meta` use outside a direct allowlisted member access
(`url`, `dirname`, `env`, …) all fail closed. Because this is a token scan and
not a scope analysis, an innocent binding named `require` is rejected too. The
blast radius of a missed input is a stale local template DB recoverable with
`worktree:template-refresh`, so the policy buys that safety with false
positives instead of with escape analysis.

The derived import closure cannot see arbitrary filesystem reads such as
`readFileSync`. To cover the seed's normal data locations, fingerprinting also
hashes every file under `packages/server/src/seed/data` regardless of extension
and every direct sibling of `packages/server/prisma/seed-template.ts`.
Developer Markdown and test files elsewhere in the broader seed/shared source
roots remain excluded. Before adding a seed-time filesystem read outside those
hashed locations, move the input under the seed data or Prisma entry directory,
or extend the appropriate blanket root; otherwise the read will not invalidate
a cached template database.

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

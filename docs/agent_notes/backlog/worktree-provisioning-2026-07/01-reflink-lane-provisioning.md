# 01 — Reflink-clone lane dependencies in worktree:init (btrfs)

Status: Done — early-stop re-scope applied after a same-filesystem cold lane completed in 10.912s (`bun install`: 1.60s); delivered step 1 plus step 3 and omitted step 2's dependency-reflink branches
Track: T (tooling) · Priority: P2 · Size: M

## Evidence (verified 2026-07-15; re-verify before implementing)

- `scripts/worktree-db.sh:790-816` (`ensure_dependencies`) — a cold secondary
  worktree pays a full `bun install` plus
  `bun run --filter @musi/server prisma:generate`. The warm check is
  presence-only (`node_modules` + generated client directories exist), so it
  neither validates freshness nor helps a fresh worktree.
- `scripts/worktree-db.sh:818-830` (`ensure_shared_output`) — every init
  rebuilds `@musi/shared` from scratch; the memo
  (`MUSI_SHARED_OUTPUT_READY_ROOT`) is per-process, so each new lane pays the
  build even when the primary checkout has an up-to-date `dist`.
- Filesystem layout (verified via `findmnt`, 2026-07-15): `/workspace` and
  `/home/node/persist` are the same btrfs filesystem (`/dev/nvme0n1p6`), so
  `cp --reflink` between them is O(metadata). The lane parent recent drains
  actually used (`/home/node/lanes`, per the drain-lane recipe) is container
  overlayfs — reflinks are impossible there and bun's cache hardlinks cannot
  cross the filesystem boundary either, so every lane pays a full physical
  copy of `node_modules`.
- The dev image ships `/usr/local/bin/wt`, which already reflink-clones
  `node_modules` for plain worktrees — proof the technique works here — but it
  is monorepo-blind (repo-root dirs only, so it would miss
  `packages/shared/dist` and the generated Prisma client) and provisions no
  DB/ports/env, so it is not a substitute for `worktree:new`. The technique
  belongs inside `worktree:init`, which agents actually use.
- Field cost: the drain-lane recipe provisions N lanes at ~13s+ each
  (install + shared build + prisma generate), serially in the orchestrator.

Failure: lane provisioning cost scales linearly with lane count, and every
lane rebuilds artifacts byte-identical to ones the primary checkout already
has, on a filesystem that could share them for free.

## Do

Ordered deliberately: step 1 is a zero-code prerequisite whose measurement
decides how much of steps 2-3 is still worth building — reflinks and cache
hardlinks are both impossible until the lane parent moves off overlayfs.

1. Update `docs/guides/per-worktree-dev.md` (and the drain-lane recipe
   guidance it feeds) first: recommend a lane parent on the same filesystem
   as the repo — in this environment a directory on the persist volume
   (`/home/node/persist`, same btrfs device as `/workspace`; re-confirmed via
   `findmnt` 2026-07-15), not `/home/node/lanes` — and state plainly that an
   overlayfs parent forfeits both reflinks and bun's cache hardlinks. Keep
   the wording environment-portable ("same filesystem as the primary
   checkout"), since the btrfs device path is host-specific. Then time a
   cold `worktree:new` onto a same-fs parent: with a warm global bun cache a
   plain `bun install` is largely hardlinking already, so this measurement
   sets the remaining budget for steps 2-3. If it is already seconds, stop
   here and re-scope this leaf to the doc change plus step 3's freshness
   fingerprints.
2. In `ensure_dependencies`, before the install fallback: when the primary
   checkout has `node_modules` and the new worktree shares its filesystem
   (compare `stat -c %d` of the two roots), `cp -a --reflink=auto` the
   primary's `node_modules` into the worktree, then run `bun install`
   anyway — with a populated `node_modules` it is a cheap lockfile
   reconcile, and it papers over primary-vs-lane lockfile drift that the
   current presence-only check would miss. Skip the copy entirely when the
   filesystems differ (do not let `--reflink=auto` degrade into paying a
   full physical copy), and fall back to today's cold path when it fails.
   Note the honest cost: `cp -a --reflink` over a few hundred thousand
   `node_modules` inodes is per-inode metadata — fast, not free.
3. Freshness fingerprints for BOTH derived artifacts, so copied state can
   never go stale behind the presence-only check:
   - `ensure_shared_output`: a dist-freshness fingerprint (hash of
     `packages/shared/src` + build config, stored beside `dist`) so a
     reflinked or already-built `dist` skips the rebuild; the seed
     fingerprint machinery (`SEED_BLANKET_HASHED_ROOTS`) already hashes
     `packages/shared/src` and can be reused. Reflink the primary's `dist`
     in step 2 so the common case hits the skip.
   - Generated Prisma client: do NOT copy it guarded only by the presence
     check — a lane whose `schema.prisma` diverges from the primary's would
     silently run a wrong client, and nothing re-generates it. Either store
     a schema fingerprint (hash of `packages/server/prisma/schema.prisma`)
     beside the generated output and re-run `prisma:generate` on mismatch,
     or skip copying the client entirely and always generate — it is the
     cheapest of the three provisioning costs.

## Verify

```
bash scripts/tests/test-worktree-db.sh
bun run verify:changed
# manual: time bun run worktree:new <same-fs-parent>/lane-x -b tmp/lane-x --from main
```

## Acceptance

The per-worktree-dev guide names the same-filesystem lane-parent requirement
and the overlayfs forfeit; a cold `worktree:new` onto a same-filesystem
parent completes in seconds, not tens of seconds (measured before and after
any reflink work, so the doc-only win is attributable); a cross-filesystem
parent still provisions correctly via the existing cold path; a lane whose
`schema.prisma` differs from the primary's gets a freshly generated Prisma
client, not a stale copy; `test-worktree-db.sh` pins both branches (reflink
hit and fallback), the dist-freshness skip, and the schema-mismatch
regeneration.

Sources: drain-lane recipe review 2026-07-15; `wt` wrapper inspection.

# Parallel Lane Drains

How to fan a backlog drain out across provisioned worktree lanes, and the
sequential-slice variant for high-risk migrations. This is the recipe that
survived the 2026-06 → 2026-08 drains; everything it once needed to work
around has landed, so nothing here is a workaround. The shell script headers
and [per-worktree-dev.md](per-worktree-dev.md) stay authoritative for the
commands. A pack's own `DRAIN.md` outranks this guide for that pack — the
code-quality-2026-08-01 pack, for instance, runs serial-only because two
concurrent full gates OOM'd its container.

## Shape

One provisioned worktree lane per file-disjoint area, one agent per lane,
sequential within a lane: isolated leaves first, shared-helper and lifecycle
refactors last. Do not use an orchestration tool's own worktree isolation for
lanes — it does a bare `git worktree add` with no dependencies, database, or
ports.

## Lane setup

```bash
bun run worktree:new /home/node/persist/lanes/<lane> -b auto/<lane> --from main
touch "$(git rev-parse --git-common-dir)/musi-fast-commit"   # once; shared by every worktree
```

- The lane parent must be writable and on the same filesystem as the primary
  checkout (`/home/node/persist` in the standard container — see the
  multi-lane section of [per-worktree-dev.md](per-worktree-dev.md)).
- The Redis logical-DB pool caps secondary worktrees at 15 slots
  (`REDIS_DB_MAX` in `scripts/worktree-db.sh`). Count the live allocations
  with `jq 'length' .worktree-state/allocations.json` before fanning out; near
  the cap, re-branch a finished lane (`git -C <lane> switch -c <new> <base>`)
  instead of provisioning another.
- Fast-commit mode skips only the slow `test`+`scripts` slots per commit; the
  land gate runs them. Run `bun run verify` once on the base before dispatching
  lanes from a fast-commit base, so land-time failures are attributable to the
  lanes rather than to deferred debt on the base.

## Lane commit protocol

Commits serialize repo-wide on the commit-queue lock; a parked lane prints a
heartbeat naming the holder. When committing into a lane from another
checkout's shell, follow the commit-wrapper rules in
[`docs/ai-harness.md`](../ai-harness.md#how-the-commit-wrapper-resolves-its-target-checkout):
a literal `git -C <lane-path>`, nothing before the `git` token, stage first
and commit with no pathspec, one git-write per shell call.

Lane prompts for delegates carry three sweeps that the commit gate defers to
land time under fast-commit:

- **Fixture copy-sets.** When a lane makes an existing script source a new
  lib, every test fixture that copies that script needs the lib added to its
  copy-set plus a matching `# smoke-subjects:` header, then
  `bun run test:scripts:subjects`.
- **Exact-set assertions.** Smoke-selection expected lists in
  `scripts/tests/test-test-scripts.sh` (the `MUSI_SCRIPTS_CHANGED_FILES=`
  blocks) and literal grep assertions on refactored surfaces go stale when a
  lane legitimately adds a smoke subject. Extend the exact set; never weaken
  the assertion to a substring match.
- **Schema-requiredness fixtures.** A new required Zod key breaks untyped
  `safeParse` fixture literals that no typecheck sees. Demand a runtime
  fixture sweep (`rg` the schema name and its embedding response schemas over
  `*.test.*`) plus the schema's package suite, not just typed-fixture updates.

## Integration

Pipeline it — do not wait for every lane before integrating. Merge each
finished-and-reviewed lane into the integration branch as it completes, start
the full `bun run test:scripts` and the cross-model boundary review on the
partial integration, and fold the slow lane in later; serialize only the final
land. Two facts about that step:

- Run one full local `bun run test:scripts` on the integration branch before
  the first land attempt. The land runner stops at the first failing suite, so
  every hidden failure costs a ~10-minute verify round.
- If a lane added a root `package.json` dependency, run `bun install` in the
  integration checkout after merging: `package.json` and `bun.lock` merge
  cleanly but `node_modules` never materializes the new dependency, and suites
  fail at the gate.

**Land-per-lane alternative** (proven on a three-lane drain): skip the
integration branch and land each reviewed lane sequentially with
`bash scripts/land.sh --branch <lane-branch>` from a clean primary worktree.
Before each later land, `git merge main` *inside* that lane (delegate the
conflict resolution, dangling-import sweep, and focused re-test), so each land
is its own full gate and a bad lane cannot hide behind a sibling. Cost: one
full verify per lane instead of one total. `land.sh` must be backgrounded —
its verify outlives a foreground shell call (see the script header).

## Teardown

```bash
bun run worktree:drop /home/node/persist/lanes/<lane> --remove   # requires a clean target
git branch -d auto/<lane>                                         # from the primary, after the land
git worktree list
```

## Sequential-slice variant for high-risk migrations

For a migration that changes shared invariants or a committed artifact's
schema, do not fan out: run **one** lane, re-branched per slice
(`git -C <lane> switch -c auto/<sliceN> main` after each land), every slice
landed to `main` through the full gate with fast-commit off, so each slice
soaks while the next is built. Slices share files, so parallel lanes would
conflict, and findings stay attributable to one small diff.

The sequence that worked (lint-ratchet one-baseline-kernel migration,
2026-07-17: seven lands in a day, −1,700 LOC, zero floor movement):

1. Two independent designs, the owner rules the forks, the synthesized plan is
   committed, and an adversarial review of the *plan* runs before any code.
2. A tolerance/passthrough slice first, so it soaks.
3. Behavior-preserving slices with **dual-run parity proofs**: keep the legacy
   implementation alive and unexported, and deep-equal old-vs-new outputs over
   a characterization corpus frozen in slice 1. The oracle suites stay
   assertion-unmodified.
4. The deliberate flip as its own slice: re-serialize the parsed committed
   artifact mechanically (never regenerate from the live tree), stamp an
   explicit version, and make acceptance assert the literal changed.
5. The deletion slice last.

Pin **both** sides of a proof test to immutable revisions
(`git show <pre>:<path>` vs `git show <flip-commit>:<path>`) and assert the
pre-side is genuinely pre-change. A proof that compares pinned history against
the live working-tree artifact passes at land and fails on the next legitimate
artifact update; reviewers verified such a test's honesty and missed its
longevity, so check quoted reviewer code for working-tree reads yourself.
`land.sh` leaves the lane on `main` after each land — re-branch immediately or
the next primary-side land fails the sibling-main preflight.

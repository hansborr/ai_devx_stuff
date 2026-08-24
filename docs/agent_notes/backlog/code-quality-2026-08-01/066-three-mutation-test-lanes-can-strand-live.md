# 66. Three in-place Stryker lanes can strand live source mutations in the contributor's worktree, with no stale-state detection or recovery rail

Status: Not started
Theme: in-place mutation-run safety · Area: tests · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

All three mutation-testing lanes (server services, scripts, lint-ratchet) run
Stryker with `inPlace: true`: mutants are written directly into the
contributor's active worktree, one at a time, and Stryker restores the
originals from its own `.stryker-tmp/backup` **only on a clean exit**. Each
lane's config says so explicitly — and each one also explicitly acknowledges
the failure mode this leaf is about: a hard kill mid-run leaves mutated
sources on disk. These are overnight-scale runs (the server lane pins
concurrency to one and is documented as meant for runs "where wall time is
not the constraint"), which is exactly the window in which a crash, OOM, or
operator kill is most likely.

The command surface does nothing about it. The four `package.json` wrappers
trap `EXIT INT TERM` solely to delete `stryker-setup-*.js` scratch files;
none of them checks whether mutate-target sources are clean before starting,
none detects the leftovers of an interrupted previous run, and none restores
mutated tracked files on any exit path. So a contributor who kills a run —
or whose container dies under it — can end up with single-character mutants
(`>=` flipped to `<`, a deleted statement) silently mixed into legitimate
uncommitted work, with no marker distinguishing the two. The configs
document the risk; nothing in the toolchain defends against it.

## Evidence

- `package.json:53-56` — all four wrappers (`test:mutation`,
  `test:scripts:mutation`, `test:lint-ratchet:mutation`,
  `test:server:mutation`) are inline `bash -c` one-liners whose trap is
  exactly `rm -f stryker-setup-*.js` on `EXIT INT TERM`; no preflight
  cleanliness check, no stale-state detection, no source restore. The
  generic `test:mutation` passes an arbitrary config path through `"$@"`.
- `stryker.config.server.mjs:14-21` — server lane sets `inPlace: true`
  because Stryker's copied sandbox breaks the vitest
  `globalSetup`/`setupFiles` path resolution, and states the tradeoff: "a
  hard kill mid-run can leave mutated sources on disk — Stryker restores
  them from .stryker-tmp/backup on a clean exit." Mutate globs at `:31`
  cover `packages/server/src/services/**/*.ts`.
- `scripts/stryker-scripts.mjs:5-11` — scripts lane repeats the same
  tradeoff; in-place is "load-bearing here" because script tests resolve the
  live repo via `import.meta.url` and `git`, and the comment warns "Do not
  switch to sandbox without re-checking those tests." Mutate globs at
  `:18-30` cover `scripts/**/*.ts` minus codemods, tests, and fixtures.
- `tools/stryker-lint-ratchet.mjs:5-9` — third in-place lane, same
  acknowledgment; sandbox breaks `@musi/lint-ratchet/*` and
  `import.meta.url` resolution. Mutate globs at `:16-20`.
- `stryker.config.server.mjs:7-13` — concurrency pinned to one, "meant for
  overnight runs": long wall-clock exposure per run.
- `scripts/lib/verify-metadata.sh:670-690` —
  `musi_changed_gate_fail_if_unstaged`, the existing abort-on-unstaged
  idiom (used by `scripts/verify.sh:113` for changed-mode verification) that
  a preflight check can mirror.
- `package.json:151` — `mutation:survivors` (`bun
  scripts/mutation-survivors.ts`) is a report reader, not a run wrapper; it
  is unaffected.

## Proposed direction

Keep in-place — it is load-bearing for all three lanes (sandbox/worktree
copies break vitest global-setup resolution, git-dependent script tests, and
`@musi/lint-ratchet` resolution, per each config's own comments), and
per-run disposable-worktree provisioning (bun install plus per-worktree
DB/Redis via `worktree:init`) is a much larger change than this leaf. The
fix is a **supervised runner**:

Replace the four inline bash wrappers in `package.json`
(`test:mutation`, `test:server:mutation`, `test:scripts:mutation`,
`test:lint-ratchet:mutation`) with one shared runner script — e.g.
`scripts/mutation-run.sh` or a Bun TS entry under `scripts/`, TDD-able like
the other scripts — that takes the lane config path (required: the generic
`test:mutation` passes an arbitrary config via `"$@"`, so the runner must
accept a config argument rather than hard-coding the three lanes), imports
it to obtain the lane's `mutate` globs, and wraps `stryker run`. The runner
does three things:

1. **Preflight** — resolve the mutate globs to tracked files and abort if
   any have staged or unstaged modifications, mirroring the
   `musi_changed_gate_fail_if_unstaged` abort-on-unstaged idiom at
   `scripts/lib/verify-metadata.sh:670`. This is the guarantee that stranded
   mutants can never mix with legitimate uncommitted work: once targets are
   known-clean at start, any later dirt on them is the run's.
2. **Stale-state detection** — at startup, if `.stryker-tmp/backup` exists
   or the mutate-target paths are dirty (impossible after a prior supervised
   run's preflight, therefore evidence of an interrupted run), refuse to
   start and print the exact recovery command
   (`git restore --worktree -- <paths>` plus `.stryker-tmp` removal), or
   restore automatically behind an explicit flag. Use the presence of
   `.stryker-tmp/backup` only as the interrupted-run signal — do not depend
   on its contents for restore; git is the source of truth once preflight
   guarantees clean targets.
3. **Exit trap** — keep the existing `stryker-setup-*.js` `EXIT INT TERM`
   cleanup and extend it to restore mutate-target paths on abnormal exit,
   while documenting in the runner that traps cannot fire on SIGKILL/OOM —
   startup detection, not the trap, is the rail for the hard-kill case the
   configs describe.

Finally, update the three lane-config comments
(`stryker.config.server.mjs:14-21`, `scripts/stryker-scripts.mjs:5-11`,
`tools/stryker-lint-ratchet.mjs:5-9`) to point at the runner as the recovery
rail instead of only acknowledging the risk.

For copyability, the runner's value to outside readers is the
preflight-clean + startup-stale-detection pattern for any in-place mutation
tool — keep it free of Musi-specific policy beyond the config-import seam.

## Scope / caveats

- **Restore only what preflight recorded.** The restore-on-exit path is
  itself a data-loss hazard if the restored path set ever diverges from what
  preflight verified clean — the runner must restore only a file list it
  recorded at preflight time, never a re-evaluated glob.
- **Glob resolution must match Stryker's semantics** (including the `!`
  exclusions) or preflight silently under-covers and detection under-fires.
  Add a small test pinning the resolved sets for all three lanes.
- **Do not over-tighten preflight.** Requiring the whole tree clean rather
  than just the mutate targets would regress DX for overnight runs on
  fast-commit branches carrying unrelated uncommitted work.
- **Out of scope:** any change to `stryker.shared.mjs`'s lane-option
  contract or `inPlace` semantics — that is
  [43-stryker-config-duplication.md](../code-quality-2026-07-25/43-stryker-config-duplication.md)
  (CQ25-221) territory, which landed shared config construction, preserves
  per-lane `inPlace` semantics, and does not rule on interruption recovery;
  do not reopen it or re-litigate its sandbox-feasibility stop. Also out of
  scope: sandbox/worktree migration, and the mutation operator-doc rewrite
  owned by
  [101-mutation-docs-promise-sandbox-isolation.md](101-mutation-docs-promise-sandbox-isolation.md).
- **Sequencing: land before
  [101-mutation-docs-promise-sandbox-isolation.md](101-mutation-docs-promise-sandbox-isolation.md).**
  That leaf's doc correction explicitly coordinates wording with this one
  and must describe the final runtime behavior (preflight, stale detection,
  recovery command).
- Keep the concurrency/DB-isolation comments in
  `stryker.config.server.mjs:7-13` untouched; they are a separate contract.
- `mutation:survivors` (`package.json:151`) reads reports only and needs no
  change.

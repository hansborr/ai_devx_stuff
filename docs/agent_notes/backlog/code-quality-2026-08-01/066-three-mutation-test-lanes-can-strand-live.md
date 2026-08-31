# 66. Three in-place Stryker lanes can strand live source mutations in the contributor's worktree, with no stale-state detection or recovery rail

Status: Landed on fix/cq-066
Theme: in-place mutation-run safety · Area: tests · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Disposition

Landed as a bash runner, with one correction to the leaf's own premise (below).
`scripts/mutation-run.sh` replaces all four inline `package.json` wrappers; it
takes the lane config path (the generic `test:mutation` still passes an
arbitrary config plus pass-through args, which `scripts/slow-drift-audit.sh`'s
`--mutate` call relies on), imports the config through
`scripts/mutation-targets.ts` / `scripts/lib/mutation-targets.ts` to resolve the
lane's `mutate` globs with Stryker 9's own matcher semantics (`!` exclusions
honoured; `scripts/mutation-targets.test.ts` pins each in-place lane's resolved
set as an exact comparison against an independent `git ls-files` filter, so an
over-narrow positive glob fails as loudly as a dropped exclusion), and applies
the three rails only to `inPlace` lanes — the sandboxed shared lane pays
nothing, and is classified before `mutate` is even read so a config leaning on
Stryker's default stays as runnable through the runner as through a bare
`stryker run`.

**The write scope is not the mutate globs, and the leaf assumed it was.** In
Stryker 9.6.1 `disableTypeChecks` defaults to `true`
(`node_modules/@stryker-mutator/core/schema/stryker-schema.json`), no lane
overrides it, and `stryker.shared.mjs`'s allowlist deliberately does not expose
the key (CQ25-221 territory, fenced by the caveats below). With `true`,
`config/file-matcher.js` expands it to
`**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}` and
`sandbox/disable-type-checks-preprocessor.js` runs it over `project.files` —
every file `fs/project-reader.js` crawled, i.e. the whole tree minus
`node_modules`, `.git`, `.stryker-tmp` and the report files, with `.gitignore`
not consulted — prefixing `// @ts-nocheck` into each
(`@stryker-mutator/instrumenter`'s `disable-type-checks.js`).
`sandbox/sandbox.js#sandboxFile` then backs up and rewrites *every* changed
file. So an in-place lane rewrites thousands of files, of which the ~67 server
service files (or 549 script files, or 84 lint-ratchet files) are a small
subset.

That makes the caveat below — "use the presence of `.stryker-tmp/backup` only as
the interrupted-run signal, do not depend on its contents for restore; git is
the source of truth" — the one thing in this leaf that does not survive contact
with the code. It was written on the premise that mutate globs equal the write
scope. They do not, so **the caveat moves and the guarantee stays**: recovery is
backup-first. `--restore` and the exit trap move `.stryker-tmp/backup-*` back
over the worktree exactly as Stryker's own
`fileUtils.moveDirectoryRecursiveSync` does from `Sandbox.dispose`, because that
directory holds the pre-run content of everything the run rewrote *including the
operator's uncommitted work in files outside the globs*, which a `git restore`
would destroy. `git restore --pathspec-from-file` over the recorded preflight
list is kept strictly as the fallback for what the backup cannot cover — a kill
that landed before Stryker had written one — where it is provably lossless
precisely because preflight proved those files clean. Nothing prints or performs
`rm -rf .stryker-tmp` any more; the rails say the opposite.

The rest of the leaf landed as written. Preflight refuses on any staged,
unstaged, or untracked file among the targets (untracked was added beyond the
leaf: an in-place mutant in a file git cannot restore is the same loss), and
fails closed if the untracked resolve itself errors. Preflight stays
target-scoped, and what it buys is now stated as making the git fallback
lossless rather than as a whole-scope guarantee. Stale-state detection keys on
the presence of `.stryker-tmp/backup-*` — Stryker's real `mkdtemp` name, not the
literal `.stryker-tmp/backup` the audit cited. Because backup-first recovery is
destructive by design, a supervised run now writes its pid to
`.stryker-tmp/mutation-run.pid` and both `--restore` and startup detection
refuse over a live one, so the marker can no longer be read as "interrupted"
when it means "still running in another terminal". The exit trap keeps the
scratch-file cleanup. The runner and the three lane-config comments note that
Stryker's own `unexpected-exit-handler` already restores on
SIGINT/SIGTERM/SIGHUP/SIGABRT, so the trap is a second line and startup
detection is the sole rail for SIGKILL/OOM.

The runner resolves `node_modules/.bin/stryker` before PATH, the way
`scripts/vitest.sh` and `scripts/typecheck.sh` do: bare `stryker` exists only
under `bun run`, so without this the recovery command the stale-state rail
prints died with `command not found` the moment an operator pasted it into a
plain shell. `scripts/tests/test-mutation-run.sh` covers the runner against a
throwaway repo with a stubbed Stryker, and *executes* both printed recovery
commands there verbatim — the repo carries a `scripts/` symlink and a
`node_modules/.bin/stryker` stub for exactly that — rather than only matching
their text.

Preflight follows Stryker's `-m/--mutate` when an invocation carries one.
That flag *replaces* the config's globs in Stryker, so resolving the config's
set anyway would verify a scope the run does not mutate and leave the git
fallback unable to restore the scope it does. The rails re-scope to the
override rather than refusing it, which also gives an in-place lane that omits
`mutate` a scope they can work from.

**Encroachment on
[101-mutation-docs-promise-sandbox-isolation.md](101-mutation-docs-promise-sandbox-isolation.md),
recorded here because 101 is still `Status: Not started`.** The
`docs/ai-harness.md` mutation section gained the operator-facing interruption
warning and the runner-based recovery recipe in this branch. That is 101's
mechanics step 3, not this leaf's work — but a command that can now refuse to
start could not ship undocumented, and 101 itself requires step 3 to describe
this runner once it lands. 101's steps 1 and 2 are untouched and still open
there: the plan doc's stale blanket sandbox claim, the per-lane `inPlace`
marking on the scripts and lint-ratchet scope bullets, and the missing
`bun run test:lint-ratchet:mutation` in the run prose.

Known defect in this branch's history: two commits carry another lane's subject
and body (a shared scratch message file, not a content error). The trees are
correct; by policy the history is not rewritten here.

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
   guarantees clean targets. *(Superseded — see `## Disposition`. This rests
   on mutate globs equalling the in-place write scope, which Stryker 9.6.1's
   default `disableTypeChecks` makes false; the backup contents are the only
   complete restore source.)*
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
  recorded at preflight time, never a re-evaluated glob. *(Holds, and is
  honoured — but only for the git fallback. The primary recovery path replays
  Stryker's own backup directory, whose scope is Stryker's, not the runner's;
  see `## Disposition`.)*
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

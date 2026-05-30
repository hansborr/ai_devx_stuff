# 14 — Degrade gracefully on shallow clones and uninstalled targets

Status: Done
Track: P (portability MVP)
Size: small-medium
Depends on: none
Blocks: none
Coordinates with: tasks 12 (jscpd skip), 31/32 (adapter skip-with-reason)

## Goal

Make drift:ai degrade *gracefully* on the two foreign-repo states that currently
fail hard:
1. a **shallow / blobless clone**, where `changed` scope's `git diff <ref>`
   SIGSEGVs and propagates as a raw crash; and
2. an **uninstalled target** (no `node_modules`), where dependent
   checks/adapters should skip-with-reason rather than crash.

Both must preserve report-only / exit-0 semantics: `current` scope must keep
working on these targets.

## Background

Read `01-shared-context.md` ("Concrete target: OpenClaw" — the shallow/blobless
facts) and `02-seam-map.md` §5. Validated fact: the OpenClaw checkout is
**shallow/blobless** — `git log` works (commit metadata is present, so all
hotspot/git-log cuts run fine) but **any** `git diff <ref>` **SIGSEGVs in git
2.39.5**. drift:ai's changed-scope path (`git-changed-scope.ts:119`) propagates
that as a raw non-zero crash with a SIGSEGV stack — opaque to the user.
`current` scope is unaffected (it doesn't diff).

Note for testing: on this OpenClaw checkout, *any* `git diff HEAD~3` SIGSEGVs —
so do **not** run drift changed-scope there expecting success. Validate the
happy path of changed scope on **Musi** or a full clone; validate only the
*degradation* (clear error, not a crash) against the shallow state.

## Seams to touch

`02-seam-map.md` §5 — `git-changed-scope.ts`:

- `git-changed-scope.ts:18` — `GitRunner = (args: readonly string[]) => string`
  (the injected seam; fake it in tests).
- `git-changed-scope.ts:20–22` — `defaultGitRunner` (wraps `execFileSync("git",
  …)`).
- `git-changed-scope.ts:118–129` — `discoverChangedFiles`; **`:119`** runs
  `git(["diff", "--name-status", ref])` — the SIGSEGV site.

For the uninstalled-target half, this coordinates with (does not own):
- jscpd skip — task 12 (`duplicates-runner.ts` ENOENT).
- adapter skip-with-reason — tasks 31/32.
- the skipped-with-reason channel — `types.ts:38` `DriftReport.skippedChecks` /
  task 21 `CheckOutcome`.

## What to do

**(a) Detect a shallow/blobless clone and raise a clear error for `changed`
scope.** Instead of letting the SIGSEGV surface as a raw non-zero crash, raise a
`DriftAiError` (the existing typed-error path — `02-seam-map.md` §1,
`runner.ts:91–92,102` map `DriftAiError → exit 2`) with a message like:

> "changed scope needs full git history; this looks like a shallow/blobless
> clone — run `git fetch --unshallow` (or use `--scope current`)."

Detection — **recommend proactive + reactive fallback**:
- *Proactive:* before the diff, run `git rev-parse --is-shallow-repository`
  (returns `true`/`false`) via the injected `GitRunner`. If `true`, raise the
  clear error.
- *Reactive fallback:* wrap the `:119` diff; if it fails with a signal/SIGSEGV
  (or non-zero in a way consistent with a missing-blob clone), raise the same
  clear `DriftAiError` rather than re-throwing the raw crash. The reactive arm
  catches blobless-but-not-flagged-shallow clones and git-version quirks.

**Preserve report-only semantics:** this only affects the `changed`-scope path.
`current` scope must still run to completion and exit 0 on a shallow clone (it
never diffs). Confirm the error is scoped to `discoverChangedFiles` /
changed-scope resolution and does not fire in `current`.

**(b) Detect an uninstalled target and surface dependent checks/adapters as
skipped-with-reason** (not crashes). Where a check/adapter needs the target's
`node_modules` (note: jscpd does **not** — see task 12), detect its absence
(e.g. no `node_modules` dir at the target root) and skip with a reason via the
existing `skippedChecks` channel (`types.ts:38`) or task 21's `CheckOutcome` if
landed. This is the same policy as tasks 12, 31, 32 — keep the reason wording
consistent with them ("target has no node_modules installed; skipping <check>").
Scope this half to what the current check set actually needs; if no default
check beyond duplicates depends on the target's `node_modules`, this half may be
mostly a documented hook for the adapter tasks — note that rather than
inventing a dependency.

## Open decisions

- **Proactive (`is-shallow-repository`) vs reactive (catch the diff crash).**
  **Recommend proactive check + reactive fallback** (covers both flagged-shallow
  and blobless-without-the-shallow-flag clones, and is robust to git-version
  differences in how the SIGSEGV surfaces).
- **How to detect "uninstalled"** — presence of `node_modules` at the target
  root vs per-tool resolution failure. Recommend a simple `node_modules` check
  for the skip *decision*, and let each tool's own resolution (task 12) be the
  authority for whether it can actually run. Keep it minimal — don't build a
  package-manager detector.

## Testing

- **Unit (shallow detection):** inject a `GitRunner` fake that returns
  `is-shallow-repository` → `"true\n"` and assert `discoverChangedFiles` /
  changed-scope resolution raises the clear `DriftAiError` (not a crash). Add a
  reactive-path test: a fake whose `diff` throws a SIGSEGV-like error → same
  clear error. Mirror the DI-fake pattern (`02-seam-map.md` §11,
  `scope.test.ts`); no `vi.mock`.
- **Unit (report-only preserved):** a shallow fake under `current` scope → no
  error, normal report.
- **Manual:** on OpenClaw, `git diff HEAD~3` SIGSEGVs — do **not** expect drift
  changed-scope to succeed there; instead confirm it now emits the clear error
  message, not a SIGSEGV stack. Validate the changed-scope **happy path** on Musi
  (`bun run drift:ai --scope changed`). Keep OpenClaw read-only.

## Out of scope

- Making `git diff` work on a shallow/blobless clone — out of our control (a git
  bug / missing blobs). We only detect and degrade.
- Implementing the adapter skip channels themselves (tasks 31/32) or the generic
  `CheckOutcome` (task 21) — use the existing `skippedChecks` path here.
- Auto-`unshallow`ing the target (never mutate a foreign repo; only suggest it in
  the error message).

## Notes (landed 2026-05-29)

- `discoverChangedFiles` now probes `git rev-parse --is-shallow-repository`
  before changed-scope diffing. A `true` result raises the existing
  `DriftAiError` path with a clear message recommending `git fetch --unshallow`
  or `--scope current`.
- The changed diff is also wrapped reactively: SIGSEGV-style failures and
  missing-object/tree messages are converted to the same `DriftAiError`, while
  unrelated diff errors still propagate unchanged.
- `--scope current` remains untouched and does not run the shallow probe; it uses
  the existing inventory path only.
- No new target-`node_modules` skip hook was added. After task 12, `duplicates`
  resolves `jscpd` from the tools checkout, and the remaining default checks do
  not require target-local installs. Adapter skip-with-reason policy remains with
  tasks 31/32 and the task-21 outcome channel.
- Validation: `bun test scripts/drift-ai.test.ts scripts/drift-ai/*.test.ts`
  passed. `bun run drift:ai --scope changed` in Musi exited 0. The OpenClaw
  checkout available during landing no longer reproduced the documented shallow
  state (`rev-parse --is-shallow-repository` returned `false`) and changed scope
  against `HEAD~3` also exited 0; `--scope current --check comments --root src`
  still ran to completion read-only.

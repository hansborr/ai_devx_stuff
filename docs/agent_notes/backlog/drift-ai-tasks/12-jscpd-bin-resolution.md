# 12 — jscpd bin resolution from the tools checkout

Status: Done
Track: P (portability MVP)
Size: small
Depends on: none
Blocks: none
Coordinates with: task 21 (CheckOutcome), task 30 (adapter "ENOENT = skip" policy)

## Goal

Resolve the `jscpd` executable from the **tools checkout** while keeping the
subprocess **cwd = the target repo**, so a pnpm/npm/yarn or entirely
uninstalled target needn't own jscpd. Today both the bin path and the cwd are
derived from a single `repoRoot`, which forces the target to have installed
`node_modules/.bin/jscpd` — exactly what portability forbids.

## Background

Read `01-shared-context.md` ("The portability target" — "The target repo must
not need to install drift:ai's implementation deps"; "Concrete target: OpenClaw"
— OpenClaw has **no `node_modules` installed at all**, so today's run emits the
jscpd ENOENT WARN once per root). Read `02-seam-map.md` §4 and §12 (tools
checkout has `jscpd@4.2.3` at `node_modules/.bin/jscpd`).

Key fact from OpenClaw validation: **jscpd scans source files and does not need
the target's `node_modules`.** So resolving the bin from the tools checkout is
not a fallback — it is the **primary** resolution path. The target-local lookup
is the fallback, useful only when someone runs drift:ai against a repo that
happens to have jscpd installed.

## Seams to touch

`02-seam-map.md` §4 — `defaultJscpdRunner` in `duplicates-runner.ts:51–104`:

- `duplicates-runner.ts:52` — `repoRoot = options.repoRoot ?? process.cwd()`
  (today used for **both** bin and cwd — this is the conflation to split).
- `duplicates-runner.ts:73` — bin: `path.join(repoRoot, "node_modules", ".bin", "jscpd")`.
- `duplicates-runner.ts:75` — subprocess `cwd: repoRoot`.
- `duplicates-runner.ts:79` — `result.error` (ENOENT) handling.
- `duplicates-runner.ts:181–190` — `buildRunnerFailureFinding`; `:188` is the
  missing-binary hint ("ensure node_modules/.bin/jscpd is installed.") that
  currently mis-advises pnpm/uninstalled targets.

## What to do

1. **Split the single `repoRoot` concept into two.**
   - **`analyzedRepoRoot`** — the subprocess **cwd**. Keep `?? process.cwd()`
     semantics (the `cd` flow makes this the target). This is what keeps jscpd's
     report paths repo-relative; do **not** change it.
   - **`jscpdBin` / `toolRoot`** — separate resolution of the executable.

2. **Bin-resolution precedence** (first hit wins):
   1. **tools-checkout** `node_modules/.bin/jscpd` (resolve via
      `import.meta.resolve` of the `jscpd` package, or `path.join` from a known
      tools root derived from the drift-ai module dir).
   2. **target-local** `node_modules/.bin/jscpd` (so an installed target still
      works).
   3. **`--jscpd-bin <path>`** explicit override (CLI flag; escape hatch for odd
      layouts / monorepo bin hoisting).

   The tools-checkout path is **primary** per the OpenClaw finding above, not a
   fallback. Put it first.

3. **Fix the missing-binary hint** (`duplicates-runner.ts:188`). It must no
   longer tell a pnpm/uninstalled *target* to install drift:ai's dependency
   locally. New wording should point at the **tools checkout** ("run `bun
   install` in the drift:ai tools checkout, or pass `--jscpd-bin <path>`").

4. **When jscpd is missing everywhere, skip cleanly with a reason** — do **not**
   emit a WARN finding. This is the OpenClaw revision: the current
   `buildRunnerFailureFinding` (ENOENT → a `duplicates` finding) is a
   false-positive on a target where jscpd was never expected. Cross-reference:
   - **task 30** "ENOENT = skip, not a finding" — the adapter policy this aligns
     with;
   - **task 21** `CheckOutcome` — the generic skipped-with-reason channel. If 21
     hasn't landed, surface the skip via the existing `skippedChecks` mechanism
     (`types.ts:38` `DriftReport.skippedChecks`; `report-builder.ts:188–191`
     `checkRunsForScope`) with a reason, rather than a finding. Keep report-only
     / exit 0 intact.

   Note the distinction: ENOENT (binary genuinely absent) → **skip**. A jscpd
   that *runs* but fails (non-zero exit, unreadable JSON —
   `duplicates-runner.ts:82–88,192–198`) is still a real **finding** (the tool
   ran and misbehaved). Only the "binary not found anywhere" case becomes a skip.

## Open decisions

- **`import.meta.resolve` vs `path.join` from a known tools root.** Recommend
  trying `import.meta.resolve("jscpd")` (robust to hoisting / workspace layouts)
  and falling back to `path.join(toolRoot, "node_modules", ".bin", "jscpd")`.
  Resolving the package entry then walking to `.bin` is fiddly; if
  `import.meta.resolve` proves awkward for the bin specifically, derive
  `toolRoot` from the drift-ai module dir (`new URL("..", import.meta.url)` up to
  the package root) and join. Pick one, document why in a short comment.
- **How to discover the tools root** — relative to the drift-ai module dir
  (recommended; stable regardless of cwd) vs an env var. Prefer module-relative.

## Testing

- **DI unit test** for the bin-resolution precedence using a fake fs/resolver
  (mirror the existing injected-runner pattern — `02-seam-map.md` §11, no
  `vi.mock`). Cover: tools-checkout hit (primary), tools-checkout miss →
  target-local hit, both miss → `--jscpd-bin` override used, all miss → skip
  signal (not a finding). Co-locate beside `duplicates.test.ts`.
- **OpenClaw validation:** with jscpd resolved from the tools checkout and
  cwd = OpenClaw, the duplicates check should **actually run** (no ENOENT) and
  emit **repo-relative** paths — replacing today's 6 ENOENT WARNs. Use the
  validated current-scope command from `01-shared-context.md`. Keep OpenClaw
  read-only.

## Out of scope

- The generic `CheckOutcome` refactor (task 21 owns it; here, use the existing
  `skippedChecks` path if 21 hasn't landed).
- Adapter-wide ENOENT policy (task 30); this task only aligns the duplicates
  runner with it.
- Changing jscpd's cwd / report-path behavior (keep `analyzedRepoRoot` = cwd).

## Implementation notes (landed 2026-05-29)

- **New module `scripts/drift-ai/jscpd-bin.ts`** holds `resolveJscpdBin` (and the
  `JscpdBinResolution` / `ResolveJscpdBinOptions` / `JscpdBinSource` types),
  re-exported from `duplicates.ts`. It was split out of `duplicates-runner.ts`
  because adding resolution there crossed the 300-line `local/max-lines` ratchet;
  splitting (vs. a ratchet exception) is the repo's preferred fix and keeps
  "find the binary" and "run the binary" focused.
- **Resolution = walk-up, not `import.meta.resolve`.** `resolveJscpdBin` walks up
  from this module's dir to the nearest `node_modules/.bin/jscpd` for the
  tools-checkout hit, then the target's `node_modules/.bin/jscpd`, then the
  `--jscpd-bin` override. `import.meta.resolve("jscpd")` yields the package entry,
  from which the `.bin` shim is unreliable to derive across nested/pnpm layouts;
  the walk-up finds the flat Bun shim directly and cwd-independently. The `fs`
  check is injected (`fileExists`) for a hermetic DI unit test.
- **Precedence is tools-checkout → target → override**, exactly as the task spec's
  numbered list (override is the lowest-precedence escape hatch, not a winner over
  auto-resolution). This is deliberate per spec; a reviewer wanting override-first
  would only need to reorder the three checks in `resolveJscpdBin`.
- **`defaultJscpdRunner` now takes `{ analyzedRepoRoot, jscpdBin }`** — cwd and
  executable are separate; `repoRoot` is gone. Only `runner.ts` constructs it.
- **Skip-with-reason** without the CheckOutcome refactor: `runner.ts`
  `resolveJscpdSetup` resolves only when `duplicates` is selected; on a miss it
  passes `jscpdUnavailableReason` on the `CheckContext`, and `report-builder.ts`
  `classifyChecks` moves `duplicates` into `skippedChecks` (no finding) and emits
  the reason via `warnStderr`. The text header's `(not run for this scope)`
  parenthetical is now slightly imprecise for this skip; making skip reasons
  first-class in the report is left to tasks 21/22 (the reporting trust pass).
  ENOENT-up-front → skip; a jscpd that *runs but fails* is still a finding (with
  the hint reworded to point at the tools checkout / `--jscpd-bin`).
- **Tests:** `resolveJscpdBin` precedence + not-found (DI fake fs) in
  `duplicates.test.ts`; a `buildReport` skip-not-finding + stderr-reason test and a
  `--jscpd-bin` parse test in `drift-ai.test.ts`. One existing test
  (`auto-loads drift-ai.config.json for --scope current reports`) now injects
  `emptyJscpdRunner()` to stay hermetic, since real resolution would otherwise
  find and spawn the tools-checkout jscpd.
- **OpenClaw validation (read-only):** `cd /home/node/tmp/openclaw` then
  `--scope current --check duplicates --root src` → exit 0, 8594 files in scope,
  real duplicate findings with **repo-relative** paths (e.g.
  `src/auto-reply/templating.ts:39-70`), **zero ENOENT WARNs** — replacing the old
  6 ENOENT failure findings. OpenClaw has no `node_modules/.bin/jscpd`; the bin
  resolved from the tools checkout.
- **Coverage-map / README:** registered `jscpd-bin.ts` in
  `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` (duplicates row),
  documented `--jscpd-bin` + the skip behavior in `scripts/drift-ai/README.md`, and
  removed the now-closed jscpd "Known gaps" bullet.

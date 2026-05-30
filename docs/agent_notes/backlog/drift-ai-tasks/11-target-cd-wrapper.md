# 11 — Target-selection flow (documented `cd` only)

Status: Done
Track: P (portability MVP)
Size: small
Depends on: 10
Blocks: none

## Goal

Make "point drift:ai at a different repo" a documented, low-friction flow without
prematurely building a real `--repo <path>` flag. The supported MVP is the
**`cd <target> && bun <tools>/scripts/drift-ai.ts`** pattern. A wrapper is
explicitly out of scope for now. A true `--repo` flag is explicitly **deferred**
because it needs one coherent path policy across six call sites; this task
records exactly what that policy must cover so the deferral is principled, not
lazy.

## Background

Read `01-shared-context.md` ("The portability target" — note the deferral
rationale: a `--repo` flag "needs one coherent policy across Git, config
discovery, `--output`, `--chunk-dir`, root validation, and cwd") and the "How to
test against OpenClaw / Musi" section (the validated command). This task builds on
task 10's contract doc — it documents the *selection* mechanism that the
contract assumes.

Why defer `--repo`: drift:ai currently leans on `process.cwd()` being the target
repo in several places (jscpd cwd `duplicates-runner.ts:52,75`; config
auto-discovery; output/chunk paths; root validation; subprocess cwd). A
half-done `--repo` that fixes some but not all of those would silently mis-root
output or config — worse than no flag. The `cd` flow makes cwd unambiguously the
target, which is correct everywhere by construction.

## Seams to touch

Doc-only. Relevant existing seams that the deferred `--repo` would have to
thread:

- jscpd cwd/bin: `02-seam-map.md` §4 (`duplicates-runner.ts:52` repoRoot, `:75` cwd).
- git cwd: `02-seam-map.md` §5 (`git-changed-scope.ts:20–22` `defaultGitRunner`
  wraps `execFileSync("git", …)` with no explicit cwd → inherits `process.cwd()`).
- config discovery / output / chunk-dir / root validation: `02-seam-map.md` §6,
  §10 (these resolve relative to cwd today).

## What to do

1. **Document the `cd` flow** (in the task-10 doc, or alongside it):
   ```sh
   cd <target-repo>
   bun <tools-checkout>/scripts/drift-ai.ts --scope current --root <src> ...
   ```
   Explain that cwd = target is what keeps output, config discovery, and
   scanner paths repo-relative.

2. **Do not ship a wrapper in this task.** The documented `cd <target-repo>` flow
   is sufficient. Keep drift:ai to one invocation surface until a real
   `--repo <path>` design threads all path semantics below.

3. **Explicitly defer `--repo <path>`** and record the path-semantics that MUST
   be designed together before it can land. List each, because a partial
   implementation is a trap:
   - **Git command cwd** — `defaultGitRunner` must run inside the target, not the
     tools checkout (`git-changed-scope.ts:20–22`).
   - **Config auto-discovery root** — discovery must search the target tree, not
     the tools checkout (which contains Musi's own `drift-ai.config.json`).
   - **`--output` base** — output paths must resolve relative to the target (or
     an explicit absolute), not the tools checkout.
   - **`--chunk-dir` base** — same as `--output`.
   - **`--root` validation** — roots are validated/resolved against the target,
     not cwd.
   - **Subprocess cwd** — jscpd (`duplicates-runner.ts:75`) and any future
     subprocess must use the target as cwd so report paths stay repo-relative.

   The deliverable here is the *list*, not the implementation. Note that the
   `cd` flow satisfies all six trivially (cwd = target), which is why it is the
   MVP.

## Locked decisions

- **Wrapper vs docs-only:** docs-only. The supported flow is
  `cd <target-repo>; bun <tools-checkout>/scripts/drift-ai.ts ...`.

## Testing

Run the documented flow against OpenClaw current scope (the validated command is
in `01-shared-context.md` "How to test against OpenClaw / Musi"):

```sh
cd /home/node/tmp/openclaw
bun /workspace/worktrees/exploration/scripts/drift-ai.ts --scope current \
  --root src --root packages --root apps --root extensions --root ui --root config
```

Confirm **exit 0** and that finding paths are **repo-relative** (e.g.
`src/...`, not absolute or tools-checkout-relative). Keep OpenClaw read-only.

## Out of scope

- Implementing `--repo <path>` (deferred; this task only enumerates its
  requirements).
- Shipping a wrapper script.
- Changing how config discovery / output / git cwd resolve (those changes belong
  with the eventual `--repo` work).

# 45a - birth and size-delta lens

Status: Done
Track: P
Size: small-medium
Depends on: 38, 39
Blocks: 45b

## Goal

Prototype a git-history lens that compares a file's birth blob against its
current blob using deterministic size metrics only.

## Background

The original complexity-at-birth task hid two independent units: finding the
birth commit/blob and choosing a complexity metric. This first slice answers the
archaeology question without taking on metric design. It uses `git show
<birth-sha>:<path>` rather than checking out old revisions and keeps rename,
squash, missing-blob, and cap caveats visible.

## Seams to touch

- bounded full-history collector from task 38
- current source inventory/read helpers
- new prototype lens modules or a separate prototype subcommand
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Identify each candidate file's birth commit/date/author using the bounded
   full-history helper, with rename caveats disclosed.
2. Read the birth blob via `git show <birth-sha>:<path>` and compare it with the
   current file.
3. Emit birth commit metadata, birth-burst size, bytes then vs now, effective LOC
   then vs now, churn since birth, and whether caps or missing blobs limited the
   row.
4. Define effective LOC locally and deterministically. Prefer the existing
   line-scanner/comment-aware helpers where practical; do not shell out to ESLint
   or add a broad dependency for this slice.
5. Rank rows as advisory evidence. Do not call a file abandoned solely from this
   lens.

## Testing

- Fake git fixtures for birth commit detection, missing old blobs, renamed files,
  squash-like single-revision history, and cap disclosure.
- Metric tests for bytes and effective LOC calculations.
- Rendering tests proving partial history and missing blobs are visible.

## Out of scope

- A cyclomatic or parser-backed complexity metric; use task 45b.
- Checking out old revisions.
- Hosted history APIs.
- Using this lens as a deletion or refactor verdict.
- A persistent blame/history cache.

## Completion notes

- Added the `birth-size-delta` prototype advisory subcommand. It uses current
  source inventory, bounded full-history records, `git show <sha>:<path>` birth
  blob reads, and the existing comment-aware line scanner for deterministic
  effective LOC.
- Rows include path-birth metadata, commit-wide birth-burst size, bytes and
  effective LOC then/current/delta, per-path churn since observed birth, missing
  blob caveats, partial-history caveats, and inspect/blob commands.
- Follow-up review fix: added `--max-blob-reads`, per-blob byte and timeout caps
  for `git show`, and advisory cap disclosure so `--top` is not mistaken for the
  cost bound.
- Split prototype subcommand dispatch from `runner.ts` into
  `prototype-subcommands.ts` so adding this subcommand did not grow the runner
  past the local max-lines policy.
- Updated `scripts/drift-ai/README.md`, CLI help, and public
  `scripts/drift-ai.ts` exports.

Verification:

- `bun test scripts/drift-ai/birth-size-delta-advisory.test.ts scripts/drift-ai/birth-size-delta-command.test.ts`
- `bun run lint:ratchet`
- `bun run typecheck`
- `bun run lint`
- `bun run docs:lint-coverage-map:check`
- `bun run verify:changed`

Note: a broader manual `bun test scripts/drift-ai.test.ts ...` run passed for the
main checkout files but also discovered `worktrees/exploration/scripts/...` tests,
which failed on that separate worktree's stale config parser. This was recorded
in `/home/node/pain-points-drift-ai.log`.

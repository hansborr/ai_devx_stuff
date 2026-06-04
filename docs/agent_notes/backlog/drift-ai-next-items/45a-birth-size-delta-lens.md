# 45a - birth and size-delta lens

Status: Parked
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

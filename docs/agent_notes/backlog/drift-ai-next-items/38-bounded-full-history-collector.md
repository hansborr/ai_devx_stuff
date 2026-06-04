# 38 - bounded full-history collector

Status: Parked
Track: P
Size: small-medium
Depends on: none
Blocks: 44a, 44b, 45a

## Goal

Add a shared bounded full-history git walk for prototype archaeology lenses that
need old-history evidence, without changing the existing windowed hotspot and
coldspot collectors.

## Background

The live `hotspots-history.ts` collector is intentionally windowed. It walks
`git log --since=<window>.days.ago` and auto-widens only within a bounded quick
lane. Ownership/DOA, source/test orphaning, and birth-vs-current lenses ask
different questions: first author, first seen, last source/test co-change, and
history since birth. Those need a capped full-history contract so each lens does
not invent its own truncation semantics.

## Seams to touch

- `scripts/drift-ai/hotspots-history.ts`, only for shared parser reuse if useful
- new `scripts/drift-ai/*history*.ts` helper modules
- prototype advisory output from task 39, for cap/truncation wording precedent
- `scripts/drift-ai/README.md`

## What to do

1. Add a helper that can walk full non-merge history under explicit caps:
   `--since` when supplied, `maxCommits`, `maxFiles`, and wall-clock timeout.
2. Reuse the existing git-log format and parser where practical so commit
   records, co-authors, subjects, and line-count degradation stay consistent.
3. Return structured cap metadata: requested caps, effective scanned range,
   whether more commits were observed, stopped reason, and any unexamined counts
   that are knowable. If an unexamined count is not knowable, say so rather than
   inventing it.
4. Keep rename behavior explicit. The first slice may keep the existing
   `--no-renames` parser-safe behavior, but it must return a rename caveat so
   44a/44b/45a do not each disclose this differently.
5. Preserve blobless partial-clone behavior: use name-only or skip line metrics
   with a clear degradation, never trigger a surprise blob fetch across full
   history.
6. Make capped runs read as partial in both text and JSON. A row must never look
   complete when history stopped after a commit, file, output, or time cap.

## Testing

- Fake git-history fixtures for uncapped, max-commit, max-file, timeout, and
  explicit `--since` runs.
- Tests proving the helper observes one extra commit or otherwise discloses that
  more history may exist when a cap is hit.
- Tests for parser reuse and rename-caveat propagation.

## Out of scope

- Replacing the existing `hotspots`/`coldspots` windowed collectors.
- A persistent blame/history cache.
- Full rename-following across history as the first slice.
- Hosted Git provider APIs.

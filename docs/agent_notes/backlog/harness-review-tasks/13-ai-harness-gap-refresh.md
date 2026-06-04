# 13 - Refresh ai-harness current gaps

Status: Parked
Track: D (docs/feedforward)
Size: small
Depends on: none
Blocks: 20, 22

## Goal

Update `docs/ai-harness.md` so its gap narrative reflects the current state:
diagnostics envelopes exist, and the remaining gap is aggregation and routine
collection.

## Background

The review found stale prose that still frames JSON diagnostics as future work.
Several tools already emit or validate `harness-diagnostics` envelopes. This
task is the human doc correction before building the fusion consumer.

## Seams to touch

- `docs/ai-harness.md`
- `harness.controls.json`; reconfirm the `logs:audit` control describes the
  current JSONL audit, not the older console-source-use idea.
- Generated docs only if the changed text is generated from the manifest.

## What to do

1. Replace "JSON output is future" style language with the current state:
   several tools emit diagnostics envelopes, while `drift:ai` and `logs:audit`
   still need projection into the shared envelope.
2. Name `harness:audit` as the intended consumer rather than a vague future
   dashboard.
3. If the doc contains hand-written rule or control counts that can drift,
   either remove them or route them through existing generated docs.
4. Keep the gaps honest: behavior confidence and slow-drift collection remain
   weak.
5. If `harness.controls.json` still describes `logs:audit` as a console-source
   scanner, update it and regenerate the generated controls doc before task 22
   projects per-control diagnostics.

## Testing

- `bun run docs:harness-controls:check` if generated harness docs are involved.
- `bun run harness:check` if `harness.controls.json` changes.
- `bun run format:changed:check`

## Out of scope

- Implementing `harness:audit`.
- Adding new diagnostics emitters.

# Status

**Last updated**: YYYY-MM-DD
**Current focus**: One sentence naming the active workstream and the note to
open next.
**Test suite**: High-level state only. Put exact counts and one-off failures in
`LOG.md` or the task note.

## What's In Progress

Keep this as a snapshot, not a changelog. Mention only the current work and
durable context a new agent cannot infer from code.

If a session ends mid-flight, update the matching `in_progress/` note and this
section so the next agent can resume without guessing.

## Read Next

- `NEXT.md` - prioritized queue.
- `DECISIONS.md` - only when changing a cross-cutting pattern.
- `LOG.md` or `finished_work/README.md` - only when retained history matters.
- `backlog/README.md` - only when re-triaging parked work.

## Handoff

1. Read this file, then `NEXT.md`.
2. If `NEXT.md` names an active note, open only that note.
3. If `NEXT.md` is empty, wait for human re-triage instead of inventing broad
   work.
4. When work lands, retain only durable handoff history and update this file
   only if the snapshot changed.

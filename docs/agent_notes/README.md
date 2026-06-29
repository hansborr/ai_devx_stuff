# Agent Notes

Persistent working notes for context future agents cannot quickly recover from code or commits alone.

## Folder Map

```text
agent_notes/
├── LOG.md
├── DECISIONS.md         # index for decisions-*.md domain files
├── decisions-*.md       # per-domain ADR-lite entries
├── README.md
├── in_progress/
├── backlog/
└── finished_work/
    └── README.md
```

## Use It This Way

- Everything under `agent_notes/` is on-demand. `LOG.md` is curated recent
  history, and `backlog/` holds parked workstreams.
- Open `DECISIONS.md` only when the task is about to change a cross-cutting pattern.
- Keep `backlog/` out of normal session-start reads. Promote an item back into `in_progress/` only when it becomes active again.
- `finished_work/` is pruned by default. Add a note there only when the
  details cannot be recovered from code, tests, commits, `LOG.md`, or
  `DECISIONS.md`.

## When To Create `in_progress/<task>.md`

Create one when the task has any of these properties:

- Non-obvious design decisions other agents would benefit from.
- Known risks or gotchas discovered during implementation.
- Multi-PR or multi-session work that needs a tracked handoff.

Do **not** create one for straightforward work where the commit message and roadmap checkbox tell the whole story.

## Thin Plan Template

For non-trivial cross-package work or work with ambiguous acceptance, copy this
whole block into `in_progress/<task>.md` before implementation. Skip it for
trivial docs edits, single-file fixes, or a fully specified existing leaf.

```markdown
# <Task> — Thin Plan

Status: In progress
Date: YYYY-MM-DD

## Scope & Non-goals

- In scope:
- Non-goals:

## Acceptance Checks

- User-visible outcome:
- Edge cases:

## Contract Impact

- Shared:
- Server:
- Client:

## Discovery Commands

- `rg "<term>"`
- `bun run code:intel -- <def|refs|dependents|tests> <target>`

## Verification Plan

- Focused:
- Changed:
```

## What To Put In A Task Note

Focus on **decisions, gotchas, and handoff state**. Do not restate the roadmap, write a file-by-file changelog, or duplicate commit history.

```markdown
# <Milestone> — <Short Description>

Status: In progress | Complete
Date: YYYY-MM-DD

## What was built
(brief; link to roadmap for full scope)

## Key decisions
(non-obvious choices and why)

## Gotchas
(things that broke, surprised, or will trip the next agent)

## Next step / handoff
(what to do next if the work is not done)
```

When work lands, fold durable history into `LOG.md`, `DECISIONS.md`, or a
small `finished_work/` note.

## Backlog

Use `backlog/` for work that still matters but should not be visible in the default loop:

- Deferred prerequisites that are not ready now.
- Broad audits or strategy docs that need later mining, not daily rereads.
- Future-phase themes that have not been promoted into a concrete leaf task.

When promoting backlog work:

1. Move the note or folder back into `in_progress/`.
2. Add one line to `LOG.md` if context is needed.

## Naming

- Feature notes: `<phase><milestone>-<description>.md`
- Review notes: `codebase-review-YYYY-MM-DD.md`
- Cross-cutting notes: `<topic>.md`

# 44a - ownership DOA prototype

Status: Done
Track: P
Size: medium
Depends on: 38, 39
Blocks: none

## Goal

Prototype ownership/DOA-style archaeology signals over git history: first
author, dominant owner, own-vs-other changes, owner recency, co-authors, and
agent hands.

## Background

Coldspots already includes a gone-silent-author amplifier, but the backlog calls
for a fuller ownership view. Keep this advisory/prototype output, not a defect
stream. Test/source orphaning is split into task 44b.

## Seams to touch

- `scripts/drift-ai/hotspots-history.ts`
- bounded full-history collector from task 38
- `scripts/drift-ai/hotspots-actionability.ts`
- new prototype lens modules or a separate prototype subcommand
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Compute file-level first author, dominant owner, own-vs-other-authored
   changes, owner recency, and a normalized DOA-style ownership score.
2. Count co-authors as contributing hands, but emit `author`, `coAuthors`, and
   `agentHands` as distinct fields.
3. Seed agent-hand detection with configurable identity patterns rather than a
   hard-coded product list.
4. Honor `.mailmap` where practical.
5. Use the bounded full-history collector from task 38 for commit/file/time caps
   and truncation disclosure.
6. Emit recent subject evidence and copy-paste git inspect commands.

## Testing

- Fake git-history fixtures for ownership concentration, first author, co-author
  handling, agent-hand labeling, gone-silent owner, and cap disclosure.
- Tests for `.mailmap` coalescing when practical.

## Out of scope

- Source/test co-change mapping; use task 44b.
- Host API review-count adapters.
- Per-line ownership as the first slice.
- User-cache-backed blame cache.
- Telling agents to "fix" ownership rows.

## Notes

Implemented `bun run drift:ai ownership` as a prototype advisory subcommand.
It uses the bounded full-history collector, honors `.mailmap` through
`git check-mailmap`, emits first author / dominant owner / author / co-author /
agent-hand evidence as distinct JSON fields, and discloses full-history caps,
scanned range, recent subjects, and inspect commands. Agent hand detection is
regex-based with seeded defaults plus repeatable `--agent-identity-pattern`.

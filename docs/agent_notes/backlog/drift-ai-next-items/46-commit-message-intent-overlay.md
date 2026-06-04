# 46 - commit-message intent overlay

Status: Parked
Track: P
Size: medium
Depends on: 39
Blocks: none

## Goal

Add a lightweight commit-message intent classifier that amplifies advisory rows
without creating standalone findings.

## Background

The brainstorm explicitly rejected "AI-written commit" detection but kept a
maintenance-intent overlay: classify subjects as fix, refactor, scaffold,
generated, update, or unknown, and show the subjects that drove the label. Regex
is enough for the first pass. This task does not depend on the full-history
collector as long as it classifies commit subjects already present on another
advisory row. If it starts scanning history itself, add a dependency on task 38.

## Seams to touch

- `scripts/drift-ai/hotspots-history.ts`
- `scripts/drift-ai/hotspots-actionability.ts`
- existing advisory row context where recent subjects already appear
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Add a deterministic regex classifier for commit subjects and optional trailer
   hints. Keep categories small: fix, refactor, scaffold, generated, update,
   unknown.
2. Emit intent labels only as overlay context on rows that already exist from
   another lens. Do not create standalone "intent" rows.
3. Preserve the subject evidence that triggered each label so a reader can
   discount weak regex matches.
4. Make patterns configurable only if the first hard-coded seed set becomes
   noisy in tests or field data.
5. Keep the overlay advisory-shaped and candidate-framed through task 39.

## Testing

- Unit tests for category regexes, precedence, unknown fallbacks, and case
  handling.
- Advisory-row tests showing intent labels do not create extra rows.

## Out of scope

- AI-authorship detection.
- Starting a separate full-history walk.
- Hosted NLP or model calls.
- Standalone findings or gates based on commit messages.

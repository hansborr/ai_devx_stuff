# 12. concurrency-guard message contradicts its own pairedGuide

Status: Done — changed `concurrency-guard/noDirectWrite` to inline `docs/guides/add-race-sensitive-mutation.md`, matching `meta.docs.pairedGuide`, and added a focused rule test pinning the inline pointer.
Lens: rules · Area: truthfulness · Severity: med · Size: XS · Confidence: high
Theme: doc-pointer-parity · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
The rule's report message tells the agent "then see docs/CONCURRENCY.md"
while its own `meta.docs.pairedGuide` points at
`docs/guides/add-race-sensitive-mutation.md`. The message and the metadata
disagree about where help lives — and since plain `bun run lint` output
shows only the message, most agents get steered to the background doc
instead of the task guide. Verified 2026-07-05.

## Evidence
- `eslint-rules/concurrency-guard.js:165` — message ends
  "…then see docs/CONCURRENCY.md."
- `eslint-rules/concurrency-guard.js:159` —
  `pairedGuide: "docs/guides/add-race-sensitive-mutation.md"`.

## Proposed direction
Point both at the guide: change the message tail to
`See docs/guides/add-race-sensitive-mutation.md.` (the guide is the
actionable recipe and itself links `docs/CONCURRENCY.md` for background).
Leave the file-header comment's CONCURRENCY.md reference alone — that is
context for rule maintainers, not the report message.

## Scope / caveats
- Update rule tests/fixtures asserting the message text; keep the
  message-guidance contract (length cap, "How to fix:" shape) green.
- Regenerate `docs:lint-guidance` output if it embeds message text.
- Leaf 21 adds the contract-test guard that would have caught this class;
  land this first so that guard starts green.

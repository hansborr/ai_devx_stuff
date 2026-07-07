# 48. Near-cap policy-prose messages: trim or document the duplication

Status: Done — kept the long self-contained diagnostics and added a `message-guidance.test.js` drift guard asserting their key duplicated tokens also appear in `docs/guides/local-eslint-rules.md`.
Lens: rules · Area: consistency · Severity: low-med · Size: S-M · Confidence: med-high
Theme: message-vs-doc-drift · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Three messages sit within ~70 chars of the 520-char contract cap by
inlining full policy prose — `max-lines/exceed` (455: metric philosophy +
exceptions-file mechanics + "don't code-golf"), `no-explicit-any/noAny`
(473: the unknown/shared-type/local-type taxonomy + exact disable syntax),
`type-assertion-boundary/missingBoundary` (500: marker placement rules).
The duplicated content also lives in `docs/guides/local-eslint-rules.md`,
and nothing diffs the two, so they drift independently. The cap-shaped
writing suggests authors write *to* the limit rather than to necessity.

## Evidence
- `eslint-rules/max-lines.js:120`, `eslint-rules/no-explicit-any.js:25-26`,
  `eslint-rules/type-assertion-boundary.js:209-210`.
- `eslint-rules/message-guidance.test.js` — caps length, doesn't diff
  against the guide.

## Decision gate (write the outcome here before implementing)
There is a real argument for the status quo: plain lint output shows only
the message, so self-containment is exactly what saves an agent a doc
trip — the review itself rated `type-assertion-boundary`'s long message as
one of the best in the set. The options:
1. **Keep long, add a drift guard** — a test asserting key tokens
   (category list, marker syntax, exceptions-file name) appear in both the
   message and the guide section. Cheapest honest option.
2. **Trim to decision + pointer** — shorter messages, taxonomy lives only
   in the guide; costs agents a doc trip on plain lint output.
3. **Split by rule** — keep `type-assertion-boundary` self-contained
   (syntax you must reproduce exactly), trim the other two (judgment
   guidance that a pointer serves fine).

Option 3 is the review's recommendation.

**Decision (2026-07-05, owner): option 1 — keep the long messages, add a
drift guard.** Self-containment stays; add a test asserting the key tokens
(category list, marker syntax, exceptions-file name) appear in both the
rule message and the corresponding guide section, so the duplication is
documented and cannot drift silently. No trimming.

## Scope / caveats
- Whatever the choice: fixtures, contract test, lint-guidance regen.
- If trimming `no-explicit-any`, keep the exact disable-with-reason syntax
  in-message — that part is load-bearing (agents must reproduce it
  character-perfect).

# 21. Contract-test guard: inline pointer ↔ pairedGuide parity

Status: Done — extended `message-guidance.test.js` with inline pointer parity, pointer presence/exemption, and heavily shared paired-guide allowlist guards.
Lens: rules · Area: discoverability · Severity: med-high · Size: S-M · Confidence: med-high
Theme: doc-pointer-parity · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
`eslint-rules/message-guidance.test.js` already contract-tests every rule
message for shape, length, and action verbs — but nothing checks doc
pointers. That's how leaf 12's message-vs-metadata contradiction and leaf
20's arbitrary pointer coverage arose, one rule at a time. The fix should
be structural, not another sweep.

## Evidence
- `eslint-rules/message-guidance.test.js` — existing contract (shape/caps),
  no doc-pointer assertions.
- Leaves 12 and 20 — the two defect classes a guard would have caught.

## Proposed direction
Extend the contract test with:
(a) **Parity:** if a message contains a `See docs/…` pointer and the rule
has `meta.docs.pairedGuide`, the paths must be equal.
(b) **Presence:** a non-EXEMPT rule with a `pairedGuide` must inline the
pointer (or be listed in a small explicit exemption set with a reason —
e.g. `type-assertion-boundary`, whose message is deliberately
self-contained).
(c) **Catch-all flag (soft):** assert no guide is `pairedGuide` for more
than N rules without an allowlist entry — today
`docs/guides/local-eslint-rules.md` backs 7 rules while having real
sections for ~2 of them, which hollows out the pointer's value.

## Scope / caveats
- Depends on leaves 12 and 20 landing first, else (a)/(b) start red.
- (c) is a tripwire for guide authors, not a message rule — keep it a
  named allowlist so accepting the status quo is an explicit act.
- Keep assertion failure text in the same style as the existing contract
  test's (it is itself an agent-facing lint message).

# 22 — Message upgrades, cross-rule fixtures, and a message eval lane

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: E (envelope/feedback) · Priority: P1 · Size: M
Created: 2026-07-15

> 08 wanted Before/After upgrades at P0; 07 wanted semantic tests + evals at
> P1. Merged into one three-part leaf; parts are independently landable.

## Evidence

- Musi's single-line message surface is a deliberate, tested choice (research
  report 05 §15: choose surface per the consuming tool) — so Before/After
  snippets belong in the agent envelope's `howToFix`, not necessarily the
  terminal line.
- The llm-core oscillation bug is the cautionary tale for part (b): its
  preset contains a rule whose fix example (`as unknown as T`) is exactly
  what a sibling rule bans, so an agent following the messages ping-pongs
  forever. Nothing in Musi's current message tests asserts cross-rule
  consistency of *suggested fixes*.
- llm-core is the only surveyed project that measures message wording against
  agent behavior (treatment vs. control). Its published "54% fewer
  iterations" table is illustrative output, not a committed run — adopt the
  method, not the number.

## Do

1. **(a) Before/After snippets** — selectively add concrete Before/After
   examples to high-traffic messages, delivered through the envelope
   (`howToFix`), keeping the single-line terminal surface intact.
2. **(b) Cross-rule fix fixtures** — add fixtures asserting that no enabled
   rule's suggested fix violates another enabled rule (start with the
   type-assertion / no-explicit-any / boundary-marker cluster, where the
   oscillation shape is most plausible).
3. **(c) Message eval lane** — stand up a small llm-core-style
   treatment/control eval over representative Musi violations: same
   violation, message variant A vs B, measure iterations-to-green. Scheduled
   lane, not commit-blocking.

## Verify

```
bun run test -- eslint-rules/message-guidance.test.js
bun run verify:changed
```

Part (c) verifies as its own scheduled script with committed run output.

## Acceptance

- High-traffic envelope entries carry Before/After examples; terminal lines
  unchanged.
- A cross-rule fixture suite fails if any rule's suggested fix trips another
  enabled rule.
- One committed eval run exists comparing at least two message variants on
  real Musi violations, with the method documented for reruns.

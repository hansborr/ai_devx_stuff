# 12 — Broaden error-semantics coverage beyond console-only catches

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: L (lint rules) · Priority: P0 · Size: S
Created: 2026-07-15

> 07 P0, 06 P1; report 04 documented the gap. One code path, a few new
> messageIds on an existing rule.

## Evidence (verified 2026-07-15; re-verify before implementing)

- `eslint-rules/no-swallowed-errors.js:25` — the rule deliberately detects
  only `console.*`-only catch bodies (`callee.object.name !== "console"`
  bails), so:
  - `catch {}` and comment-only catches currently **pass** where
    `catch { console.log(e) }` fails — the stricter dodge beats the looser one;
  - log-then-return-fallback passes (report 04: arguably worse than
    log-and-continue — it hides failure behind normal-looking output);
  - `Sentry.captureException(error)`-style calls pass, and the rule's own fix
    message can steer agents toward exactly that dodge (the research's
    "Sentry dodge" story beat).
- log+throw in the same catch block (double-reporting) is also uncovered —
  adapted from Factory's one genuinely portable logging rule.

Failure: the rule teaches agents which swallow shapes it checks; every
uncovered sibling becomes the compliant-looking evasion.

## Do

Extend `local/no-swallowed-errors` with sibling messageIds:

1. Empty and comment-only catch bodies (llm-core's message discipline is the
   model: "a comment alone does not satisfy this rule").
2. Log-then-return-fallback. Research found zero live instances, so this can
   land as hard-error with no ratchet drain — confirm with a full scan first.
3. Log+throw in the same block (double-reporting).
4. Keep the existing `why`/`howToFix` message shape; make sure no suggested
   fix is itself a shape another messageId flags (leaf 22's cross-rule
   fixture concern).

## Verify

```
bun run test -- eslint-rules/no-swallowed-errors.test.js
bun run lint:probe-rule
```

Full-scan probe for each new messageId before choosing hard-error vs ratchet.

## Acceptance

- `catch {}`, comment-only, log-return-fallback, and log+throw shapes all
  fire with distinct messageIds and fix guidance.
- Zero-findings shapes land as hard errors; any shape with live debt goes
  through the ratchet per `docs/guides/lint-ratchet.md`.

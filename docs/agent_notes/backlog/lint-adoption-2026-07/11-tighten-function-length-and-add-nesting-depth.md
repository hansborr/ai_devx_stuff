# 11 — Tighten function length and add a nesting-depth rule

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: L (lint rules) · Priority: P0 · Size: M
Created: 2026-07-15

> Unanimous direction across 06/07/08. Codex calibration adopted: ratchet
> toward 80–100, do not copy llm-core's 50 monorepo-wide in one step.

## Evidence (verified 2026-07-15; re-verify before implementing)

- `eslint-config/rule-groups.js:24` — `max-lines-per-function` is 200
  (skipBlankLines/skipComments), 4× llm-core's 50 and Musi's loosest
  structural limit.
- No `max-depth` (or equivalent nesting rule) anywhere in `eslint-config/`,
  so a shallow-but-deeply-nested 199-line handler passes clean today.

Failure: agents produce long, deeply nested handlers that pass every
structural gate; complexity is capped but nesting is not, and 200 lines is
generous enough that the limit rarely steers.

## Do

1. Ratchet production code from 200 toward **80–100** via the lint-ratchet
   no-new-floor mechanism (`docs/guides/lint-ratchet.md`, "Adding a new rule
   to an already linted area"); codex suggests then evaluating 60 for
   service/router code as a second step.
2. Add `max-depth` at 3–4, ratcheted the same way.
3. Pair the messages with a `prefer-early-return` fix-shape suggestion (08's
   framing) so the steered fix is guard clauses, not artificial function
   splits. Respect the existing anti-gaming message convention ("do not
   compress lines or inline useful helpers just to satisfy the metric").
4. Keep the existing `max-lines-per-function: "off"` test-config carve-out
   (`eslint-config/test-configs.js:102`) and the reviewed max-lines exceptions
   machinery untouched — this leaf is about functions, not files.

## Verify

```
bun run lint:ratchet:check-baseline
bun run verify:changed
```

## Acceptance

- New functions over the tightened limit or deeper than the nesting cap fail
  at commit time; existing debt is frozen in the ratchet baseline.
- Rule messages carry the early-return fix shape and the anti-gaming clause.
- llm-core's 50-line limit is explicitly *not* adopted monorepo-wide in this
  step (recorded so a later drain can revisit).

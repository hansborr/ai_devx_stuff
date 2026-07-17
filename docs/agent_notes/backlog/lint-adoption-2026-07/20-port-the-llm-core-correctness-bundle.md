# 20 — Port the llm-core silent-wrong correctness bundle

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: L (lint rules) · Priority: P1 · Size: S
Created: 2026-07-15

> 08 ranked P0, 06/07 P1. Adjudicated P1 by leverage (individually
> low-frequency) but trivially cheap — near-zero expected violations means
> hard-error directly, no ratchet, no drain; can land any afternoon.

## Evidence

Five llm-core rules target bugs that typecheck, pass casual review, and fail
at runtime — the exact place agents fail most and human reviewers of agent
output are weakest:

- `bad-comparison-sequence` (e.g. `a < b < c` chains)
- `missing-throw` (`new Error(...)` constructed but not thrown)
- `bad-min-max-func` (inverted `Math.min`/`Math.max` clamps)
- `no-incorrect-sort` (default lexicographic sort on numbers)
- `uninvoked-array-callback` (callback referenced, never called)

None of these have equivalents in Musi's current config (verified absent from
`eslint-config/` on 2026-07-15). Do **not** take the llm-core preset to get
them — see the non-recommendations in
[`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md).

## Do

1. Port the five as `local/*` rules with Musi-shape messages (`why`/
   `howToFix`, action-verb allowlist), not as an llm-core dependency —
   follow `docs/guides/local-eslint-rules.md` for registration, docs, and
   test surfaces.
2. Full-scan probe each rule first (`lint:probe-rule`); expected zero
   findings → enable as hard error directly, no ratchet entry.
3. Check each rule's suggested fix against the rest of the enabled config
   (the llm-core oscillation bug is the cautionary tale).

## Verify

```
bun run lint:eslint-rules
bun run lint:probe-rule
bun run verify:changed
```

## Acceptance

- All five rules registered, tested with RuleTester fixtures, and enabled as
  hard errors.
- Zero live findings at enable time, or any findings fixed in the same
  branch (not baselined).
- Messages pass the existing message-guidance shape tests.

# Evaluate testing-library And jest-dom Plugins For Client Tests

Status: Done (2026-06-12, landed in "feat(lint): adopt testing-library for
client tests and ratchet its debt")
Order: 06
Source: promoted from the lint-review-2026-06 watchlist ("Client test
quality"), 2026-06-12 re-triage.

## Context

The watchlist entry: evaluate `eslint-plugin-testing-library` and
`eslint-plugin-jest-dom` only for client `.test.tsx` files. The
`@vitest/eslint-plugin` slice already landed — do not re-promote it.
Client component tests are the one test family with no framework-specific
lint coverage beyond Vitest generics; both plugins target real bug
classes (asserting on implementation details, non-retrying queries,
missing `await` on user-event, weak jsx assertions).

## Scope

- Probe both plugins' recommended configs against client `.test.tsx` files
  only (scope the flat-config block; do not let it leak to server/shared
  tests). Record finding counts per rule.
- Triage the top finding rules: real bug class vs idiom mismatch with the
  existing test helpers (`packages/client/src/test/`). The repo precedent
  is adopt-clean, ratchet-floor, or reject-with-evidence per rule group —
  not all-or-nothing.
- Land the adopted slice (clean rules at `error`; any rule with existing
  debt gets a message-count ratchet floor per the registry conventions).
- Record the verdict with counts and probe timings in
  `evaluation-verdicts.md`, including explicit rejects so the watchlist
  entry can be closed rather than re-litigated.

## Definition Of Done

Either both plugins have a landed, scoped configuration with any debt
ratcheted, or the verdict register records a reject with finding counts —
and the watchlist entry is updated to point at the verdict.

## Verification

- `bun run lint -- --max-warnings=0` and lint:ratchet gates.
- `bun run --filter @musi/client test` stays green (rule fixes must not
  weaken tests).
- `bun run verify:changed`.

## Notes (2026-06-12)

Outcome is a split: see the full verdict in `evaluation-verdicts.md`.

- **jest-dom rejected, not deferred-for-noise.** It is hard-incompatible with
  this repo's ESLint 10.4.0: the latest published `eslint-plugin-jest-dom`
  (5.5.0) peers at eslint <=9 and 7 of its 11 rules call the removed
  `context.getSourceCode()`, so the probe crashed rather than reporting. The
  dependency was removed; revisit only after an eslint-10-compatible release.
- **testing-library adopted, scoped to `packages/client/src/**/*.test.tsx`.**
  18 clean rules at `error`; three implementation-detail debt rules ratcheted
  (`no-node-access` 121, `no-container` 25, `prefer-screen-queries` 6) with a
  `promote-to-normal-lint` disposition; `render-result-naming-convention`
  rejected (off) as pure naming style (46 findings, varied ad-hoc names).
- **No test code was edited.** Debt was floored/rejected, not drained, so the
  client test runtime is unaffected. Draining + promotion is tracked in
  `watchlist.md` (the ratchets' `exitPath`).
- **Surprise: the leaf's verification command is wrong for this layout.**
  `@musi/client` has no `test` script; client tests run via the root
  `bun run test:client` (vitest `--project=client`). Used that instead.
- **Deferred:** client hook tests in `.test.ts` (`renderHook`) are out of the
  leaf's `.test.tsx` scope; one finding seen there
  (`no-wait-for-multiple-assertions`). Broadening is folded into the drain
  follow-up.

# 31 — Drain `testing-library/prefer-screen-queries` (clears an entire ratchet)

Status: Ready
Track: D (ratchet drain) · Priority: P2 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `ratchet/testing-library-prefer-screen-queries-client-tests` — 6 findings
  in 2 files:
  - `packages/client/src/components/campaign/maps/fog-overlay.test.tsx` (5)
  - `packages/client/src/components/common/toast-provider.test.tsx` (1)

## Do

Mechanical swap to `screen.*` queries (or destructure-free equivalents),
keeping every behavioral assertion identical. Then retire the now-zero
ratchet per the zero-baseline lifecycle in `docs/guides/lint-ratchet.md`.

## Verify

```
bun run test -- packages/client/src/components/campaign/maps/fog-overlay.test.tsx packages/client/src/components/common/toast-provider.test.tsx && bun run lint:ratchet
```

## Acceptance

Both files pass with unchanged assertion counts; the ratchet reaches zero
and is retired per lifecycle.

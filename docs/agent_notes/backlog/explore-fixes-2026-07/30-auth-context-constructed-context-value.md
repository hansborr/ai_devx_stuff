# 30 — Memoize the auth context value (clears an entire ratchet)

Status: Ready
Track: D (ratchet drain) · Priority: P1 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/hooks/auth-context.tsx:113` — constructed context
  value; the single remaining finding in
  `ratchet/react-jsx-no-constructed-context-values-client`
  (`lint-ratchet.baseline.json`).

## Do

Wrap the context value in `useMemo` with the correct dependency list (read
`docs/guides/client-effects.md` mindset: this is derived state, not an
effect). Then retire the now-zero ratchet per the zero-baseline lifecycle in
`docs/guides/lint-ratchet.md` — either in the same commit or a paired
follow-up, whichever the lifecycle prescribes.

## Verify

```
bun run test -- packages/client/src/hooks/auth-context.test.tsx && bun run lint:ratchet
```

(auth-context test path: locate with `bun run code:intel -- tests packages/client/src/hooks/auth-context.tsx`)

## Acceptance

The ratchet count reaches zero and the ratchet is retired per lifecycle;
auth behavior unchanged (context consumers don't re-render on unrelated
provider renders — that's the point of the fix).

# 50 — Extract the shared death-save dots presentational component

Status: Ready
Track: C (client) · Priority: P2 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/components/campaign/combat/combat-death-saves.tsx:12`
  and `packages/client/src/components/sheet/death-saves-interactive.tsx:23` —
  two near-duplicate death-save dot implementations (also a long-standing
  drift-ai near-duplicate finding). Aria/disabled/sizing behavior can diverge
  silently.

## Do

Extract one shared presentational dots component (props: successes,
failures, interactivity flags/handlers); keep mutation handlers and
query/socket wiring local to each call site. Follow the component-placement
conventions of the nearest MODULE.md.

## Verify

```
bun run test -- packages/client/src/components/campaign/combat/combat-death-saves.test.tsx packages/client/src/components/sheet/death-saves-interactive.test.tsx
```

## Acceptance

Both surfaces render through the shared component with unchanged behavior
and passing tests; dot markup/aria exists once.

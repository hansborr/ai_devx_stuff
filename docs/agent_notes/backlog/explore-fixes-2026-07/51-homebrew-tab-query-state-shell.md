# 51 — Extract the homebrew entry-tab loading/error/empty shell

Status: Ready
Track: C (client) · Priority: P2 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/components/campaign/npcs/homebrew-monster-tab.tsx:85`
  and `packages/client/src/components/sheet/homebrew-item-tab.tsx:189` — the
  same query-state flow (loading / error / empty / list) duplicated across
  the monster and item homebrew tabs (drift-ai near-duplicate finding).

## Do

Extract a small generic render shell handling the four query states, with
type-specific row rendering and empty-state copy passed in. Keep tRPC/query
wiring at the call sites (client cache/socket guide applies to the wiring,
not the shell). Read the nearest MODULE.md first.

## Verify

```
bun run test -- packages/client/src/components/campaign/npcs/homebrew-monster-tab.test.tsx packages/client/src/components/sheet/homebrew-item-tab.test.tsx
```

## Acceptance

Both tabs render through the shared shell with unchanged behavior and
passing tests.

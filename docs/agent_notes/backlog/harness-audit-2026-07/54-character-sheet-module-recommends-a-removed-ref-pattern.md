# 54 — Character-sheet module recommends a removed ref pattern

Status: Done
Track: DOC (docs) · Priority: P2 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** History and current code confirm the `useRef` pattern was removed when React Hooks recommended-latest landed; the module still instructs contributors to preserve it.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `packages/client/src/hooks/character-sheet/MODULE.md:98-100` — the gotcha recommends a stable-ref pattern using `useRef` plus `useCallback`.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:18` — the hook imports `useCallback` but no `useRef`.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:143-160` — mutation functions are destructured and included in callback dependencies.
- `eslint-config/client-configs.js:127-132` — client lint applies React Hooks `recommended-latest`.

Failure: Following the module’s explicit advice can reintroduce render-time ref mutation and conflict with current lint and hook behavior.

## Do

Replace the stale gotcha with the current destructured-mutation and dependency-array pattern. Explain why mutation functions belong in callback dependencies.

## Verify

After staging the documentation change, compare the documented pattern with
`use-character-stats.ts`, then run the changed gate:

```
bun run verify:changed
```

## Acceptance

- The module describes the pattern implemented by `use-character-stats.ts`.
- No guidance recommends render-time ref mutation.

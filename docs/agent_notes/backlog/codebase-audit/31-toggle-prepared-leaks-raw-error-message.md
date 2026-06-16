# 31. togglePrepared mutation toasts the raw server error.message, bypassing the onTRPCError copy catalog every sibling hook uses

Status: Done — 2026-06-14. `togglePrepared`'s `onError` now routes through `onTRPCError({ action: "update spell preparation" })` (rollback `restoreSnapshot` retained); `use-character-spells.test.ts` extended to assert catalog copy on FORBIDDEN + rollback intact.
Theme: error copy consistency · Area: client · Severity: low · Size: XS

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: error-observability); evidence independently re-verified. · Confidence: high

## Problem
`use-character-spells.ts` is the single client `src` site that surfaces a raw tRPC `error.message` to the user — `toast.error(error.message || "Failed to update spell preparation")`. The `togglePrepared` server handler throws developer-facing strings (`"Not a member of this campaign"`, `"Spell not found on character"`, `"Cantrips are always prepared"`), and the adjacent spell-slot CAS path throws `"Spell slot modified concurrently"` — jargon never meant to be read by a player. The whole reason `onTRPCError` + `TOAST_MESSAGES` exists is to keep server strings off the UI and map tRPC codes to player-facing copy; this one hook silently opts out. For a new developer, it is a discoverability trap: copying this hook as a template propagates the wrong pattern, and the inconsistency hides where the codebase's one true error-copy convention lives (you cannot tell from this file that a catalog exists at all).

## Evidence
- `packages/client/src/hooks/character-sheet/use-character-spells.ts:71` — `toast.error(error.message || "Failed to update spell preparation")` inside the `togglePrepared` mutation's `onError`; ripgrep confirms this is the only `toast` + `error.message` pairing under `packages/client/src`.
- `packages/client/src/hooks/vtt-drawer/use-confirm-cast.ts:38-48` — clean exemplar: routes `onError` through `onTRPCError({ action: "cast spell", onConflict: { message, sideEffect } })` instead of echoing the server string.
- `packages/client/src/lib/trpc-error.ts:26-43` — `onTRPCError` maps `error.data.code` to catalog copy (`hasCatalogMessage`/`TOAST_MESSAGES.codes[code]`) and falls back to `TOAST_MESSAGES.default(action)`; never exposes `error.message`.
- `packages/client/src/lib/toast-messages.ts:1-17` — the catalog the leaking hook bypasses: `codes` maps `BAD_REQUEST`/`FORBIDDEN`/`NOT_FOUND`/`UNAUTHORIZED`/`TOO_MANY_REQUESTS` to player copy; `default` is `Failed to ${action}`.
- `packages/server/src/routers/character-spell.ts:159-187` — `togglePrepared` calls `assertCharacterOwnerOrAccess` then throws `NOT_FOUND "Spell not found on character"` (179) and `BAD_REQUEST "Cantrips are always prepared"` (185) — all reachable by the line-71 toast.
- `packages/server/src/utils/campaign-auth.ts:58,91` — `FORBIDDEN "Not a member of this campaign"`, reached via `assertCharacterOwnerOrAccess`; developer-facing copy the catalog is designed to replace with `"You don't have permission to update spell preparation."`.
- `packages/server/src/utils/spell-slot-mutations.ts:60` — `CONFLICT "Spell slot modified concurrently"`, the genre of jargon `TOAST_MESSAGES` exists to keep out of toasts (illustrative — this one is thrown on the cast/consume path in the same spell domain, not by `togglePrepared` itself).
- Adoption count: `rg -ln "onTRPCError" packages/client/src` resolves to exactly 5 consuming hooks (`use-confirm-cast`, `use-feature-use`, `use-weapon-attack`, `use-monster-hp-update`, `use-drop-concentration`), plus the helper and its test — so this leak sits next to a small but established convention.

## Proposed direction
Fix shape only — do not implement here; fold into the broader `onTRPCError` adoption work it depends on.
- Replace the hand-rolled `onError` in `useCharacterSpells`'s `togglePrepared` mutation with `onTRPCError({ action: "update spell preparation" })`, preserving the optimistic-rollback side effect via the helper's `sideEffect` hook (the existing `restoreSnapshot(queryClient, spellsKey, ctx)` must still run, so pass it as the `sideEffect` of the relevant recovery hook, or keep the snapshot restore in a thin wrapper that then delegates to `onTRPCError`). Note that the current `onError` receives the optimistic `ctx`; `onTRPCError`'s callback signature takes only `error`, so the rollback closure over `ctx` needs to be retained — keep that wiring, do not drop the rollback.
- TDD: a focused test already exists at `packages/client/src/hooks/character-sheet/use-character-spells.test.ts` (its `togglePrepared` optimistic-update block is at `:87-127`). **Extend** it — do not create a new file — to assert (a) on a `FORBIDDEN` toggle failure the toast text is the catalog copy, not `"Not a member of this campaign"`, and (b) the optimistic update is still rolled back. Mirror the assertion style already used in `packages/client/src/lib/trpc-error.test.ts` and the existing vtt-drawer hook tests (e.g. `use-weapon-attack.test.ts`).
- Package-flow: client-only; no shared/server changes. The server messages stay as-is (they are correct developer/log copy); only the client display layer changes.

## Scope / caveats
- This is an error-copy/consistency finding, NOT a duplication or dead-code finding — both code paths are live and intentionally different copy strategies; it is therefore out of scope for `drift-ai-findings/` (which owns near-duplicate and dead-code work).
- Distinct from the agent-friction backlog (harness ergonomics) and from the planned useEffect guardrails / Storybook catalog / lint-debt drains — this touches none of those surfaces.
- Do NOT change the server-side messages or the `NOT_FOUND` mismatch semantics in `campaign-auth.ts` (see `docs/authorization.md`); the developer-facing strings are correct for logs and tests — only the client toast should stop echoing them.
- Keep the optimistic-update rollback intact; the risk here is regressing the snapshot restore while swapping the `onError` callback. If decoupling the rollback from `onTRPCError` proves awkward, leaving a one-line wrapper that calls both is acceptable.
- Smallest-possible blast radius: one mutation in one hook plus a new focused test; broader sweep of the 18-odd `"Failed to X"` hardcoded toasts is the parent adoption effort, not this leaf.

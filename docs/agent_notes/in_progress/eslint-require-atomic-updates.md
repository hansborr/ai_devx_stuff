# ESLint require-atomic-updates Adoption

> **Centralized backlog**: lint-related upcoming work lives in
> `docs/agent_notes/backlog/lint-hardening-cross-repo-review.md`. This
> leaf is landed and has no remaining work; it is retained for provenance
> and is referenced from that index under "Adjacent Active Work".

Status: Landed. `require-atomic-updates` is enabled globally.
Date: 2026-05-11
Source: `docs/agent_notes/in_progress/eslint-llm-core-evaluation.md`

## Goal

Enable core ESLint `require-atomic-updates` globally after fixing the current
baseline. Keep this as its own note because the findings are concurrency
behavior, not just lint-rule selection.

## Rule Shape

`require-atomic-updates` reports async/generator code that reads shared state,
crosses an `await` or `yield`, then writes back to that state. The default rule
also reports property writes on non-local objects, which is useful for server
boundaries where post-await writes can race with other handlers.

Start with the default global rule behavior. If one remaining property write is
intentionally safe after review, prefer a tight file/rule override with a
commented rationale over weakening the global option.

## Landed Findings

Fixed in this order; the server findings sit in the surface
`docs/CONCURRENCY.md` covers, while the e2e ones were test-state shape
cleanups.

### Real concurrency hazards (fix first)

- `packages/server/src/config/redis.ts`: `closeRedis()` now captures the
  client, clears `redisClient`, then awaits `quit()` so overlapping closes
  cannot both act on stale singleton state.
- `packages/server/src/socket/auth-middleware.ts`: auth middleware now assigns
  through a post-await `socketData` local instead of carrying a pre-await
  object path into the assignment.

### Test-state shape (fix second)

- `e2e/campaign-notes.spec.ts`: the edit test now captures the original title,
  updates shared state to the new title before awaited work, then keeps the
  edit -> read assertion against the shared title.
- `e2e/campaign-npcs.spec.ts`: same shape for `npcName` after the NPC edit
  workflow.

## See Also

- `docs/CONCURRENCY.md` — the policy surface the server findings sit in. Read
  before reshaping `redis.ts` or `auth-middleware.ts`.
- `docs/agent_notes/in_progress/eslint-llm-core-evaluation.md` — parent
  evaluation that proposed this leaf.

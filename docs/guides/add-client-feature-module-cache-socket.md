# Add A Client Feature Module With Cache And Socket State

Use this path when adding or changing a client feature module that owns tRPC
queries, TanStack Query cache updates, optimistic state, or socket-driven
refresh behavior.

1. Read the local `MODULE.md` before editing a feature directory. If the new or
   changed directory owns cache writes, socket invalidation, stores, or several
   related components, add or refresh its `MODULE.md` using
   `docs/module-docs.md` and run `bun run module:index`.
2. Keep the source of truth explicit. tRPC query results are canonical persisted
   state; socket events are freshness signals unless the payload is complete
   ephemeral data such as `notification:new`.
3. Derive query keys and filters through `useTRPC()` helpers:
   `queryOptions(...)`, `queryFilter(...)`, `infiniteQueryKey(...)`, or
   `infiniteQueryFilter(...)`. Do not hand-build production query keys.
   Repeated feature keys should live in a small local helper such as
   `packages/client/src/hooks/character-sheet/character-keys.ts`.
4. Put shared cross-feature invalidation in
   `packages/client/src/lib/query-invalidation.ts`. Put feature-specific
   optimistic patches and rollback helpers in the feature hook/module that owns
   the cached shape.
5. Wrap mutations with `useMutation(trpc.<router>.<procedure>.mutationOptions(...))`.
   On success or settle, invalidate every query surface that can display stale
   data. Use `useQueryInvalidation()` for shared campaign, encounter, map,
   character, chat, notes, and homebrew keys.
6. For optimistic updates, cancel the affected query, snapshot the old cache
   value, write a typed `setQueryData` updater, restore the snapshot on error,
   and invalidate on settle. Reuse existing local helpers such as
   `snapshotAndSet` / `restoreSnapshot` in `hooks/character-sheet/` when you
   are extending that module.
7. Keep direct socket listeners out of feature components. Components should
   consume hooks; socket connection state comes from `useSocket()`, and room
   membership belongs to `useCampaignPresence()`.
8. For persisted entity broadcasts, add or reuse the server broadcast path from
   `docs/guides/add-socket-broadcast.md`, then add client invalidation in
   `packages/client/src/hooks/realtime-invalidation.ts`. Filter events by the
   required campaign/entity ids, no-op when ids are missing, register listeners
   only while connected, and always unregister with the matching `socket.off`.
9. Add a reconnect path with `useSocketReconnection` for each socket
   invalidation hook. Reconnect should refetch the relevant query surfaces
   because broadcasts may have been missed while disconnected.
10. Use direct socket `setQueryData` only when the event payload contains the
    complete client cache item and a replay or duplicate can be handled locally.
    `useNotifications()` is the model: invalidate on connect, dedupe by id,
    then prepend the socket item to the cached list.
11. Keep transient UI state in the feature store or component state. If a
    mutation makes selected UI state invalid, clear that local state on success
    while still invalidating the server-backed query.
12. Add or update focused tests beside the hook or component. Use
    `createQueryWrapper()` for hook tests that need a `QueryClientProvider`,
    `renderWithProviders()` for components, `renderWizard()` for character
    wizard flows, and `@/test/mock-trpc.js` for mocked tRPC modules.
13. Socket/cache tests should cover listener registration and cleanup, null or
    disconnected socket no-ops, id filtering, invalidation counts or keys,
    reconnect invalidation, optimistic rollback, and duplicate handling for
    direct socket cache writes.
14. When the feature also adds a tRPC procedure or broadcast, follow
    `docs/guides/add-trpc-procedure.md` and
    `docs/guides/add-socket-broadcast.md` in the same change.
15. Run the focused client tests while iterating, then run
    `bun run verify:changed` before calling the change done.

Useful checks and examples:

- `packages/client/src/hooks/realtime-invalidation-*.test.ts` covers campaign,
  encounter, map, and character-sheet socket invalidation.
- `packages/client/src/hooks/use-notifications.test.ts` covers direct socket
  cache insertion and duplicate handling.
- `packages/client/src/hooks/character-sheet/*.test.ts*` covers optimistic
  cache updates, rollback, and conflict-visible behavior.
- `local/test-file-location` keeps new tests beside the code they exercise.

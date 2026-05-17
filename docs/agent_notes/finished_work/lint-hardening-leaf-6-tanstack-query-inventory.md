# Leaf 6 TanStack Query ESLint Inventory

Status: Pass 1 inventory captured on 2026-05-16.

## Probe

Installed root dev dependency:

- `@tanstack/eslint-plugin-query@5.100.10`

Temporarily added a client-only flat-config block for
`packages/client/**/*.{ts,tsx}` with all seven rules from
`pluginQuery.configs["flat/recommended"]` forced to `warn`, then ran:

```bash
bun run lint 2>&1 | tee /tmp/leaf6-pass1-lint.log
```

The probe produced 13 warnings across the seven recommended rules. The repo's
lint script still includes `--max-warnings=0`, so the captured log ends with
the expected warning-budget failure while the temporary config is present.

## Summary

| Rule | Count | Recommended severity | One-line summary |
| --- | ---: | --- | --- |
| `@tanstack/query/exhaustive-deps` | 7 | error | Test tRPC mock `queryOptions` builders close over values/functions that are not represented in their `queryKey`. |
| `@tanstack/query/no-rest-destructuring` | 0 | warn | No object rest destructuring of query results found. |
| `@tanstack/query/stable-query-client` | 0 | error | No unstable `QueryClient` construction found. |
| `@tanstack/query/no-unstable-deps` | 6 | error | React callbacks depend on whole `useMutation` result objects. |
| `@tanstack/query/infinite-query-property-order` | 0 | error | Infinite query option objects already satisfy the plugin's property order. |
| `@tanstack/query/no-void-query-fn` | 0 | error | No void-returning query functions found. |
| `@tanstack/query/mutation-property-order` | 0 | error | Mutation option objects already satisfy the plugin's property order. |

## `@tanstack/query/exhaustive-deps`

Count: 7 warnings.

Representative findings:

- `packages/client/src/test/mock-trpc-helpers.ts:8` - `makeListQuery` returns
  a `queryFn` that closes over `data`, but the mock key is only
  `["test", key]`.
- `packages/client/src/test/mock-trpc-helpers.ts:67` - `makeInfiniteQuery`
  uses the captured `getPage` callback while the key is built from input/key
  only.
- `packages/client/src/test/mock-trpc-magic-item.ts:69` - the magic-item list
  mock closes over `listData` while the key is `["test", "magicItem.list",
  input]`.
- `packages/client/src/test/mock-trpc-monster.ts:73` - the monster list mock
  has the same captured `listData` shape.
- `packages/client/src/test/mock-trpc.tsx:197` - the invite mock reads
  mutable test `state` from `queryFn`/`initialData` while the key contains only
  the campaign id.

The two remaining warnings are the same pattern in `mock-trpc.tsx` note and
inventory list mocks: local `listPage` helpers are used by `queryFn` and
`initialData` without being represented in the key.

## `@tanstack/query/no-unstable-deps`

Count: 6 warnings.

Representative findings:

- `packages/client/src/components/campaign/members/members-panel.tsx:126` -
  `handleAssign` depends on the whole `assignMutation` object.
- `packages/client/src/components/campaign/members/members-panel.tsx:131` -
  `handleUnassign` depends on the whole `unassignMutation` object.
- `packages/client/src/hooks/use-character-actions.ts:56` -
  `handleConfirmDelete` depends on the whole `deleteMutation` object.
- `packages/client/src/hooks/use-character-actions.ts:74` -
  `handleToggleVisibility` depends on the whole `visibilityMutation` object.
- `packages/client/src/hooks/use-notifications.ts:123` - `markRead` depends
  on the whole `markReadMutation` object.

The remaining warning is the same pattern for `markAllReadMutation` in
`packages/client/src/hooks/use-notifications.ts:128`.

## Plugin Compatibility Check

Commands run:

```bash
bun run code:intel -- def --name useQuery
bun run code:intel -- def packages/client/src/components/campaign/members/members-panel.tsx:92:27
bun run code:intel -- def packages/client/src/lib/trpc.ts:10:23
bun run code:intel -- exports packages/client/src/lib/trpc.ts
rg -n "trpc\\..*\\.queryOptions\\(" packages/client/src
rg -n "trpc\\..*\\.useQuery\\(" packages/client/src
```

Findings:

- Exact-name `useQuery` has no local definition; a positional lookup at a
  client call site resolves to TanStack React Query's `useQuery` declaration in
  `@tanstack/react-query@5.95.2`.
- `packages/client/src/lib/trpc.ts` exports `TRPCProvider`, `useTRPC`, and
  `useTRPCClient` from `createTRPCContext<AppRouter>()` in
  `@trpc/tanstack-react-query@11.15.1`.
- Production client usage consistently uses `const trpc = useTRPC()` plus
  `trpc.*.queryOptions(...)` passed to TanStack hooks such as `useQuery`,
  stored as an options variable, or spread into an options object with local
  fields such as `enabled`.
- `rg` found 67 raw `trpc.*.queryOptions(` matches under
  `packages/client/src` and 0 `trpc.*.useQuery(` matches. One of the
  `queryOptions` matches is a test comment; the rest are real source/test
  call sites.
- No rule fired in `packages/client/src/lib/trpc.ts`, so the real tRPC context
  wrapper is not itself a plugin false positive in this probe.
- `@tanstack/query/exhaustive-deps` does fire inside local test mock
  `queryOptions` definitions under `packages/client/src/test/mock-trpc*`.
  Treat those as mock-wrapper shape findings, not production query call-site
  bugs.

Compatibility verdict: the plugin recognizes the app's direct TanStack hook
usage around tRPC `queryOptions` well enough for an inventory pass. The only
wrapper-shaped findings are in test mocks that intentionally imitate tRPC's
queryOptions API.

## Triage Hints

- `@tanstack/query/no-unstable-deps`: clean and promote to error. The six
  findings are narrow production call-site cleanup: destructure stable
  mutation members such as `mutate`/status fields and depend on those instead
  of the whole mutation result object.
- `@tanstack/query/exhaustive-deps`: needs per-site investigation. Every
  finding is in test mock queryOptions builders, so Pass 2 should decide
  whether to make mock keys reflect the captured mock inputs/functions, narrow
  the rule away from test mocks, or add a documented helper-level exception.

## Revert Requirement

The TanStack Query probe block in `eslint.config.js` was reverted before the
Pass 1 commit. `git diff eslint.config.js` was empty after the revert.

Post-revert verification:

```bash
bun run lint -- --max-warnings=0
bun run typecheck
```

Both commands passed with the plugin installed but not wired into persistent
ESLint config.

## Implementation Result

Pass 2 landed the client-scoped TanStack Query plugin config with these final
severities:

| Rule | Final severity |
| --- | --- |
| `@tanstack/query/exhaustive-deps` | error |
| `@tanstack/query/no-rest-destructuring` | warn |
| `@tanstack/query/stable-query-client` | error |
| `@tanstack/query/no-unstable-deps` | error |
| `@tanstack/query/infinite-query-property-order` | error |
| `@tanstack/query/no-void-query-fn` | error |
| `@tanstack/query/mutation-property-order` | error |

The 6 `no-unstable-deps` findings were resolved by destructuring stable
mutation members before React callback dependency arrays.

The 7 `exhaustive-deps` test-mock findings used the primary key-fix approach:
captured mock data/state/function references are represented in mock
`queryKey`s. For object-shaped test keys that existing cache-seeding tests use,
captured functions are carried as object properties so the dependency is
visible to ESLint while TanStack's hash remains compatible with the existing
object key shape.

Net lint findings after implementation: 0.

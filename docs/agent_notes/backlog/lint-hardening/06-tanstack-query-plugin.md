# Leaf 6: TanStack Query Lint Plugin

Status: Landed (2026-05-16)
Depends on: Leaf 1 (zero-warning gate)

Dependency detail: the recommended preset includes at least one warning-
severity rule, so Leaf 1's `--max-warnings=0` behavior is what makes the
preset deterministic without rewriting upstream severities. Before Leaf 1,
only run inventory in a throwaway config.

## Problem

The client uses TanStack Query heavily for tRPC-backed queries and mutations.
`@tanstack/eslint-plugin-query` exists and catches AI-generated mistakes the
TypeScript compiler does not surface:

- Query functions that close over variables missing from the `queryKey`.
- Whole query or mutation result objects placed directly in React dependency
  arrays instead of destructured stable members.
- `QueryClient` instances created in unstable component positions.
- Query functions that return `void` (the resolved value is dropped).
- Rest destructuring and property-order issues that make query tracking or
  infinite/mutation options harder for the plugin to reason about.

Before this leaf, the plugin was not installed.

## Rule Goals

Enable the `flat/recommended` config under `packages/client/**/*.{ts,tsx}`.
The package also exposes legacy `recommended` / `recommendedStrict` config keys
for `.eslintrc`; do not use those legacy keys in Musi's flat
`eslint.config.js`. The plugin's actual rule set at the time of writing is:

| Rule | Recommended | Severity in recommended | Notes |
|---|---|---|---|
| `@tanstack/query/exhaustive-deps` | yes | error | Query fn deps must appear in `queryKey`. |
| `@tanstack/query/no-rest-destructuring` | yes | **warn** | Rest-destructuring of query results loses tracking. |
| `@tanstack/query/stable-query-client` | yes | error | `QueryClient` must not be re-created on every render. |
| `@tanstack/query/no-unstable-deps` | yes | error | Don't put whole query/mutation result objects in React dep arrays. |
| `@tanstack/query/infinite-query-property-order` | yes | error | Stable property order for `useInfiniteQuery`. |
| `@tanstack/query/no-void-query-fn` | yes | error | Query functions must return a value. |
| `@tanstack/query/mutation-property-order` | yes | error | Stable property order for mutations. |
| `@tanstack/query/prefer-query-options` | strict only | error | Use the `queryOptions({...})` helper instead of inline objects. |

Two implications:

1. The recommended preset ships `no-rest-destructuring` at `warn`. With
   `--max-warnings=0` (Leaf 1) this still fails the gate, but contributors
   reading the config should not be surprised.
2. `prefer-query-options` lives in the flat `flat/recommended-strict` config
   (legacy name: `recommendedStrict`). Evaluate separately. Musi's tRPC client
   returns `trpc.x.queryOptions(...)` already, so this rule is likely a net win
   — but inventory before promoting.

## Possible Outcomes

- **Adopt recommended.** Default expectation. Rules are correctness-focused
  and the inventory is likely small.
- **Adopt recommended + `prefer-query-options`.** Expected after the
  follow-up evaluation if tRPC integration is clean.
- **Adopt subset.** If `no-unstable-deps` or `exhaustive-deps` collides
  with a custom client wrapper, narrow the rule rather than disabling
  per-site.
- **Reject.** Unlikely. If the plugin cannot reason about Musi's tRPC
  wrappers at all, park with a recorded reason.

## Rollout

1. Install `@tanstack/eslint-plugin-query`. Add a scoped config block in
   `eslint.config.js` for client TS/TSX files using
   `pluginQuery.configs["flat/recommended"]`. Scope the emitted flat-config
   objects to `packages/client/**/*.{ts,tsx}` or manually copy the plugin/rules
   into an equivalent scoped block.
2. Run as inventory; expect findings concentrated around hooks built early in
   the project. Triage and fix.
3. Promote to `error` only after the inventory is empty. Scope-silence with
   `// eslint-disable-next-line <rule> -- <reason>` only where a stable
   reference cannot be lifted out (rare).
4. Cross-check the rule set against `packages/client/src/hooks/` for any
   custom query/mutation wrappers.
5. Separately evaluate `prefer-query-options` from
   `pluginQuery.configs["flat/recommended-strict"]`. Run as inventory, fix any
   inline-object patterns, promote.
6. Add to `docs/ai-harness.md`.
7. If any rule is dropped, deferred, subset-adopted, or fully adopted with
   caveats/scoped exceptions, record the verdict in
   `evaluation-verdicts.md`.

## Open Question

Does `@tanstack/eslint-plugin-query` interact with the tRPC client wrappers
generated from shared Zod schemas? Verify before promoting to `error` that
the plugin recognizes `trpc.*.queryOptions(...)` / `mutationOptions(...)`
shapes, or that any misses are limited to rules where the wrapper can be
handled with a narrow allowlist. `prefer-query-options` is the most
sensitive rule to this question because it specifically inspects the
options-object shape.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
- Targeted client tests for any hook reshaped during cleanup.
- If any rule is rejected, deferred, subset-adopted, or fully adopted with
  caveats/scoped exceptions, append a row to `evaluation-verdicts.md` before
  closing the leaf.

## References

- [TanStack Query ESLint plugin](https://tanstack.com/query/latest/docs/eslint/eslint-plugin-query)

## Implementation Result

Pass 2 landed `@tanstack/eslint-plugin-query@5.100.10` as a
`packages/client/**/*.{ts,tsx}` flat-config block.

| Rule | Final severity |
|---|---|
| `@tanstack/query/exhaustive-deps` | error |
| `@tanstack/query/no-rest-destructuring` | warn |
| `@tanstack/query/stable-query-client` | error |
| `@tanstack/query/no-unstable-deps` | error |
| `@tanstack/query/infinite-query-property-order` | error |
| `@tanstack/query/no-void-query-fn` | error |
| `@tanstack/query/mutation-property-order` | error |

Resolved counts: 6 `no-unstable-deps` findings in production client hooks and
7 `exhaustive-deps` findings in test tRPC mocks. The mock findings used the
primary approach: include captured references in mock query keys, with
object-key function dependencies represented as object properties where needed
to preserve existing TanStack cache hashes in tests.

Final lint baseline: 0 findings. `prefer-query-options` remains open for a
separate strict-config evaluation; it was not enabled in this pass.

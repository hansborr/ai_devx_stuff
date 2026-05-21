# Leaf 24 `@tanstack/query/prefer-query-options` Evaluation

Date: 2026-05-19
Branch: `feature/lint-tanstack-prefer-query-options`
HEAD: `1491cc83`

## Inventory

Temp config: `/tmp/tanstack-prefer-query-options.config.mjs`. It is a minimal
flat config using `createRequire("/workspace/package.json")`, enables only
`@tanstack/query/prefer-query-options` at `error`, scopes to
`packages/client/**/*.{ts,tsx}`, and ignores dist/tests:
`**/dist/**`, `*.test.*`, `*.spec.*`, `*.test-helper.*`, and
`packages/client/src/test/**`. It also defines disabled-rule plugin namespaces
and sets `reportUnusedDisableDirectives: "off"` so inline eslint comments do
not pollute the rule-only inventory.

Command:

```bash
time bunx eslint --config /tmp/tanstack-prefer-query-options.config.mjs --format=json --output-file /tmp/tanstack-prefer-query-options.json "packages/client/**/*.{ts,tsx}"
```

Runtime: `real 0m1.569s`.

Result: 360 files linted, 0 findings, 0 non-rule diagnostics.

Linted file coverage by directory:

| Directory | Files linted | Findings |
| --- | ---: | ---: |
| `packages/client/src/components` | 268 | 0 |
| `packages/client/src/hooks` | 36 | 0 |
| `packages/client/src/pages` | 17 | 0 |
| `packages/client/src/routes` | 16 | 0 |
| `packages/client/src/lib` | 15 | 0 |
| `packages/client/src` | 3 | 0 |
| `packages/client/src/stores` | 3 | 0 |
| `packages/client` | 2 | 0 |

Smoke check: stdin linting an inline `useQuery({ queryKey, queryFn })` sample
did report `@tanstack/query/prefer-query-options`, so the zero inventory is not
a dead config.

Supplemental all-client check: the existing TanStack block covers all
`packages/client/**/*.{ts,tsx}`, so I also ran a non-required
`/tmp/tanstack-prefer-query-options-all-client.config.mjs` without test
ignores. Runtime: `real 0m2.318s`. Result: 10 test-only findings under
`packages/client/src/components/vtt/drawer/**/*.test.tsx`.

## Current Query Shape

Production client source is already aligned with the helper style:

- `rg "queryOptions\\(|mutationOptions\\(|infiniteQueryOptions\\("` finds 159
  production helper call sites under `packages/client/src`.
- `rg "queryFn:"` finds 0 production query functions outside tests.
- `rg "useMutation\\(\\s*\\{"` finds 0 production inline mutation objects.
- Inline `useQuery({ ... })` production sites spread tRPC helper output and add
  local options, for example:

```ts
const mapQuery = useQuery({
  ...trpc.map.get.queryOptions({ id: mapId ?? "" }),
  enabled: hasMap,
});
```

The rule correctly leaves those helper-spread sites alone.

## Classification

Required production inventory:

| Category | Findings |
| --- | ---: |
| Inline query-options that should adopt `queryOptions(...)` | 0 |
| tRPC helper-compatible rewrites | 0 |
| False positives around tRPC wrappers | 0 |
| Style churn only | 0 |
| Real correctness wins | 0 |

Supplemental all-client findings, relevant to adopting in the existing block:

| Category | Findings |
| --- | ---: |
| Inline query-options that should adopt `queryOptions(...)` | 0 |
| tRPC helper-compatible rewrites | 10 |
| False positives around tRPC wrappers | 0 |
| Style churn only | 0 |
| Real correctness wins | 0 current bugs; 10 cache-key drift preventions |

All 10 supplemental findings are test cache seeding/default calls that type the
mock tRPC query key by hand. They are not production false positives.

Representative samples:

| File | Original code | Rule wants | Judgement |
| --- | --- | --- | --- |
| `cast-rail.test.tsx` | `queryClient.setQueryData(["test", "character.get", character.id], character);` | `trpc.character.get.queryOptions({ id: character.id }).queryKey` | Correct. The component queries the same tRPC helper. |
| `cast-rail.test.tsx`, `spells-tab.test.tsx`, `stats-tab.test.tsx` | `queryClient.setQueryData(["test", "characterSpell.list", characterId], options.spells);` | `trpc.characterSpell.list.queryOptions({ characterId }).queryKey` | Correct and mechanical; removes repeated manual mock keys. |
| `confirm-cast-strip.test.tsx` | `queryClient.setQueryData(["test", "map.get", options.map.id], options.map);` | `trpc.map.get.queryOptions({ id: options.map.id }).queryKey` | Correct; production already uses the tRPC map helper. |
| `actions-tab.test.tsx` | `["test", "inventory.list", { characterId, itemType: "weapon", limit: 100 }]` | `trpc.inventory.list.queryOptions({ characterId, itemType: "weapon", limit: 100 }).queryKey` | Correct and higher value than style; the mock inventory key shape is helper-built. |
| `player-sheet-drawer.test.tsx` | `queryClient.setQueryDefaults(["test", "character.get", characterId], { queryFn: ... })` | `trpc.character.get.queryOptions({ id: characterId }).queryKey` | Correct; keeps the error-default seed tied to the drawer query helper. |

## Recommendation

Recommendation: **ADOPT**, after one small migration commit drains the 10
test-only manual query-key findings. Do not scope the rule to production only;
the test findings are legitimate tRPC helper-compatible rewrites and are small.

Exact rule config to add after the test migration:

```js
{
  files: ["packages/client/**/*.{ts,tsx}"],
  plugins: { "@tanstack/query": pluginQuery },
  rules: {
    "@tanstack/query/exhaustive-deps": "error",
    "@tanstack/query/no-rest-destructuring": "warn",
    "@tanstack/query/stable-query-client": "error",
    "@tanstack/query/no-unstable-deps": "error",
    "@tanstack/query/infinite-query-property-order": "error",
    "@tanstack/query/no-void-query-fn": "error",
    "@tanstack/query/mutation-property-order": "error",
    "@tanstack/query/prefer-query-options": "error",
  },
}
```

Migration commit plan:

1. In these six files, replace manual `["test", ...]` query keys with keys
   derived from the matching mock tRPC `queryOptions(...)` result:
   `cast-rail.test.tsx`, `confirm-cast-strip.test.tsx`,
   `player-sheet-drawer.test.tsx`, `actions-tab.test.tsx`,
   `spells-tab.test.tsx`, and `stats-tab.test.tsx`.
2. Add `@tanstack/query/prefer-query-options: "error"` to the existing client
   TanStack Query ESLint block.
3. Verify with the focused drawer tests plus `bun run lint -- --max-warnings=0`
   and `bun run verify:changed`.

Verdict register: no row needed if adopted as above; the register only asks for
reject, defer, subset adoption, or full adoption with scoped caveats.

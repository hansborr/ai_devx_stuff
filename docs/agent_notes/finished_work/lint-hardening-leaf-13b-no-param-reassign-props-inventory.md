# Leaf 13b Inventory: no-param-reassign / props true

Status: Resolved — verdict in register entry dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-13b-no-param-reassign-props.
Throwaway config: /tmp/eslint-no-param-reassign-props.config.js
(not committed).

Scope: `scripts/**/*.ts`, `packages/client/src/**/*.{ts,tsx}`,
`packages/server/src/**/*.ts`, and `packages/shared/src/**/*.ts`,
excluding tests under `packages/*/src/**/__tests__/**`, `*.test.ts`,
and `*.spec.ts`. The test-only helper
`packages/client/src/test/mock-trpc.tsx` remains in scope because it
mocks shared state intentionally.

## Resolution

- Verdict: `no-param-reassign` with `{ props: true }` **deferred** for
  this scope. All 17 findings are deliberate mutation boundaries:
  helper parser state, Canvas 2D drawing state, accumulator/cache
  containers, Prisma update input assembly, or mock fixture state.
- No production code or eslint.config.js changes landed; the default
  `no-param-reassign` rule with `props: false` remains adopted from
  Leaf 10, and the stricter `{ props: true }` option stays off.
- No obvious 1-2 line bug-prevention rewrite fell out of the
  inventory. Adopting the option now would require broad inline
  disables or churny return-new-state rewrites around intentional
  helper/API patterns.

## Summary

- Total findings: 17
- intentional-helper-state: 9
- canvas-mutation: 4
- accumulator: 2
- prisma-update-input: 1
- mock-state: 1
- other: 0

Config note: the final probe used the throwaway `/tmp` config requested
for this leaf:

```bash
bun run eslint --config /tmp/eslint-no-param-reassign-props.config.js \
  "scripts/**/*.ts" \
  "packages/client/src/**/*.{ts,tsx}" \
  "packages/server/src/**/*.ts" \
  "packages/shared/src/**/*.ts"
```

The run reported 17 errors and 0 warnings, matching the expected current
total for this branch.

## Findings

### intentional-helper-state

- `scripts/code-intel/cli-args.ts:207` — CLI dependents option parsing
  uses a small `state` struct passed through option consumers. Brief
  excerpt:

  ```ts
  if (option.name === "--exclude-tests") {
    ensureFlagHasNoValue(option);
    state.excludeTests = true;
  ```

- `scripts/code-intel/cli-args.ts:212` — the same dependents parser
  stores the parsed depth before returning the next argv index. Brief
  excerpt:

  ```ts
  const parsed = readOptionValue(option, args, index, "--depth requires a positive integer.");
  state.depth = parseDepth(parsed.value);
  return parsed.nextIndex;
  ```

- `scripts/code-intel/cli-args.ts:217` — the same dependents parser
  stores the parsed limit in the helper state. Brief excerpt:

  ```ts
  const parsed = readOptionValue(option, args, index, "--limit requires a non-negative integer.");
  state.limit = parseLimit(parsed.value);
  return parsed.nextIndex;
  ```

- `scripts/code-intel/cli-args.ts:227` — the same dependents parser
  stores the parsed package filter in the helper state. Brief excerpt:

  ```ts
  );
  state.project = parseProjectFilter(parsed.value);
  return parsed.nextIndex;
  ```

- `scripts/code-intel/cli-args.ts:303` — CLI tests option parsing uses
  the same small state-struct consumer pattern. Brief excerpt:

  ```ts
  if (option.name === "--direct") {
    ensureFlagHasNoValue(option);
    state.direct = true;
  ```

- `scripts/code-intel/cli-args.ts:308` — the tests parser stores the
  parsed depth in the helper state. Brief excerpt:

  ```ts
  const parsed = readOptionValue(option, args, index, "--depth requires a positive integer.");
  state.depth = parseDepth(parsed.value);
  state.depthSpecified = true;
  ```

- `scripts/code-intel/cli-args.ts:309` — the tests parser tracks that
  depth was explicitly supplied, using the same helper state. Brief
  excerpt:

  ```ts
  state.depth = parseDepth(parsed.value);
  state.depthSpecified = true;
  return parsed.nextIndex;
  ```

- `scripts/code-intel/cli-args.ts:314` — the tests parser stores the
  parsed limit in the helper state. Brief excerpt:

  ```ts
  const parsed = readOptionValue(option, args, index, "--limit requires a non-negative integer.");
  state.limit = parseLimit(parsed.value);
  return parsed.nextIndex;
  ```

- `scripts/code-intel/cli-args.ts:324` — the tests parser stores the
  parsed package filter in the helper state. Brief excerpt:

  ```ts
  );
  state.project = parseProjectFilter(parsed.value);
  return parsed.nextIndex;
  ```

The CLI option consumers mutate a local parse-state struct while walking
argv. Returning a fresh state object from every branch would add churn
without preventing a bug identified by this inventory.

### canvas-mutation

- `packages/client/src/components/campaign/maps/fog-overlay.tsx:113` —
  Canvas 2D drawing state is intentionally set before painting fog.
  Brief excerpt:

  ```ts
  ctx.save();
  ctx.fillStyle = opts.fogColor;
  ctx.globalAlpha = opts.fogOpacity;
  ```

- `packages/client/src/components/campaign/maps/fog-overlay.tsx:114` —
  Canvas alpha state is intentionally set from the fog opacity. Brief
  excerpt:

  ```ts
  ctx.fillStyle = opts.fogColor;
  ctx.globalAlpha = opts.fogOpacity;
  ctx.fillRect(0, 0, opts.totalW, opts.totalH);
  ```

- `packages/client/src/components/campaign/maps/fog-overlay.tsx:116` —
  Canvas compositing state is intentionally switched to carve reveal
  regions out of the fog. Brief excerpt:

  ```ts
  ctx.fillRect(0, 0, opts.totalW, opts.totalH);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ```

- `packages/client/src/components/campaign/maps/fog-overlay.tsx:117` —
  Canvas alpha is intentionally reset before drawing reveal rectangles.
  Brief excerpt:

  ```ts
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  for (const r of opts.regions) {
  ```

There is no return-new-state shape for these assignments; mutating the
context properties is the CanvasRenderingContext2D API.

### accumulator

- `scripts/code-intel/project-cache.ts:67` — lazy cache initialization
  stores the reference project on the passed cached entry. Brief
  excerpt:

  ```ts
  if (!cached.referenceProject) {
    cached.referenceProject = this.buildReferenceProject(this.repoRoot);
  }
  ```

- `scripts/code-intel/source-project.ts:170` — compiler path
  collection appends a unique path value into a passed accumulator
  object. Brief excerpt:

  ```ts
  const existing = compilerPaths[key] ?? [];
  if (!existing.includes(value)) compilerPaths[key] = [...existing, value];
  ```

Both sites are accumulator/cache-building helpers. They could be
rewritten to return new containers, but that would trade straightforward
builder code for style churn rather than bug prevention.

### prisma-update-input

- `packages/server/src/services/level-up/asi.ts:93` — dynamic Prisma
  update input assembly writes validated ability-score keys into the
  caller-provided update object. Brief excerpt:

  ```ts
  // type-assertion-boundary: prisma - Prisma's CharacterStatsUpdateManyMutationInput is field-typed (strength/dexterity/etc.), but we're writing dynamic keys from abilityDeltas; the runtime invariant matches the same AbilityScores keys narrowed above.
  (data as Record<string, unknown>)[key] = next;
  ```

The assignment is already documented as a Prisma type boundary: the
runtime keys are narrowed by `abilityDeltas`, while Prisma's generated
input type is field-shaped.

### mock-state

- `packages/client/src/test/mock-trpc.tsx:193` — the test-only tRPC mock
  records invite creation in shared fixture state. Brief excerpt:

  ```ts
  create: makeMutation("invite.create", () => {
    state.createdInvite = CREATED_INVITE;
    return Promise.resolve(CREATED_INVITE);
  ```

This helper intentionally models mutation side effects so client tests
can observe mock invite state.

### other

No findings.

## Recommended next step

"Defer `no-param-reassign` with `{ props: true }` — all 17 current findings are intentional canvas/API/helper-state/Prisma/mock mutations, so enabling it would mostly add suppressions or style rewrites with no surfaced bug-prevention value."

The current distribution has no genuine bug or small production cleanup
candidate. Revisit only if a future postmortem identifies parameter
property mutation as a recurring bug class, or if a narrower local rule
can exempt Canvas/Prisma/mock/helper-state mutation boundaries cleanly.

# 40. `no-restricted-syntax` overlays clobber by flat-config replacement — the config test admits the blind spot; make composition additive

Status: Step 1 done — selector-presence test upgrade landed; Step 2 builder design recorded and implementation remains out of scope.
Lens: config architecture · Area: flat-config composition · Severity: med · Size: S + L (split 2026-07-04) · Confidence: high
Theme: config-ordering · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
Flat config replaces (not merges) rule entries by key, so every config group
that wants `no-restricted-syntax` for a file family must repeat the *entire*
selector array for any overlapping family — currently done by hand in at
least four places (server files, server routers, shared schemas, env/main
process-primitives), each with a warning comment. The guard test itself
admits the hole: a new `no-restricted-syntax` block placed *before* the
process-primitive block is "silently clobbered for code files rather than
caught." That is a policy-loss failure mode waiting for the next fence
(exactly how the raw-SQL fence of leaf 30 could silently vanish for a
subdirectory).

## Evidence
- `eslint-config/package-boundary-configs.js:118-124,220-225,235-241,248` — repeated full arrays with "flat config replaces" comments. Verified 2026-07-04.
- `eslint-rules/restricted-syntax-and-globals-config.test.js:18-21` — the admitted ordering blind spot.

## Proposed direction
Split (2026-07-04 review) — most of the safety value is in the test:
1. **Test upgrade first (S, standalone):** make the real-config test assert
   *presence of selector ids per representative file* (via
   `--print-config`-style resolution) instead of trusting block order. This
   alone closes the "silently clobbered" detection blind spot, with no
   refactor risk.
2. **Composition builder (DESIGN-GATED):** each policy declares
   `{ id, files, selectors[] }`; a builder computes, per distinct
   file-family intersection, the union of applicable selector arrays and
   emits the final configs in one place. Removes the duplicated arrays,
   makes ordering irrelevant, and turns "new fence" into a one-object diff.
   Record the design decision here before starting.

## Scope / caveats
- Keep generated output inspectable (the builder should be data-in,
  config-out with no conditionals beyond glob math) — copyability is a goal
  for this repo's config layer.
- Verify the emitted configs byte-match current resolution for a
  representative file set before/after (snapshot the `--print-config` rule
  entry) so the refactor is provably behavior-neutral.
- Two commits: (1) test upgrade; (2) builder + migration of the existing
  four sites, only after its design note is recorded here.
- Step 1's landed test intentionally trades the old exact selector-count pin
  for a required-selector drop-detection matrix by representative file. That
  catches clobbered/missing policy fences directly, but a stray extra selector
  is no longer rejected solely because the array length changed; Step 2's
  design-gated builder is the place to make additive composition exact.

## Step 2 builder design

Recorded plan only — no implementation in this commit.

### Current seams to preserve

Re-verified against the current tree before recording this design:

- `eslint-config/shared-policy.js:116-126` owns the process selector objects
  (`process.exit`, `process.env`) that multiple config modules repeat.
- `eslint-config/script-configs.js:90-132` defines the broad process-primitive
  rule plus boundary overrides where all or part of that selector family drops.
- `eslint-config/package-boundary-configs.js:112-124` repeats process selectors
  beside shared-schema permissiveness selectors.
- `eslint-config/package-boundary-configs.js:206-248` repeats process selectors
  beside raw-SQL and tRPC-output selectors, with `config/env.ts` and `main.ts`
  keeping raw-SQL restrictions while dropping process-primitive restrictions.
- `eslint-config/client-configs.js:178-203` repeats process selectors beside
  client query-key and `import.meta.env` selectors.
- `eslint-rules/restricted-syntax-and-globals-config.test.js:196-214` is the
  Step 1 drop-detection matrix: it asserts required selector families are
  present for representative files, but intentionally does not reject extra
  selector families by count.

### API shape

Add a small builder module, proposed name
`eslint-config/restricted-syntax-builder.js`, with three data constructors and
one emitter:

```js
const selectors = defineRestrictedSyntaxSelectors({
  "process.exit": processExitRestrictedSyntax,
  "process.env": processEnvRestrictedSyntax,
  "raw-prisma-sql": rawPrismaSqlRestrictedSyntax,
  "shared-schema-z-any": sharedSchemaZAnyRestrictedSyntax,
  "trpc-output-permissive": permissiveTrpcOutputRestrictedSyntax,
  "client-query-key-array": clientQueryKeyRestrictedSyntax,
  "import-meta-env": importMetaEnvRestrictedSyntax,
});

const policies = [
  restrictedSyntaxPolicy({
    id: "process-primitives",
    files: codeFiles,
    ignores: [...eslintConfigJsFiles, ...tsConfigFiles],
    selectors: ["process.exit", "process.env"],
  }),
  restrictedSyntaxPolicy({
    id: "server-raw-sql",
    files: ["packages/server/src/**/*.ts"],
    ignores: serverRawSqlAllowedFiles,
    selectors: ["raw-prisma-sql"],
  }),
  restrictedSyntaxPolicy({
    id: "router-output-shape",
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    selectors: ["trpc-output-permissive"],
  }),
];

const exceptions = [
  restrictedSyntaxException({
    id: "test-env-boundaries",
    files: testAndHelperFiles,
    remove: ["process.env"],
  }),
  restrictedSyntaxException({
    id: "server-bootstrap-process-boundaries",
    files: ["packages/server/src/config/env.ts", "packages/server/src/main.ts"],
    remove: ["process.exit", "process.env"],
  }),
];

export const restrictedSyntaxConfigs = buildRestrictedSyntaxConfigs({
  selectors,
  policies,
  exceptions,
  order: [
    "process.exit",
    "process.env",
    "raw-prisma-sql",
    "shared-schema-z-any",
    "trpc-output-permissive",
    "client-query-key-array",
    "import-meta-env",
  ],
});
```

The builder should treat selector ids as the source of truth. A policy only
adds selector ids for a file family; an exception only removes selector ids for
a narrower file family. The emitter computes the final selector-id set for each
distinct file-family intersection, sorts by the explicit `order`, and emits
ordinary flat-config objects with:

```js
rules: { "no-restricted-syntax": ["error", ...selectorObjects] }
```

If an exception leaves a family with no selectors, emit
`"no-restricted-syntax": "off"` only for that exact family. That preserves the
current boundary shape where named bootstrap/config/test files deliberately
drop process selectors without accidentally dropping independently applicable
raw-SQL or client selectors.

### Guarantees

The builder must preserve Step 1's guarantees by making the Step 1 matrix
derive from the builder's selector ids, not from hand-maintained duplicate
arrays. For every representative file, the resolved config must still include
all selector ids the matrix currently requires: process primitives in normal
code, raw SQL in server source and routers, permissive output guards in router
source, shared-schema permissiveness guards in shared schemas, and client
query/import-meta guards in client source.

The builder must also close Step 1's recorded limitation. The future test should
compare the exact resolved selector-id set for each representative file, not
only `some(...)` presence. A stray extra selector becomes a real diff because
it either appears in the exact-id snapshot or fails builder validation as an
unknown/unordered selector id.

### Validation rules

The builder should fail fast before exporting configs when:

- a selector id is declared twice;
- a policy references an unknown selector id;
- an exception removes an unknown selector id;
- a selector id is missing from `order`;
- a generated file-family intersection would emit duplicate selector ids;
- an exception targets files broader than the policy family it intends to
  narrow, unless it is explicitly marked as a global exception.

Keep the generated config inspectable: the emitted objects should contain plain
`files`, `ignores`, and `rules` fields only. Do not hide behavior in predicate
functions inside the flat config.

### Acceptance tests for implementation

1. Unit-test the builder with synthetic overlapping policies:
   `process-primitives` + `server-raw-sql` + `router-output-shape` must produce
   a router family containing the union of all three selector groups in stable
   order.
2. Unit-test exceptions: a test/helper family removes `process.env` but keeps
   `process.exit`; `config/env.ts` and `main.ts` remove process selectors while
   preserving raw-SQL selectors.
3. Update the real-config Step 1 matrix so each representative file asserts the
   exact selector-id set. This restores the old exact-count protection without
   reintroducing hand-count fragility.
4. Add a regression where a new synthetic policy applies to a subdirectory
   already covered by process primitives; the resolved selector set must include
   both the synthetic selector and the existing process selectors.
5. Add a static smoke that `rg '"no-restricted-syntax": \[' eslint-config`
   finds only builder output/fixtures after migration, not ad hoc repeated
   arrays in config modules.
6. Before migration, capture current resolved selector-id snapshots for the
   representative files. After migration, the same snapshots must be
   byte-identical except for any intentionally documented selector-id rename.

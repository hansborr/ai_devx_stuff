# 40. `no-restricted-syntax` overlays clobber by flat-config replacement — the config test admits the blind spot; make composition additive

Status: **Step 1 and step 2 both done** (step 2 landed 2026-07-25 on
`refactor/restricted-syntax-builder`). Tracked as `F5` in
`../ready-2026-07/00-index.md` §1. See "Step 2 as built" at the end of this
leaf for what shipped and where it departs from the recorded design.

> **2026-07-25 dispatch notes.** No further design round: implement the design
> below as written. The duplication it targets has grown since it was recorded
> — 11 `no-restricted-syntax` entries across three config modules, including a
> hand-written "repeat…" comment at `package-boundary-configs.js:256-257` added
> *after* this design. Acceptance test #6 (before/after byte-identical
> resolved-selector snapshots) is what makes the refactor provably
> behavior-neutral; do not skip it. Size is **M**, not the recorded L — step 1
> already landed the matrix that anchors the parity proof.
>
> Line refs drifted ~+20: `package-boundary-configs.js` 118-124/220-225/235-241/248
> → 141-146/243-248/256-264/271; `shared-policy.js:116-126` → `:186-197`;
> `script-configs.js:90-132` → `:150-200`. The quoted blind-spot comment
> ("silently clobbered for code files rather than caught") no longer exists —
> step 1 replaced it with the matrix rationale.
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

## Step 2 as built (2026-07-25)

Landed as three commits on `refactor/restricted-syntax-builder`: the pre-change
resolution pin, the builder, then the migration.

### What shipped

- `eslint-config/restricted-syntax-builder.js` — the engine. Constructors are
  the recorded ones (`defineRestrictedSyntaxSelectors`,
  `restrictedSyntaxPolicy`, `restrictedSyntaxException`,
  `buildRestrictedSyntaxConfigs({ selectors, policies, exceptions, order })`).
- `eslint-config/restricted-syntax-policy.js` — the data. Every selector object
  in the repo now lives here once; the three config modules no longer own any.
- `eslint.config.js` spreads `restrictedSyntaxConfigs` where
  `processPrimitiveConfigs` used to sit; no other config group sets the rule key.

### Deltas from the recorded design

1. **Families are a tree, not a free lattice.** Each policy/exception declares
   `within: <parentId>`. A node's emitted `files` is the intersection of its own
   patterns with every ancestor's (flat config ANDs the patterns inside a nested
   array) and its `ignores` is the union along that chain, so a child family is
   a subset of its parent *by construction*. Nodes emit parent-first, and any
   two families that are not an ancestor/descendant pair must be **provably
   disjoint** (three sound proofs: one family's patterns listed verbatim in the
   other's ignores; a literal-path family with no member inside the other; or
   prefix-incomparable static glob prefixes). Enumerating every intersection of
   N policies instead would have emitted ~30 config objects for 9 real families,
   against this leaf's own "keep generated output inspectable" constraint.
2. **Selector ids are 1:1 with selector objects**, so the recorded
   `client-query-key-array` id became `query-key-array-property` and
   `query-client-array-key-argument` (that policy always contributed two
   objects). `order` has eight ids, and it reproduces every pre-existing site's
   selector order exactly.
3. **Three exceptions, not two.** The recorded `server-bootstrap-process-boundaries`
   is split from the script/prisma boundary list, because the old single "off"
   block spanned two different families: files under the raw-SQL policy (which
   must keep that fence — the old `config/env.ts`/`main.ts` re-add block) and
   files under process-primitives only (which resolve fully off).
4. **Two extra validations** beyond the recorded six: an ambiguous-overlap check
   (the laminarity guard above) and a dead-removal check (an exception removing
   a selector its family never applies).
5. `no-restricted-syntax: "off"` is emitted as the bare severity string, not
   `["off"]`. Flat config keeps the inherited options when only a severity is
   given, so the boundary files still resolve to `[0, process.exit, process.env]`
   exactly as before.
6. Three policies had their `ignores` widened with `testAndHelperFiles` so the
   cross-cutting test/helper exception is provably disjoint from them. Inert for
   every tracked file (see the parity proof below), because the per-package
   test/helper lists already covered every test file that exists — but **not**
   inert for files added later; see "Recorded policy change" under step 3.

### Parity proof

`ESLint.calculateConfigForFile` was run over **every tracked lintable file**
(2639 of them) before and after the migration: the resolved
`no-restricted-syntax` entry — severity, selector objects, messages, order — is
**byte-identical for 2639/2639**. The committed
`eslint-rules/restricted-syntax-resolution.snapshot.json` pins 29 representative
files from that pre-change run and is asserted by
`eslint-rules/restricted-syntax-resolution-snapshot.test.js`.

## Step 3: pre-land review fixes (2026-07-25)

Three-model review of the step-2 branch (Codex "land after these fixes", Opus
"land as is" + one P1 follow-up, Grok "land as is"), applied on
`refactor/restricted-syntax-builder-fixes`.

### Recorded policy change: test and helper files take the test carve-out everywhere

Step 2's delta 6 called the `testAndHelperFiles` widening inert. It is inert for
every tracked file, but it **is** a semantic change for files added later, and
that is now a recorded decision rather than a side effect of a tool constraint.

What changes, measured by resolving synthetic paths through `main`'s config and
this branch's with `ESLint.calculateConfigForFile`:

| path (none exist yet) | before | after |
| --- | --- | --- |
| `packages/server/src/routers/*.spec.ts` | `process.exit`, `process.env`, `raw-prisma-sql`, `trpc-output-permissive` | `process.exit` |
| `packages/server/src/routers/**/test/*.ts` | same four | `process.exit` |
| `packages/shared/src/schemas/*.spec.ts` | `process.exit`, `process.env`, `shared-schema-z-any` | `process.exit` |
| `packages/shared/src/schemas/*test-helper*.ts` | same three | `process.exit` |

The old behavior was an artifact of block order, not a policy: the package
fences were spread *after* the test carve-out and spelled their test ignores as
`**/*.test.ts`, so `routers/foo.spec.ts` was fenced while the sibling
`services/foo.spec.ts` was not. The new behavior is uniform — a test or helper
file takes the test carve-out whichever package directory it lands in.

Keeping the old behavior was checked first and rejected on evidence. For two
glob families the builder's only applicable disjointness proof is "one family's
file patterns appear verbatim in the other's `ignores`", which has exactly two
directions. Dropping the widening is rejected outright
(`server-raw-sql`/`test-env-boundaries` "neither nested nor provably
disjoint"), as is every partial variant; the one alternative that builds
excludes whole packages from `test-env-boundaries` instead, which strips the
`process.env` carve-out from **585 tracked test and helper files**. Reproducing
the old `.spec`-vs-`.test` asymmetry exactly would mean hand-partitioning globs
to encode an ordering accident.

Pinned by the synthetic `.spec`/helper resolution cases in
`eslint-rules/restricted-syntax-and-globals-config.test.js`
("gives future test and helper files the test carve-out in every package
family"). `calculateConfigForFile` resolves non-existent paths, so the pin needs
no fixture files.

### Other fixes applied in the same round

- **Negated patterns are rejected.** Every disjointness proof assumed positive
  patterns (`familyMatches` treats any matching ignore as final;
  `provablyDisjoint` compares ignores by string equality), but ESLint re-includes
  after a negated ignore, so `["foo/**/*.test.ts", "!foo/special.test.ts"]` would
  be accepted as disjoint from a sibling owning the first pattern and then
  resolve by emission order. `files` and `ignores` now reject `!` at declaration
  time rather than modelling ordered ignore semantics.
- **Family liveness is asserted.** The builder is filesystem-free, so a typo'd
  glob builds clean and enforces nothing — and the prefix proof rewards it,
  since a misspelled directory is trivially disjoint from everything. Two tests
  now assert every emitted family is the deepest match for at least one
  non-ignored tracked file, and that every literal path exists. Mutation-checked
  against a dead fence: it is the only failure in the project.
- **The sole-ownership guard covers the root config.** It scanned only
  `eslint-config/*.js` and only the double-quoted spelling, so an entry in
  `eslint.config.js` — the one place that clobbers the composed policy outright
  — bypassed it.
- **Two rejections gave unactionable advice.** A family nested under a terminal
  exception, and an overlap with a `global: true` exception, both now name the
  policy-plus-nested-exception restructure; the overlap error also says the
  `ignores` proof needs verbatim patterns.
- **`intersectFileGroups` no longer restates ancestor globs** that a literal
  child path already satisfies (emitted output 152 to 98 lines, resolution
  unchanged).
- **Documentation**: `docs/guides/add-restricted-syntax-fence.md`, registered in
  the `docs/ai-harness.md` guides table and cross-linked from `lint-overview.md`.
  Nothing previously pointed at the builder.
- `docs/generated/lint-coverage-map.md` said 49 `eslint-rules/*.test.js`; there
  are 48. The count column is hand-maintained and unchecked.

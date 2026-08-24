# 11 — Type successful shared-schema fixtures

Status: Implemented — 2026-07-22
Date: 2026-07-21
Priority: P2
Size: L
Risk: medium

> Owner decision 2026-07-22: approved at full scope, including the
> repository-wide migration and global retirement of the ambiguous
> `expectParseSuccess` name; do not substitute a deprecated-alias variant.
> Accepted on code-quality grounds, not only gate timing: declarative call
> sites plus typed positive fixtures that serve as contract documentation.

## Problem

Expected-success shared-schema tests commonly pass an untyped object to
`schema.safeParse(...)` and only then give the result to `expectParseSuccess`.
Because Zod accepts `unknown` at that runtime boundary, TypeScript never checks
that the fixture still satisfies the schema input. Adding a required contract
key can therefore leave a positive fixture stale until Vitest runs.

Commit `81335a14` made `encounterDetailSchema.activeTurnOrigin` required and
nullable. The untyped `validEncounter` embedded in `combat-action.test.ts`
remained typecheck-green but failed at the full land gate; follow-up `533eb08a`
repaired it. The full gate prevented integration, but the feedback arrived much
later than the shared typecheck slot.

The current helper also serves a different, valid seam: wrapper APIs such as
`validateHomebrewData(...)` deliberately accept `unknown` and return a
safe-parse-shaped result without exposing the selected schema. Those tests
cannot use a schema-and-input helper and still need issue-rich success
assertions. The fix must distinguish direct schema fixtures from result-only
wrapper contracts instead of banning the latter.

## Verified evidence

- `packages/shared/src/schemas/encounter.ts` defines `activeTurnOrigin` as a
  required nullable key on `encounterDetailSchema`.
- `packages/shared/src/schemas/combat-action.test.ts` defines the untyped
  `validEncounter`, documents the blind spot beside the repaired key, and
  embeds it in an expected-success `attemptAttackResponseSchema` parse.
- `packages/shared/src/test/parse-helpers.ts` accepts only an already-produced
  `z.ZodSafeParseResult<T>`. At that point the original input type has been
  erased to `unknown`.
- `validateHomebrewData` in `packages/shared/src/schemas/homebrew.ts` accepts
  unknown data and returns `HomebrewDataValidation`; its many positive tests
  are legitimate result-only consumers.
- `packages/shared/src/test/parse-helpers.test.ts` pins parsed-value return,
  issue-rich diagnostics, and custom messages that both named success helpers
  must preserve.
- `packages/shared/tsconfig.json` includes all `src`, so compile-time fixture
  checks participate in shared typecheck.
- Shared schema tests have broad usage of the ambiguous helper: the 2026-07-21
  triage found roughly 380 calls across 26 files, including direct `safeParse`
  calls, one-hop result variables, and wrapper results. This is an L-sized
  classification and migration, not a helper-only M change.
- Existing selection is not the defect. The verified reproduction

  ```sh
  bash scripts/vitest.sh list --project=shared --changed 81335a14^ \
    --reporter=verbose | rg 'encounter.test|combat-action.test'
  ```

  selects both the directly changed schema test and the transitive
  `combat-action.test.ts` fixture. `scripts/test-changed.sh` already delegates
  shared changes to Vitest's changed graph.
- Fast-commit skips test and scripts slots, while typecheck remains enabled via
  `harness.controls.json` and `scripts/verify/steps.generated.sh`. Moving the
  invariant into TypeScript gives earlier feedback without changing that
  policy.

Source: `/home/node/persist/musi/pain_points/focused-verification-gaps.md` and
`/home/node/.claude/projects/-workspace/memory/autonomous-drain-lane-recipe.md`.
No existing backlog leaf owns this fixture boundary.

## Helper contract

Add a schema-aware positive helper:

```ts
export function expectSchemaParseSuccess<TSchema extends z.ZodType>(
  schema: TSchema,
  input: NoInfer<z.input<TSchema>>,
  message?: string,
): z.output<TSchema> {
  return expectParseResultSuccess(schema.safeParse(input), message);
}
```

`NoInfer` is load-bearing: the first argument selects the schema and the second
must conform to its input instead of widening inference to accommodate a bad
fixture. Return `z.output<TSchema>` so transforms and defaults retain the
correct parsed type. The helper needs no cast or type-assertion-boundary marker.

Preserve the result-only behavior under an explicit name:

```ts
export function expectParseResultSuccess<T>(
  result: z.ZodSafeParseResult<T>,
  message?: string,
): T
```

Move the current implementation and diagnostics to that function, and have the
schema-aware helper delegate to it. Retire the ambiguous
`expectParseSuccess` export and migrate all repository consumers; do not turn
the result helper into a private escape hatch or ban it from schema tests.
Wrapper-return tests such as `expectParseResultSuccess(validateHomebrewData(...))`
are its intended use.

## Static boundary and known limits

The schema helper can only enforce what `z.input<TSchema>` expresses. For
ordinary `z.object` and composed object schemas it catches missing or wrongly
typed fixture fields. Schemas built around `z.coerce`, `z.preprocess`, custom
schemas, or an explicit `unknown` input may expose `unknown` (or another broad
input type), so no helper signature can recover a narrower compile-time shape.
Those tests retain runtime coverage; do not add casts, hand-authored mirror
types, or claim that typecheck validates them.

Likewise, data that enters through a wrapper whose public contract is
`unknown -> SafeParseResult` has intentionally crossed the static boundary.
Use `expectParseResultSuccess` there. If a test has direct access to both a
typed schema and a positive fixture, use `expectSchemaParseSuccess`; do not
manufacture an intermediate result merely to select the weaker helper.

## Implementation shape

1. Add runtime and compile-time tests in
   `packages/shared/src/test/parse-helpers.test.ts`. Use never-invoked
   `@ts-expect-error -- <reason>` examples to prove a missing top-level key and
   the concrete nested/embedded required-key shape are rejected. The directives
   must become unused and fail typecheck if input checking regresses. Also pin a
   transform/default output type and document a coercion/unknown example where
   static rejection is intentionally impossible.
2. Classify every `expectParseSuccess` consumer. Migrate direct positive
   `schema.safeParse(input)` calls, including a one-hop
   `const result = schema.safeParse(input)` used only by the assertion, to
   `expectSchemaParseSuccess(schema, input)`. Preserve follow-on assertions
   against its parsed return. Migrate wrapper API results and results whose
   schema/input are intentionally unavailable to `expectParseResultSuccess`.
   Remove the ambiguous export only after the repository-wide migration.
3. Add a forcing function that rejects importing the retired
   `expectParseSuccess` name from the parse-helper module and points to both
   replacements. It must allow `expectParseResultSuccess`, including in shared
   schema tests. Do not attempt a general Zod dataflow sensor.
4. If `@typescript-eslint/no-restricted-imports` is used, compose the named
   import entry into the existing flat-config option object rather than
   redeclaring and replacing the rule in a later matching config. Add a
   regression fixture that proves both the new restriction and an existing
   restriction still fire, plus an out-of-scope/result-helper case that stays
   clean. If safe composition is awkward, prefer one focused local rule with
   the same import-source/name contract and boundary tests.
5. Replace `expectParseSuccess` with both new names in
   `scriptTestAssertFunctionNames` in `eslint-config/shared-policy.js`, so
   Vitest `expect-expect` recognition stays aligned with both legitimate
   assertion seams.
6. Update the Test Seams/Gotchas guidance in
   `packages/shared/src/schemas/MODULE.md`: direct expected-success fixtures use
   the typed schema helper; wrapper/unknown result contracts use the explicit
   result helper; deliberately invalid fixtures keep raw `safeParse` plus
   `expectParseFailure`.

## Acceptance

- Given `outerSchema = z.object({ encounter: innerSchema })` where
  `innerSchema` has a required nullable field, omitting that nested field from
  `expectSchemaParseSuccess(outerSchema, input)` fails `bun run typecheck`
  without running Vitest.
- The schema helper returns `z.output<TSchema>` for transforms/defaults. Both
  success helpers preserve the current parsed return, issue-rich failure
  diagnostics, and custom message text.
- Every repository use of ambiguous `expectParseSuccess` is classified and
  migrated; the export is removed. Direct positive `safeParse` fixtures in
  `packages/shared/src/schemas/*.{test,spec}.ts` use the typed helper, while
  `validateHomebrewData` and comparable wrapper-result tests use the explicit
  result helper.
- The enforcement rejects the retired named import, including an alias, with
  an actionable two-path repair message. It does not reject the explicit
  result helper. A boundary regression proves the rule scope and, if composed
  through `no-restricted-imports`, proves existing restrictions were not
  clobbered by flat-config replacement semantics.
- Negative fixtures remain intentionally untyped: malformed, missing, and
  wrong-type values continue through
  `expectParseFailure(schema.safeParse(unknownValue))` without casts or
  type-assertion-boundary markers.
- Tests state, rather than conceal, that coercive/preprocessed/unknown-input
  schemas and unknown-taking wrapper APIs retain runtime-only input assurance.
- `scriptTestAssertFunctionNames` recognizes both new helpers.
- `packages/shared/src/schemas/MODULE.md` explains the three-way
  positive-direct/positive-wrapper/negative split.
- Existing changed-test selection and fast-commit policy remain byte-for-byte
  unchanged. This leaf adds no dependency mapper and changes no verification
  slot selection.

## Verification

Run focused tests during migration, then the shared suite, typecheck, lint-rule
tests, and normal commit gate:

```sh
bun run test -- packages/shared/src/test/parse-helpers.test.ts
bun run typecheck
bun run test:shared
bun run test -- eslint-rules/shared-policy.test.js
```

If enforcement requires a new local rule, also run its exact focused test and:

```sh
bun run test:eslint-rules
```

Demonstrate the compile-time regression by temporarily removing the required
nested key and observing typecheck fail; do not weaken it into a runtime-only
assertion.

## Out of scope

- Typing negative fixtures or requiring casts for intentionally invalid data.
- Pretending coercion, preprocessing, custom schemas, or wrapper-owned unknown
  inputs have a narrower static type than Zod exposes.
- Adding an `rg` schema-name sweep; composed-schema consumers need not mention
  the nested schema name, as this incident demonstrated.
- Changing Vitest's changed-test graph, `test:changed`, fast-commit skip policy,
  or verification slot selection.
- Migrating all `.parse(...)` calls or every server/client Zod test to the
  schema-aware helper. Retiring the ambiguous success-helper name is global;
  the direct-fixture conversion target remains shared schema tests.
- Replacing schema-derived domain types with hand-authored fixture interfaces.

# Leaf 9 Pass 2 deferred — bucket scout

Date: 2026-05-17
Branch: feat/lint-hardening-leaf-9-scout (scout only; no config changes
committed)

## Summary

The temporary probe reproduced the Pass 1 total: 772 findings across the two
deferred rules, with 423 `strict-boolean-expressions` and 349
`promise-function-async` warnings. The findings collapse into 17 buckets:
7 strict-boolean buckets and 10 promise-function buckets. The implementation
path should use three targeted `promise-function-async` override blocks, then
run five targeted fix passes; `strict-boolean-expressions` should roll out by
scope because its largest buckets need intent-preserving explicit checks.

Probe notes: `bun run lint --silent` passed `--silent` through to ESLint and
failed as an invalid flat-config option, so the probe used the requested
fallback `bun run lint 2>&1 | tee /tmp/leaf9-scout-lint.log`. The probe edits
were reverted after inventory.

## strict-boolean-expressions (423)

### Bucket: domain-presence-guards — 174

- Distribution: server 83, shared 2, client 74, scripts 0, e2e 15.
- Sites:
  - `packages/server/src/services/spell-casting/spell-casting.ts:48`
  - `packages/client/src/components/campaign/members/members-panel.tsx:95`
  - `e2e/page-objects/character-sheet.po.ts:185`
- Recommendation: case-by-case.
- Recipe / glob: no override. Convert ID, cursor, token, and option guards to
  explicit presence checks. Use `value !== undefined && value !== null &&
  value !== ""` when the old truthiness behavior intentionally rejected empty
  strings; use `value !== undefined` only where schemas already rule out empty
  IDs. Nullable booleans in this bucket should become `flag === true` or
  `flag !== true`, depending on the branch semantics.

### Bucket: boundary-parser-config-strings — 101

- Distribution: server 39, shared 2, client 9, scripts 43, e2e 8.
- Sites:
  - `e2e/global-setup.ts:13`
  - `scripts/code-intel/cli-args.ts:51`
  - `packages/shared/src/dice/dice-notation.ts:124`
- Recommendation: fix.
- Recipe / glob: no override. Environment variables and CLI arguments should
  use explicit missing or empty checks (`raw === undefined || raw === ""`).
  Regex captures should use `match[index] !== undefined` before conversion.
  Headers, cookies, and parser boundary values should compare to `undefined`,
  `null`, or `""` according to the boundary contract.

### Bucket: tsx-presentation-conditionals — 96

- Distribution: server 0, shared 0, client 96, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/components/campaign/chat/dice-roll-result.tsx:83`
  - `packages/client/src/components/character-create/steps/proficiencies-step.tsx:55`
  - `packages/client/src/components/sheet/spell-detail-dialog.tsx:75`
- Recommendation: case-by-case.
- Recipe / glob: no override. This bucket contains the client `ternary-default`
  and `logical-and-render` shapes. Display text and error strings should use
  explicit non-empty checks and render with `condition ? <Node /> : null`;
  optional booleans should use `flag === true`. Do not blanket-allow nullable
  strings in TSX because the same files also contain real ID and permission
  gates.

### Bucket: any-dynamic-boundary-guards — 18

- Distribution: server 6, shared 0, client 12, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/components/homebrew/monster/monster-form-data.ts:199`
  - `packages/client/src/routes/router.test.tsx:40`
  - `packages/server/src/utils/combat-chat.ts:31`
- Recommendation: case-by-case.
- Recipe / glob: no override. Replace `any` truthiness with `unknown` plus
  explicit guards (`value !== null && typeof value === "object"`, array checks,
  and property-existence checks). Test/mock values should be narrowed before
  the conditional instead of relying on truthiness.

### Bucket: array-predicate-truthy — 13

- Distribution: server 2, shared 0, client 10, scripts 1, e2e 0.
- Sites:
  - `packages/client/src/components/campaign/combat/initiative-tracker-actions.test.tsx:103`
  - `packages/client/src/hooks/realtime-invalidation-encounter.test.ts:179`
  - `packages/server/src/routers/encounter-map.ts:114`
- Recommendation: fix.
- Recipe / glob: no override. Predicate callbacks must return booleans:
  use `el.textContent?.includes(label) === true`, `key?.includes(name) === true`,
  or split nullable value checks before returning. Avoid `filter(Boolean)` and
  string-valued predicate returns.

### Bucket: generic-non-boolean-truthiness — 11

- Distribution: server 6, shared 0, client 5, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/components/common/form-field.tsx:34`
  - `packages/server/src/routers/encounter.ts:118`
  - `packages/server/src/services/starting-equipment-service.ts:24`
- Recommendation: fix.
- Recipe / glob: no override. Replace `filter(Boolean)`, generic object
  truthiness, and derived non-boolean conditions with explicit predicates or
  comparisons. Generic helpers such as `assertFound<T>` need null-specific
  checks instead of `if (!value)`.

### Bucket: nullable-number-truthy — 10

- Distribution: server 3, shared 0, client 6, scripts 1, e2e 0.
- Sites:
  - `packages/client/src/components/character-create/steps/species-step.tsx:149`
  - `packages/server/src/services/level-up/asi.ts:112`
  - `scripts/code-intel/format.ts:258`
- Recommendation: fix.
- Recipe / glob: no override. Arrays use `.length > 0`; optional numeric
  prerequisites use `minimumLevel !== undefined` before comparison; numeric
  display suffixes use `value !== undefined && value > 0`. Do not enable
  `allowNullableNumber` because `0` is meaningful in these sites.

## promise-function-async (349)

### Bucket: client-trpc-test-mock-factories — 76

- Distribution: server 0, shared 0, client 76, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/test/mock-trpc-encounter.ts:29`
  - `packages/client/src/test/mock-trpc-map.ts:32`
  - `packages/client/src/test/mock-trpc.tsx:606`
- Recommendation: override.
- Recipe / glob: disable `@typescript-eslint/promise-function-async` for
  `packages/client/src/test/mock-trpc*.{ts,tsx}`. These mock factories model
  tRPC promise-returning contracts and are not production promise boundaries.

### Bucket: client-react-query-option-mocks — 14

- Distribution: server 0, shared 0, client 14, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/components/campaign/homebrew-link/campaign-homebrew-section.test.tsx:65`
  - `packages/client/src/hooks/vtt-drawer/use-confirm-cast.test.ts:45`
  - `packages/client/src/components/sheet/homebrew-item-tab.test.tsx:85`
- Recommendation: override.
- Recipe / glob: covered by the broader test-file override
  `**/*.{test,spec}.{ts,tsx}`. If fixed instead, simple query/mutation stubs
  can become async, but intentionally pending `new Promise(() => {})` stubs
  should stay obvious.

### Bucket: vitest-mock-implementations — 76

- Distribution: server 33, shared 0, client 43, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/components/app-header.test.tsx:97`
  - `packages/client/src/components/campaign/tokens/map-token-mutations.test.tsx:101`
  - `packages/server/src/services/rest-service.test.ts:112`
- Recommendation: override.
- Recipe / glob: disable `@typescript-eslint/promise-function-async` for
  `**/*.{test,spec}.{ts,tsx}`. This bucket covers `vi.fn(() =>
  Promise.resolve(...))`, `mockImplementation(() => promise)`, and
  `mockImplementationOnce(() => promise)` shapes.

### Bucket: server-clean-db-delete-callbacks — 20

- Distribution: server 20, shared 0, client 0, scripts 0, e2e 0.
- Sites:
  - `packages/server/src/test/clean-db.ts:14`
  - `packages/server/src/test/clean-db.ts:20`
  - `packages/server/src/test/clean-db.ts:31`
- Recommendation: fix.
- Recipe / glob: single-file mechanical pass: change `deleteIfExists(() =>
  prisma.x.deleteMany())` to `deleteIfExists(async () =>
  prisma.x.deleteMany())`.

### Bucket: prisma-transaction-callbacks — 38

- Distribution: server 38, shared 0, client 0, scripts 0, e2e 0.
- Sites:
  - `packages/server/src/services/character-live-state/spell-slot.ts:27`
  - `packages/server/src/services/spell-casting/non-combat-cast.ts:71`
  - `packages/server/src/utils/character-stats-mutations.test.ts:56`
- Recommendation: fix.
- Recipe / glob: add `async` to interactive `$transaction((tx) => ...)`
  callbacks. Do not apply this recipe to array `$transaction([...])` builders;
  those belong to the promise fan-out bucket.

### Bucket: dynamic-import-loader-callbacks — 12

- Distribution: server 0, shared 0, client 12, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/pages/character-sheet/sheet-dialogs.tsx:13`
  - `packages/client/src/routes/campaign-detail-route.ts:31`
  - `packages/client/src/routes/character-sheet-route.ts:8`
- Recommendation: override.
- Recipe / glob: disable `@typescript-eslint/promise-function-async` for
  `packages/client/src/routes/**/*-route.ts` and
  `packages/client/src/pages/character-sheet/sheet-dialogs.tsx`. These
  framework loaders intentionally return `import()` promises.

### Bucket: promise-collection-fan-out — 20

- Distribution: server 20, shared 0, client 0, scripts 0, e2e 0.
- Sites:
  - `packages/server/src/app.test.ts:51`
  - `packages/server/src/routers/encounter-combat-concurrency.test.ts:364`
  - `packages/server/src/routers/encounter-map.ts:119`
- Recommendation: case-by-case.
- Recipe / glob: no whole-bucket override. `Promise.all`/`allSettled`
  callbacks can usually become async, but PrismaPromise array builders must
  stay non-async when they are passed to `$transaction([...])`.

### Bucket: server-router-srd-pass-throughs — 44

- Distribution: server 44, shared 0, client 0, scripts 0, e2e 0.
- Sites:
  - `packages/server/src/routers/srd.ts:245`
  - `packages/server/src/routers/character.ts:141`
  - `packages/server/src/routers/encounter-combat.ts:30`
- Recommendation: fix.
- Recipe / glob: add `async` to tRPC `.query` / `.mutation` resolvers and SRD
  table `fetch` callbacks that directly return service or Prisma promises.
  Scope: `packages/server/src/routers/**/*.ts`.

### Bucket: test-helper-callbacks-and-fakes — 38

- Distribution: server 35, shared 0, client 3, scripts 0, e2e 0.
- Sites:
  - `packages/client/src/hooks/use-map-image-upload.test.ts:59`
  - `packages/server/src/test/race-helpers.test.ts:26`
  - `packages/server/src/test/test-database-url.test.ts:113`
- Recommendation: case-by-case.
- Recipe / glob: no whole-bucket recommendation beyond the general test-file
  override. Most fake `fetch`, `json`, `query`, `setup`, and `action`
  callbacks can be async; manual event/socket promises may deserve a narrow
  local suppression or a helper-specific override.

### Bucket: misc-production-script-one-offs — 11

- Distribution: server 4, shared 0, client 5, scripts 2, e2e 0.
- Sites:
  - `packages/client/src/hooks/character-sheet/use-character-stats.ts:147`
  - `packages/server/src/services/auth-service.ts:32`
  - `scripts/code-intel/daemon-client.ts:154`
- Recommendation: case-by-case.
- Recipe / glob: no broad glob. Cached in-flight promise functions may need a
  local override to preserve promise identity. Hook wrappers and script/manual
  promise wrappers can usually become async after checking call-site semantics.

## Recommended implementation plan

1. Add three override blocks for `@typescript-eslint/promise-function-async`:
   `**/*.{test,spec}.{ts,tsx}` for test mocks and test-only promise fakes
   (174 raw findings), `packages/client/src/test/mock-trpc*.{ts,tsx}` for
   client tRPC mock factories (76 findings), and the dynamic import loader
   pair `packages/client/src/routes/**/*-route.ts` plus
   `packages/client/src/pages/character-sheet/sheet-dialogs.tsx`
   (12 findings).
2. Fix promise production/server pass-throughs: add async to server router/SRD
   callbacks (44), interactive Prisma transaction callbacks (38 raw; fewer
   after the test override), and the server clean-db delete callbacks (20) if
   `packages/server/src/test/**/*.ts` is not covered by an override.
3. Review promise fan-out and one-offs: keep PrismaPromise array builders
   non-async; add async to plain `Promise.all` collectors; decide locally on
   cached promise identity helpers and manual socket/daemon promises.
4. Fix strict-boolean in mechanical passes: boundary/parser/config strings
   (101), nullable numbers and array predicates (23), generic non-boolean and
   dynamic guards (29), then domain presence guards (174).
5. Finish strict-boolean with the client TSX pass (96), keeping render
   conditions explicit rather than enabling broad nullable-string allowances.

## Adoption order

- Phase 1: enable `promise-function-async` at `error` after the three override
  blocks plus the production callback fixes. The remaining promise surface is
  small and mostly case-by-case.
- Phase 2: enable `strict-boolean-expressions` for shared, scripts, and e2e
  after the boundary/parser/config and nullable-number passes.
- Phase 3: enable `strict-boolean-expressions` for server after the domain
  guards, array predicates, generic truthiness, and router/service boundary
  fixes.
- Phase 4: enable `strict-boolean-expressions` for client after the TSX
  presentation pass and the remaining domain guards.

Full implementation after the recommended promise overrides should touch about
230 files and change roughly 750-900 lines, dominated by 423 strict-boolean
sites across 217 files plus about 64 promise-function sites outside the
override globs.

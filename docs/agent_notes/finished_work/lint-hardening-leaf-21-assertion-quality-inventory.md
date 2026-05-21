# Leaf 21 Inventory: Assertion-Quality Parse Helpers

Status: Resolved - verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-21-assertion-quality.
Probe: reproducible `rg`; no throwaway ESLint config needed.

Scope: tests and production under `packages/` and `scripts/`.

## Resolution

- Verdict: the assertion-quality local lint rule is **deferred**.
- The `expectParseSuccess` / `expectParseFailure` migration is complete for
  the target bug class. Probe A found 38 helper files, and Probe B found 0 raw
  `.safeParse(...).success` test assertions.
- The only raw `.safeParse(...).success` row is production schema logic:
  `packages/shared/src/schemas/map-inputs.ts:36` uses it inside a Zod
  `.refine(...)` predicate to accept upload paths or URLs. That is not a test
  assertion and would be a false positive for this leaf.
- The broader test assertion probes returned 11 unique `.success` assertion
  rows: 10 tRPC response-body `{ success: boolean }` checks and one
  `toast.success` spy assertion. None are Zod parse results.
- A wider sanity probe over all test `.success` member uses found four Zod
  parse-result guards. Each guard appears after the parse result has already
  gone through `expectParseSuccess` or `expectParseFailure`, and only narrows
  the result for data/error detail assertions. These are not old-style
  pass/fail assertions.
- No `safeParseAsync(...).success` rows exist.
- No production code, tests, or `eslint.config.js` changes landed. A local rule
  today would have nothing high-signal to flag, or it would need broad
  carve-outs for the production `.refine(...)` predicate, tRPC response
  bodies, toast spies, and legitimate post-helper narrowing guards.

## Summary

- Helper soak files: 38.
- Raw `.safeParse(...).success` rows: 1 production, 0 tests.
- Raw `.safeParseAsync(...).success` rows: 0.
- Broad `.success` assertion rows in tests: 11 unique rows.
- tRPC response-body `{ success: boolean }` assertions: 10.
- Toast spy assertions: 1.
- Zod parse-result `.success` assertions in tests: 0.
- Zod parse-result `.success` narrowing guards in tests: 4, all after helper
  assertions.
- `validateHomebrewData(...)` calls in
  `packages/shared/src/schemas/homebrew.test.ts`: 32, all flowing through
  `expectParseSuccess` or `expectParseFailure`.

## Probe Commands

Helper soak:

```bash
rg -l "expectParseSuccess|expectParseFailure" packages/ scripts/ | sort
rg -l "expectParseSuccess|expectParseFailure" packages/ scripts/ | wc -l
```

Raw direct success:

```bash
rg -n '\.safeParse\(.*?\)\.success' packages/ scripts/ --type ts
rg -n '\.safeParseAsync\(.*?\)\.success' packages/ scripts/ --type ts
```

Broader success assertions:

```bash
rg -n 'expect\([^)]*\.success\b' packages/ scripts/ --type ts
rg -n '\.success\)?\.toBe\(' packages/ scripts/ --type ts
rg -n 'expect\([^)]*\.success\b|\.success\)?\.toBe\(' packages/ scripts/ --type ts | sort
```

Homebrew helper path:

```bash
rg -n 'validateHomebrewData' packages/shared/src/schemas/homebrew.test.ts
rg -n 'validateHomebrewData\(' packages/shared/src/schemas/homebrew.test.ts
```

Additional sanity probe for non-assertion guards:

```bash
rg -n '\.success\b' packages/ scripts/ --type ts -g '*.test.ts' -g '*.test.tsx' | sort
```

## Probe Results

Probe A returned 38 helper files:

```text
packages/client/src/components/homebrew/background/background-form-data.test.ts
packages/client/src/components/homebrew/class/class-form-data.test.ts
packages/client/src/components/homebrew/item/item-form-data.test.ts
packages/client/src/components/homebrew/magic-item/magic-item-form-data.test.ts
packages/client/src/components/homebrew/monster/monster-form-data.test.ts
packages/client/src/components/homebrew/species/species-form-data.test.ts
packages/client/src/components/homebrew/spell/spell-form-data.test.ts
packages/client/src/components/homebrew/subclass/subclass-form-data.test.ts
packages/server/src/routers/app-router.output-coverage.test.ts
packages/server/src/routers/dice.test.ts
packages/server/src/socket/broadcast-registry.test.ts
packages/shared/src/map/drawing.test.ts
packages/shared/src/map/fog.test.ts
packages/shared/src/schemas/attack-roll-inputs.test.ts
packages/shared/src/schemas/auth.test.ts
packages/shared/src/schemas/campaign-inputs.test.ts
packages/shared/src/schemas/campaign.test.ts
packages/shared/src/schemas/character-inputs.test.ts
packages/shared/src/schemas/character.test.ts
packages/shared/src/schemas/chat-inputs.test.ts
packages/shared/src/schemas/combat-action.test.ts
packages/shared/src/schemas/encounter-inputs.test.ts
packages/shared/src/schemas/encounter.test.ts
packages/shared/src/schemas/harness-diagnostics.test.ts
packages/shared/src/schemas/homebrew-export.test.ts
packages/shared/src/schemas/homebrew.test.ts
packages/shared/src/schemas/inventory-inputs.test.ts
packages/shared/src/schemas/inventory.test.ts
packages/shared/src/schemas/map-inputs.test.ts
packages/shared/src/schemas/note.test.ts
packages/shared/src/schemas/npc-inputs.test.ts
packages/shared/src/schemas/rest-inputs.test.ts
packages/shared/src/schemas/socket-events.test.ts
packages/shared/src/schemas/spell-action-inputs.test.ts
packages/shared/src/schemas/spell-casting-inputs.test.ts
packages/shared/src/schemas/weapon-mastery-inputs.test.ts
packages/shared/src/test/parse-helpers.test.ts
packages/shared/src/test/parse-helpers.ts
```

Probe B returned one production row and no test rows:

```text
packages/shared/src/schemas/map-inputs.ts:36:  .refine((v) => v.startsWith(UPLOAD_PATH_PREFIX) || z.url().safeParse(v).success, {
```

Probe C returned these assertion rows:

```text
packages/client/src/components/homebrew/collections/import-collection-dialog.test.tsx:97:      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Imported"));
packages/server/src/routers/auth-change-password.test.ts:36:    expect(body.result.data.success).toBe(true);
packages/server/src/routers/auth-delete-account.test.ts:44:    expect(body.result.data.success).toBe(true);
packages/server/src/routers/character-spell.test.ts:165:      expect(trpcData<{ success: boolean }>(res.body).success).toBe(true);
packages/server/src/routers/encounter-map.test.ts:82:      expect(result.success).toBe(true);
packages/server/src/routers/encounter-map.test.ts:280:      expect(result.success).toBe(true);
packages/server/src/routers/homebrew-collection.test.ts:259:    expect(trpcData<{ success: boolean }>(res.body).success).toBe(true);
packages/server/src/routers/inventory-list.test.ts:324:    expect(trpcData<{ success: boolean }>(res.body).success).toBe(true);
packages/server/src/routers/note.test.ts:354:      expect(trpcData<{ success: boolean }>(res.body).success).toBe(true);
packages/server/src/routers/note.test.ts:452:      expect(trpcData<{ success: boolean }>(res.body).success).toBe(true);
packages/server/src/routers/npc.test.ts:207:      expect(trpcData<{ success: boolean }>(res.body).success).toBe(true);
```

Probe D confirmed 32 `validateHomebrewData(...)` call sites in
`homebrew.test.ts`. The call sites either store the parse result and then pass
it to `expectParseSuccess` / `expectParseFailure`, or pass the
`validateHomebrewData(...)` result directly to the helper.

The `safeParseAsync(...).success` sub-query in the Raw direct success block
returned no rows.

The additional sanity probe over all test `.success` member uses returned the
same 11 assertion rows already classified in Probe C, plus four post-helper
narrowing guards:

```text
packages/server/src/routers/dice.test.ts:69:      if (parsed.success) {
packages/shared/src/schemas/homebrew.test.ts:69:    if (!result.success) {
packages/shared/src/schemas/homebrew.test.ts:700:    if (!result.success) {
packages/shared/src/schemas/homebrew.test.ts:711:    if (!result.success) {
```

Each guard follows an `expectParseSuccess(...)` or `expectParseFailure(...)`
call and only narrows the Zod result for subsequent data or error detail
assertions, so a generic "never read `.success` in tests" rule would false-
positive on them.

## Findings

### helper-soak

The helper migration is broadly used across shared schemas, map rules, server
router/socket tests, and client homebrew form-data tests. The 38 helper files
include the helper implementation and its own tests.

### production-refine-predicate

- `packages/shared/src/schemas/map-inputs.ts:36` - `z.url().safeParse(v).success`
  is a Zod `.refine(...)` predicate inside schema construction. It is not a
  Vitest assertion and does not suffer from the failure-message quality issue
  the helper migration fixed.

### trpc-response-success

The 10 server test assertion rows check returned tRPC response data shaped as
`{ success: boolean }`. They are not Zod parse results:

- `packages/server/src/routers/auth-change-password.test.ts:36`
- `packages/server/src/routers/auth-delete-account.test.ts:44`
- `packages/server/src/routers/character-spell.test.ts:165`
- `packages/server/src/routers/encounter-map.test.ts:82`
- `packages/server/src/routers/encounter-map.test.ts:280`
- `packages/server/src/routers/homebrew-collection.test.ts:259`
- `packages/server/src/routers/inventory-list.test.ts:324`
- `packages/server/src/routers/note.test.ts:354`
- `packages/server/src/routers/note.test.ts:452`
- `packages/server/src/routers/npc.test.ts:207`

### toast-spy-success

- `packages/client/src/components/homebrew/collections/import-collection-dialog.test.tsx:97`
  asserts that the `toast.success` mock was called. The property name overlaps
  with parse-result success only textually.

### post-helper-narrowing

The wider test-only `.success` probe also found these non-assertion guards:

```text
packages/server/src/routers/dice.test.ts:69:      if (parsed.success) {
packages/shared/src/schemas/homebrew.test.ts:69:    if (!result.success) {
packages/shared/src/schemas/homebrew.test.ts:700:    if (!result.success) {
packages/shared/src/schemas/homebrew.test.ts:711:    if (!result.success) {
```

Each guard follows an `expectParseSuccess(parsed)` or
`expectParseFailure(result)` call and exists only to narrow the Zod result for
detail assertions such as parsed data fields or error paths. These rows are a
reason not to enforce a generic "never read `.success`" rule.

## Verdict

Defer the assertion-quality local rule: `expectParseSuccess` /
`expectParseFailure` migration is complete (38 helper files, 0 raw
`.safeParse(...).success` test sites), the one production `.refine` predicate
would be a false positive, and the broader tRPC response-body `.success`
assertions are a different bug class.

Revisit only if:

- A code-review or postmortem catches a regression to the old parse-result
  boolean assertion pattern.
- A wider Zod-result-handling helper surface emerges, such as
  `safeParseAsync(...)` helpers or tagged result helpers beyond Zod, and the
  desired lint shape has concrete examples.

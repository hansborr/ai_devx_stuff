# Leaf 10a Inventory: vitest/no-conditional-expect

Status: Resolved — rule deferred, five surfaced silent-pass bugs fixed.
Generated 2026-05-19 against
feature/lint-hardening-leaf-10a-vitest-conditional-expect.
Throwaway config: /tmp/eslint-conditional-expect.config.js
(not committed).

## Resolution

- Verdict: `vitest/no-conditional-expect` **deferred** (kept off in
  `eslint.config.js`). See verdict register entry dated 2026-05-19.
- The five `combat-actions.test.ts` silent-pass sites surfaced by the
  inventory were fixed in commit
  `a44e71a4` by injecting a mid-roll RNG (`midRng = () => 10`) into the
  two affected tests and removing the `if (!criticalMiss)` /
  `if (result.attackResult.hit)` guards. The remaining 50 findings stay
  as-is because they are legitimate `safeParse`, `expect.unreachable()`
  / `expect.fail()`, concurrency-branch, or table-driven shapes the
  rule cannot distinguish from real bugs.

## Summary

- Total findings: 55
- bug: 5
- safeParse: 6
- unreachable: 20
- concurrency: 16
- other: 8

Note: the literal inventory command aborted before producing JSON because this
checkout has no non-e2e `packages/**/*.spec.ts` files. The successful run used
the same scoped patterns with `--no-error-on-unmatched-pattern`.

## Findings

### bug

- `packages/server/src/services/combat-actions/combat-actions.test.ts:210` -
  high-bonus attack can natural-1 and skip the hit assertion while the test
  still passes. Excerpt: `if (!result.attackResult.criticalMiss) {`
  / `expect(result.attackResult.hit).toBe(true);`
- `packages/server/src/services/combat-actions/combat-actions.test.ts:214` -
  same natural-1 branch skips the damage assertion for the test's main behavior.
  Excerpt: `expect(target.currentHp).toBeLessThan(TARGET_HP);`
- `packages/server/src/services/combat-actions/combat-actions.test.ts:329` -
  concentration-drop test silently passes on a miss because all outcome checks
  are inside `if (result.attackResult.hit)`. Excerpt:
  `expect(stats.currentHp).toBe(0);`
- `packages/server/src/services/combat-actions/combat-actions.test.ts:330` -
  same hit-only branch can skip the concentration-clear assertion. Excerpt:
  `expect(stats.concentrationSpellId).toBeNull();`
- `packages/server/src/services/combat-actions/combat-actions.test.ts:331` -
  same hit-only branch can skip the chat concentration assertion. Excerpt:
  `expect(result.chat?.concentrationDescription).toContain("concentration");`

### safeParse

- `packages/server/src/routers/dice.test.ts:70` - `expectParseSuccess(parsed)`
  already fails the negative path; the branch only narrows successful Zod data.
  Excerpt: `if (parsed.success) {` /
  `expect(parsed.data.groupResults.length).toBeGreaterThanOrEqual(1);`
- `packages/server/src/routers/dice.test.ts:71` - same safeParse narrowing block
  after `expectParseSuccess(parsed)`. Excerpt:
  `expect(typeof parsed.data.total).toBe("number");`
- `packages/server/src/routers/dice.test.ts:72` - same safeParse narrowing block
  after `expectParseSuccess(parsed)`. Excerpt:
  `expect(parsed.data.notation).toBe("2d6+3");`
- `packages/shared/src/schemas/homebrew.test.ts:70` -
  `expectParseFailure(result)` already fails if parsing succeeds; the branch
  narrows the Zod error. Excerpt: `if (!result.success) {` /
  `expect(result.error).toBeDefined();`
- `packages/shared/src/schemas/homebrew.test.ts:701` -
  `expectParseFailure(result)` guards the failure path before checking the Zod
  issue path. Excerpt:
  `expect(result.error.issues[0]?.path).toEqual(["expectedVersion"]);`
- `packages/shared/src/schemas/homebrew.test.ts:712` -
  same `expectParseFailure(result)` guarded Zod issue-path assertion. Excerpt:
  `expect(result.error.issues[0]?.path).toEqual(["expectedVersion"]);`

### unreachable

- `packages/server/src/trpc/rate-limit.test.ts:54` - `expect.unreachable()`
  catches the no-throw path before the catch assertions. Excerpt:
  `expect.unreachable("should have thrown");` / `expect(err).toBeInstanceOf(TRPCError);`
- `packages/server/src/trpc/rate-limit.test.ts:55` - same catch block after
  `expect.unreachable()`. Excerpt:
  `expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");`
- `packages/server/src/trpc/trpc.test.ts:30` - `expect.unreachable()` catches
  unexpected success before the catch assertion. Excerpt:
  `expect.unreachable();` / `expect(err.cause).toBeInstanceOf(ZodError);`
- `packages/server/src/trpc/trpc.test.ts:40` - `expect.unreachable()` catches
  unexpected output success before the catch assertions. Excerpt:
  `expect(err.code).toBe("INTERNAL_SERVER_ERROR");`
- `packages/server/src/trpc/trpc.test.ts:41` - same catch block after
  `expect.unreachable()`. Excerpt:
  `expect(err.cause).toBeInstanceOf(ZodError);`
- `packages/server/src/utils/dice-error-wrap.test.ts:23` - `expect.fail()`
  catches the no-throw path before the catch assertions. Excerpt:
  `expect.fail("expected to throw");` / `expect(err).toBe(original);`
- `packages/server/src/utils/dice-error-wrap.test.ts:24` - same catch block
  after `expect.fail()`. Excerpt:
  `expect((err as TRPCError).code).toBe("NOT_FOUND");`
- `packages/server/src/utils/dice-error-wrap.test.ts:36` - `expect.fail()`
  catches the no-throw path before the catch assertions. Excerpt:
  `expect(err).toBe(original);`
- `packages/server/src/utils/dice-error-wrap.test.ts:37` - same catch block
  after `expect.fail()`. Excerpt:
  `expect((err as TRPCError).message).toBe("Item is not a weapon");`
- `packages/server/src/utils/dice-error-wrap.test.ts:48` - `expect.fail()`
  catches the no-throw path before the catch assertions. Excerpt:
  `expect(err).toBeInstanceOf(TRPCError);`
- `packages/server/src/utils/dice-error-wrap.test.ts:49` - same catch block
  after `expect.fail()`. Excerpt:
  `expect((err as TRPCError).code).toBe("BAD_REQUEST");`
- `packages/server/src/utils/dice-error-wrap.test.ts:50` - same catch block
  after `expect.fail()`. Excerpt:
  `expect((err as TRPCError).message).toBe("sides must be >= 1");`
- `packages/server/src/utils/dice-error-wrap.test.ts:66` - `expect.fail()`
  catches the no-throw path before the catch assertions. Excerpt:
  `expect(err).toBeInstanceOf(TRPCError);`
- `packages/server/src/utils/dice-error-wrap.test.ts:67` - same catch block
  after `expect.fail()`. Excerpt:
  `expect((err as TRPCError).code).toBe("BAD_REQUEST");`
- `packages/server/src/utils/dice-error-wrap.test.ts:68` - same catch block
  after `expect.fail()`. Excerpt:
  `expect((err as TRPCError).message).toBe("Invalid dice notation");`
- `packages/shared/src/test/parse-helpers.test.ts:21` - `expect.fail()`
  catches unexpected parse-helper success before the catch assertions. Excerpt:
  `expect.fail("expectParseSuccess should have thrown");` /
  `expect(message).toContain("Expected Zod parse to succeed");`
- `packages/shared/src/test/parse-helpers.test.ts:22` - same catch block after
  `expect.fail()`. Excerpt: `expect(message).toContain("issues");`
- `packages/shared/src/test/parse-helpers.test.ts:32` - `expect.fail()`
  catches unexpected parse-helper success before the catch assertion. Excerpt:
  `expect(message).toContain("parsing user input");`
- `packages/shared/src/test/parse-helpers.test.ts:50` - `expect.fail()`
  catches unexpected parse-helper failure before the catch assertions. Excerpt:
  `expect(message).toContain("Expected Zod parse to fail");`
- `packages/shared/src/test/parse-helpers.test.ts:51` - same catch block after
  `expect.fail()`. Excerpt: `expect(message).toContain("name");`

### concurrency

- `packages/server/src/routers/encounter-combat-concurrency.test.ts:244` -
  branch depends on whether the concurrent turn advance won; both states are
  valid and earlier assertions require one commit. Excerpt:
  `if (!turnAdvanced) {` / `expect(attackHit).toBe(true);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:247` -
  branch asserts the valid final state when the concurrent attack hit. Excerpt:
  `if (attackHit) {` / `expect(damageApplied).toBe(true);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:249` -
  alternate branch asserts the valid final state when the attack missed or did
  not commit. Excerpt: `} else {` / `expect(damageApplied).toBe(false);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:252` -
  branch asserts the valid final state when advanceTurn committed. Excerpt:
  `if (advanceCommitted) {` / `expect(turnAdvanced).toBe(true);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:316` -
  branch depends on whether concurrent advanceTurn won; both states are valid.
  Excerpt: `if (!turnAdvanced) {` / `expect(spellLanded).toBe(true);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:319` -
  branch asserts the valid final state when the concurrent spell landed. Excerpt:
  `if (spellLanded) {` / `expect(damageApplied).toBe(true);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:321` -
  alternate branch asserts the valid final state when the spell missed or did
  not commit. Excerpt: `} else {` / `expect(damageApplied).toBe(false);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:324` -
  branch asserts the valid final state when advanceTurn committed. Excerpt:
  `if (advanceCommitted) {` / `expect(turnAdvanced).toBe(true);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:592` -
  branch depends on which concurrent condition update committed and asserts the
  matching final state. Excerpt: `if (clearOk) {` /
  `expect(monster.conditions).toEqual([]);`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:599` -
  alternate branch asserts the valid ticked-condition state when the clear was
  rejected. Excerpt:
  `expect(monster.conditions).toEqual([{ name: "poisoned", durationRounds: 2 }]);`
- `packages/server/src/routers/encounter-participants-remove.test.ts:141` -
  branch depends on both concurrent mutations committing; the combined outcome
  is valid but timing-dependent. Excerpt:
  `if (removedOk && activatedOk) {` / `expect(detail.state).toBe("active");`
- `packages/server/src/routers/encounter-participants-remove.test.ts:142` -
  same both-committed concurrency branch. Excerpt:
  `expect(detail.participants).toHaveLength(2);`
- `packages/server/src/routers/rest-long.test.ts:486` - level-up race can leave
  the class at level 7 or not; the branch asserts the level-7 slot invariant
  only when that concurrent state lands. Excerpt:
  `if (finalCc.level === 7) {` / `expect(l4, ...).toBeDefined();`
- `packages/server/src/routers/rest-long.test.ts:490` - same level-up race
  branch for level-4 slot totals. Excerpt:
  `expect(l4!.total).toBe(L7_L4_SLOTS);`
- `packages/server/src/routers/rest-long.test.ts:492` - same level-up race
  branch for level-3 slot totals. Excerpt:
  `expect(l3!.total).toBe(L7_L3_SLOTS);`
- `packages/server/src/services/level-up/level-up-concurrency.test.ts:124` -
  branch depends on both concurrent writes landing; final strength is asserted
  unconditionally first. Excerpt:
  `if (updateLanded && asiLanded) {` / `expect(finalStats.strength).not.toBe(silentClobberValue);`

### other

- `packages/server/src/routers/encounter-combat.test.ts:153` - random retry
  branch is guarded by the later `expect(hitOccurred).toBe(true)`, but it is not
  an explicit `expect.fail()` / `expect.unreachable()` pattern. Excerpt:
  `if (result.attackResult.hit) {` / `expect(target?.currentHp).toBeLessThan(10);`
- `packages/server/src/routers/srd-spell.test.ts:176` - deterministic sort
  invariant split by adjacent-pair shape; same-level pairs assert name order.
  Excerpt: `if (prev.level === curr.level) {` /
  `expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);`
- `packages/server/src/routers/srd-spell.test.ts:178` - deterministic sort
  invariant split by adjacent-pair shape; different-level pairs assert level
  order. Excerpt: `} else {` / `expect(prev.level).toBeLessThan(curr.level);`
- `packages/server/src/utils/homebrew-helpers.test.ts:157` - table-driven
  optional-property expectation; the branch follows explicit fixture data.
  Excerpt: `if (scenario.parentClassName === undefined) {` /
  `expect(data, scenario.label).not.toHaveProperty("parentClassName");`
- `packages/server/src/utils/homebrew-helpers.test.ts:159` - table-driven
  optional-property expectation for the defined fixture case. Excerpt:
  `expect(data.parentClassName, scenario.label).toBe(scenario.parentClassName);`
- `packages/server/src/utils/map-helpers.test.ts:332` - prior
  `expect(fn).toThrow(TRPCError)` catches the no-throw path, but the pattern is
  not an explicit fail/unreachable alternate branch. Excerpt:
  `expect(fn).toThrow(TRPCError);` / `expect((e as TRPCError).code).toBe("BAD_REQUEST");`
- `packages/server/src/socket/auth-middleware.test.ts:117` - mixed code-path
  loop checks an error argument only when one exists; adjacent tests already
  cover the required error/no-error behavior for each path. Excerpt:
  `if (next.mock.calls[0]?.[0]) {` / `expect(next.mock.calls[0][0]).toBeInstanceOf(Error);`
- `packages/shared/src/schemas/encounter-inputs.test.ts:179` - discriminated
  union narrowing after `expect(result.type).toBe("monster")`; missed branch is
  already caught by the prior type assertion. Excerpt:
  `if (result.type === "monster") {` / `expect(result.maxHp).toBe(7);`

## Recommended next step

Defer — too many false positives (>30% of findings) and the rule does not
understand Musi's `Zod safeParse` / `expect.fail` patterns.

The rule did surface 5 real silent-pass bugs worth fixing in a focused cleanup,
but 50 of 55 findings are legitimate guarded assertions or timing-dependent
invariants. Enabling the rule now would require broad inline suppression before
the test surface has been normalized around helper patterns the rule can accept.

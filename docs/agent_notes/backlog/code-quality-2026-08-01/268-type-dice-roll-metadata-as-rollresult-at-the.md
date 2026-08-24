# 268. Type dice.roll metadata as RollResult at the response boundary

Status: Not started
Theme: Give dice.roll a RollResult-typed response instead of four client metadata assertions · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The `dice.roll` procedure always constructs and persists a `RollResult`, but
its generic chat-message output contract exposes `metadata` as optional
`unknown`. The two client roll hooks therefore recover the producer's concrete
type through four unchecked assertions.

That leaves the response boundary weaker than both sides of it: producer/schema
drift is invisible to TypeScript, and invalid metadata can reach toast
formatting or the weapon attack-to-critical-damage chain as though it had
already been validated. Each new dice consumer must repeat the same assertion
and its justification instead of inheriting the procedure's actual contract.

## Evidence

- `packages/server/src/routers/dice.ts:29-75` — `dice.roll` declares the generic
  `chatMessageSchema` output at `:32`, constructs `rollResult` through
  `rollFromNotation` at `:45-53`, stores it as metadata at `:55-64`, and always
  returns the mapped roll message.
- `packages/shared/src/schemas/chat-inputs.ts:52-65` — the generic
  `chatMessageSchema` deliberately defines metadata as
  `z.unknown().optional()`.
- `packages/shared/src/schemas/dice-inputs.ts:26-40` — the shared package
  already defines `diceGroupResultSchema` and `rollResultSchema`, including
  optional notation and the persisted group-result fields.
- `packages/shared/src/dice/types.ts:36-42` — `DiceGroupResult` and
  `RollResult` are already inferred from those runtime schemas rather than
  maintained as separate handwritten shapes.
- `packages/client/src/hooks/use-ability-roll.ts:23-27` — the ability hook
  asserts `data.metadata as RollResult | undefined` and describes the shape as
  guaranteed by the mutation contract even though the inferred contract is
  still `unknown`.
- `packages/client/src/hooks/use-weapon-roll.ts:39-60,67-87` — the weapon hook
  repeats three metadata assertions: damage toast, attack toast, and the
  attack-success callback that decides whether to double damage dice. Pin
  re-measurement:
  `git grep -n 'metadata as RollResult | undefined' ebf096580b31f604861fadb3d4cbd4079da4f017 -- 'packages/client/src/hooks/use-*-roll.ts'`
  returns four matches across exactly these two hooks.
- `packages/server/src/routers/dice.test.ts:46-90` — route coverage already
  checks that returned metadata parses with `rollResultSchema`, but this
  runtime expectation is not expressed in the procedure's output type.

## Proposed direction

Add a dedicated shared response schema for this procedure, for example
`diceRollResponseSchema = chatMessageSchema.extend({ metadata:
rollResultSchema })`, with metadata required. Keep the generic
`chatMessageSchema` unchanged because non-dice chat messages legitimately carry
other metadata shapes.

Use the dedicated schema as `dice.roll`'s `.output(...)` parser. Keep
`rollFromNotation` and metadata construction in the dice caller, persist the
same `rollResult` through `toJson`, and return the mapped message with that
concrete metadata attached so the response parser validates the value and the
client procedure type exposes `RollResult`.

Remove all four metadata assertions and their
`type-assertion-boundary` comments from `use-ability-roll.ts` and
`use-weapon-roll.ts`. Toast rendering and critical-hit detection should consume
the inferred `data.metadata` directly; retain the weapon helper's explicit
`RollResult` parameter where it remains useful independently of transport
narrowing.

Extend the shared response-schema coverage with a malformed-metadata rejection
case, retain the router's valid-result assertions for ordinary, keep-highest,
and labeled rolls, and keep the ability/weapon hook tests covering toast and
attack-to-damage behavior. Typechecking the hooks without the four assertions
is the compile-time regression check.

## Scope / caveats

- Preserve the persisted `RollResult` and `DiceGroupResult` shapes exactly,
  including `rolls: []` for flat terms and optional notation. `CQ25-179` in
  [`code-quality-2026-07-25/25-dice-model.md`](../code-quality-2026-07-25/25-dice-model.md)
  protects those wire and persistence shapes; it does not preclude typing this
  procedure's response.
- Sequence this work after or with
  [001-chat-persistence-delivery-policy.md](./001-chat-persistence-delivery-policy.md),
  whose migration touches `dice.roll` but explicitly leaves metadata shapes
  caller-owned. Do not move roll construction or dice-specific validation into
  the generic chat-message service.
- Do not narrow `chatMessageSchema.metadata` globally or add a discriminator to
  persisted chat metadata. This is a procedure-specific response contract.
- If the generic envelope must remain at the router boundary, replace the four
  assertions with one centralized `rollResultSchema.safeParse` adapter and
  explicit invalid-data handling. Do not silently discard parse failure or
  move unchecked assertions into a shared helper.
- This leaf changes response typing and validation, not dice notation,
  randomness, persistence layout, broadcasting, toast presentation, or
  critical-hit rules.

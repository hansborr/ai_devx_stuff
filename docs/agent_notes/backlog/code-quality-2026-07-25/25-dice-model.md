# 25. The dice model encodes flat modifiers as a zero-sided die and hand-mirrors its result types from Zod

Status: Done — landed 2026-07-26 as [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)'s slices D1 (`34624532`) and D2 (`71c456f6`), merge `7a4b10ac`. **Kept in full — no step dropped or merged**, and no divergence: the sentinel record is gone, the `*Parsed` aliases were renamed away rather than deprecated, and the persisted result schemas are byte-unchanged. See [`00-index.md`](./00-index.md#landed)
Theme: dice model · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/shared/src/dice/types.ts` declares four interfaces, and two main
things have gone wrong with them, plus one small dead branch alongside.

First, `DiceGroup` is a single flat record that has to stand in for two mutually
exclusive term kinds. A real dice term (`3d6kh2`) carries `count`/`sides`/`keep`
and always sets `modifier: 0`. A flat modifier term (`+5`) carries only
`modifier` and is forced to fill the dice fields with sentinels:
`{ count: 0, sides: 0, keep: undefined }`. A zero-sided die is not merely odd —
it is unconstructible by the module's own parser, which rejects
`sides < MIN_DIE_SIDES`. The type therefore describes states the system forbids,
and the roller only survives because `for (let i = 0; i < group.count; i++)`
happens never to fire for a flat term, so `sides: 0` is never handed to the RNG.
The safety is incidental, not expressed. The colocated tests have already
drifted into the impossible region: `dice-roller.test.ts` constructs
`{ count: 1, sides: 20, modifier: 5 }` — a dice term *and* a flat modifier in
one group, which the parser can never produce, so that test pins behaviour of a
state that does not exist in production.

Separately — and unrelated to `DiceGroup`'s shape — one genuinely dead branch
sits downstream in the same module. `parseDiceNotation` unconditionally
sets `notation: clean` on every non-throwing path, so the
`parsed.notation ?? notation` fallback in `rollFromNotation` (`dice-roller.ts:55`)
— which consumes `parseDiceNotation`'s own return value two lines above — can
never take its right-hand side. The similar-looking conditional spread in
`rollDice` (`:43`) is **not** dead: `rollDice` takes a caller-supplied
`ParsedNotation`, `notation` is optional on that type, `dice/*.js` is a declared
`exports` entry of `@musi/shared`, and every direct `rollDice` call in
`dice-roller.test.ts` / `dice-roller.property.test.ts` omits `notation` today. So
the spread runs on every direct call, and the optionality is a real part of the
`rollDice` contract rather than a leftover.

Second, `DiceGroupResult` and `RollResult` are hand-authored in `types.ts` while
`diceGroupResultSchema` and `rollResultSchema` in `packages/shared/src/schemas/dice-inputs.ts`
declare the identical pair — same fields, same optionality, no divergence. That
is a direct violation of a rule the package documents about itself:
`packages/shared/src/schemas/MODULE.md:142` says to derive types from the schema
and not to hand-author a parallel TypeScript type that can drift. Today there is
no drift; the cost is that nothing stops it, and the next person to add a field
to a roll result has two places to change and no compiler telling them so.

## Evidence

- `packages/shared/src/dice/types.ts:10-17` — `DiceGroup` carries `count`, `sides`, `keep`, `modifier` and `sign` in one flat shape.
- `packages/shared/src/dice/dice-notation.ts:141` — dice terms return `{ count, sides, keep, modifier: 0, sign }`; `modifier` is always dead here.
- `packages/shared/src/dice/dice-notation.ts:155` — flat terms return `{ count: 0, sides: 0, keep: undefined, modifier: value, sign }` (inside `parseTerm`, which starts at `:144`).
- `packages/shared/src/dice/dice-notation.ts:130-132` — `parseDiceTerm` throws when `sides < MIN_DIE_SIDES`, so `sides: 0` is unreachable through the public parser.
- `packages/shared/src/dice/dice-roller.ts:12-39` — the roll loop has no *term-kind* branch; the die-count loop at `:15-17` relies on `group.count === 0` to keep `rng(1, 0)` from ever being called.
- `packages/shared/src/dice/dice-roller.test.ts:20-23` — constructs `{ count: 1, sides: 20, keep: undefined, modifier: 5, sign: 1 }`, a group the parser cannot emit.
- `packages/shared/src/dice/dice-notation.ts:55` — `parseDiceNotation` always returns `notation: clean`; every other exit from the function throws (`:25`, `:46`, `:50`).
- `packages/shared/src/dice/dice-roller.ts:55` — `parsed.notation ?? notation` in `rollFromNotation`, where `parsed` came from `parseDiceNotation` at `:54`. This fallback is genuinely unreachable.
- `packages/shared/src/dice/dice-roller.ts:43` — `...(parsed.notation !== undefined ? { notation: parsed.notation } : {})`. This one **is** reachable: `rollDice:8` accepts any `ParsedNotation`, and `ParsedNotation.notation` is optional at `packages/shared/src/dice/types.ts:19-23`.
- `packages/shared/package.json:17-20` — `"./dice/*.js"` is a declared subpath export, so `rollDice` and `ParsedNotation` are importable from outside the package rather than module-private.
- `packages/shared/src/dice/dice-roller.test.ts:9,:20,:32,…` (18 direct `rollDice` calls) and `dice-roller.property.test.ts:35,:53,:74` — every one passes a hand-built `{ groups: [...] }` with no `notation`, exercising the `:43` false arm on each call.
- `packages/shared/src/dice/types.ts:29-43` — hand-authored `DiceGroupResult` and `RollResult`.
- `packages/shared/src/schemas/dice-inputs.ts:29-44` — `diceGroupResultSchema`/`rollResultSchema` plus `DiceGroupResultParsed`/`RollResultParsed`, field-for-field identical.
- `packages/shared/src/schemas/MODULE.md:142` — "Derive types from the schema (`z.infer<typeof fooSchema>`); do not hand-author a parallel TypeScript type that can drift".
- `packages/shared/src/schemas/dice-inputs.ts:1-3` — imports only `zod` and `../constants.js`; `packages/shared/src/rules/armor-class.ts:1-2` already imports from `../schemas/`, so `dice/` importing `schemas/` introduces no cycle or new layering.

## Proposed direction

Work in this order; each numbered step is one commit, and each starts with the
test change (TDD).

1. **Make Zod the source of truth for the result types.** Replace the
   hand-authored `DiceGroupResult`/`RollResult` in
   `packages/shared/src/dice/types.ts:29-43` with `z.infer` aliases over
   `diceGroupResultSchema`/`rollResultSchema` from
   `packages/shared/src/schemas/dice-inputs.ts` (or re-export the inferred types
   from there). Decide in the same pass whether `DiceGroupResultParsed`/`RollResultParsed`
   become deprecated re-exports or are renamed away; do not leave two live names
   for one type. Both names have live client consumers —
   `packages/client/src/components/campaign/chat/dice-roll-result.tsx:1` imports
   both and its test at `dice-roll-result.test.tsx:1` imports `RollResultParsed` —
   so renaming is a two-file client edit while a deprecated re-export keeps the
   commit shared-only. Pick one explicitly and say which in the commit message.
   Pure type change either way, no runtime diff.

2. **Delete the one dead fallback, and leave `ParsedNotation.notation` optional.**
   Replace `rollDice({ ...parsed, notation: parsed.notation ?? notation }, rng)`
   at `dice-roller.ts:55` with `rollDice(parsed, rng)`: `parseDiceNotation` at
   `:54` always populates `notation`, so both the `??` and the re-spread are
   inert. Keep the conditional spread at `dice-roller.ts:43` — it is live for
   direct `rollDice` callers, who legitimately hand-build a `ParsedNotation`
   without a notation string.

   Do **not** narrow `ParsedNotation.notation` to required as part of this step.
   Narrowing it would force `notation` onto all 21 direct `rollDice` fixtures for
   no behavioural gain, and would remove a caller's ability to roll pre-built
   groups that have no source notation. If a future leaf still wants that
   contract, it is a deliberate API narrowing in its own commit — update those
   call sites first, and only then collapse the `:43` spread to
   `notation: parsed.notation`.

3. **Split `DiceGroup` into a discriminated union of terms.** Introduce something
   like `type DiceTerm = { kind: "dice"; count; sides; keep; sign } | { kind: "flat"; value; sign }`
   in `types.ts`, and have `parseDiceTerm`/`parseTerm` in `dice-notation.ts:141`
   and `:155` emit the matching variant instead of sentinel-filled records.

4. **Convert the roll loop to an exhaustive switch** in `dice-roller.ts:12-39`.
   The dice arm keeps the existing roll/keep/sum logic; the flat arm computes
   `subtotal = value * sign` directly. Both arms must still push a
   `DiceGroupResult`-shaped entry, so the flat arm emits `{ rolls: [], subtotal }`.

5. **Repoint the four dice test files** (`dice-notation.test.ts`,
   `dice-notation.property.test.ts`, `dice-roller.test.ts`,
   `dice-roller.property.test.ts`) at the new term shapes, and delete or rewrite
   the fixtures that construct impossible groups — notably `dice-roller.test.ts:20-23`.
   Run with `bun run --filter @musi/shared test -- src/dice`.

## Scope / caveats

- **Do not let the term union leak into the result model.** `RollResult` and
  `DiceGroupResult` are wire and persisted shapes — `rollResultSchema` at
  `packages/shared/src/schemas/dice-inputs.ts:37-42` validates roll metadata read
  back from JSON. Adding a `kind` discriminator, dropping `rolls` for flat terms,
  or otherwise reshaping the *result* side is a breaking data change and is out
  of scope. Flat terms must keep emitting `{ rolls: [], subtotal }`.
- **`ParsedNotation.notation` stays optional.** Delete only the `:55` fallback.
  The conditional spread at `:43` is live: all 21 direct `rollDice` fixtures omit
  `notation`, so deleting the spread without first requiring `notation` is a
  typecheck failure, and requiring `notation` is a deliberate API narrowing
  across those 21 fixtures, not a tidy-up.
- **Treat both input types as internally reshapeable, and confirm that before
  starting.** `./dice/*.js` is an exported subpath
  (`packages/shared/package.json:17-20`), so reshapeability here is a usage fact,
  not a visibility one: no schema mirrors `DiceGroup`/`ParsedNotation` and
  nothing persists or transmits them. `@musi/shared/dice/types.js` has 14
  importers outside `packages/shared/src/dice/` (5 client, 9 server), but every
  one of them takes `RngFn`, `RollResult`, or `DiceGroupResult` — no file outside
  `packages/shared/src/dice/` references `DiceGroup` or `ParsedNotation`. Re-check
  with
  `bun run code:intel -- refs packages/shared/src/dice/types.ts:10:18 --limit 0`
  (`refs` needs a `file:line:col` location; `bun run code:intel -- def --name DiceGroup`
  gets you the location if `types.ts:10` has moved). A plain
  `git grep -n "\bParsedNotation\b"` will also hit
  `scripts/codemods/fixtures/expand-barrel/**` — self-contained codemod fixture
  trees with their own local `types.ts`, excluded from typecheck at
  `tsconfig.scripts.json:17` and unaffected by this leaf.
- Step 1 is independently valuable and carries no runtime risk; if the union work
  in steps 3-5 gets deferred, land steps 1-2 anyway rather than parking the whole
  leaf.
- The cost of step 4 is real: the loop gains a term-kind switch on top of the
  keep branch it already has at `dice-roller.ts:22-29`. That is the intended
  trade — the branch buys the deletion of two sentinel fields and an impossible
  state — but do not also take the opportunity to "simplify" the
  keep-highest/keep-lowest sorting in the dice arm; that logic is SRD-facing and
  covered by the property tests.
- No sequencing dependency on other leaves in this pack.

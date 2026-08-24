# 38. Dice grammar semantics ride on four positional regex captures plus a mislabeled keep-discriminator assertion

Status: Not started
Theme: typed regex decoding · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The dice-notation grammar is encoded as four anonymous parenthesized captures,
and its parser gives those captures meaning purely by numeric index:
`match[1]` is the die count, `match[2]` the sides, `match[3]` the keep
discriminator, `match[4]` the keep count. Nothing ties the regex to the
decoder, so any grammar edit — adding a capture, making one non-capturing,
reordering alternatives — must keep the parentheses, the indexes, the
`Number(...)` conversions, and the asserted `"h" | "l"` union synchronized by
hand. A miss does not fail loudly: `parseKeepSpec` maps every non-`"h"` value
to `"lowest"`, so a desynchronized capture silently changes which dice a roll
keeps. On top of that, the one cast in the file carries a
`type-assertion-boundary: framework` marker even though what it describes is a
runtime regex invariant — the repo's marker taxonomy calls that `interop` —
and in a repo meant to be copied as a harness reference, a miscategorized
marker is exactly the kind of example that propagates.

## Evidence

- `packages/shared/src/dice/dice-notation.ts:14` —
  `const DICE_TERM_REGEX = /^(\d+)?d(\d+)(?:k([hl])(\d+))?$/;` — four
  positional capture groups, none named.
- `packages/shared/src/dice/dice-notation.ts:124-128` — `parseDiceTerm`
  decodes `match[1]` through `match[4]` by index, with the cast
  `match[3] as "h" | "l" | undefined` at `:127` under a
  `type-assertion-boundary: framework` marker at `:126`.
- The cast is not even needed today: `parseKeepSpec`
  (`dice-notation.ts:101-105`) declares `keepType: string | undefined`, so the
  raw `match[3]` is assignable without any assertion — the marker documents a
  cast that buys nothing.
- `packages/shared/src/dice/dice-notation.ts:118` — `parseKeepSpec` resolves
  the discriminator as `keepType === "h" ? "highest" : "lowest"`, so any
  unexpected capture value silently becomes "keep lowest" instead of an error.
- `packages/shared/src/dice/dice-notation.ts:144-155` — `parseTerm` passes the
  raw `RegExpExecArray` into `parseDiceTerm`, and repeats the positional
  pattern for `FLAT_TERM_REGEX` (`:15`) via `flatMatch[1]` at `:154`.
- `tsconfig.base.json:16` — `noUncheckedIndexedAccess: true` (inherited by
  `packages/shared/tsconfig.json:2`), so `match.groups` access already yields
  `string | undefined`: named groups need no cast at all.
- `packages/shared/src/dice/dice-notation.test.ts:72-95` pins keep-highest and
  keep-lowest parsing (`4d6kh3`, `2d20kl1`, `4d6kh3+2`), so the refactor has a
  behavioral safety net; `dice-notation.property.test.ts` adds property
  coverage beside it.

## Proposed direction

Convert `DICE_TERM_REGEX` to named capture groups and decode via
`match.groups` in `parseDiceTerm`, replacing the mislabeled `framework`
assertion on the keep discriminator with a runtime narrow
(`keepType === "h" || keepType === "l"`) or, if a cast remains, a correctly
categorized `interop` marker.

Mechanics: name the four groups in place (e.g.
`/^(?<count>\d+)?d(?<sides>\d+)(?:k(?<keepType>[hl])(?<keepCount>\d+))?$/`),
read them as `diceMatch.groups?.count` etc. in `parseDiceTerm:123-128` —
under `noUncheckedIndexedAccess` each access is already
`string | undefined`, so no assertion is required anywhere. Prefer the runtime
narrow over a marker: it also closes the silent-`"lowest"` fallback at `:118`
for any future grammar drift. `FLAT_TERM_REGEX`'s single capture at
`:152-154` can be swept into the same pattern while there. Run the existing
suite as the gate: `bun run test -- packages/shared/src/dice/dice-notation.test.ts`.

## Scope / caveats

- **Parser internals only.** The dice result model is under a standing
  do-not-reopen ruling from the 2026-07-25 pack (SHARED-CLUSTER-PLAN.md ruling
  for its leaf 25, recorded against `CQ25-179`): never add a `kind`
  discriminator to `DiceGroupResult`/`RollResult`, never drop `rolls` for flat
  terms (both persist into `ChatMessage.metadata`), keep the conditional
  spread at `dice-roller.ts:45-46`, and `ParsedNotation.notation` stays optional.
  This leaf touches only capture decoding in `dice-notation.ts` and does not
  brush any of that.
- No grammar change: the regexes must accept and reject exactly the same
  strings — the keep-highest/lowest tests at `dice-notation.test.ts:72-95` and
  the property suites are the check.
- If the runtime-narrow option turns an impossible capture value into a thrown
  error inside `parseDiceTerm`, keep the message consistent with the file's
  existing `Invalid dice notation` wording; do not invent a new error channel.
- Marker bookkeeping: deleting the cast removes one `type-assertion-boundary`
  comment; see
  [`docs/guides/local-eslint-rules.md`](../../../guides/local-eslint-rules.md#type-assertion-boundary-marker)
  so no orphaned marker or ratchet surprise is left behind.

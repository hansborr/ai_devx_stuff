# 64. The concurrency-guard direct branch has no shared corpus, so rule/scanner divergences keep recurring there

Status: **Done 2026-07-31** on branch `fix/cq-64-70-guard-corpora`.
Theme: Detector parity as a checked claim · Area: harness (+ server docs) · Severity: low · Size: S

Source: the three-round four-model merge gate on `fix/cq-server-postmerge`,
2026-07-28 — all four reviewers rated every item here `[P2]`/follow-up and
recommended landing that branch without them · Confidence: high — each item was
reproduced against the live tree by at least one reviewer, and the headline
divergence by all four

Anchors pinned to `7f0c4a793`, the merge that landed that branch. The final
round-three gate cleared it unanimously with these items outstanding; they are
recorded here rather than fixed there because none can ship a wrong enforcement
decision.

## Outcome

- `concurrency-guard-direct-corpus.json` is now run through both the ESLint rule
  and the ts-morph detector. The existing nested corpus also carries the
  destructured-function-parameter counterexample. Each suite asserts its corpus
  is non-empty and compares findings in source order.
- Review restored three scanner cases that the first shared-corpus extraction
  dropped: a delegate alias initialized behind `satisfies`, a no-substitution
  template member that remains deliberately non-static, and a renamed
  destructured function parameter that actually reaches `isConstBinding`.
  Parity comments now claim agreement only over declared corpus examples.
- The widened corpus failed first: ESLint missed a one-hop delegate alias behind
  `satisfies`/non-null wrappers, while both ts-morph paths climbed through a
  function boundary and mistook a destructured parameter for an outer `const`
  binding. `delegateName` now unwraps transparently, and one exported
  function-boundary-aware `isConstBinding` replaces the two ts-morph copies.
- Direct and nested cases remain separate JSON corpora. Their finding shapes and
  detector entry points differ, so combining them would add branch/config
  structure without strengthening either comparison. This leaf's behavior
  corpus and leaf 70's filesystem module classification likewise share no useful
  code substrate.
- The bundled residue shipped: `connectOrCreate` is disclosed alongside the
  other inverse-FK escapes; the prepared-spell backoff comment distinguishes
  commit delay from multi-loser jitter; the stale leaf-05/plan terminology now
  names the shared two-shape serialization predicate and checked/unchecked
  helpers; and the two-party long-rest race now requires HTTP 200 rather than
  accepting a retry-budget 409.

## Problem

`eslint-rules/concurrency-guard.js` and `scripts/codemods/concurrency-guard/`
are meant to agree. For the **nested** branch that is a checked claim: one shared
corpus (`eslint-rules/concurrency-guard-nested-corpus.json`) is run through both
detectors, by `concurrency-guard.test.js` on the rule side and
`concurrency-guard-drift.test.ts` on the codemod side.

The **direct** branch has no such corpus. It has two hand-maintained lists — the
rule's `valid`/`invalid` arrays, and a drift test that only exercises the
codemod. That asymmetry, not any one bug, is why direct-branch divergences have
now recurred in three consecutive review rounds of the same branch: round two
closed one and opened another, round three closed that one and opened a third.

## Evidence

**The current divergence — an alias behind a transparent wrapper.** Reproduced
independently by all four reviewers. `eslint-rules/concurrency-guard.js:196`
(`delegateName`) starts from `unwrapChain` and only peels `as`/`satisfies`/`!`
later, inside `knownPropertyName`, which then requires a `MemberExpression`. The
codemod's `delegateName` (`scripts/codemods/concurrency-guard/ast.ts:68`) now
peels all transparent wrappers *before* its identifier branch. So:

```ts
const stats = tx.characterStats;
await (stats satisfies typeof stats).update({ where: { characterId }, data: {} });
// or: await stats!.update({ where: { characterId }, data: {} });
```

reports `characterStats.update` from the scanner and nothing from lint. On the
branch point both detectors missed it, so this divergence was introduced while
closing the member-expression form of the same shape.

It also leaves the rule internally asymmetric, mirrored from round two:
`receiverModelName` (`:234`) peels transparent wrappers before the alias split;
`delegateName` (`:196`) does not. `unwrapTransparent` is already imported at
`:58`, so the code fix is one identifier.

**A second divergence, opposite direction.** `nested-writes.ts:91` and `:101`
search *any* ancestor for a `const` declaration list, so they climb through an
arrow function into an outer binding and misclassify a destructured **function
parameter** as a const model alias:

```ts
const write = ({ character }) =>
  character.update({ where: { id }, data: { stats: { update: { currentHp: 0 } } } });
```

The scanner reports it; ESLint correctly does not.

## Why it is low severity

Every shape here is diagnostic-only. A direct gated write is already a hard type
error through `ConcurrencyGatedWrite` (`packages/server/src/utils/prisma-types.ts:67-70`),
and lint — not the scanner — is the enforcement gate. The current divergence
direction is scanner-over-reports, so no enforcement hole opens that was not
already there. What it costs is trust in the former `nested-writes.ts:5`
"behaviourally identical" claim. The finite corpora check only their declared
examples, so the implementation now says exactly that rather than promising
universal parity.

## Proposed direction

1. Change `unwrapChain` → `unwrapTransparent` at `concurrency-guard.js:196` and
   add the alias-behind-a-wrapper shape to both detectors' cases.
2. Narrow `nested-writes.ts`'s const-binding lookup so it cannot climb through a
   function boundary into an outer scope, and pin the destructured-parameter
   shape as a no-finding case on both sides.
3. **Give the direct branch a shared corpus of its own**, run through both
   detectors the way the nested corpus already is. This is the item that closes
   the class rather than the instance; items 1 and 2 are the two instances it
   would have caught.
4. Re-scope the `nested-writes.ts:5` parity claim to whatever the corpora
   actually check, so the comment stops promising more than the tests hold.

## Also recorded here — smaller residue from the same gate

These were raised once each and are cheap; they do not need their own leaves.

- **`docs/CONCURRENCY.md:132` omits `connectOrCreate`** from the inverse-FK
  escape list. The generated nested input exposes it
  (`packages/server/src/generated/prisma/models/CharacterClass.ts:500`), and
  against an existing row `character.classes.connectOrCreate` takes the connect
  branch and rewrites `CharacterClass.characterId` unseen by both detectors.
  Same class as the `connect`/`set`/`disconnect` entry beside it;
  [leaf 60](./60-nested-write-runtime-guard.md) defers the operator deliberately,
  so disclosure is the whole fix.
- **`packages/server/src/utils/prepared-spell-toggle.ts:54`** still carries the
  superseded jitter explanation — it attributes re-collision to multiple losers
  restarting together and says the test substitutes a deterministic stagger. The
  measured two-racer case has one loser that retries before the winner's commit
  returns, so the backoff *delay* is primary and jitter additionally separates
  multiple losers. `docs/CONCURRENCY.md:635` was corrected; this production
  comment was missed.
- **`docs/agent_notes/backlog/code-quality-2026-07-25/05-router-and-service-boundaries.md:71`
  and `:107`, and `SERVER-COMMENTS-PLAN.md:562`** still reference a rest-local
  `PRISMA_TX_WRITE_CONFLICT`, "the P2034 retry loop", and undifferentiated "CAS
  helpers". Live code uses the shared two-shape predicate, and the reset/sync
  helpers are explicitly unchecked. The "anti-dependency rationale" phrasing in
  those same lines was relabelled; these anchors were not. A future S6 refactor
  following them could restore the framing that branch corrected.
- **`packages/server/src/routers/rest-long.test.ts:457`** accepts either 200 or
  409 from the long rest. If the P2034 retry regresses, the simulation can commit
  its L3/L4 writes, long rest can return 409, and the unconditional assertions at
  `:471` still pass without a committed rest. With a single competing writer at
  most one abort is possible, so this two-party race should require 200.

## Verify

```
bun run test:eslint-rules -- eslint-rules/concurrency-guard.test.js
bun run test:scripts:file -- scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts
bun run test -- --project server src/routers/rest-long.test.ts
bun run lint
```

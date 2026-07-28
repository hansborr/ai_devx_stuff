# Session handoff — 2026-07-28

Status: Informational — not a leaf; no promotion decision attaches to this note

State of the work in flight at the end of the 2026-07-28 session. Every branch below is committed and
gate-clean unless stated otherwise; nothing is pushed and nothing has an open PR.

**Merge policy in force for this pack:** a branch reaches `main` only after passing a four-model
review gate — Opus 5, Codex (with its own internal subagents, multi-angle), Fable 5, and Grok 4.5 —
and the owner has standing authorisation for merge-on-green. A gate round that turns up findings is
answered on the branch and re-gated, not waived.

## Landed this session

| Branch | Merge | Notes |
|---|---|---|
| `feat/cq-common-language-ownership` (leaf 55) | `137cd7991` | Two full gate rounds. Round two cleared unanimously with no findings. |
| `fix/saving-throw-proficiency-identity` (leaf 61) | `48474f8cb` | Gate passed unanimously; landed after a clean solo full verify. The pack's only `high`-severity leaf, and the only one not found by an audit. |

## Open — `feat/cq-client-followups` (client round three, Branch A)

**Do not merge as-is.** Gate result: three mergeable (Opus 5, Fable 5, Grok 4.5), one not-mergeable
(Codex). No P0 or P1 from anyone, and all four independently confirmed the acceptance test holds —
`buildInventoryProps` rejects a raw link id, so the round-two defect class is closed at the type
level.

The branch carries a **user-visible regression it introduced**, which is why it is parked rather than
landed: `add-item-dialog.tsx:197-231` places `CustomItemForm` at different tree positions in its two
branches, so when membership resolves from `null` to `member` React unmounts the form and clears
typed input. Reachable by deep-linking a linked sheet with a cold `campaign.get`, opening **+ Add**,
and typing while the query settles.

A fix mission covering the full panel outcome is written and ready to dispatch. Its five items:

1. **Make the code match the documented contract** (all four reviewers). `pages/MODULE.md:113-115`
   and the comment at `sheet-layout.tsx:113-115` claim the two projections are the only way to spend
   the context; in fact the socket takes raw `linkedCampaignId` (`:129`), `useRollPermission` takes
   the whole context (`:131`), and `isCampaignDm` is a third projection (`:134`). Adjudicated: route
   the socket through `campaignIdentity` and make the prose exact, rather than editing the contract
   down. Also fix the stale comment at `sheet-layout.test.tsx:120-122`.
2. **The `AddItemDialog` remount** above.
3. **A rendered state-matrix test** proving `resolving`, `nonmember` and `error` produce identical
   output. Adjudicated **for Codex against a 3-1 majority**: the other three judged the
   derivation-level pin adequate because components consume only the projections, but the layout
   still holds the full `campaign` value, so a future author can add a status-specific branch that
   no current test would catch. The design decision specified rendered equivalence.
4. **Two doc scopings** — qualify `pages/MODULE.md:148-151` as same-client only, and leave the
   near-duplicate baseline alone (reviewers split on the mechanism; all agreed the edit is legitimate
   and the detector fails safe).
5. **Optional:** `members-panel.tsx:211-214` derives the outgoing character from possibly-stale
   rendered props, so a re-assign inside the refetch window invalidates only one side. Fix if small,
   file as a leaf if not.

## Open — `fix/cq-server-postmerge`

Complete: four commits (`981cd066a`, `12c171d00`, `ae4b91cde`, `5518bda6c`), clean tree, each one
through the full commit gate. **Not reviewed by the four-model gate, not merged** — it needs a merge
from `main` first, which has advanced past its branch point. Its mission is `scratchpad/srv-fix.prompt`
from the prior session, copied into this session's scratchpad; the report is `scratchpad/srv-fix.msg`.

What it settled, all reproduced against the lane's live Postgres before being changed:

- **The long-rest barrier is `CharacterStats`, not `CharacterClass`.** Confirmed by probe: a
  serializable long rest against a READ COMMITTED multiclass level-up traces
  `characterClass.findMany` → `characterStats.findUnique` → `characterStats.updateMany` → P2034, and
  never reaches `resetAllHitDice`. Strip the stats write and the same race commits undetected.
  `resetAllHitDice` is a real but partial barrier covering only a same-class level-up. Corrected in
  `CONCURRENCY.md`, `rest-MODULE.md`, `rest-service.ts` and `apply-level-up.ts` — the obligation is
  bilateral, so level-up's side now says so too.
- **`serializable-isolation.test.ts` now drives the real program**, mutation-checked both ways.
- **The guide's generalised rule was unsound** and now reads "rows that were in that snapshot and
  that you then UPDATE", with the `updateMany`-over-a-to-many consequence stated.
- **`concurrency-guard.js` receiver aliases restored** plus the computed-access, quoted-key and
  const-bound-element parity gaps; `repairKind` fixed. `packages/server/src/**` lints clean before
  and after.
- **The `repository.character.update(...)` false positive reproduces and was deliberately kept** — a
  receiver matching a model name, relation name, gated mutator *and* `where` key is indistinguishable
  from a Prisma call without type information. Now a corpus case with the expected finding plus a
  disclosure in the rule JSDoc and `CONCURRENCY.md`, rather than a latent surprise.
- **The toggle race's stated invariant was false** — over 40 gate-shaped runs the loser never
  retried once. Mechanism the reviews had not stated: Postgres raises the loser's abort *before the
  winner's `COMMIT` returns*, so an immediate retry re-enters the winner's window. Replaced with a
  wait-for-a-peer-to-commit gate and `retries === 1`; reverting the gate fails 5/6, so the assertion
  is load-bearing.
- **Two review claims refuted with evidence** — the four-racer rationale (139/150 four-racer runs
  conflict in the away-from-cap shape the test actually uses) and an invented SSI conflict in the
  toggle→long-rest edge (one-directional, no pivot).

**Open decision it surfaced, which belongs to leaf 60:** `character.update({ data: { classes:
{ connect: { id } } } })` writes `CharacterClass.characterId` — the FK is on the *gated* side
(`schema.prisma:903`) — and neither detector sees it, because `connect` is not a gated mutator. The
existing corpus case named "connect is not a write to the gated row" generalises from
`mapToken.encounterParticipant`, where the FK is on the non-gated side; it is true there and false
here, so at minimum that case should be renamed. Recorded against leaf 60, whose v1 already treats
this as a non-goal.

## Decided, recorded, not started

**Leaf 60 — the Prisma `$extends` runtime nested-write guard.** A three-model design panel (Opus 5,
Fable 5, Codex) answered it and the owner adjudicated. The full decision is now recorded in
[`60-nested-write-runtime-guard.md`](./60-nested-write-runtime-guard.md) under
"Decided — design panel, 2026-07-28", which supersedes that leaf's original `## Steps`. Headlines:

- Build the guard. Two panelists independently produced *different* worked examples that lint clean
  and type-check today (`campaign.characters → stats`, `campaignMember.character → stats`, plus the
  same shape via `User.characters`, `Species.characters`, `Background.characters`) — the gate is
  closed only at depth one, because the rule's walker drops the current model on any non-gated hop.
  **Reproduce one before building**; if it does not reproduce, stop, because the justification goes
  with it.
- Keep the ESLint nested branch as a non-authoritative author-time diagnostic, rebased on generated
  relation metadata. Retire the codemod's nested clone, the flat `GATED_RELATION_FIELDS` table and
  the parity corpus.
- Generate the full relation graph from `schema.prisma` — **not** from Prisma's internal
  `runtimeDataModel`, which two panelists rejected as an internal surface.
- v1 gates `update`/`updateMany`/`updateManyAndReturn`/`upsert` on gated *target* models. FK
  ownership is generated into the artifact but **not** gated on in v1; record the
  `connect`/`disconnect`-through-inverse case as an explicit non-goal with `Map.encounters` as the
  worked example.
- Walk only schema-known keys (never `Json` columns). No bypass of any kind. Pin that the extension
  applies inside `$transaction` in both forms — if it does not, stop and re-take the judgement.
- Size: 4–5 commits, M, not the leaf's original S.

**Leaf 55's backfill question** was answered by the owner (backfill despite an empty dataset) and is
recorded in the landed leaf.

## Filed this session, not started

- **Leaf 61** — landed, see above. Notable as the pack's first entry not found by an audit: a
  reviewer tracing consumers on an unrelated branch found it, and it is the only `high`-severity leaf
  in the pack.
- **Leaf 62** — client adoption of the shared ability-identity helper, leaf 61's deliberately
  deferred half.
- **Branch B (socket association freshness)** — the multi-tab assignment P1 and the
  campaign-deletion cascade, split out of client round three by unanimous panel advice. The design
  panel's recommended mechanism is a new user-targeted `character:associationChanged` event rather
  than widening `character:updated` (which requires `campaignId` and is campaign-room scoped);
  `broadcast-registry.ts:186-200` already supports global user-filtered delivery. Emit after
  persistence per ADR-0003. **No leaf file written yet** — the design is recorded in
  `CLIENT-CLUSTER-PLAN.md`'s "Decided — design panel, 2026-07-28" section.
- **The wider `InventoryPanel` owner-gate gap** — Add and per-row Edit/Delete render with no owner
  check at all, so a nonmember on a public sheet is offered the whole mutation surface. The Homebrew
  finding that round two raised is only the half that is *guaranteed* to fail rather than merely
  refused. Recorded in `CLIENT-CLUSTER-PLAN.md`; no leaf file yet.

## Operational note worth keeping

**Two concurrent full `verify` runs in different worktrees fail each other**, and they fail in a way
that looks like a branch defect. Confirmed twice this session on a branch that had passed a clean solo
verify minutes earlier: first a 30s timeout in `eslint-rules/no-unbounded-promise-all-config.test.js`
(passes in ~1s isolated), then `test-dependency-freshness` failing `pre-commit held the queue for 5s
after a 1s memory deadline`. The commit queue and memory deadline are shared across worktrees, so
those assertions measure global contention. Before attributing a timing-shaped gate failure to a
branch, check `ps -eo pid,etimes,pcpu,args --sort=-pcpu` for another lane's `verify.sh` /
`test-scripts.sh` / `verify-async.sh` poll loop. Serialize full verifies across lanes.

Separately, the client lane reported the parallel pre-commit gate failing reproducibly on its branch
(`restricted-syntax-and-globals-config.test.js` and `actionlint` timing out under concurrent
full-suite load, both passing in isolation) and landed via the sequential verify marker bridge at
~23–28 minutes per run.

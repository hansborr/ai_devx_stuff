# SERVER-COMMENTS-PLAN. The five server leaves and the three comment/naming leaves: scheduling plan

Status: Planned — **the server's boundaries are in the right places and none of
the five server leaves says otherwise; what is wrong is that three of those
boundaries are unenforced at the type level and one MODULE doc lies about its own
file set. Of the three comment and naming leaves, roughly a quarter survives.
Two new live defects surfaced during the consults that no leaf records: a
check-then-act race in the prepared-spell limit, and four seed generators that
break the moment they are given the package script leaf 06 asks for.** Supersedes
the `## Proposed direction` of leaves
[02](./02-fastify-io-augmentation.md),
[03](./03-authz-caller-contract.md),
[04](./04-socket-broadcast-surface.md),
[05](./05-router-and-service-boundaries.md),
[06](./06-seed-pipeline-and-generators.md),
[44](./44-comment-archaeology.md),
[45](./45-comments-compensating-for-code.md) and
[46](./46-naming-renames.md).

Date: 2026-07-26 · Area: server + comments/naming · Source leaves: 02, 03, 04,
05, 06, 44, 45, 46 (leaf 01 is in flight elsewhere and is out of scope; its two
overlaps are recorded below)

Cross-model planning session: `consult codex` (own subagents across
service/router boundary design, socket and auth correctness, type modelling, and
separately "are the comment and naming leaves worth doing at all", synthesized)
and `consult cursor` (Grok, "step back — is this server layered right, and is a
comment/naming sweep the best use of effort here?"). Both were asked the same
question independently. **They agreed on the layering verdict and on refusing most
of 44 and 46, and split on five calls** — recorded in
[Where the consults split](#where-the-consults-split-and-the-call). Every count,
anchor and verification path below was re-measured or existence-checked against
`2cf49496` (`main`); the leaves' evidence is pinned to `883d48bf`.

## Verdict

**The server application layering is sound. Not one of leaves 02, 03, 04 or 05
contains a finding of the form "this logic is in the wrong layer" — except leaf
05 step 5, and `packages/server/src/services/README.md:203-207` already records
that one as known and deliberately scoped out of a previous audit.** Everything
else in the four server-boundary leaves is one of four other things:

1. **A boundary the type system does not enforce.** `server.decorate("io", io)`
   (`packages/server/src/app.ts:254`) against zero `declare module "fastify"`
   augmentations repo-wide, read back through a runtime string probe
   (`packages/server/src/utils/socket-helpers.ts:3-9`). Ten `server: unknown`
   declarations across nine files, and three separate hand-rolled re-derivations
   of `FastifyInstance["log"]` to buy back what `unknown` threw away. This is
   leaf 02, and it is the highest-value work in the cluster.
2. **An API-shape inconsistency inside a correct authorization model.** Leaf 03.
   The NOT_FOUND-vs-FORBIDDEN semantics, the one-log-per-boundary discipline and
   the helper set are all right; three ways to pass the caller is impedance, not
   architecture.
3. **Cleanup that did not follow a finished migration.** Leaf 04. The registry
   *is* the boundary; what is left behind it is a shipped migration recipe, 347
   lines of per-family tests that re-test the registry, one sentinel entry, and
   duplicated type aliases.
4. **Documentation that has gone stale against its own tree, plus one private-API
   reach-in.** Leaf 05: `services/rest-MODULE.md:5-8` calls rest a single file
   while `rest-service.ts:29-30` imports two siblings; `routers/homebrew.ts:404-405`
   spreads `._def.procedures` when the installed `@trpc/server` 11.17.0 ships
   `mergeRouters` on the root object.

**Leaf 04's headline — "half a boundary" — overstates it, and this plan does not
adopt that framing.** The boundary is whole; the scaffolding around it was never
taken down. Both consults said so independently.

Leaf 06 is not a layering leaf at all: it is an unattested code-generation
pipeline whose inputs are, by documented design, outside the tree
(`docs/srd-data-sources.md:34-37`, `.gitignore:63`). That single fact decides most
of it — four of its nine steps cannot be verified by any gate or by any
implementer who has not cloned the upstream repositories, and are parked.

**On the comment and naming leaves the answer is mostly no.** Leaf 44 is 60-plus
single-line edits qualifying backlog coordinates in source comments, and the cost
of an unqualified `leaf 06` in a comment falls on one human reader who is one
`git log -S` away from resolving it. Leaf 46 is a pure rename sweep, and renames
are cheap to write and expensive to review. What survives is the subset where a
comment or a name is **not a comment or a name** — where the string is data that
reaches a second audience, or where a name produces a wrong answer:

- **Six ratchet metadata strings in `scripts/lint-ratchet/lint-ratchet-config.ts`
  reach two audiences beyond the source file** — but not the two the leaf names.
  See [Ruling: leaf 44](#ruling-leaf-44--one-defect-three-drive-bys-and-a-sweep-this-plan-refuses);
  the leaf's central evidence is wrong in both directions, and the corrected
  picture makes the two strings it calls inert the *most* urgent ones.
- **A file header states a compile-time guarantee that does not exist**
  (`packages/server/src/utils/encounter-state-mutations.ts:21-22`), and the
  correct statement is 25 lines below it at `:47-54`. Two comments in one file
  disagree and the wrong one is first.
- **A naming choice produces a wrong user-facing message.** The spell path calls
  `assertEncounterCombatant` with `input.casterParticipantId`
  (`packages/server/src/services/encounter-combat/spell-action.ts:18-23`), so a
  player casting with someone else's caster is told *"Players can only attack
  with their own character"* (`packages/server/src/utils/encounter-combat-auth.ts:69`,
  `:88`).

**Leaf 45 step 4 (trimming the `*-mutations.ts` headers) and leaf 45 step 2
(deriving a five-pair transition union) are both dropped**, the first as a trap
and the second because both consults rated it complexity for negligible value.
**Leaf 46 step 8 (fog dimensions) is replaced by a smaller change that fixes the
real defect.**

So: **eight leaves → one structural typing fix (02), one bounded API convergence
with its widest steps optional (03), three cleanups behind a finished migration
(04), three small drifts plus one reframed extraction (05), a seed pipeline split
at its own documented fault line (06), and five surviving items across 44/45/46.**

## Two live defects the leaves do not record

Both came out of the codex consult and both are verified against the tree.

**1. The prepared-spell limit is a check-then-act race.** [P2]
`packages/server/src/routers/character-spell.ts:195-229` reads the cap
(`calcMaxPrepared`), then issues a separate `characterSpell.count`, then — outside
any transaction and with no CAS — issues `characterSpell.update` at `:225-228`.
Two concurrent `togglePrepared` calls at `maxPrepared - 1` both read
`preparedCount = maxPrepared - 1`, both pass the guard, and both write. The
consequence is one spell over the limit, not corruption, which is why this is P2
and not P1 — but it is a genuine read-then-write race in a mutation path in a repo
that has `docs/CONCURRENCY.md`, `docs/guides/add-race-sensitive-mutation.md` and a
`codemod:concurrency-guard` scanner for exactly this shape.

**This reframes leaf 05 step 5.** Extracting `calcMaxPrepared` and the guard into
`utils/` makes the *rule* unit-testable and does **not** fix the invariant. The
extraction is still worth doing on its own terms — but a commit message must not
describe it as fixing the limit. Slice S7 states both halves and separates them.

**2. All four seed generators derive their paths from `process.cwd()`, so leaf 06
step 2's package script would break them.** [P1] `generate-class-features.ts:18`,
`generate-srd-spells.ts:21`, `generate-subclasses.ts:18` and
`generate-srd-rules-glossary.ts:19` each set `const ROOT = process.cwd()` and then
`join(ROOT, "packages/server/src/seed/…")`. Adding them to
`packages/server/package.json` "next to the existing `backfill:*` entries", as the
leaf proposes, runs them with `cwd = packages/server`, so `ROOT` resolves to the
package and every path becomes `packages/server/packages/server/…`. The existing
`backfill:*` scripts do not have this problem because they use
`resolve(import.meta.dirname, …)` (`backfill-srd-spell-combat.ts:14`,
`backfill-srd-monster-actions.ts:13`) — which is also the fix. **cwd independence
is a precondition for the scripts, not a follow-up**, and it is folded into S10.

## Ruling: the layering — sound, and the leaves agree with each other about why

Both consults reached this independently. The evidence is that the repo's own
rubric is *usable*:

- `packages/server/src/services/README.md:11-60` states a three-weight taxonomy
  (deep module / flat service / `utils/`) and `:253-265` a three-question
  promotion rubric. The inventory at `:236-249` matches the tree.
- `:108-118` pre-answers the most common false positive — a router doing
  `assertCharacterOwner` + `emitCharacterUpdate` inline around a shape-2 service
  is *correct*, not a leak.
- `:195-207` pre-answers the second — `auth.ts`'s batched `$transaction([...])`
  and `character-spell.ts`'s inline spell-rule enforcement are both recorded as
  deliberate, with reasons.
- `packages/server/src/socket/MODULE.md:24-26` records the five per-family
  broadcast wrappers as a deliberate stable-call-site facade over the registry.
- `packages/server/src/socket/broadcast-registry.ts:125-127` records what is
  deliberately *out* of registry scope (presence transitions, connection-envelope
  events) and links the classification record.

Codex adds one framing correction worth keeping: **the model does not require every
request to walk a literal `router → service → utils` chain.** It permits
request-facing services that own auth, transactions and post-commit broadcast;
deeper helpers whose caller deliberately owns those concerns; and routers that keep
straightforward request adaptation. Line count is not the rubric —
`services/README.md:253-265` is.

A layering that answers "where does this belong?" without argument, and that has
already written down its own known exceptions, is not a broken layering. **Do not
plan any of these five leaves as an architecture correction.** The largest router
is 561 lines (`routers/srd.ts`), the largest service 457 (`services/rest-service.ts`);
there is no god file to break up and no service to invent.

The one genuine structural observation the leaves *do* make, and which this plan
elevates, is narrower than "layering": **the server/service seam is deliberately
decoupled from Fastify and pays for that decoupling three separate times.**
`packages/server/src/trpc/context.ts:41` types `req` as
`CreateFastifyContextOptions["req"]`, so routers hold a real `FastifyInstance`;
the widening to `unknown` happens on purpose as values cross into `services/`
(`packages/server/src/services/inventory-service.ts:52-55` states why). The
decoupling is right. The price is a runtime string probe with a `framework` cast
(`utils/socket-helpers.ts:3-9`), a private `WarnLogger` interface plus a nine-line
type guard (`utils/combat-chat.ts:24-38`), a `ServerWithLog` cast
(`utils/character-campaign.ts:26-28`, `:70`), and a fourth partial re-declaration
of the same log shape (`services/map-tokens/types.ts:27-34`). Leaf 02's
`BroadcastHost` port pays it once. That is the cluster's best single change.

### One taxonomy observation, correctly scoped, that this plan does not act on

Codex flags `utils/character-campaign.ts:51-72` (`emitCharacterUpdate`) and
`utils/combat-chat.ts:48-104` as orchestrating persistence and broadcast in `utils/`
against the README's claim that utils do not. **Half of that reading is wrong**: the
"do not own a transaction boundary … and do not emit broadcasts" sentence at
`services/README.md:69-71` is scoped to the *Concurrency primitives* bullet, not to
`utils/` generally. But the unscoped line at `:76-78` — "The distinguishing feature
is 'no orchestration surface'" — does not cover `utils/combat-chat.ts`, which
persists a row, broadcasts it, persists and broadcasts N more, and swallows errors.
That is a placement/documentation question for a future leaf, **not** evidence the
layering has failed, and nothing in this plan touches it.

### The edge the leaves miss: `02 ↔ 04`

The index records `04 → 05`, `05 ↔ 45` and `05 ↔ 46`. It does not record
`02 ↔ 04`, and there are two collisions:

1. **Same file, opposite directions.** Leaf 02 step 5 retypes
   `broadcastRestHpAttribution(server: unknown, …)`
   (`packages/server/src/services/rest-encounter-attribution.ts:37`) to the port
   type; leaf 04 step 5 **deletes that function**.
2. **Two new homes for one kind of type.** Leaf 02 step 2 wants a module holding
   the Fastify augmentation and the pinned decorator key; leaf 04 step 1 wants
   `packages/server/src/socket/socket-types.ts` holding `AppSocket`/`AppServer`.
   Both are "where does the server package declare its socket-facing types?". This
   is the same question `07-PLAN.md` dissolved for the shared-`seed/`-helper home.
   **Decide it once**: S1 creates one home and S2 uses it.

## Ruling: leaf 44 — one defect, three drive-bys, and a sweep this plan refuses

**Keep steps 1-5. Drop steps 6, 7, 8 and 9. That is roughly a fifth of the leaf.**

Steps 1 and 2 are the leaf. The `principle` and `zeroBaselineDisposition.reason`
fields are not prose: they are registry values the repo projects into two
consumers. **But leaf 44's account of which string reaches which consumer is wrong
in both directions, and the correction changes what is urgent.** Traced on
`2cf49496`:

| Consumer | Mechanism | Which strings actually reach it |
| --- | --- | --- |
| `docs/generated/harness-controls.md` | the generator projects `principle` | all four `principle` strings — `:157` → `:570`, `:402` → `:724`, `:420` → `:738`, `:459` → `:766`. **Leaf is right.** |
| The agent regression envelope's `why` | `buildGenericFinding` (`scripts/lint-ratchet/diagnostics.ts:207-225`) reads **`ratchet.zeroBaselineDisposition?.reason`** for `third-party` and `core` ratchets | `zeroBaselineDisposition.reason` at `:405` and `:423`, both on `source: { kind: "third-party" }` testing-library ratchets, both containing "the leaf 06 inventory". **Live today.** |
| — | `buildLocalFinding` (`diagnostics.ts:182-196`) reads `ruleDocsById.get(regression.ruleId).principle` — the **local ESLint rule's** docs metadata, *not* the registry entry | none of the registry `principle` strings. `:157` is `ratchet/local-no-swallowed-errors-broader-semantics` (`ruleId: "local/no-swallowed-errors"`), so it takes this path. |

So the leaf's claim that the four `principle` strings "reach an agent as the
regression envelope's `why`" is **false**, and its claim that the two
`zeroBaselineDisposition.reason` strings "render nowhere today" is **also false** —
they are the ones an agent reads right now. Both sets still need fixing; the
priority is inverted from what the leaf says.

Two more facts that make step 1 cheaper than it looks: `configHashInput`
(`tools/lint-ratchet/src/kernel/baseline-hash.ts:92-107`) hashes only
`files`/`ignores`/`metric`/`mode`/`ruleId`/`ruleOptions`/`typeAwareProject`, so
**editing `principle` or `reason` moves no baseline and needs no
`lint:ratchet:update`**; and `lint-review-2026-06 leaf 03e` (rendered at
`docs/generated/harness-controls.md:752`, `:780`) is the pack-qualified shape
already in the registry to copy.

**One correction to step 2's placement, and one to its rule.** The leaf proposes
extending `bun run harness:check`. `principle` is already validated in three places
— `tools/lint-ratchet/src/kernel/registry-validation.ts:251`,
`scripts/harness/harness-check-validation.ts:178`, and
`scripts/harness/generate-harness-controls-validation.ts:86`/`:160` — and
`scripts/lint-ratchet/check-registry.ts` (296 lines, with an existing
`check-registry.test.ts`) is the repo-side registry checker. Put the rule where the
registry entry is validated, so it covers `reason` — the field the generator never
reads and the one that actually reaches an agent. **Codex argued against the guard
entirely** (see [Where the consults split](#where-the-consults-split-and-the-call));
its brittleness objection is answered by making the rule reject a *bare* coordinate
and explicitly accept the pack-qualified form.

Steps 3, 4 and 5 are three cheap corrections, each a document actively telling a
reader something false:

- `scripts/harness-check.ts:17-20` enumerates nine generated surfaces;
  `harness.controls.json` declares **eleven** (re-counted). The list is derived at
  runtime by `checkGeneratedFreshnessOutputs` (`:90`, called at `:140`), so the
  prose copy can only rot.
- `packages/server/src/services/README.md:220-237` — a section headed "Deferred
  convergence follow-ups" saying "intentionally not done in this doc-first pass",
  under which both bullets read "**(done):**". This is the services charter; an
  agent reading it to decide what is settled gets the wrong answer.
- `tools/lint-ratchet/src/git-rail/info-attributes.ts` states its contract five
  times as "matches the previous awk" (`:7`, `:40-41`, `:79-80`, `:112-113`,
  `:166-167`). The awk was removed in `8b1f3adc` and is not in the tree, so the
  file's stated specification is unverifiable. Half the work is already written:
  `:40-41` parenthesizes the real rule.

**Step 6 is refused as a scheduled unit.** It is the mass qualification of
resolvable backlog ids: five `leaf 50 step 2` sites, two `leaf 40 step N` sites,
nine `ux-audit P0-3` sites, 38 `task NN` occurrences in non-test `scripts/drift-ai/`
`.ts` files (re-counted), plus a dozen singletons. Every one is one `git log -S` or
one `grep -r` away from resolution for the one reader who ever needs it, and the
diff is 60-plus single-line edits across three trees for a reviewer to confirm did
not change meaning. Two carve-outs: `scripts/lib/eslint-json.ts:4-5` names a pack
directory that **does not exist** (`docs/agent_notes/backlog/lint-ratchet-arch`),
which is a wrong statement rather than an unqualified one, and is folded into S13;
and qualify any coordinate in a file you are already editing for another slice.

**Steps 7, 8 and 9 are dropped.** Step 9 is not a comment change at all and the leaf
names it as the natural split point.

## Ruling: leaf 45 — step 1 and step 3 keep, steps 2 and 4 dropped

**Step 1 is the cheapest true-defect fix in the whole cluster.** Verified:
`packages/server/src/utils/encounter-state-mutations.ts:21-22` says
`setEncounterState` "enforces the 5 valid transitions as a compile-time union
derived from the `VALID_TRANSITIONS` tuple". `packages/shared/src/rules/combat.ts:8`
declares `VALID_TRANSITIONS` as `Record<EncounterState, EncounterState[]>` — not a
tuple — and `encounter-state-mutations.ts:44-45` declares two *independent* unions
so the signature admits the full 3×3 cross product. `:47-54` says this correctly.
Delete the false sentence; point at `:47-54`.

**Step 3 is a pure move with a real payoff and no risk.** The Pino business-event
vocabulary at `packages/server/src/app.ts:90-106` is the closed `event` name set,
the `actor` omission rule, the scope-id rule and the `outcome` enum. The file that
*types* it is `packages/server/src/utils/request-logger.ts` — `AuthzOutcome`
(`:33`), `AuthzEvent` (`:42`), and the three emitters `logAuthzDecision` (`:80`),
`logMutation` (`:109`), `logBroadcast` (`:138`) — and `request-logger.ts:27-32`
points *back* at `app.ts` for the contract it enforces. A reader arriving at
either file is sent to the other. Move `:90-106`; leave `:107-113` (redaction and
volume) beside `LOGGER_REDACT_PATHS` at `app.ts:85-88`, where it belongs.

**Step 2 is dropped.** Deriving a five-pair `EncounterTransition` from
`VALID_TRANSITIONS` means re-declaring the constant `as const satisfies`, rewriting
`isValidTransition`'s body (a `readonly ["active"]` tuple rejects `.includes`), a
mapped type with a `[…] extends [never]` guard because `VALID_TRANSITIONS.resolved`
is `[]`, a two-direction assignability pin, and a new `parseEncounterTransition`
that must stay invisible to `scripts/codemods/concurrency-guard/helper-shapes.ts:166`/`:222`
— all to delete two casts that are already *correctly* marked `interop` and that
`docs/guides/local-eslint-rules.md` sanctions. Both consults rated it complexity
for negligible value, and the runtime matrix is already fully pinned at
`packages/shared/src/rules/combat.test.ts:16-65` (16 assertions, 5 true, 11 false).

**Record the mechanism, because leaf 01 is in flight and proposes the wrong one.**
Leaf 01 step 2 says the two casts at `routers/encounter.ts:192-193` could be removed
by "making `isValidTransition` a real type guard". They cannot: a TS type predicate
narrows only the parameter it names, so `from is …` cannot narrow `input.to`. And a
helper returning `{ from: EncounterFromState; to: EncounterToState }` is the same
3×3 cross product the header already misdescribes, so it would drop the casts while
leaving the false claim just as false. **Both routes fail; the casts stay.**

### Ruling: leaf 45 step 4 — the three copies are three altitudes. Drop it.

The leaf asks for roughly 60 lines out of the three `utils/*-mutations.ts`
headers, on the grounds that `docs/CONCURRENCY.md` restates them "at near-verbatim
length". Re-read against the tree, that framing does not hold:

- `packages/server/src/utils/participant-stats-mutations.ts:6-56` is a numbered
  **"six helpers, four shapes" selection guide**. Its shape-4 paragraph (`:43-55`)
  is a *compressed* version of `docs/CONCURRENCY.md:104-129`, embedded in a list
  whose job is "which helper do I call?". Excising one entry from a numbered
  selection list to replace it with a pointer breaks the list, not the duplication.
- The index names exactly this file family in its keep-verbatim list, and the
  leaf's own caveats then concede that `:17-33` (shape 1 vs shape 2 side by side)
  must stay, that `setParticipantTurnOrigin`'s JSDoc (`:221-231`) *depends* on the
  header, and that `clearParticipantTurnOrigin`'s JSDoc (`:248-268`) carries
  material in neither the header nor `CONCURRENCY.md`.

A file-local header, a cross-cutting doc and a per-function JSDoc saying related
things at three different altitudes is a documentation pattern, not triplication.
The downside of getting the trim wrong is a lost concurrency invariant; the upside
is 60 lines of prose in files nobody reads for length. Both consults said drop, one
of them calling the headers "the highest-value comments in the server". **Refused.**

## Ruling: leaf 46 — two scheduled items, not eight

**Keep step 7 (the bug) and step 6 (the name that contradicts its control flow).
Steps 1 and 3 are optional. Steps 2, 4, 5 and the client `pid` sweep are dropped.
Step 8 is replaced.**

The leaf's own severity is **low** and its own summary says "None of this is a bug
(except the attack-worded spell denial)". Take that at face value.

**Step 7 is the exception and is worth its own slice.** Verified: the exported
type and the log event already say *combatant* (`encounter-combat-auth.ts:16`
`EncounterCombatantResult`, `event: "authz.encounter.combatant"` at `:52`, `:62`,
`:80`, …) while the argument and the deny reason say *attacker* (`:31`
`attackerParticipantId`, `:84` `reason: "not_attacker_owner"`), and
`services/encounter-combat/spell-action.ts:18-23` routes the spell path through
the same door with `input.casterParticipantId`. The user-visible half — the two
messages at `:57`, `:69` and `:88` — is a bug fix and ships as its own commit.

**Step 6 is scheduled, on codex's argument.** `finishTopLevelCommand`
(`services/character-live-state/side-effects.ts:27-44`) is invoked at the *top* of
every command as `return finishTopLevelCommand(ctx, {…})` and its body runs the
command, logs and emits. Its two siblings in the same file describe themselves
accurately, so it is the lone outlier, and `character-live-state/MODULE.md:56`
explains the envelope in prose. It is module-private, compiler-checked except two
test *titles* (`stats-conditions.test.ts:169`, `:195`), and it is the one rename in
the leaf that buys architectural clarity rather than tidiness.

**Steps 1 and 3 are optional.** Step 1 (`utils/combat-chat.ts:92`, where `action`
holds a `ChatMessage` while `msg.action` in the same statement is the action label)
is a four-line diff removing a same-statement collision. Step 3 (`routers/srd.ts`,
where `f` is a `ClassFeatureRow` at `:142` and a `FeatRow` at `:214`, 72 lines
apart, in a domain where both are Prisma models) is parameter names inside mappers
with no call-site churn. Both are cheap and both are taste as much as defect; they
are bundled as one opportunistic slice. **Step 3 also discharges leaf 05 step 3**,
which prescribes the same sweep over six of the ten spellings — so if S19 is not
done, leaf 05 step 3 is not done either, and that is the intended outcome.

**Steps 2 and 4 are dropped.** `chatMsg`/`chatPayload` (`services/rest-service.ts`)
is one file of private locals where, as codex put it, some of the names are already
defensible. `EpochWindow` → `TimedRunOutcome` (`scripts/lib/verify-metadata-core.ts:78`)
is a non-exported type in one file, and the leaf spends a paragraph arguing about
what the right replacement name even is; the file is also copied verbatim into
sandbox repos by the shell tests (`:16-18`), so the rename drags in the scripts
smoke suite for a private name.

**Step 5 is dropped.** It renames the SRD procedure-factory arguments `item` →
`itemSchema` and `fetch` → `query`, across `utils/srd-query-helpers.ts` and *both*
consumers: 26 sites in `routers/srd.ts` and 18 in `srd-query-helpers.test.ts`. The
leaf's own text concedes that `item` is *correct* (it is the array element schema,
wrapped at `:39`/`:58`) and merely "reads as a domain object", and the `fetch`
complaint is that a destructured local shadows a global this code never calls —
nothing in the repo lints it. 44 call sites against a taste objection is the
review-attention trade this plan refuses.

**Step 8 is replaced.** The leaf wants the client fog-callback rectangle respelled
`width`/`height` while the persisted `FogRegion` keeps `w`/`h`, with an explicit
translation at `components/campaign/maps/map-fog-actions.ts:51` where
`{ id, ...rect }` currently spreads straight into `addFogRegion`. That trades a
spelling inconsistency for a *new* failure mode: a translation point someone can
later re-collapse into a spread, in the one place a persisted fog layer is built,
plus a containment comparison at `:58-59` that reads both shapes in one expression
and would have to be reasoned about rather than left alone. The actual defect in
the leaf's own evidence is different and cheaper: the `{ x; y; w; h }` callback
shape is **re-declared inline at five sites**
(`hooks/canvas-input/tool-handlers.ts:139`, `hooks/canvas-input/use-canvas-input.ts:41`,
`components/campaign/maps/map-canvas.tsx:35`,
`components/campaign/maps/map-fog-actions.ts:32` and `:47`). Extract that shape
once, keep the `w`/`h` spelling, and stop — S20.

**The client `pid` sweep is accepted from leaf 17 and then dropped.**
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) moved leaf 17 step 7 here to
dissolve its `14 → 17` edge, not because it judged the sweep worth doing — its own
rejected-alternatives row calls it "pure rename churn across six files".
Re-measured on `6cf8c78d5`: **27 whole-word `pid` occurrences across 6 client
files, plus 6 camel-cased carrier lines** — `hpPid` in one of those same six
files and `targetPid` in a seventh. This plan takes
ownership so the item is not orphaned, and rules it **not scheduled**: opportunistic
only, with the leaf's exact verification (`rg -n '\bpid\b|[A-Za-z]Pid\b'
packages/client/src` returning nothing — a bare `\bpid\b` check passes while `hpPid`
survives). One trap for whoever does it:
`components/campaign/combat/combat-map-content.tsx:121` writes `participantId: pid`,
which collapses to a shorthand property after the rename.

## Where the consults split, and the call

| Question | codex | cursor | Call |
| --- | --- | --- | --- |
| **Leaf 44 step 2 — the coordinate guard** | Do not add. Duplicates registry policy, and qualified references like `lint-review-2026-06 leaf 03e` make a lexical rule brittle. | Highest-value part of the leaf; it is what makes step 1 permanent. | **Add it**, in `scripts/lint-ratchet/check-registry.ts`, rejecting a *bare* `leaf <N>` / `task <NN>` / `P<n>-<n>` and explicitly accepting the pack-qualified form. Codex's brittleness objection is real and is answered by the carve-out, not by dropping the guard; without it, step 1 regresses on the next ratchet added. Cost: one rule and one test case in a file that already exists for this. |
| **Leaf 46 step 7 — rename `not_attacker_owner`?** | Keep it. It is stable observability vocabulary alongside the event name. | Rename it; log vocabulary, same commit as the union. | **Rename it.** Codex conflated the reason with the event. The event string `authz.encounter.combatant` *is* stable identity — asserted 7 times and prefix-matched by `logs-audit` — but `scripts/logs-audit/logs-audit-event-fields.ts` holds **no reason literals** (structural check at `:87-96`, `authz.` prefix at `:186`), and `not_attacker_owner` has exactly four live occurrences. It is also *wrong* on the spell path. The event string does not move. |
| **Leaf 46 steps 1-4 — the file-local renames** | Drop all four; opportunistic only. | Mechanical, low meaning change, still review cost. | **Split.** Steps 1 and 3 survive as one optional slice (S19) because each fixes a real two-meanings-one-name hazard; steps 2 and 4 are dropped. Two models leaning drop is enough to demote all four out of the scheduled set. |
| **Leaf 46 step 6 — `finishTopLevelCommand`** | Keep — the one rename with real architectural clarity. | Lumped with the mechanical churn. | **Keep, scheduled (S16).** Codex is the only one who argued for it and the argument is specific: the name contradicts the control flow in a module whose MODULE doc documents the envelope. Contained and compiler-checked bar two test titles. |
| **Leaf 04 step 4 — thin the per-family tests** | Do not: saved lines are not worth lost contract coverage. | Keep. | **Keep (S3), with a precondition.** The repo's own design says these assertions belong in `broadcast-registry.test.ts` — `broadcast-registry.ts:119-123` and `socket/MODULE.md:59-60` both say so. Codex's objection is generic and does not engage with that, but it converts cleanly into a check: before deleting any assertion, confirm the equivalent exists in `broadcast-registry.test.ts`. |
| **Leaf 03 — how far to go** | Test-only caller normalization; do not churn production helper signatures. | Keep steps 1-5, defer step 6. | **Split at the real seam.** Traced: `getAuthzUserId`/`getAuthzLogContext` have four internal call sites (`character-auth.ts:90-91`, `:129-130`, `:205-206`, `encounter-combat-auth.ts:106-107`) and all four collapse to plain property reads once the union is narrowed — **no production signature change needed**. So S8 (steps 1, 2, 3, 5, 7) delivers the union removal and the helper deletion at ~27 sites, and only the last re-split at `:205-207` needs step 4's 21-site signature change, which becomes optional S17. Both consults get what they asked for. |

Where they **agreed**: the layering is sound and needs no restructuring; leaf 02 is
the highest-value slice; `server: unknown` must not become `FastifyInstance`; leaf
44 is mostly busywork; the `*-mutations.ts` headers must not be trimmed; leaf 45
step 2 is not worth its complexity; the socket wrapper files stay; leaf 06 must not
promise a drift gate; and leaf 05's `assertTurnLock` merge and `srd.ts` split should
both be dropped.

## Corrections to the leaves, verified

1. **Leaf 44's diagnostics claim is wrong in both directions.** See the leaf-44
   ruling table. `diagnostics.ts:196` is inside `buildLocalFinding` and reads the
   *local ESLint rule's* docs metadata, not the registry `principle`; the agent
   envelope's `why` for third-party ratchets comes from
   `zeroBaselineDisposition.reason` at `diagnostics.ts:214`/`:225`. The two `reason`
   strings the leaf calls inert are the live agent-facing ones.
2. **Editing `principle` or `reason` moves no ratchet baseline.**
   `configHashInput` (`tools/lint-ratchet/src/kernel/baseline-hash.ts:92-107`)
   excludes both fields. No `lint:ratchet:update` in S12.
3. **Leaf 44's inventory of bare coordinates in ratchet metadata is two sites
   short, and the second is in a different source file.** Re-swept on `2cf49496`:
   `scripts/lint-ratchet/lint-ratchet-config.ts:479` carries
   `principle: "… while Leaf 41 drain work proceeds."` on
   `ratchet/vitest-valid-expect-script-tests`, rendered at
   `docs/generated/harness-controls.md:794`; and `harness.controls.json:1722`
   carries `"principle": "Detect drift between the Leaf 41 lint coverage map …"`
   on `check/lint-coverage-map`, rendered at
   `docs/generated/harness-controls.md:1870`. Six bare coordinates are rendered
   today, not four. The manifest site is why S12's guard needs a home in
   `scripts/harness/harness-check-validation.ts` as well as in the registry
   checker — a registry-only rule would not have caught it, and a doc-only rule
   would not catch the two `reason` strings.
4. **Leaf 05 step 5's "~50 lines to `utils/`" is not all extractable as a pure
   helper, and the block it moves has a race.** `calcMaxPrepared`
   (`routers/character-spell.ts:46`) is pure and moves cleanly. The enforcement
   block at `:195-224` is not: it runs `prisma.character.findUniqueOrThrow` and
   `prisma.characterSpell.count` inline, and the count-then-update at `:207-228` is
   the check-then-act race recorded above.
5. **Leaf 06 step 2 as written breaks all four generators** — they resolve paths
   from `process.cwd()`. See the second live defect above.
6. **Leaf 04 cites `presence-multi-tab.test.ts` without a path and it is not in
   `socket/`.** It is `packages/server/src/services/presence-multi-tab.test.ts`.
   `packages/server/src/socket/campaign-room.test.ts` does exist.
7. **Leaf 05 step 1 is viable exactly as described.** `mergeRouters` is on the
   `initTRPC` root object in the installed `@trpc/server` 11.17.0 (declared at
   `unstable-core-do-not-import.d-BdVSvUCr.d.mts:1738`), and
   `packages/server/src/trpc/trpc.ts` exports only `router` (`:82`),
   `publicProcedure` (`:84`) and `protectedProcedure` (`:93`).
   `routers/homebrew.ts:404-405` is the only non-test `_def` reach-in in
   `packages/server/src`, and `routers/routers-MODULE.md:109` is the only doc
   outside `docs/agent_notes/` that names the mechanism.
8. **Leaf 03's counts hold.** Re-measured: 21 union call sites in
   `utils/character-auth.test.ts` (14 string + 7 object) and 16 in
   `utils/encounter-combat-auth.test.ts` (9 + 7) — 23 string-arm sites total;
   `assertCharacterOwner` has 21 call sites excluding its declaration; and
   `assertCampaignMember`/`assertCampaignDm` have 42 production plus 16 test call
   sites excluding their two declarations, i.e. the 58 the leaf claims.
9. **Leaf 44's `harness-check.ts` count holds**: nine surfaces named in the comment
   against **11** `generatedSurface` entries in `harness.controls.json`.
10. **Leaf 46's note about `request-logger.ts:35-41` is right and matters to leaf
   45 step 3.** That comment claims
   `scripts/logs-audit/logs-audit-event-fields.ts` "matches these strings exactly";
   the script holds no event or reason literals (structural `reason` validation at
   `:87-96`, `authz.` prefix match at `:186`). Real enforcement is the union plus
   `packages/server/src/utils/__type-tests__/authz-vocabulary-restrictions.ts`. The
   literals still must not change while moving the block, but the *comment* is
   wrong and S14 corrects it.
11. **Leaf 06's step-9 trap is real.** `packages/server/src/test/prepare-test-db.ts:26`
    bounds the worktree slug at `[a-z0-9_]{1,49}`, while `test-database-url.ts:105`'s
    `worktreeTestDatabaseSlug` validates with an unbounded `/^[a-z0-9_]+$/`.
    Importing the parser's regex *widens* the sole gate (`assertSafeTestDbUrl`,
    `:55-63`) in front of `DROP SCHEMA IF EXISTS "public" CASCADE` (`:111`). Of the
    four re-spelled pieces, only `WORKTREE_DB_PREFIX` (`test-database-url.ts:28`) is
    exported today.
12. **Leaf 06 gains four items from `07-PLAN.md`, all re-resolved:** the no-op
    `features.map((f) => ({ ...f, id: f.id }))` at `seed/generate-subclasses.ts:129`,
    the identical branches at `seed/rules-glossary-parser/parse-glossary-entry.ts:41-46`,
    the `ABILITY_MAP` derivation at `seed/spell-parser/extract-spell-metadata.ts:8`,
    and `compareCodePoint` at `seed/spell-parser/extract-spell-combat.ts:66`.
    `packages/server/src/utils/string-order.ts` does **not** exist yet — slice 07.1
    creates it — so if 07.1 has landed the seed comparator points there rather than
    at a new seed-local helper. That is the "one home" decision `07-PLAN.md` hands
    to leaf 06.
13. **Codex's "utils orchestrate" P2 half-holds.** The "do not emit broadcasts"
    sentence at `services/README.md:69-71` is scoped to concurrency primitives, not
    to `utils/` at large. The unscoped `:76-78` line is the one
    `utils/combat-chat.ts` sits awkwardly against. Not acted on here.

## Leaf disposition

| Leaf | Disposition | Why |
| --- | --- | --- |
| **02** | **Keep in full** → S1, S2 | The one place in this cluster where a rename or a deletion silently disables every broadcast at runtime and nothing fails to compile. Steps 1-3 are one unit (the augmentation types readers, the pinned key catches a rename, the `app.test.ts` pair catches a deletion). Steps 4-6 pay the decoupling toll once instead of four times. Absorbs leaf 04 step 1. Both consults ranked it first. |
| **03** | **Keep steps 1-3, 5, 7; steps 4 and 6 optional** → S8, S17, S18 | The authorization *model* is correct; this is signature convergence. Traced: the two unwrap helpers collapse to property reads once the union is narrowed, at four internal sites, **without** any production signature change — so S8 delivers the leaf's whole motivating defect at ~27 sites. Step 4 (21 sites) buys only the last re-split at `character-auth.ts:205-207`; step 6 (66 sites) buys consistency in two more files. Both optional. |
| **04** | **Keep steps 1, 2, 4, 5; step 3 optional; drop step 6** → S1, S3, S4, S5 | Step 1 merges into S1 (see the `02 ↔ 04` edge). Steps 2 and 4 delete scaffolding behind a finished migration and are the leaf's honest core. Step 5 is a real dedupe *and* the precondition for leaf 05's step 4b. Step 3 is a genuine type improvement with no user-visible payoff — optional. Step 6 is dropped: the leaf itself says cutting it "loses nothing else", it is the only medium-risk item, and it saves three lines. |
| **05** | **Keep steps 1, 2, 4a; reframe step 5; drop steps 3, 4b, 6, 7** → S6, S7 | Steps 1, 2 and 4a are three small drifts against a sound design. Step 5 is reframed: the extraction is testability only, and the race it sits on is a separate decision (see the two live defects). Step 3 is leaf 46's (S19). Step 4b resolves to "do nothing": S5 dissolves `rest-encounter-attribution.ts`, leaving rest with two internal files, so `services/README.md:21-28` criterion 3 fails and rest stays a flat service with the corrected companion doc — what `services/README.md:40` prescribes. Step 6 is navigational only. Step 7 merges two race-sensitive lock branches for a 24-line saving with only the DM branch under unit test. |
| **06** | **Split at its own fault line: step 9 first and alone, keep 1-4 with a new precondition; park 5-8** → S9, S10, S11 | Step 9 is not seed pipeline, is the highest-actual-risk item, and guards a `DROP SCHEMA`. Steps 1-3 are the coherent core — but step 2 must be preceded by making the generators cwd-independent or the scripts it adds are broken on arrival. Step 4 absorbs the four items `07-PLAN.md` hands over. Steps 5-8 all rewrite or depend on committed generator output that **no gate and no implementer without `docs/refs/` cloned can verify**; step 8 additionally carries an explicit abandon condition. |
| **44** | **Cut to a fifth, with its central evidence corrected** → S12, S13 | Steps 1-2 fix six strings that reach an operator doc and an agent envelope — though not the way the leaf says (correction 1). Steps 3-5 are three documents that state something false. Steps 6-9 are 60-plus single-line coordinate qualifications plus one code-structure change mislabelled as comment work. Refused. |
| **45** | **Keep steps 1 and 3; drop steps 2 and 4** → S14 | Step 1 is the cluster's cheapest defect fix. Step 3 is a pure move that puts a contract beside the types that enforce it. Step 2 is type complexity for two correctly-marked casts, and both consults said drop. Step 4 trims a numbered helper-selection guide against a cross-cutting doc; three altitudes, not three copies. |
| **46** | **Two scheduled items, two optional, four dropped** → S15, S16 (+ S19, S20) | Step 7 fixes a wrong user-facing message. Step 6 fixes a name that contradicts its control flow. Steps 1 and 3 are optional. Steps 2, 4 and 5 and the inherited client `pid` sweep are dropped. Step 8 is replaced by extracting the five inline rect declarations while leaving the persisted spelling alone. |

## Slices

S1-S16 are scheduled in order; S17-S20 are optional. Each row is one agent session.
`bun run test -- <paths>` is the focused form; `bun run test:scripts:file -- <path>`
is the scripts-project form. Every path below was existence-checked on `2cf49496`.

| # | Slice | Done criteria | Verify |
| --- | --- | --- | --- |
| **S1** | **One home for the server's socket types, and a decorator key the compiler pins (M, leaf 02 steps 1-3 + leaf 04 step 1). Land this first — both consults ranked it the cluster's best change.** Create one module under `packages/server/src/socket/` holding (a) the `declare module "fastify"` augmentation adding **`io?: AppSocketServer`** — optional, because `app.ts:249` only decorates when `opts.enableSocketIO !== false`; (b) `export const IO_DECORATOR_KEY: Extract<keyof FastifyInstance, "io"> = "io";`; and (c) the `AppSocket` / `AppServer` aliases currently re-declared at `socket/auth-middleware.ts:11`, `socket/connection-handler.ts:13-14` and `socket/campaign-room-handler.ts:27-28`. Rewrite `app.ts:254` to `server.decorate(IO_DECORATOR_KEY, io)`; repoint the three alias sites; have `socket/index.ts` keep re-exporting `AppSocketServer` so its 18 existing importers are untouched. Add two assertions to `packages/server/src/app.test.ts`: an app built with sockets exposes `io`, and one built with `enableSocketIO: false` does not — `app.test.ts:195` already builds the second case. **The augmentation alone does not catch a rename** (`decorate`'s `P extends string \| symbol` swallows an unknown key), and it cannot catch a deletion because `io` must stay optional; the pinned key and the two assertions are what close those. **Do not make `io` required.** | `grep -rn 'declare module "fastify"' packages/server/src` returns 1, up from 0; `grep -n 'decorate("io"' packages/server/src/app.ts` returns 0, down from 1; `grep -rn "type AppSocket = Socket<" packages/server/src/socket` returns 1, down from 3; two new `app.test.ts` assertions exist | `bun run test -- packages/server/src/app.test.ts packages/server/src/socket/auth-middleware.test.ts packages/server/src/socket/connection-handler.test.ts packages/server/src/socket/campaign-room.test.ts` then `bun run typecheck` |
| **S2** | **The `BroadcastHost` port: delete the runtime probe and the three hand-rolled log shapes (M, leaf 02 steps 4-6).** Declare one server-side port that an augmented `FastifyInstance` satisfies structurally, with **both members optional**: `interface BroadcastHost { readonly io?: AppSocketServer; readonly log?: { warn(obj: object, msg: string): void } }`. Retype the ten `server: unknown` declarations to `BroadcastHost \| undefined` — `services/encounter-combat/types.ts:8`, `services/character-live-state/types.ts:7`, `services/inventory-service.ts:60`, `services/weapon-mastery-service.ts:23`, `services/map-tokens/types.ts:17`, `utils/character-campaign.ts:32`, `services/rest-service.ts:143`, `utils/combat-chat.ts:12`, and the bare params at `services/rest-service.ts:119` and `services/rest-encounter-attribution.ts:37`. Narrow `getSocketIO` (`utils/socket-helpers.ts:3`) to `server?.io ?? null`, deleting the `"io" in server` probe and its `framework` marker. Delete `WarnLogger` / `hasWarnLogger` (`utils/combat-chat.ts:24-38`), rewriting `warnCombatChatFailure` as `server?.log?.warn(…)` with its swallow-and-log behaviour unchanged, and delete `ServerWithLog` and its cast (`utils/character-campaign.ts:26-28`, `:70`). Express `MapDeleteServiceContext` (`services/map-tokens/types.ts:27-34`) as a **`log`-required narrowing** of the port — `map-tokens/map-cascade.ts:47` dereferences it unconditionally. Update the `getSocketIO` signature documented at `socket/MODULE.md:31`. Give `services/encounter-combat/participant-action.test.ts:446`'s raw io fake the `as unknown as AppSocketServer` the other fakes already use. **Do NOT retype the contexts as `{ req: { server: FastifyInstance } }`** — that re-couples nine files to Fastify and is the decoupling `inventory-service.ts:52-55` documents; both consults said so unprompted. **Neither port member may be required**: 18 test contexts pass `server: {}` and two pass `server: undefined`. | `grep -rn "server: unknown" packages/server/src` returns 0, down from 13; `packages/server/src/utils/socket-helpers.ts` contains no `type-assertion-boundary` marker and no `"io" in`; `grep -n "WarnLogger\|ServerWithLog" packages/server/src/utils/*.ts` returns 0; `socket/MODULE.md:31` names the new parameter type | `bun run test -- packages/server/src/utils/combat-chat.test.ts packages/server/src/utils/character-campaign.test.ts packages/server/src/services/inventory-service.test.ts packages/server/src/services/weapon-mastery-service.test.ts packages/server/src/services/map-tokens/link-conflict.test.ts packages/server/src/services/map-tokens/empty-string-semantics.test.ts packages/server/src/services/encounter-combat/participant-action.test.ts packages/server/src/services/rest-service.test.ts` then `bun run typecheck` and `bun run lint` |
| **S3** | **Take down the scaffolding behind the finished registry migration (S, leaf 04 steps 2 and 4).** Commit 1: retitle the numbered block at `socket/broadcast-registry.ts:106-123` to "Adding a registry event", drop the `DX5.3c-DX5.3f` parenthetical and step 2's migration wording, keep steps 1 and 3. **Keep the `socket-emit-inventory.md` link at `:125-127` exactly as it is** — it is the classification record for what is deliberately out of registry scope. Commit 2: thin the four one-expression per-family tests (`map-broadcast.test.ts` 44 lines, `campaign-broadcast.test.ts` 90, `character-broadcast.test.ts` 90, `encounter-broadcast.test.ts` 123 — 347 total over five one-line functions) to one assertion each: the helper forwards its positional arguments into the right registry event name and payload shape (spied `broadcast`), plus the `io === null` no-throw case. A table-driven test over the four thin helpers is the natural shape. **Precondition, because codex dissented on this step:** for every assertion you delete, first confirm the equivalent exists in `broadcast-registry.test.ts` (598 lines; it indexes all seven event keys at `:109`, `:136`, `:160`, `:190`, `:214`, `:234`, `:254`). Name the covering assertion in the commit message. Then delete the room-delivery, outsider-non-delivery and `socket.broadcast` log re-assertions (`encounter-broadcast.test.ts:92`, `:108`), per `broadcast-registry.ts:119-123` and `socket/MODULE.md:59-60`. **Keep the five wrapper files** (`socket/MODULE.md:24-26` documents them as the deliberate stable-call-site facade) and **keep `chat-broadcast.test.ts` (328 lines) out of scope** — it tests real whisper-routing logic at `chat-broadcast.ts:33-37`, not the registry. | `grep -n "DX5.3" packages/server/src/socket/broadcast-registry.ts` returns 0, down from 1; `:125-127` byte-unchanged; the four per-family test files total under ~120 lines, down from 347; `broadcast-registry.test.ts` is unchanged and the commit message names its covering assertion for each deletion; the five wrapper files are unchanged | `bun run test -- packages/server/src/socket/broadcast-registry.test.ts packages/server/src/socket/map-broadcast.test.ts packages/server/src/socket/campaign-broadcast.test.ts packages/server/src/socket/character-broadcast.test.ts packages/server/src/socket/encounter-broadcast.test.ts packages/server/src/socket/chat-broadcast.test.ts` |
| **S4** | *(Optional.)* **Split the registry entry type so the runtime throw becomes a type error (M, leaf 04 step 3).** Two separately-keyed registries — room-delivered and user-targeted — or a keyed conditional type; a plain union is not enough because `broadcast<Name extends RegisteredEvent>` indexes `BROADCAST_REGISTRY[name]` generically. **`chat:newMessage` must appear in both halves** (`chat-broadcast.ts:33-46` calls `broadcastToUsers` for whispers and `broadcast` for room messages); `notification:new` appears only in the user-targeted one. The user-targeted entry shape is `{ schema, logFields, emitToUsers }` — dropping `emit` deletes the throwing stub at `broadcast-registry.ts:190-192` and the unusable `room: () => ""` at `:188`. Give `emitToUsers` a `room: string \| undefined` parameter and pass `options.room` straight through, deleting the `entry.room(validated)` fallback at `:272`; **do not substitute `options.room ?? ""`**, which relocates the sentinel into shared code. **Keep `logFields` required on both halves** — `:59-65` states the invariant so a new event cannot opt out of the logging contract, so `:189`'s `logFields: () => ({})` survives and `:264` is unchanged. **Keep the sweep honest**: `broadcast-registry.test.ts:478-479` iterates `Object.keys(BROADCAST_REGISTRY)` to enforce that contract; export a combined object or run the sweep over both halves. No runtime behaviour changes. | `grep -n 'room: () => ""' packages/server/src/socket/broadcast-registry.ts` returns 0, down from 1; the `if (!entry.emitToUsers) throw` guard at `:269` is gone; `logFields` is required on both halves; the `Object.keys` sweep covers all seven events | `bun run test -- packages/server/src/socket/broadcast-registry.test.ts packages/server/src/socket/chat-broadcast.test.ts packages/server/src/services/notification-service.test.ts packages/server/src/routers/notification.test.ts` then `bun run typecheck` |
| **S5** | **One HP-attribution broadcaster (S, leaf 04 step 5). Precondition for the leaf-05 rest decision.** Keep a single post-commit fan-out over `readonly LoggedHpChange[]`. `broadcastRestHpAttribution` (`services/rest-encounter-attribution.ts:36-44`) and `broadcastLoggedHpChange` (`services/character-live-state/encounter-attribution.ts:20-32`) differ only in `(server, changes, logger?)` versus `(ctx, changes)`, and `RestContext` (`rest-service.ts:140-145`) is already structurally assignable to `CharacterLiveStateContext` (`character-live-state/types.ts:4-9`). Drop the `logRestHpChange` / `RestHpChange` pass-through (`rest-encounter-attribution.ts:16-33`) — it only relabels `before`/`after` into `beforeHp`/`afterHp`/`tempHp` on the way to `logCharacterHpChangeInTx` — or, at minimum, move the JSDoc at `:7-15` (which describes a *function*) off `export interface RestHpChange` and onto `logRestHpChange` at `:25`. Decide where the surviving broadcaster lives before starting; leaving it in `character-live-state/` makes `rest-service.ts` import across service modules. Call sites are `rest-service.ts:317`, `:442`, `stats-conditions.ts:105`, `:138`. Fold `rest-encounter-attribution.test.ts`'s surviving assertions (`:70` `describe("logRestHpChange")`, `:219` `describe("broadcastRestHpAttribution")`) into `character-live-state/encounter-attribution.test.ts` rather than deleting them. **Keep `encounter-hp-log.ts:4-25` and `:106-110` verbatim** and **keep the `InTx` suffix on `logCharacterHpChangeInTx`** — it marks a real invariant (the function takes a `TxClient`). | `grep -rn "broadcastRestHpAttribution" packages/server/src` returns 0; exactly one function fans out over `LoggedHpChange[]`; no assertion from `rest-encounter-attribution.test.ts` is lost; `utils/encounter-hp-log.ts` is byte-unchanged | `bun run test -- packages/server/src/services/character-live-state/encounter-attribution.test.ts packages/server/src/services/rest-service.test.ts packages/server/src/routers/encounter-hp-attribution.test.ts packages/server/src/services/character-live-state/stats-conditions.test.ts` |
| **S6** | **Three router and doc drifts (S, leaf 05 steps 1, 2, 4a).** Commit 1: add `export const mergeRouters = t.mergeRouters;` to `packages/server/src/trpc/trpc.ts` and rewrite `routers/homebrew.ts:403-406` to use it; procedure keys and the `trpc.homebrew.*` surface are unchanged. In the same commit update `routers/routers-MODULE.md:109`, swapping `..._def.procedures` for `mergeRouters` and keeping the "no own mount key" note. Commit 2: reshape `getRefreshTokenFromCookie` (`routers/auth.ts:52-63`) to return `string \| null`, let logout (`:253`) throw at its own site, and delete the hand-inlined `parseCookies` at `:185-186` and the four-line comment at `:181-184` that exists only to explain the divergence. **Behaviour must not move**: logout keeps throwing the same UNAUTHORIZED / `INVALID_REFRESH_MESSAGE` pair, and refresh keeps emitting `logMutation({ event: "auth.refresh", outcome: "failure", reason: "invalid_refresh" })` *before* throwing. Commit 3, doc only: rewrite `services/rest-MODULE.md:5-8` so it describes the actual file set instead of asserting rest is a single file. **Preserve the `Serializable` isolation choice, its anti-dependency rationale, the P2034 retry loop, the CAS helpers and the Stats→CC lock ordering verbatim.** | `grep -n "_def" packages/server/src/routers/homebrew.ts` returns 0, down from 2 (a repo-wide `_def` grep is not a usable criterion: `app-router.output-coverage.test.ts` reaches into `_def` on purpose, and `services/character-live-state/mapping.ts:25` names a migration containing `_default`); `routers-MODULE.md:109` names `mergeRouters`; `routers/auth.ts` calls `parseCookies` once; `rest-MODULE.md` no longer says "Single-file flat service" | `bun run test -- packages/server/src/routers/homebrew-entry.test.ts packages/server/src/routers/homebrew-campaign.test.ts packages/server/src/routers/homebrew-collection.test.ts packages/server/src/routers/homebrew-import.test.ts packages/server/src/routers/auth-refresh.test.ts packages/server/src/routers/auth-logout.test.ts` then `bun run typecheck` and `bun run module:index:check` |
| **S7** | **Prepared-spell rule out of the router — and an honest statement about what that does not fix (S, leaf 05 step 5, reframed).** Write the tests first; the payoff of the extraction *is* testability. Move `calcMaxPrepared` (`routers/character-spell.ts:46`) to `packages/server/src/utils/prepared-spells.ts` with a pure `assertPreparedLimit(maxPrepared, preparedCount)` beside it, and have the procedure at `:195-224` call both. **The two Prisma reads stay in the procedure** — `prisma.character.findUniqueOrThrow` and `prisma.characterSpell.count` are not part of the rule (correction 4). **The commit message must state that this does not fix the limit**: the count at `:207-213` and the update at `:225-228` are still a check-then-act race outside any transaction, so two concurrent `togglePrepared` calls at `maxPrepared - 1` both pass. Serializing it is a *separate decision* — it means giving `togglePrepared` a transaction boundary and a compound-WHERE or count-inside-tx guard, which re-answers `services/README.md:253-265` Q1 in favour of a **flat service** (not `services/character-spells/`), and it needs `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md` in the loop plus a concurrent last-slot test. Record it as a follow-on with an owner call; do not fold it into this slice. **Do NOT create `services/character-spells/`** for the extraction alone: no transaction boundary today, so Q1 routes it to `utils/`, and `services/README.md:203-207` already records the inline enforcement as known. Two things not to claim in the commit message: mapping is *already* extracted (`utils/spell-mapping.ts`, `services/spell-casting/combat-eligibility.ts`), and inline single-row persistence plus `emitCharacterUpdate` is the documented correct shape for a router calling a shape-2 helper (`services/README.md:108-118`). | `packages/server/src/utils/prepared-spells.ts` and a colocated test exist; `grep -n "function calcMaxPrepared" packages/server/src/routers/character-spell.ts` returns 0; unit tests cover the over-prepare rejection with no tRPC caller; the `Cannot prepare more than N spells` message is unchanged; the commit message names the unfixed race and the follow-on decision | `bun run test -- packages/server/src/utils/prepared-spells.test.ts packages/server/src/routers/character-spell.test.ts` then `bun run typecheck` |
| **S8** | **One authz caller shape, without touching a production signature (M, leaf 03 steps 1, 2, 3, 5, 7). The ordering is a typecheck constraint, not a preference.** Commit 1: export `AuthzCallerContext` from `utils/request-logger.ts:13-15`. Nothing else changes; no production caller carries an explicit `AuthzCaller` annotation. Commits 2-3: migrate the 23 string-arm call sites to the object form, one test file per commit — 14 in `utils/character-auth.test.ts` (`:157`, `:162`, `:168`, `:177`, `:195`, `:211`, `:258`, `:264`, `:270`, `:276`, `:285`, `:332`, `:338`, `:351`) and 9 in `utils/encounter-combat-auth.test.ts` (`:165`, `:174`, `:181`, `:187`, `:192`, `:204`, `:213`, `:222`, `:234`); `user.id` becomes `{ userId: user.id }`. Each compiles on its own because the union still accepts both arms, and this **must** come before the narrowing. Commit 4: narrow `AuthzCaller` to `AuthzCallerContext` (or delete the alias in favour of the exported interface); the typecheck failure list is the checklist for anything commits 2-3 missed. Commit 5: delete `getAuthzUserId` / `getAuthzLogContext` (`request-logger.ts:19-25`) and inline their four call sites — `character-auth.ts:90-91`, `:129-130`, `:205-206` and `encounter-combat-auth.ts:106-107` — as plain property reads. **No production helper signature changes in this slice**; `assertCharacterOwner` keeps its positional `userId`, so `character-auth.ts:205-207` still re-splits, now in two inline lines instead of three. Commit 6: rename `MutableNote` (`utils/note-auth.ts:9`) to `NoteMutationAccess` — it returns an access decision, not a note. **Preserve the NOT_FOUND-vs-FORBIDDEN semantics verbatim** (`docs/adr/0002-character-not-found-semantics.md` lists `character-auth.test.ts` under `enforced_by`, so commits 2-3 edit a gate file) and **keep the one-log-per-boundary comments at `campaign-auth.ts:17-19` and `note-auth.ts:22-24` verbatim**. Do not reorder the `assertCharacterOwner`-before-`assertCharacterLinkedToCampaign` sequence at `services/inventory-service.ts:184`/`:191`. | `grep -n "AuthzCaller = string" packages/server/src/utils/request-logger.ts` returns 0; `grep -rn "getAuthzUserId\|getAuthzLogContext" packages/server/src` returns 0, down from 12; `grep -rn "MutableNote" packages/server/src` returns 0; no production helper signature changed | `bun run test -- packages/server/src/utils/character-auth.test.ts packages/server/src/utils/encounter-combat-auth.test.ts packages/server/src/utils/note-auth.test.ts packages/server/src/utils/request-logger.test.ts packages/server/src/services/inventory-service.test.ts` then `bun run typecheck` and `bun run adr:check` |
| **S9** | **Stop re-spelling the `DROP SCHEMA` guard (S, leaf 06 step 9). Not seed pipeline; do this first if you do only one thing from leaf 06.** `packages/server/src/test/prepare-test-db.ts:25-28` re-spells the worktree naming convention as literals (`"[a-z0-9]{1,2}"`, `"[a-z0-9_]{1,49}"`, `musi_test`, `musi_wt_`) directly beneath the module that declares itself its single source of truth (`test-database-url.ts:25-27`). That regex is the *sole* gate in `assertSafeTestDbUrl` (`:55-63`) fronting `DROP SCHEMA IF EXISTS "public" CASCADE` (`:111`). Export composable **string fragments** from `test-database-url.ts` — worker-key character class plus its max length, worktree-slug character class plus the 49-character bound — and derive both the anchored `WORKER_KEY_PATTERN` (`:8`) and the literals at `prepare-test-db.ts:25-28` from them. **Importing today's constants is not an option**: `worktreeTestDatabaseSlug` validates with an unbounded `/^[a-z0-9_]+$/` (`:105`) where `prepare-test-db.ts:26` bounds at `{1,49}`, so a naive import *widens* the guard. **Pin the exact boundaries with tests**: a 49-character slug accepted and a 50-character slug rejected; a two-character worker key accepted and a three-character one rejected. Leave `worker-test-database.ts:298`'s deliberately different legacy `{1,6}` variant alone until someone establishes why it exists. | `grep -n '\[a-z0-9_\]{1,49}' packages/server/src/test/prepare-test-db.ts` returns 0; `test-database-url.ts` exports the fragments and derives `WORKER_KEY_PATTERN` from them; the four boundary cases are pinned; `worker-test-database.ts:298` is byte-unchanged | `bun run test -- packages/server/src/test/test-database-url.test.ts` plus the new `prepare-test-db` guard test, then `bun run typecheck` |
| **S10** | **Make the seed generators runnable, then script them and attest their output (M, leaf 06 steps 1-3 plus a new precondition).** Commit 1 (**precondition — do this first or commit 2 ships broken scripts**): make all four generators cwd-independent. `generate-class-features.ts:18`, `generate-srd-spells.ts:21`, `generate-subclasses.ts:18` and `generate-srd-rules-glossary.ts:19` each set `const ROOT = process.cwd()`; resolve the repo root from `import.meta.dirname` instead, the way `backfill-srd-spell-combat.ts:14` and `backfill-srd-monster-actions.ts:13` already do. **No committed generated file may change.** Commit 2: add a second subsection to "Reseeding from upstream" in `docs/srd-data-sources.md` (the existing one at `:55-67` covers only the reference-JSON copy path) stating which repository to clone where, which of the four generators to run in which order, which committed files each rewrites, and which manifest to update. **Do not re-litigate the input story** — `docs/refs/` is an optional gitignored operator checkout (`:34-37`, `.gitignore:63`) and both upstreams are pinned (`:40-52`). Commit 3: give the four generators npm entries in `packages/server/package.json` beside `backfill:*` (`:23-24`), folding each `// Usage: bun …` header into the script. Commit 4: widen `seed/seed-derived-provenance.test.ts` beyond `/^5e-srd-.*\.json$/` (`:31-36`) so `class-features/*.ts`, `subclass-features/*.ts` and `seed-srd-subclass-data.ts` carry a sha256 and the generator that emits them; the manifest lives under `seed/data` and these files do not, so pick either a second manifest or a root-relative `name` field and say which in the test. **This is an attestation, not a drift gate** — say so in the test's own header. **Do not add a `:check` script in the `harness:wiring:check` idiom**; that idiom assumes in-tree inputs, and no gate can regenerate without `docs/refs/`. | Every generator resolves paths without `process.cwd()`; running each from both the repo root and `packages/server` targets the same files; `docs/srd-data-sources.md` has a markdown-generator subsection naming all four; `packages/server/package.json` has four generator scripts; the provenance test records the generated `.ts` artifacts and its header states what the attestation does and does not prove; no new `verify` slot; `git diff --stat packages/server/src/seed` is empty for generated paths | `bun run test -- packages/server/src/seed/seed-derived-provenance.test.ts` then `bun run typecheck` and `bun run harness:check` |
| **S11** | **One seed helper home (S, leaf 06 step 4 plus the four items `07-PLAN.md` hands over).** Extract the four-step slug chain — three byte-identical bodies at `seed/generate-class-features.ts:26-32`, `seed/generate-subclasses.ts:22-28` and `seed/rules-glossary-parser/parse-glossary-entry.ts:20-26` under two names — and `cleanDesc` (`generate-class-features.ts:34-53`, `generate-subclasses.ts:30-48`) into one shared seed util, following the `seed/srd-class-generator-config.ts:1-19` precedent, and delete the docstring at `seed/spell-parser/spell-corrections.ts:1-4` that documents the copy-paste. **`toSpellSlug` stays in `spell-corrections.ts`** and becomes `toKebab(correctSpellName(name))`: it must keep applying `SPELL_NAME_CORRECTIONS` (`:6-8`, `Thunderwavea` → `Thunderwave`) *before* slugging, or every spell id derived from the misspelled heading changes. **Pin `toSpellSlug("Thunderwavea") === "thunderwave"` before touching it.** Keep the four explanatory comments on the surviving `cleanDesc` copy (`generate-class-features.ts:36`, `:38`, `:49`, `:50`) — the two bodies are not byte-identical. Also land the four one-line items `07-PLAN.md` moved here: delete the no-op `features.map((f) => ({ ...f, id: f.id }))` at `generate-subclasses.ts:129`; collapse the identical branches at `parse-glossary-entry.ts:41-46`; derive `extract-spell-metadata.ts:8`'s `ABILITY_MAP`; and repoint `extract-spell-combat.ts:66`'s `compareCodePoint`. **Decide the shared-helper home once**: if slice `07.1` has landed, `packages/server/src/utils/string-order.ts` exists and the comparator points there rather than at a second seed-local copy. **Nothing in this slice may change a committed generated file.** | `git grep -n "function toKebab\|function toGlossarySlug" packages/server/src/seed` returns 1, down from 3; one `cleanDesc` definition with its four comments; `toSpellSlug` still calls `correctSpellName` first and a test pins `Thunderwavea`; `git diff --stat packages/server/src/seed/class-features packages/server/src/seed/subclass-features packages/server/src/seed/seed-srd-subclass-data.ts` is empty | `bun run test -- packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.test.ts packages/server/src/seed/spell-parser/parse-spell-block.test.ts packages/server/src/seed/srd-class-generator-config.test.ts packages/server/src/seed/seed-derived-provenance.test.ts` then `bun run typecheck` |
| **S12** | **The eight metadata strings that reach an operator doc and an agent envelope (S, leaf 44 steps 1-2, plus two sites the leaf misses). The highest-value comment work in the pack.** Commit 1: rewrite seven strings in `scripts/lint-ratchet/lint-ratchet-config.ts` — `principle` at `:157`, `:402`, `:420`, `:459` and **`:479`** (`ratchet/vitest-valid-expect-script-tests`, "while Leaf 41 drain work proceeds") and `zeroBaselineDisposition.reason` at `:405`, `:423` — plus an eighth in **`harness.controls.json:1722`** (`check/lint-coverage-map`, "the Leaf 41 lint coverage map"). The last two are **not in leaf 44's inventory** (correction 3). Make each state the rule rather than the coordinate ("beyond the current inventory", "the inventory this floor was set from"), or qualify it the way `lint-review-2026-06 leaf 03e` already does (rendered at `docs/generated/harness-controls.md:752`, `:780`). **Read correction 1 first**: the `principle` strings reach `docs/generated/harness-controls.md` only (`:570`, `:724`, `:738`, `:766`, `:794`, `:1870`), while `:405` and `:423` are the ones an agent reads today through `diagnostics.ts:214`/`:225` — do not scope this to the rendered set. Regenerate `docs/generated/harness-controls.md`. **No `lint:ratchet:update`** — `baseline-hash.ts:92-107` excludes both fields (correction 2). Read [`docs/guides/lint-ratchet.md`](../../../guides/lint-ratchet.md) first: these are ratchet metadata fields, not free prose. Commit 2: add a rule rejecting a **bare** backlog coordinate (`leaf <N>`, `task <NN>`, `P<n>-<n>`) in a `principle` or `zeroBaselineDisposition.reason` field. **It needs two homes because the strings have two sources**: `scripts/lint-ratchet/check-registry.ts` (with `check-registry.test.ts`) for the registry — which is where `reason`, the field the generator never reads, lives — and `scripts/harness/harness-check-validation.ts`, which already validates manifest `principle` at `:178`, for `harness.controls.json`. Share one predicate between them rather than writing the regex twice. **The rule must explicitly accept the pack-qualified form** (`<pack-name> leaf <N>`) — that carve-out is the answer to codex's brittleness objection, and without it the rule fires on `lint-review-2026-06 leaf 03e`, which is the shape the repo wants. | `grep -cE "the leaf [0-9]+\|Leaf [0-9]+" scripts/lint-ratchet/lint-ratchet-config.ts` returns 0, down from 7; `grep -c "leaf 06 inventory\|leaf 12 inventory\|Leaf 41" docs/generated/harness-controls.md` returns 0, down from 6, and the doc is regenerated in the same commit; `lint-ratchet.baseline.json` is byte-unchanged; new cases in `check-registry.test.ts` and `scripts/harness/harness-check-validation.test.ts` fail on a bare coordinate and pass on a pack-qualified one | `bun run test:scripts:file -- scripts/lint-ratchet/check-registry.test.ts` then `bun run lint:ratchet:check-registry`, `bun run docs:harness-controls:check`, `bun run harness:check` and `bun run harness:audit` |
| **S13** | **Three documents that state something false (XS, leaf 44 steps 3-5 plus one carve-out from step 6).** (a) `scripts/harness-check.ts:17-20` — replace the hand-typed nine-surface enumeration with a sentence pointing at the `generatedSurface` entries in `harness.controls.json` as the source of truth; there are **11**, and `checkGeneratedFreshnessOutputs` (`:90`, called at `:140`) already derives the real list at runtime. (b) `packages/server/src/services/README.md:220-237` — collapse to the two conventions the section actually establishes (depth-signalling `run*Core` naming, `(ctx, character, input)` argument order) and delete the "intentionally not done" framing above two bullets marked `(done)`. **Confine this to `:220-237`**: do not re-open the `encounter-map.ts` transaction prose, which `:192-196` describes correctly and `:212` already scopes. (c) `tools/lint-ratchet/src/git-rail/info-attributes.ts` — rewrite the five "matches the previous awk" statements (`:7`, `:40-41`, `:79-80`, `:112-113`, `:166-167`) as statements about observable output; `:40-41` already parenthesizes the real rule, so promote the parenthetical and drop the awk clause. Qualify or drop the bare `leaf-04` at `:3`. (d) One carve-out from the refused step 6: `scripts/lib/eslint-json.ts:4-5` spells a pack path that **does not exist** — point it at `docs/agent_notes/backlog/lint-arch-review-2026-07/14-enumerated-subpath-exports.md`, the spelling `scripts/lib/atomic-write.ts:4-7` already uses. **Do not fold `process-argv.ts`, `codepoint-compare.ts` and `eslint-json.ts` into a barrel** — `codepoint-compare.ts:6-9` and `eslint-json.ts:8-10` both state the one-file-wide seam on purpose. | `grep -n "awk" tools/lint-ratchet/src/git-rail/info-attributes.ts` returns 0, down from 5; `grep -n "intentionally not done" packages/server/src/services/README.md` returns 0; `scripts/harness-check.ts` names no surface list; `grep -n "lint-ratchet-arch" scripts/lib/eslint-json.ts` returns 0 | `bun run test:scripts:file -- tools/lint-ratchet/src/git-rail/info-attributes.test.ts` then `bun run harness:check` and `bun run lint` |
| **S14** | **One true header sentence, and the Pino vocabulary beside its types (S, leaf 45 steps 1 and 3).** Commit 1: delete the false sentence at `packages/server/src/utils/encounter-state-mutations.ts:21-22` ("enforces the 5 valid transitions as a compile-time union derived from the `VALID_TRANSITIONS` tuple") and replace it with the accurate version already written at `:47-54`, or a pointer to it. **Do this even if nothing else in leaf 45 lands.** **Any diff outside those two lines fails this commit** — the rest of the header is on the do-not-touch list. Commit 2: move `packages/server/src/app.ts:90-106` (the dotted `event` vocabulary, the `actor` omission rule, the scope-id rule, the `outcome` enum, the `socket.broadcast`/`socketEvent` convention) to the top of `packages/server/src/utils/request-logger.ts`, above `RequestLogger` at `:3`. **Leave `app.ts:107-113` in place** — redaction and volume belong beside `LOGGER_REDACT_PATHS` (`:85-88`). Trim `request-logger.ts:27-32` to the authz-only fact it adds (routing through one helper keeps the field shape consistent across the three auth modules), deleting the now-circular "documented in `app.ts`" clause at `:27-28`. Leave a one-line pointer in `app.ts` — `docs/agent_notes/backlog/worktree-local-observability.md:22-23` points there for this contract. **This is a move, not a rewrite**: do not edit a single `AuthzEvent` or `AuthzReason` literal. While in `request-logger.ts`, correct the comment at `:35-41`, which claims `scripts/logs-audit/logs-audit-event-fields.ts` "matches these strings exactly" — that script carries no event or reason literals (structural `reason` check at `:87-96`, `authz.` prefix match at `:186`); the real enforcement is the union plus `utils/__type-tests__/authz-vocabulary-restrictions.ts` (correction 10). | `grep -n "compile-time union" packages/server/src/utils/encounter-state-mutations.ts` returns 0 and commit 1's diff is two lines; `packages/server/src/app.ts` contains no `event`-vocabulary block and one pointer line; `request-logger.ts` opens with it; `LOGGER_REDACT_PATHS` and its following paragraph are unchanged; no `AuthzEvent`/`AuthzReason` string literal changed | `bun run test -- packages/server/src/utils/request-logger.test.ts packages/server/src/app.test.ts packages/server/src/utils/encounter-state-mutations.test.ts` then `bun run typecheck` |
| **S15** | **Combatant vocabulary, and the attack-worded spell denial (S, leaf 46 step 7). The only user-visible behaviour change in this cluster.** TDD — the messages are asserted at `utils/encounter-combat-auth.test.ts:225` and `:237` and nowhere under `e2e/`. **Commit 1 (the bug fix, reviewable alone):** reword the two messages to cover both callers — `"Combatant not found in this encounter"` (`:57`) and `"Players can only act with their own character"` (`:69`, `:88`) — and update the two assertions. **Commit 2 (the vocabulary):** rename `VerifyPlayerArgs.attackerParticipantId` (`:31`) → `combatantParticipantId`, `verifyPlayerCanAttack` (`:36`) → `verifyPlayerControlsCombatant`, the `assertEncounterCombatant` parameter (`:103`), and the reason code `not_attacker_owner` (`:84`) → `not_combatant_owner` **together with the `AuthzReason` union member** (`utils/request-logger.ts:52-66`, member at `:63`, narrowing at `:72`) — a half-done reason rename is a typecheck error, and the test title at `encounter-combat-auth.test.ts:391` and assertion at `:411` move with it. **Codex argued for keeping `not_attacker_owner` as stable observability vocabulary; overruled** — `scripts/logs-audit/logs-audit-event-fields.ts` holds no reason literals (correction 10), the code has four live occurrences, and it is wrong on the spell path. **Do not change the `"authz.encounter.combatant"` event string or the `AuthzEvent` union** (`request-logger.ts:42-50`): it *is* the audited stream's identity and is asserted 7 times (`:280`, `:301`, `:323`, `:341`, `:361`, `:379`, `:407`). **Stop at the auth helper's own parameter** — `attackerParticipantId` is also a wire field (`packages/shared/src/schemas/attack-roll-inputs.ts:61`, `:85`, `services/combat-actions/types.ts:96`, client hooks, `hooks/vtt-drawer/MODULE.md`), and `services/encounter-combat/attack-action.ts:21` keeps passing it in. **Leave `services/combat-actions/load-participants.ts:50`'s identical `"Attacker not found in this encounter"` literal alone**: it is `loadAttackParticipants`, reached only from `executeAttack` after auth has passed, so its wording is correct for its caller. | A spell-path denial test asserts `"Players can only act with their own character"`; `grep -rn "not_attacker_owner" packages/server/src` returns 0; the count of `"authz.encounter.combatant"` occurrences is unchanged; `packages/shared/src/schemas/attack-roll-inputs.ts` is byte-unchanged; `load-participants.ts:50` is byte-unchanged | `bun run test -- packages/server/src/utils/encounter-combat-auth.test.ts packages/server/src/routers/encounter-combat-spell.test.ts packages/server/src/routers/encounter-combat.test.ts` then `bun run typecheck` |
| **S16** | **`finishTopLevelCommand` names what it does (S, leaf 46 step 6).** Rename to `runTopLevelCommand` (or `withCharacterCommandEnvelope`) in `services/character-live-state/side-effects.ts:27-44` — the function is invoked at the *top* of every command as `return finishTopLevelCommand(ctx, {…})` and its body runs the command, logs and emits, while its two siblings in the same file (`hasCharacterLiveStateSideEffects` `:14`, `emitCharacterLiveStateSideEffects` `:18`) describe themselves accurately. Update the 12 call sites in `spell-slot.ts` (`:23`, `:40`, `:57`), `rest.ts` (`:24`, `:45`), `sorcery-point.ts` (`:42`, `:78`), `feature.ts` (`:113`) and `stats-conditions.ts` (`:76`, `:116`, `:171`, `:215`); all six references in `stats-conditions.test.ts` — import `:5`, comment `:21`, `vi.fn` mock `:25`, `mockFinish` binding `:31`, and the **test titles at `:169` and `:195`, which are string literals the compiler will not flag**; the second `vi.fn` mock at `feature-concurrency.test.ts:18`; the comment at `sorcery-point.test.ts:25`; and `services/character-live-state/MODULE.md:56`. One commit — a partial rename leaves the mocks pointing at a missing export. **Rename only.** Hoisting `logMutation` + `emitCharacterUpdate` out of the envelope, or moving the call to the end so "finish" becomes true, changes when the socket emit fires relative to the transaction; that is race-sensitive (`docs/CONCURRENCY.md`, `docs/guides/add-socket-broadcast.md`) and out of scope. | `grep -rn "finishTopLevelCommand" packages/server/src` returns 0, including the two test titles and `MODULE.md:56`; the emit still fires after `input.run()` and after `logMutation` | `bun run test -- packages/server/src/services/character-live-state` then `bun run typecheck` and `bun run module:index:check` |
| **S17** | *(Optional.)* **`assertCharacterOwner` takes the caller object (M, leaf 03 step 4).** Convert `utils/character-auth.ts:18-23` to `(prisma, characterId, caller: AuthzCallerContext)` **in a single commit that also updates all 21 call sites** — 12 production (`routers/character.ts:81`, `:90`, `:125`, `routers/character-spell.ts:64`, `:143`, `:245`, `routers/inventory.ts:72`, `:118`, `routers/campaign.ts:232`, `routers/weapon-mastery.ts:17`, `services/inventory-service.ts:184`, `services/weapon-mastery-service.ts:52`), 8 in `character-auth.test.ts` (`:76`, `:80`, `:88`, `:97`, `:103`, `:409`, `:424`, `:440`), and the internal one at `:207`. `(ctx.prisma, id, ctx.user.id, { logger: ctx.logger })` becomes `(ctx.prisma, id, { userId: ctx.user.id, logger: ctx.logger })`. **The re-split at `character-auth.ts:205-207` is deleted in this same commit** — the moment the parameter is context-only, the `else` branch must stop re-splitting or the file does not compile. Not splittable without breaking typecheck. Optional because S8 already removes the union, the two unwrap helpers and 90% of the leaf's motivating cost; this buys the last two lines at 21 sites, and codex argued against churning production signatures at all. | `assertCharacterOwner` takes three parameters; `character-auth.ts` has no `userId`/`logContext` re-split; all 21 sites pass one caller object; no behaviour change | `bun run test -- packages/server/src/utils/character-auth.test.ts packages/server/src/routers/character.test.ts packages/server/src/routers/character-spell.test.ts packages/server/src/routers/inventory.test.ts packages/server/src/services/inventory-service.test.ts packages/server/src/services/weapon-mastery-service.test.ts` then `bun run typecheck` and `bun run adr:check` |
| **S18** | *(Optional, deferred.)* **Converge `campaign-auth.ts` and `note-auth.ts` on the object caller (L, leaf 03 step 6).** One file per commit; the signature and every call site move together or it does not typecheck. `assertCampaignMember` (`campaign-auth.ts:39-44`) and `assertCampaignDm` (`:72-77`) have 42 production and 16 test call sites; `loadNoteForMutation` (`note-auth.ts:26-31`) has 8 (2 production at `routers/note.ts:217`, `:238`, 6 in `note-auth.test.ts`). Keep the `(prisma, scopeId, caller)` argument order so each call site is a single argument replacement. **Preserve the one-log-per-boundary comments at `campaign-auth.ts:17-19` and `note-auth.ts:22-24` verbatim** and the NOT_FOUND normalization at `note-auth.ts:16-20`; moving log context into the caller object must not cause a second `authz.*` event per decision. Deferred because it buys consistency across two more files at 66 sites. | Every `assertCampaignMember`/`assertCampaignDm`/`loadNoteForMutation` call passes one caller object; no second `authz.*` event fires per decision; the three comments are byte-unchanged | `bun run test -- packages/server/src/utils/campaign-auth.test.ts packages/server/src/utils/note-auth.test.ts packages/server/src/routers/note.test.ts packages/server/src/routers/campaign.test.ts` then `bun run typecheck` |
| **S19** | *(Optional, opportunistic.)* **Two file-local renames that fix a two-meanings-one-name hazard (XS, leaf 46 steps 1 and 3; discharges leaf 05 step 3).** (1) `utils/combat-chat.ts` — `action` → `actionMessage` and `concentration` → `concentrationMessage` (`:92`, `:98`). `action` holds a `ChatMessage` while `msg.action` in the *same statement* is the combat-action label declared at `:20` and persisted into `metadata` at `:67`; both are block-scoped consts with no other references, so the diff is four lines. (2) `routers/srd.ts` — collapse the ten mapper-parameter spellings (`sp` `:113`, `st` `:120`, `sub` `:125`, `sst` `:130`, `f` `:142`, `c` `:155`, `cls` `:176`, `sc` `:180`, `bg` `:197`, `f` `:214`) onto `row`, the convention `mapEquipment` already uses at `:227`; nested `.map()` callbacks may take the entity they iterate (`speciesTrait`, `subspecies`, `subspeciesTrait`, `subclass`) where several are in scope at once. The reason to do it is the `f`-is-two-entities hazard — `ClassFeatureRow` at `:142` and `FeatRow` at `:214`, 72 lines apart in one 561-line file, in a domain where both are Prisma models. **Do not restructure the `Prisma.*GetPayload` row types or the `narrow*EnumColumns` helpers while in there.** Optional because both consults rated the file-local renames opportunistic; **if this is not done, leaf 05 step 3 is not done either**, which is the intended outcome. | `grep -n "const action = await persistCombatChat" packages/server/src/utils/combat-chat.ts` returns 0; no `srd.ts` mapper declares a single- or double-letter parameter | `bun run test -- packages/server/src/utils/combat-chat.test.ts packages/server/src/routers/srd.test.ts packages/server/src/utils/srd-query-helpers.test.ts` then `bun run typecheck` |
| **S20** | *(Optional, small.)* **One named type for the fog callback rectangle (XS, replaces leaf 46 step 8).** The `{ x; y; w; h }` callback rect is re-declared inline at five sites — `hooks/canvas-input/tool-handlers.ts:139`, `hooks/canvas-input/use-canvas-input.ts:41`, `components/campaign/maps/map-canvas.tsx:35`, `components/campaign/maps/map-fog-actions.ts:32` and `:47`. Declare it once beside the fog handler and import it at all five. Optionally rename `createFogHandler`'s `onRegionDrawn` parameter (`tool-handlers.ts:171`) to `onFogRegionDrawn` to match the config key it is fed from at `:300`. **Keep the `w`/`h` spelling** — `packages/shared/src/map/fog.ts:22-32` is persisted JSON (`FogLayerData`), and the spread at `map-fog-actions.ts:51` (`{ id: crypto.randomUUID(), ...rect }`) is the only place a persisted `FogRegion` is built from the callback rect. Respelling the callback introduces a translation point in exactly that spot, and forces the containment comparison at `:58-59` — which reads both shapes in one expression — to be reasoned about rather than left alone. **Do not touch `packages/shared/src/map/fog.ts`.** | The callback rect type is declared once and imported at five sites, down from five inline declarations; `packages/shared/src/map/fog.ts` byte-unchanged; `map-fog-actions.ts:51` still spreads | `bun run test -- packages/client/src/hooks/canvas-input/use-canvas-input-measure-fog.test.ts packages/client/src/hooks/canvas-input/use-canvas-input.test.ts packages/client/src/components/campaign/maps/fog-overlay.test.tsx` then `bun run typecheck` |

### Dependency edges

The index records `04 → 05`, `05 ↔ 45` and `05 ↔ 46` for this cluster. Under this
plan one survives, two dissolve, and one new edge appears.

- **`S1 → S2` (hard).** S2's port references `AppSocketServer` through the
  augmentation S1 declares, and `getSocketIO`'s narrowing depends on `io` being a
  typed optional member.
- **`S5 → S6` commit 3 (hard — this is the `04 → 05` edge).** S5 dissolves
  `services/rest-encounter-attribution.ts`, one of the three internal files leaf 05
  counts against `services/README.md:21-28` criterion 3. Land S5, then write
  `rest-MODULE.md` against the two files that remain. **The promotion itself (leaf
  05 step 4b) is not scheduled** — with two internal files criterion 3 fails and
  rest stays a flat service with a corrected companion doc.
- **`S2 ↔ S5` (hard, unrecorded in the index).** S2 retypes
  `rest-encounter-attribution.ts:37`'s `server: unknown`; S5 deletes the function
  that declares it. Do S5 first and S2 retypes one fewer site, or S2 first and S5
  deletes a typed parameter. **Do not run them concurrently.**
- **`S4 → S3` commit 2 (soft).** If both happen, do the registry split first: it
  changes what a thin per-family test can usefully assert.
- **`S8 → S17 → S18` (hard, if the optionals happen).** S17 and S18 both assume the
  union is gone and `AuthzCallerContext` is exported.
- **`S10 commit 1 → S10 commit 3` (hard, inside the slice).** cwd independence
  before the package scripts, or the scripts ship broken.
- **`S10 → S11` (soft).** S11 must not change a committed generated file; having the
  regeneration procedure and the attestation in place first makes that verifiable.
- **`S11 ↔ 07-PLAN slice 07.1` (soft).** If 07.1 has landed,
  `packages/server/src/utils/string-order.ts` exists and S11's comparator points
  there. If not, S11 owns the home decision alone, per `07-PLAN.md`.
- **`S12 → S13` (soft, file-family).** Both touch harness prose; S12's guard is what
  makes S13's corrections stick.
- **`S19 ↔ leaf 05 step 3` — dissolved.** Same `routers/srd.ts` sweep; leaf 46's
  inventory is the fuller one (ten spellings versus six) and this plan drops leaf
  05's copy. One owner: S19, and if S19 is skipped neither happens.
- **`leaf 46 step 2 ↔ leaf 05 step 4b` — dissolved.** Leaf 46's caveat sequences its
  `rest-service.ts` rename against a `git mv` into `services/rest/`. Both the rename
  and the move are dropped.
- **`S14 ↔ leaf 05 step 7` — dissolved (this is the `05 ↔ 45` edge).** Leaf 45's
  caveat says: decide leaf 05 step 7 first, because merging the two `assertTurnLock`
  branches changes what shape 5 of the header
  (`encounter-state-mutations.ts:37-41`) describes. **This plan drops leaf 05 step 7**,
  so shape 5 stays verbatim and S14 can land immediately. Record the decision so the
  question is not re-opened.
- **Leaf 01 overlaps, both benign.** Leaf 01 steps 3-4 retype the where-clause at
  `services/inventory-service.ts:148` and the update helper at `:171`; S2 rewrites
  the declaration at `:60`. Different hunks. Leaf 01 step 2's suggested mechanism
  for removing the `encounter.ts:192-193` casts does not work (see the leaf-45
  ruling); nothing in this plan removes them.
- **Everything else is parallel.** S6, S7, S9, S12, S13, S15, S16 and S20 have no
  edges.

Two slices must not be worked concurrently by two agents even though they have no
file overlap: **S13 and S14** both edit `packages/server/src/` prose, and leaf 44
and leaf 45 both say so.

## Do not touch

These are named so a delegate working any slice above cannot mistake them for
targets. Every one is load-bearing; several are named in `00-index.md`'s
comment-density section as keep-verbatim, and both consults independently produced
overlapping versions of this list.

**Concurrency and trust boundaries**

- `packages/server/src/utils/participant-stats-mutations.ts:6-56` — the "sole
  sanctioned escape" header and its numbered "six helpers, four shapes" selection
  guide, including shape 1 vs shape 2 side by side at `:17-33` (the only place the
  "derives from fresh stats" vs "blind-writes client-supplied absolute values"
  choice is laid out as a choice) and the shape-4 turn-origin paragraph at `:43-55`.
  Also `setParticipantTurnOrigin`'s JSDoc (`:221-231`) and
  `clearParticipantTurnOrigin`'s (`:248-268`), which carries the relink-leak
  scenario and the capture/clear serialization channel found nowhere else.
- `packages/server/src/utils/encounter-state-mutations.ts:6-42` — the same header
  for `Encounter`. **S14 commit 1 changes exactly two lines of it (`:21-22`) and
  nothing else.** Shape 5 (`:37-41`), the `assertTurnLock` `count=0` semantics, and
  every compound-WHERE/CAS rationale stay verbatim.
- `packages/server/src/utils/character-stats-mutations.ts:6-39`,
  `spell-slot-mutations.ts` and `character-class-mutations.ts` — the remaining
  `*-mutations.ts` headers, on the same terms.
- `packages/server/src/utils/encounter-hp-log.ts:4-25` (transaction-before-broadcast
  discipline) and `:106-110` (why every active encounter needs its own entry and
  broadcast). The `InTx` suffix on `logCharacterHpChangeInTx` is part of the
  contract, not a spelling.
- `packages/server/src/services/combat-actions/assert-turn.ts:5-14` — the only place
  the turn-lock invariant (pins both `round` and `currentTurnIndex` so a stale action
  cannot land after a turn wrap) and the direct-import/facade-cycle convention are
  stated together. **`assert-turn.ts` is not deleted by anything in this plan.**
- `packages/server/src/services/combat-actions/types.ts:62-70` and
  `packages/server/src/utils/__type-tests__/assert-turn-opts-dedup.ts` — the alias
  pair and the compile-time guard that make field drift a compile error.
- `packages/server/src/utils/encounter-state-mutations.ts:209-264` — both
  `assertTurnLock` branches, flat and separately auditable. Leaf 05 step 7 is
  dropped.

**Socket**

- `packages/server/src/socket/campaign-room-handler.ts:154-158` — the five-line
  `disconnecting` ordering note (the socket is still in the room, so the last-tab
  count includes self). Nothing in this plan extracts the room-exit tail; leaf 04
  step 6 is dropped.
- `packages/server/src/socket/broadcast-registry.ts:59-65` — the `logFields`
  mandatory-by-design invariant, and `:125-127` — the out-of-scope classification
  and its `socket-emit-inventory.md` link.
- `packages/server/src/socket/MODULE.md:24-26` — the per-family facade rationale.
  The five wrapper files stay.

**Auth**

- `packages/server/src/config/auth.ts:20-30` and
  `packages/server/src/services/auth-service.ts:60` — the login timing-oracle
  explanation and the dummy-hash requirement.
- `packages/server/src/utils/campaign-auth.ts:17-19` and
  `packages/server/src/utils/note-auth.ts:22-24` — the one-authz-log-per-boundary
  discipline; `note-auth.ts:16-20` — the NOT_FOUND-vs-FORBIDDEN normalization;
  `packages/server/src/utils/character-auth.ts:12-16` — the masking rationale.
  `docs/adr/0002-character-not-found-semantics.md` is the decision of record.
- The `"authz.encounter.combatant"` event string and the `AuthzEvent` union
  (`packages/server/src/utils/request-logger.ts:42-50`). S15 touches `AuthzReason`
  only.

**Shared rules and client**

- `packages/shared/src/map/area-template.ts:2-5`, `:18`, `:30`, `:80` and
  `packages/shared/src/map/grid-utils.ts:10-23`, plus
  `packages/shared/src/map/area-template-MODULE.md` — the AoE coordinate model, the
  Chebyshev simple-diagonal rule, and the hex geometry derivations, including their
  `no-magic-numbers` fences.
- `packages/client/src/stores/map-canvas-store.ts:245` and `:608` — the
  fire-after-commit callback ordering invariant.
- `packages/shared/src/map/fog.ts` — persisted `FogLayerData`. S20 does not touch it.

**Harness prose that looks like archaeology and is not**

- `scripts/lint.sh:44` — "3.381 GiB versus 4.095 GiB monolithic", the
  `--concurrency=2` 8.14 GB figure and the OOM note are operational measurements.
  Nothing in this plan edits them.
- `scripts/lib/cli.ts:74-80` — the `parseArgs` spike record ends in a standing
  prohibition that stops a future agent re-attempting a rewrite `cli.test.ts`
  already pins as broken. Not in scope.
- `packages/server/src/routes/upload-routes.ts` — the whole header. Bullets 2 and 3
  (the `TRPCError` → flat HTTP 403 remap, and which multipart errors keep their
  native status) have no inline counterpart. Leaf 44 step 7 is dropped.
- `scripts/harness/harness-diagnostics-output.ts` — deliberate, recently reviewed
  exhaustiveness documentation. Leaf 44 step 7 is dropped.
- `scripts/lib/process-argv.ts:3-4` and `scripts/lib/codepoint-compare.ts:4-6` —
  already pack-qualified; they are the shape to copy, not sites to change.

## Index reconciliation (whichever slice lands first applies these)

1. `00-index.md`, "How to use this pack": replace the Server dependency line
   `04→05, 05↔45, 05↔46` with a pointer to this file — `05↔45` and `05↔46` both
   dissolve here, `04→05` survives as `S5 → S6`, and a new `S2 ↔ S5` edge appears.
   `06↔07` was already dropped by `07-PLAN.md`.
2. `00-index.md`, "Read this first": add this file to the cluster-plan list beside
   the client, harness and shared plans, and note that it completes the set.
3. `00-index.md`, [Leaves](./00-index.md#leaves): point rows 02, 03, 04, 05, 06, 44,
   45 and 46 at this plan and re-size them — 03 L→M (steps 4 and 6 optional),
   04 M→S, 05 L→S, 06 L→M (steps 5-8 parked), 44 L→S, 45 M→XS, 46 L→S.
4. `00-index.md`, "Suggested first slice": add **S1** as the next candidate. It is
   the only item in the pack where a rename silently disables every broadcast at
   runtime with nothing failing to compile, and both consults ranked it first.
5. `00-index.md`, "Executive summary": the claim that the server layering "holds in
   the large" is confirmed by two independent consults and should say so. Add the
   prepared-spell race to the "Real modelling and contract defects" list — it is the
   pack's second live defect after leaf 19's versatile damage.
6. Each of the eight leaves: add a Status pointer to this plan and record which
   steps are dropped — 03.4 and 03.6 (optional), 04.6, 05.3 (to leaf 46), 05.4b,
   05.6, 05.7, 06.5-8 (parked), 44.6 (except the `eslint-json.ts` carve-out), 44.7,
   44.8, 44.9, 45.2, 45.4, 46.2, 46.4, 46.5, 46.8 (replaced by S20), and leaf 17's
   inherited `pid` sweep (accepted, not scheduled).
7. `00-index.md`, [Constraints on future proposals]: add four rows — "retype the
   service contexts as `{ req: { server: FastifyInstance } }`" (re-couples nine
   files to Fastify; the `unknown` is deliberate decoupling per
   `services/inventory-service.ts:52-55`); "trim the `utils/*-mutations.ts` headers
   against `docs/CONCURRENCY.md`" (a file-local selection guide, a cross-cutting doc
   and a per-function JSDoc are three altitudes, not three copies); "rename `w`/`h`
   in `packages/shared/src/map/fog.ts`" (persisted `FogLayerData`; needs a Prisma
   data migration plus a tolerant read seam); and "remove the `encounter.ts:192-193`
   casts by making `isValidTransition` a type guard" (a predicate narrows only the
   parameter it names).
8. Leaf 05's caveats: record that step 7 is **dropped**, which is the answer leaf 45
   asks for at its own "Sequencing with leaf 05" caveat.
9. Leaf 44's Evidence section: correct the diagnostics claim per correction 1 — it is
   the leaf's central piece of evidence and it is wrong in both directions — and add
   the two sites its inventory misses per correction 3
   (`scripts/lint-ratchet/lint-ratchet-config.ts:479` and `harness.controls.json:1722`).

## Rejected alternatives — why

| Alternative | Why not |
| --- | --- |
| **Retype the nine service contexts to `{ req: { server: FastifyInstance } }`** | The obvious refactor and the wrong one. It re-couples seven `services/` files and two `utils/` files to Fastify, and `services/inventory-service.ts:52-55` states that the narrow shape exists so services stay callable from tests without a full Fastify request. 18 test contexts pass `server: {}` and two pass `undefined`; all 20 become type errors. The `BroadcastHost` port recovers the types without importing Fastify into a single service file. Both consults rejected this unprompted. |
| **Stop leaf 02 after the module augmentation** | Buys editor completion on `server.io` and nothing else. `decorate`'s key parameter is `P extends string \| symbol`, so `server.decorate("ixo", io)` still compiles with the augmentation in place; and `io` must stay optional, so deleting the `decorate` call is not a type error either. The augmentation, the pinned key and the two `app.test.ts` assertions are one unit — that is why S1 is one slice. |
| **Enforce a service layer for every router procedure** | Ceremony, and contrary to the documented rubric: `services/README.md:108-118` states that a router doing `assertCharacterOwner` + `emitCharacterUpdate` inline around a shape-2 helper is correct, and `:253-265` Q1 routes a pure helper with no transaction boundary to `utils/`. |
| **Inline `broadcast()` at the call sites, or merge the four per-family wrapper files** | ~55 production references for no payoff beyond type naming. The merge is worse: `socket/MODULE.md:24-26` documents the per-family files as the deliberate stable-call-site facade, it removes no production indirection, it rewrites 14 imports across 13 production files plus tests, and the natural filename collides with `services/encounter-combat/broadcast-helpers.ts`. S3 fixes the thing genuinely out of line with the documented design — 347 lines of tests over 95 lines of wrappers. |
| **Extract the shared room-exit tail in `campaign-room-handler.ts` (leaf 04 step 6)** | Three lines saved against the only medium-risk item in leaf 04. The three sites differ in leave semantics, awaitability and error handling; the disconnect site runs inside `void (async () => {…})()` and swallows every error, so a mistake inside the extracted helper is silent. The leaf itself says cutting the step "loses nothing else". Guards are `packages/server/src/socket/campaign-room.test.ts` and `packages/server/src/services/presence-multi-tab.test.ts` (correction 6). |
| **Promote rest to `services/rest/` (leaf 05 step 4b)** | Conditional on a count that S5 changes. After S5 dissolves `rest-encounter-attribution.ts`, rest has two internal files and `services/README.md:21-28` criterion 3 fails. A flat service with a corrected `-MODULE.md` companion is exactly what `services/README.md:40` prescribes. Promoting anyway would also demand renaming `rest-service.ts` to a `services/rest/rest.ts` facade to match `level-up/`, `spell-casting/`, `combat-actions/`, `character-live-state/` and `map-tokens/`. |
| **Split `routers/srd.ts` by content family (leaf 05 step 6)** | Not "unrelated content families": one uniform read-only catalog where every procedure is 5-10 lines over three shared factories, already banner-sectioned. `SUBCLASS_REFERENCE_SELECT` (`:88`, used at `:417`/`:446`), `mapFeat` (`:214`, used at `:208`/`:315`/`:461`) and `mapClassFeature` (`:142`, used at `:179`/`:189`/`:299`) each straddle families, including inside the shared list-procedure factory calls. The payoff is file size only. |
| **Merge the two `assertTurnLock` branches (leaf 05 step 7)** | 52 lines to roughly 28, in race-sensitive locking code whose exact WHERE clause *is* the lock semantics. Two flat, separately auditable branches have review value a conditionally-built WHERE object destroys, and `utils/encounter-state-mutations.test.ts:28-95` covers the DM branch only, so the merge would refactor the non-DM path with no direct unit coverage. Read `docs/CONCURRENCY.md` before ever re-opening this. |
| **Delete `services/combat-actions/assert-turn.ts`** | Five artifacts around one rename, and every one has a written rationale: `combat-actions/MODULE.md:36-42` advertises `assertTurnInsideTx` as the module's cross-module turn-validation primitive, the JSDoc at `:5-14` is the only joint statement of the lock invariant and the facade-cycle convention, `types.ts:62-66` explains the alias pair, and `utils/__type-tests__/assert-turn-opts-dedup.ts` enforces it. Deleting it costs four files plus a MODULE edit and breaks the facade export at `combat-actions.ts:38` that `spell-casting/combat-transaction.ts:160` consumes. |
| **Extract the prepared-spell predicates and call the limit fixed** | S7 does the extraction and the commit message must say the opposite. The count at `character-spell.ts:207-213` and the update at `:225-228` remain a check-then-act race outside any transaction; a tidier `utils/` helper does not serialize anything. Serializing it is a separate decision that gives `togglePrepared` a transaction boundary and re-answers `services/README.md:253-265` Q1 in favour of a flat service. |
| **Regenerate the seed artifacts, relayout `subclass-features/{a,b}.ts`, prettier-ise the two TypeScript generators, or table-drive the eight reference-table seeders (leaf 06 steps 5-8)** | All four either rewrite committed generator output or depend on being able to regenerate it, and `docs/refs/` is an optional gitignored operator checkout by design (`docs/srd-data-sources.md:34-37`, `.gitignore:63`). No gate can verify them and no implementer without the upstream repositories cloned can either. Step 8 additionally carries the leaf's own abandon condition: if the eight Prisma delegates need a `type-assertion-boundary: prisma` marker to make the table compile, the duplication is the cheaper of the two. Parked behind a provisioned checkout, not scheduled. |
| **Add the four generator package scripts without fixing `process.cwd()` first** | All four generators set `ROOT = process.cwd()` and join repo-relative paths, so a package-scoped script resolves `packages/server/packages/server/src/seed/…`. Broken on arrival. S10 commit 1 is the precondition. |
| **Add a regenerate-and-diff `:check` script for the seed generators** | The `harness:wiring:check` idiom assumes in-tree inputs. A manifest checksum a human updates during regeneration proves only that nobody hand-edited the file afterwards — which is the failure mode that actually happens here, and is all that is on offer. S10 says so in the test's own header. |
| **Qualify the 60-plus bare backlog coordinates in source comments (leaf 44 step 6)** | Five `leaf 50 step 2` sites, two `leaf 40 step N` sites, nine `ux-audit P0-3` sites, 38 `task NN` occurrences across non-test `scripts/drift-ai/` `.ts` files, plus a dozen singletons — 60-plus single-line edits across three trees, for a reader who is one `git log -S` from the answer, reviewed by someone who must confirm none of them changed meaning. Both consults called it busywork. Two carve-outs survive in S13. |
| **Trim the two self-restating headers and move one comment below an import (leaf 44 steps 7-8)** | `upload-routes.ts`'s header bullet 1 and its inline counterpart at `:167-170` say the same thing in two places a reader hits at different moments, which is not obviously worse than one. `harness-diagnostics-output.ts` is deliberate, recently reviewed work. The `prototype-advisory.ts` move is one line with a documented no-follow-on-sweep caveat attached to it. Three edits with no consumer. |
| **Pick one failure-reporting convention in `scripts/harness-check.ts` (leaf 44 step 9)** | A code-structure change across three modules and their tests, sharing only the leaf's diagnosis with the rest of it. The leaf names it as the natural split point. If it is worth doing it is its own leaf, not comment work. |
| **Derive a five-pair `EncounterTransition` union from `VALID_TRANSITIONS` (leaf 45 step 2)** | `as const satisfies` on the shared constant, an `.includes` → `.some` rewrite, a mapped type with an `extends [never]` guard for `resolved: []`, a two-direction assignability pin, and a `parseEncounterTransition` that must stay invisible to `scripts/codemods/concurrency-guard/helper-shapes.ts:166`/`:222` — to delete two casts that are already correctly marked `interop`. Both consults said the complexity is not worth it, and `packages/shared/src/rules/combat.test.ts:16-65` already pins the full 4×4 matrix at runtime. |
| **Make `isValidTransition` a TS type guard instead (leaf 01 step 2)** | A type predicate narrows only the parameter it names, so `from is …` cannot narrow `input.to`. A helper returning `{ from: EncounterFromState; to: EncounterToState }` is the same 3×3 cross product the header already misdescribes, so it drops the casts while leaving the false claim just as false. Both routes fail; the casts stay and S14 makes the header honest about why. |
| **Trim ~60 lines from the three `*-mutations.ts` headers against `docs/CONCURRENCY.md` (leaf 45 step 4)** | See the ruling. A numbered helper-selection guide, a cross-cutting concurrency doc and a per-function JSDoc are three altitudes of one contract, not three copies of it. The leaf's own caveats then exempt most of what it proposes to cut. Downside: a lost concurrency invariant. Upside: 60 lines of prose. |
| **Rename `item` → `itemSchema` and `fetch` → `query` in the SRD procedure factories (leaf 46 step 5)** | 44 call sites — 26 in `routers/srd.ts`, 18 in `srd-query-helpers.test.ts` — against an objection the leaf itself downgrades: `item` is *correct* (the array element schema, wrapped at `:39`/`:58`) and merely "reads as a domain object", and the `fetch` complaint is a destructured local shadowing a global this code never calls. Nothing in the repo lints it. Revisit only if leaf 05 step 6 ever happens, which this plan also rejects. |
| **Rename `chatMsg`/`chatPayload` and `EpochWindow` (leaf 46 steps 2 and 4)** | Both are private to one file and neither produces a wrong answer. Codex noted that some of the rest-service names are already defensible; the `EpochWindow` rename additionally drags in the shell smoke suite (`scripts/lib/verify-metadata-core.ts:16-18` says the file is copied verbatim into sandbox repos) for a non-exported type name. Opportunistic at best. |
| **Respell the client fog callback rect `width`/`height` with a translation point (leaf 46 step 8)** | Trades a spelling inconsistency for a new failure mode in the one place a persisted `FogRegion` is built (`map-fog-actions.ts:51`), and forces the containment comparison at `:58-59` — which reads both shapes in one expression — to be reasoned about rather than left alone. The real defect in the leaf's own evidence is five inline re-declarations of one shape; S20 fixes that and leaves the spelling. |
| **The client `pid` → `participantId` sweep (leaf 17 step 7, moved here by CLIENT-CLUSTER-PLAN)** | Accepted into leaf 46's scope so it is not orphaned, then not scheduled. Re-resolved on `6cf8c78d5`: 27 whole-word `pid` occurrences across 6 files plus 6 camel-cased carrier lines (`hpPid` overlaps one of those files; `targetPid` adds a seventh), all pure rename churn. The client plan moved it here to dissolve a dependency edge, and its own rejected-alternatives row already calls it churn. Both consults said drop. Opportunistic only, with the leaf's exact verification (`rg -n '\bpid\b\|[A-Za-z]Pid\b' packages/client/src` returning nothing). |
| **Rename `logCharacterHpChangeInTx`** | The `InTx` suffix marks a real invariant: the function takes a `TxClient` and must run inside the caller's transaction. A domain-flavoured name like `recordHpChangeForActiveEncounters` drops the signal. |
| **Change the `"authz.encounter.combatant"` event string while renaming the reason code (S15)** | It is the stable identity of an audited log stream, prefix-matched at `scripts/logs-audit/logs-audit-event-fields.ts:186` and asserted 7 times in `encounter-combat-auth.test.ts`. Only the `AuthzReason` union (`request-logger.ts:52-66`) moves. |
| **Keep `not_attacker_owner` because it is stable observability vocabulary (codex)** | Overruled. Unlike the event string, `logs-audit` holds no reason literals — it validates `reason` structurally at `:87-96`. The code has four live occurrences (`request-logger.ts:63`, `encounter-combat-auth.ts:84`, and two in its test), it is enforced by the union plus a type test rather than by an external consumer, and it is factually wrong on the spell path. If an out-of-repo dashboard queries it, that is an operator call to make at land time. |
| **Rename `attackerParticipantId` beyond the auth helper's parameter (S15)** | It is a wire field on `packages/shared/src/schemas/attack-roll-inputs.ts:61`/`:85` and `services/combat-actions/types.ts:96`, threaded through client hooks and documented in `hooks/vtt-drawer/MODULE.md`. The attack path is genuinely an attack; renaming a shared input schema is an API change, not a naming cleanup. |
| **Drop the leaf-44 coordinate guard entirely (codex)** | Overruled, with the objection absorbed. Codex is right that a naive lexical rule fires on the pack-qualified form the repo *wants* (`lint-review-2026-06 leaf 03e`), so S12's rule rejects only the bare form and explicitly accepts the qualified one. Without any guard, step 1's six fixes regress the moment someone adds a ratchet, and the registry already has a validation module with tests for exactly this class of rule. |
| **Move the whole `utils/`-orchestration question into this plan** | `services/README.md:69-71`'s "do not emit broadcasts" is scoped to concurrency primitives, so half of codex's P2 does not hold. The residual — `utils/combat-chat.ts` persisting, broadcasting and swallowing against the unscoped "no orchestration surface" line at `:76-78` — is a placement and documentation question worth its own leaf, not a rider on eight others. |

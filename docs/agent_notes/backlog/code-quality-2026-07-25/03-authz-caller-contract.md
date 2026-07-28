# 03. Authorization helpers take the caller three different ways, so every helper needs its own unwrap dance

Status: Proposed — not promoted
Theme: Authorization API surface · Area: server · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The authz helper family has no single answer to "how do I pass the caller?". Three shapes are
in use simultaneously, two of them inside the same file:

1. **`AuthzCaller = string | AuthzCallerContext`** — a union that every consumer must unpack
   through `getAuthzUserId` / `getAuthzLogContext`. Used by `character-auth.ts` and
   `encounter-combat-auth.ts`.
2. **Positional `(prisma, scopeId, userId, logContext?)`** — user id and log context kept
   apart. Used by `campaign-auth.ts` and `note-auth.ts`.
3. **An input object plus a caller** — `assertCharacterLinkedToCampaign(prisma, input, caller)`
   sitting immediately next to positional `assertCharacterAccess(prisma, characterId,
   campaignId, caller)` in the same file.

The cost is visible where shapes 1 and 2 meet. `assertCharacterOwnerOrAccess` receives an
`AuthzCaller`, and because `assertCharacterOwner` takes shape 2 while `assertCharacterAccess`
takes shape 1, it has to unpack the union and re-split it into two positional arguments in the
`else` branch — a three-line dance whose only job is impedance matching between two helpers in
the same module. Every new authz helper has to pick a side, and every caller has to remember
which side it picked.

`AuthzCallerContext` — the shape everything is converging on anyway — already exists but is not
exported, so the union is the only thing callers can name.

One adjacent naming defect belongs with this work because it changes the same signatures:
`note-auth.ts:9` calls its return type `MutableNote`, but it returns
`{ campaignId, authorId, visibility, isDm }` — an access decision, not a note.

## Evidence

- `packages/server/src/utils/request-logger.ts:13-15` — `interface AuthzCallerContext extends
  AuthzLogContext { readonly userId: string }`, **not exported**
- `packages/server/src/utils/request-logger.ts:17` — `export type AuthzCaller = string |
  AuthzCallerContext`
- `packages/server/src/utils/request-logger.ts:19-25` — `getAuthzUserId` and
  `getAuthzLogContext`, the two unwrap helpers
- `packages/server/src/utils/character-auth.ts:18-23` — `assertCharacterOwner(prisma,
  characterId, userId: string, logContext?: AuthzLogContext)` — shape 2
- `packages/server/src/utils/character-auth.ts:85-88` — `assertCharacterLinkedToCampaign(prisma,
  input: CharacterCampaignLinkInput, caller: AuthzCaller)` — shape 3
- `packages/server/src/utils/character-auth.ts:123-127` — `assertCharacterAccess(prisma,
  characterId, campaignId, caller: AuthzCaller)` — shape 1
- `packages/server/src/utils/character-auth.ts:205-207` — the unpack-and-re-split in
  `assertCharacterOwnerOrAccess`
- `packages/server/src/utils/campaign-auth.ts:39-44`, `:72-77` — positional
  `(prisma, campaignId, userId, …)`
- `packages/server/src/utils/note-auth.ts:26-31` — positional `(prisma, noteId, userId,
  logContext)`
- `packages/server/src/utils/note-auth.ts:9` — `MutableNote`, an access decision under a
  data-shaped name
- All **12** production call sites pass the **object** form: `routers/dice.ts:39`,
  `routers/cast-spell.ts:105`, `:113`, `:158`, `routers/character-spell.ts:169`,
  `services/inventory-service.ts:191`, `:252`,
  `services/character-live-state/access.ts:13`, `:26`,
  `services/map-tokens/token-lifecycle.ts:50`,
  `services/encounter-combat/attack-action.ts:18`, `services/encounter-combat/spell-action.ts:18`
- The **string** form is alive in tests, not vestigial. Exact counts:
  - `utils/character-auth.test.ts` — **14** string-form `AuthzCaller` arguments against **7**
    object-form ones. String: `assertCharacterAccess` at `:157`, `:162`, `:168`, `:177`,
    `:195`, `:211`; `assertCharacterOwnerOrAccess` at `:258`, `:264`, `:270`, `:276`, `:285`;
    `assertCharacterLinkedToCampaign` at `:332`, `:338`, `:351`. Object: `:453`, `:471`,
    `:488`, `:505`, `:531`, `:558`, `:567`
  - `utils/encounter-combat-auth.test.ts` — **9** string-form `assertEncounterCombatant`
    arguments (`:165`, `:174`, `:181`, `:187`, `:192`, `:204`, `:213`, `:222`, `:234`) against
    **7** object-form ones (`:275`, `:296`, `:317`, `:335`, `:355`, `:373`, `:401`)
  - **23 string-arm call sites in total**
- Separately (shape 2, not the union): `assertCharacterOwner`'s positional
  `(…, userId, logContext?)` has **12** production call sites — `routers/character.ts:81,90,125`,
  `routers/character-spell.ts:64,143,245`, `routers/inventory.ts:72,118`,
  `routers/campaign.ts:232`, `routers/weapon-mastery.ts:17`,
  `services/inventory-service.ts:184`, `services/weapon-mastery-service.ts:52` — plus the
  internal call at `utils/character-auth.ts:207` and **8** test call sites in
  `utils/character-auth.test.ts` (`:76`, `:80`, `:88`, `:97`, `:103`, `:409`, `:424`, `:440`).
  These are *not* string-arm callers; they are the reason the signature change in step 4 is a
  21-site atomic commit rather than a local edit
- Load-bearing behaviour that must survive: `packages/server/src/utils/campaign-auth.ts:17-19`
  and `packages/server/src/utils/note-auth.ts:22-24` document the one-authz-log-per-boundary
  discipline (log-free `fetchCampaignMembership` so each public boundary emits exactly one
  decision log); `note-auth.ts:16-20` documents the NOT_FOUND-vs-FORBIDDEN normalization

## Proposed direction

The ordering below is load-bearing: **widen nothing, narrow the union first, and change any
signature only in a commit that also moves every call site.** Do not reconcile
`assertCharacterOwner` up front — intermediate commits would then pass positional arguments,
and later a `string | AuthzCallerContext` union, into a context-only parameter, and would not
typecheck.

1. **Export `AuthzCallerContext` from `utils/request-logger.ts`.** Nothing else changes in this
   commit. No production caller carries an explicit `AuthzCaller` annotation — the only
   annotations are the helper parameters themselves (`character-auth.ts:88`, `:127`, `:200`,
   `encounter-combat-auth.ts:104`) and the two unwrap helpers, and re-pointing those at
   `AuthzCallerContext` here would break all 23 string-form test callers before step 2 has
   moved them. The helper parameters change in step 3. No behaviour change, no test change;
   this is the enabling commit.
2. **Migrate the 23 string-arm call sites to the object form**, one test file per commit
   (14 in `utils/character-auth.test.ts`, 9 in `utils/encounter-combat-auth.test.ts`):
   `user.id` becomes `{ userId: user.id }`. Every commit typechecks on its own because the
   union still accepts both arms. This must come **before** any signature change — the union
   has to be empty of string callers before it can be narrowed, and doing it later means
   rewriting the same call sites twice.
3. **Narrow `AuthzCaller` to `AuthzCallerContext`** (or delete the alias in favour of the
   exported interface). `getAuthzUserId` / `getAuthzLogContext` stay for now and degrade to
   trivial accessors; the typecheck failure list is the checklist for anything step 2 missed.
   `assertCharacterOwnerOrAccess` still calls positional `assertCharacterOwner`, so its `else`
   branch survives this commit unchanged.
4. **Convert `assertCharacterOwner` (`character-auth.ts:18-23`) to
   `(prisma, characterId, caller: AuthzCallerContext)` in a single commit that also updates all
   21 call sites** — 12 production, 8 in `character-auth.test.ts`, and the internal one at
   `:207`. `(ctx.prisma, id, ctx.user.id, { logger: ctx.logger })` becomes
   `(ctx.prisma, id, { userId: ctx.user.id, logger: ctx.logger })`. **The unpack-and-re-split at
   `character-auth.ts:205-207` is deleted in this same commit,** not a later one: the moment the
   parameter is context-only, the `else` branch must stop re-splitting or the file does not
   compile. This is the first wide commit; step 6 is wider. It is mechanical but wide, and it is
   not splittable without breaking typecheck.
5. **Delete `getAuthzUserId` / `getAuthzLogContext`** once no caller remains. Pure removal.
6. **Converge `campaign-auth.ts` and `note-auth.ts` on the same object caller**, one file per
   commit. `campaign-auth.ts` is the largest commit in the leaf, not step 4: `assertCampaignMember`
   (`:39-44`) and `assertCampaignDm` (`:72-77`) have **42** production and **16** test call sites
   (58 total) and, by the same typecheck constraint as step 4, the signature and every call site
   move together. `note-auth.ts` is a separate, much smaller commit — `loadNoteForMutation`
   (`:26-31`) has 8 call sites (2 production: `routers/note.ts:217`, `:238`; 6 in
   `utils/note-auth.test.ts`). Keep the `(prisma, scopeId, caller)` argument order so the diff at
   each call site is a single argument replacement.
7. **Rename `MutableNote` -> `NoteMutationAccess`** (or similar) in `note-auth.ts:9` and its
   consumers. Separate commit, no behaviour change.

## Scope / caveats

- **The string arm is not vestigial — do not plan this as a three-line deletion.** It has 14
  call sites in `character-auth.test.ts` and 9 in `encounter-combat-auth.test.ts`, 23 in total:
  a test-wide edit. Size step 2 off those 23 union sites, size step 4 separately off its 21
  `assertCharacterOwner` sites — the two sets do not overlap, because `assertCharacterOwner`'s
  `userId: string` is a positional parameter, not the union's string arm — and size step 6 off
  its 58 `campaign-auth.ts` sites, the largest single commit in the leaf.
- **Ordering is a typecheck constraint, not a preference.** Narrowing the union or the
  `assertCharacterOwner` parameter before its callers move produces commits that do not
  compile. Follow steps 1-4 in order; do not hoist the signature change.
- **Preserve the NOT_FOUND-vs-FORBIDDEN semantics verbatim.** `note-auth.ts:16-20` and the
  character helpers deliberately return NOT_FOUND for unlinked/mismatched/invisible records so
  that a FORBIDDEN does not leak the record's existence to other campaign members. A signature
  change must not "tidy" any of these into FORBIDDEN. See
  `docs/adr/0002-character-not-found-semantics.md` — the decision of record, which lists
  `packages/server/src/utils/character-auth.test.ts` under `enforced_by`, so step 2 is editing a
  gate file — and `docs/authorization.md` for the full visibility map. Both are mandatory
  reading for authz changes per `AGENTS.md`. Do not reorder the
  `assertCharacterOwner`-before-`assertCharacterLinkedToCampaign` sequence in
  `services/inventory-service.ts:184`/`:191`: ADR-0002 is why the `notFoundMessage` override
  there is safe ("An override on a deny path that a non-owner can reach would reintroduce the
  oracle").
- **Preserve the one-log-per-boundary discipline.** The comments at `campaign-auth.ts:17-19`
  ("Keeping it log-free lets each public boundary emit exactly one authz decision log under its
  own event name") and `note-auth.ts:22-24` explain why `fetchCampaignMembership` is log-free
  and why `loadNoteForMutation` mirrors `assertEncounterCombatant`. Moving log context into the
  caller object must not cause a second `authz.*` event to fire per decision. Keep both comments
  verbatim; they are the reason risk here is low rather than none.
- **These two findings are one piece of work, not two.** The union-with-two-unwrap-helpers and
  the three-calling-shapes inconsistency are the same defect seen from opposite ends: the union
  exists *because* the helpers disagree. Do not schedule them separately, and do not split step 6
  into its own leaf — it is the three-calling-shapes half of the finding. `MutableNote` (step 7)
  is the one genuinely separable item and can be split off if convenient.
- Steps 1-3 and 5 are type-and-test-only. Steps 4 and 6 rewrite argument construction in
  production routers and services (no behaviour change, but a wide diff), so run the full authz
  test files rather than a focused subset; `docs/guides/add-trpc-procedure.md` covers the router
  side if any procedure's caller construction changes.
- No dependency on other leaves in this pack.

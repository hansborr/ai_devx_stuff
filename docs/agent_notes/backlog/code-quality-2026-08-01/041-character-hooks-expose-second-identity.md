# 41. Nine character-scoped hooks redundantly expose character scope in at least one action payload, with mixed identity-field conventions

Status: Not started
Theme: single identity channel · Area: client · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every character-sheet hook is instantiated for exactly one character: the
`characterId` parameter flows into `useCharacterKeys`, which derives the cache
keys used for optimistic updates and invalidation. Every hook exposes at least
one action whose raw RPC input repeats that character scope, but the wire field
is not uniform: seven modules use `characterId`, personality uses `id`, and
inventory uses `characterId` for create while update/delete necessarily target
an item `id`. TypeScript cannot connect any repeated character identifier to
the hook's captured scope, so a wrong-but-authorized target can make the
mutation and cache work address different characters.

For the character-scoped actions, callers currently restate the hook's
character identity as payload boilerplate. Item IDs on inventory update/delete
are genuine entity identity and are not removable boilerplate. The module
already has the injection idiom in `useCampaignScopedMutation`, which injects
`campaignId` inside five hooks; the redundant character-scope fields should be
handled similarly, using each wire schema's actual field name.

## Evidence

- `packages/client/src/hooks/character-sheet/character-keys.ts:27-43` —
  `useCharacterKeys(characterId)` derives every cache key (`characterKey`,
  `spellsKey`, `inventoryKey` and the filter variants) from the captured id.
- Exactly 9 production hook modules call `useCharacterKeys(characterId)`
  (re-measured at the pin with
  `git grep -n "useCharacterKeys(" -- packages/client/src`, excluding the
  defining module and tests): `use-character-level-up.ts:16`,
  `use-character-personality.ts:17`, `use-character-spells.ts:40`,
  `use-character-stats.ts:102`, `use-inventory.ts:39`, `use-rest.ts:28`,
  `use-sorcery-points.ts:44`, `use-spell-slots.ts:38`,
  `use-weapon-masteries.ts:18` (all under
  `packages/client/src/hooks/character-sheet/`).
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:25,28-29` —
  `StatsUpdatePayload = UpdateCharacterStatsInput`, so `updateStats` /
  `updateStatsAsync` accept a payload-borne `characterId` while the hook's own
  cache scope is captured at `:102`; the optimistic patch at `:106-108` and the
  invalidation at `:117-119` always use the captured scope regardless of what
  id the payload carried.
- `packages/client/src/hooks/character-sheet/use-character-spells.ts:19-32` —
  five actions (`addSpell`, `removeSpell`, `togglePrepared`, `castSpell`,
  `dropConcentration`) all typed over full identity-bearing transport inputs.
- Identity fields vary in the remaining hooks. Spell slots, level-up, rest,
  sorcery points, and weapon masteries use `characterId`
  (`packages/shared/src/schemas/rest-inputs.ts:11,44`,
  `sorcery-point-inputs.ts:12,22`, `weapon-mastery-inputs.ts:14`). Personality
  uses `id` (`character-inputs.ts:136`). Inventory create uses `characterId`,
  while update/delete use item `id` (`inventory-inputs.ts:17,59,81`).
- The cited sheet callers do restate `characterId: character.id` for the
  character-scoped actions (`sheet-dialogs.tsx:66,69,143` and
  `sheet-helpers.ts:199-209`). `inventory-tab.tsx:42` is not another such call:
  it instantiates the hook there and later calls `updateItem` with item IDs.
- The injection idiom already exists:
  `packages/client/src/hooks/character-sheet/use-campaign-scoped-mutation.ts:8-18`
  spreads a hook-held `campaignId` into payloads before `mutate`, used at 11
  wrap sites across five hooks (`use-character-spells.ts:92-94`,
  `use-inventory.ts:92`, `use-rest.ts:45-46`, `use-sorcery-points.ts:68-69`,
  `use-spell-slots.ts:93-95`).
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:55-64` —
  `UPDATE_STATS_CONTROL_FIELDS` strips `characterId` / `campaignId` /
  `expectedVersion` out of the optimistic patch; the wire variables reaching
  `onMutate` will still contain the id after injection, so this set (and its
  guiding comment) must keep `"characterId"` listed.

## Proposed direction

Narrow every action whose wire identity denotes the hook's character scope,
and inject the captured `characterId` under the field name that procedure
expects. Inventory update/delete retain their required item `id`; they are not
part of the identity-removal success criterion.

Conventions for every slice:

- Use `Omit<TInput, "characterId">` for characterId-bearing actions and
  `Omit<UpdateCharacterPersonalityInput, "id">` for personality. Inventory
  create omits `characterId`; inventory update/delete omit neither target ID.
  `packages/shared` schemas stay the single wire contract; no new schemas.
- Each narrowed action callback restores the captured character scope before
  calling `mutate` — as `characterId` for most procedures and as `id` for
  personality. Compose this with `useCampaignScopedMutation` where applicable;
  owner-only mutations continue to bypass campaign-scope injection.
- Internal `useMutation` wiring is untouched: `onMutate` / `onError` /
  `onSettled` still receive full wire variables, so optimistic patches (e.g.
  `buildUpdateStatsPatch` with `UPDATE_STATS_CONTROL_FIELDS`, which keeps
  `"characterId"`) and invalidation via `useCharacterKeys` are unchanged.
- Each narrowed action gets a one-line JSDoc stating the injection contract:
  the hook supplies its character-scope identity; payloads cannot override it.
  Inventory update/delete remain documented as item-ID-targeted actions.
- Before touching a slice, grep its call sites and confirm none intentionally
  passes an id different from the hook's captured scope. Any such site is
  either a latent cache-coherence bug to surface or a caller that needs its
  own hook instance — never silently preserved. (Expected result: none; the
  call-site survey above found only same-scope ids.)
- Each slice lands complete — hook, all call sites, adjacent tests (every hook
  has a sibling `*.test.ts(x)`) — so two conventions never coexist at rest.

Ordered slices (each self-contained; nine modules named so none is skipped):

1. **Stats + spell-slots + sorcery-points** (`use-character-stats.ts`,
   `use-spell-slots.ts`, `use-sorcery-points.ts`). The exported alias
   `StatsUpdatePayload` (`use-character-stats.ts:25`) becomes the `Omit` form;
   its importers (`components/sheet/ability-scores-state.ts`,
   `ability-scores.tsx`, `combat-stats.tsx`, `death-saves-interactive.tsx`,
   `sheet-props.ts`, `pages/character-sheet/sheet-state.ts`) move in this
   slice. Note `sheet-state.ts:174` manually spreads `campaignId` into
   `updateStatsAsync` — `campaignId` survives the `Omit` (only `characterId`
   is removed), so that DM path keeps compiling; verify it does.
2. **Spells + rest + level-up** (`use-character-spells.ts`, `use-rest.ts`,
   `use-character-level-up.ts`). Call sites include
   `pages/character-sheet/sheet-dialogs.tsx` (`:66,69,208`) and
   `sheet-helpers.ts` (`:169-209`).
3. **Inventory + personality + weapon-masteries** (`use-inventory.ts`,
   `use-character-personality.ts`, `use-weapon-masteries.ts`). Call sites
   include `components/vtt/drawer/tabs/inventory-tab.tsx` and
   `sheet-dialogs.tsx:143`.
4. **Close out**: refresh
   `packages/client/src/hooks/character-sheet/MODULE.md` — its seam
   description of `use-campaign-scoped-mutation.ts` (`:95-98`) gains the
   parallel `characterId`-injection convention — and re-run the nine-module
   grep to confirm no hook still exposes a payload-borne `characterId`.

## Scope / caveats

- **No identity brands or nominal id types.** The 2026-07-25 pack's design
  panel refused branding for presence, the character socket, both roll hooks
  and `useDmStatsCallbacks`
  (`docs/agent_notes/backlog/code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md:663-688`,
  recorded as do-not-reopen): those surfaces are server-backstopped, so
  branding buys casts for nothing. This leaf is consistent with that ruling —
  it removes the second identity channel instead of branding it — and those
  socket/presence/roll/DM-callback hooks stay out of scope entirely.
- **Out of scope:** server or shared schema changes of any kind;
  `expectedVersion`/CAS handling, which remains caller-supplied on the stats
  payload; the query side of the hooks (only action signatures narrow).
- **Foreign-id risk is the real risk.** A call site that deliberately passed a
  foreign character-scope identity would have its target silently rewritten to
  the hook's captured id. Audit each narrowed action before migration. Inventory
  update/delete retain item IDs and therefore retain a separate potential
  item-target/cache-scope mismatch that this character-identity change does not
  eliminate.
- **A stalled partial migration is worse than the status quo** for a repo
  judged on copyability — hence slice-complete landings, in the slice order
  above.
- **`Omit` masks future schema meaning.** A future input whose `characterId`
  means something other than the hook's scope would be silently absorbed by
  the injection — the per-hook JSDoc contract line is the guard.
- **Sequencing:**
  [062-character-key-hook-constructs-three-filter.md](./062-character-key-hook-constructs-three-filter.md)
  deletes the dead `characterFilter`/`spellsFilter`/`inventoryFilter` surface
  from `character-keys.ts` — distinct problem, same file and consumers. Land
  that small deletion before this migration (or explicitly rebase this leaf
  after it) to avoid conflict churn.
- `UPDATE_STATS_CONTROL_FIELDS` (`use-character-stats.ts:60-64`) keeps
  `"characterId"`: wire-level variables contain the injected id when
  `onMutate` builds the optimistic patch, so removing it would leak the id
  into the cached stats object.

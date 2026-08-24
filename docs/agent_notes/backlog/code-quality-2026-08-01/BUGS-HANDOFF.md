# Suspected bugs handoff

**This is input to a later `/code-review`, not part of this code-quality
pack's proposal queue.** The audit deliberately did not pursue or verify these
suspected bugs; each needs independent confirmation before any fix.

The 118 entries below preserve every `bugsSideList` item surfaced by the audit
lanes at evidence pin `ebf096580b31f604861fadb3d4cbd4079da4f017`. Their lane
grouping, cited evidence, suspicion rationale, and suggested owner are retained
as reported. See [ORCHESTRATION.md](./ORCHESTRATION.md#deliverable) for the scope
decision and [RUN-LEDGER.md](./RUN-LEDGER.md#runs) for run provenance.

## lane-01-harness-core (4)

### 01-B01 — Hook-wiring validation appears to ignore unknown fields
- `scripts/harness/hook-wiring-schema.ts:233`
- `scripts/harness/hook-wiring-schema.ts:332`
- Why suspected: Manual object validation checks required fields but appears not to reject misspelled additional fields, allowing configuration mistakes to be silently unused.
- suggestedOwner: code-review

### 01-B02 — Hook generation can leave a partially updated output set
- `scripts/harness/generate-hook-wiring.ts:276`
- `scripts/harness/hook-shim-files.ts:93`
- Why suspected: Multiple generated files appear to be written sequentially without an atomic batch boundary, so interruption can leave mutually inconsistent projections.
- suggestedOwner: code-review

### 01-B03 — Verify-step generation can leave four outputs mutually inconsistent
- `scripts/harness/generate-verify-steps.ts:402`
- `scripts/harness/generate-verify-steps.ts:433`
- Why suspected: The generator writes four related artifacts separately and appears able to stop after only a subset has been replaced.
- suggestedOwner: code-review

### 01-B04 — Multiline ESLint suppression rationales may produce empty ledger identities
- `scripts/suppression-ledger-identity.ts:148`
- `scripts/suppression-ledger.json:369`
- `packages/server/src/services/srd/srd-query-helpers.ts:8`
- Why suspected: The identity parser and an observed multiline directive shape appear capable of disagreeing about where rationale text begins.
- suggestedOwner: code-review

## lane-02-analyzers (14)

### 02-B01 — Invalid duplicates mode throws an unexpected generic error
- `scripts/drift-ai/duplicates-check-config.ts:59`
- `scripts/drift-ai/runner.ts:106`
- Why suspected: Malformed checks.duplicates.mode bypasses the DriftAiError path used for normal configuration failures and may crash instead of returning the documented config-error result.
- suggestedOwner: code-review

### 02-B02 — Malformed Dolos rows can silently become an empty or weakened report
- `scripts/drift-ai/dolos-output.ts:113`
- `scripts/drift-ai/dolos-output.ts:119`
- `scripts/drift-ai/dolos-output.ts:120`
- Why suspected: Rows missing expected columns are discarded and missing overlap metrics become zero without a malformed-row diagnostic, so schema drift can resemble a clean scan.
- suggestedOwner: code-review

### 02-B03 — Import-cycle detection ignores self-cycles
- `scripts/drift-ai/import-cycles.ts:151`
- `scripts/drift-ai/import-cycles-graph.ts:169`
- Why suspected: The graph retains same-file edges, but cycle acceptance requires an SCC with at least two nodes.
- suggestedOwner: code-review

### 02-B04 — Malformed Knip envelopes can be reported as clean
- `scripts/drift-ai/knip-duplicates.ts:41`
- `scripts/drift-ai/knip-orphan-files.ts:100`
- `scripts/drift-ai/knip-unused-exports.ts:72`
- Why suspected: Each parser treats a missing or non-array issues field as successful empty findings.
- suggestedOwner: code-review

### 02-B05 — MinHash pair keys can collide on separator-bearing document IDs
- `scripts/drift-ai/minhash-lsh.ts:77`
- `scripts/drift-ai/minhash-lsh.ts:261`
- Why suspected: Two unrestricted IDs are concatenated with an unescaped pipe before insertion into a candidate Map.
- suggestedOwner: code-review

### 02-B06 — Line scanning does not re-enter code inside template interpolations
- `scripts/drift-ai/line-scanner.ts:41`
- `scripts/drift-ai/line-scanner.ts:59`
- Why suspected: Backtick strings are scanned only for escapes and the closing backtick, so ${...} content is not visited as code.
- suggestedOwner: code-review

### 02-B07 — Similarity-ts nonzero exits are accepted when any pair was parsed
- `scripts/drift-ai/near-duplicates-runner.ts:156`
- Why suspected: Partial stdout from a failed subprocess can be returned as a successful candidate report.
- suggestedOwner: code-review

### 02-B08 — Ownership analysis silently suppresses all check-mailmap failures
- `scripts/drift-ai/ownership-command.ts:97`
- Why suspected: Every resolution failure is cached as the unresolved identity with no degraded-state disclosure.
- suggestedOwner: code-review

### 02-B09 — Latest-log filesystem failures are indistinguishable from empty directories
- `scripts/logs-audit/logs-audit-latest.ts:111`
- `scripts/logs-audit/logs-audit-latest.ts:122`
- Why suspected: Directory-read and stat failures collapse to empty candidate lists, so unreadable configured roots can be reported as having no compatible logs.
- suggestedOwner: code-review

### 02-B10 — Code-intel does not classify test-helper modules as tests
- `scripts/code-intel/test-files.ts:1`
- `scripts/code-intel/graph-queries.ts:159`
- Why suspected: The classifier recognizes only .test.ts/.test.tsx despite 10 tracked .test-helper.ts(x) modules, so exclude-tests and direct test discovery can retain test-only helpers.
- suggestedOwner: code-review

### 02-B11 — Injected global or sticky sibling-marker regexes make classification stateful
- `scripts/drift-ai/sibling-naming.ts:51`
- `scripts/drift-ai/sibling-naming.ts:132`
- Why suspected: RegExp.test is called without resetting lastIndex, so /g or /y overrides can alternate results for identical tokens.
- suggestedOwner: code-review

### 02-B12 — Suppression parsing loses lexical context at diff-hunk boundaries
- `scripts/drift-ai/suppressions.ts:129`
- `scripts/drift-ai/suppressions.ts:148`
- Why suspected: The comment scanner resets at every hunk, so additions inside pre-existing multiline comments or strings can be misclassified.
- suggestedOwner: code-review

### 02-B13 — Git-quoted suppression paths are only partially decoded
- `scripts/drift-ai/suppressions.ts:199`
- `scripts/drift-ai/suppressions.ts:205`
- Why suspected: The decoder handles quotes and backslashes but not other Git C/octal escapes, so quoted paths may not match changedPaths.
- suggestedOwner: code-review

### 02-B14 — Verdict staleness ignores dirty-state and fingerprint drift
- `scripts/drift-triage/triage-verdict-collect.ts:201`
- `scripts/drift-triage/triage-verdict-types.ts:86`
- Why suspected: The source-state comparison computes stale only from HEAD even though provenance includes dirty state and a state fingerprint.
- suggestedOwner: code-review

## lane-03-server (18)

### 03-B01 — campaign.get bypasses documented campaign-member error semantics
- `packages/server/src/routers/campaign.ts:145`
- `packages/server/src/routers/campaign.ts:149`
- `packages/server/src/routers/campaign.ts:155`
- `packages/server/src/utils/campaign-auth.ts`
- Why suspected: The router returns NOT_FOUND for every missing membership, while the authorization policy says an existing-campaign non-member receives FORBIDDEN.
- suggestedOwner: code-review

### 03-B02 — Whisper online detection and delivery use different socket scopes
- `packages/server/src/routers/chat.ts:24`
- `packages/server/src/routers/chat.ts:72`
- `packages/server/src/socket/broadcast-registry.ts:234`
- Why suspected: Online detection scans every socket, but whisper delivery considers only sockets in the campaign room, potentially suppressing both delivery and the offline notification.
- suggestedOwner: code-review

### 03-B03 — A whisper without a recipient falls through to whole-campaign broadcast
- `packages/server/src/socket/chat-broadcast.ts`
- `packages/shared/src/schemas/chat-inputs.ts`
- Why suspected: The schema permits whisper with recipientId null, while the broadcaster enters targeted delivery only when recipientId is truthy.
- suggestedOwner: security-review

### 03-B04 — Timestamp-only chat pagination can skip equal-createdAt rows
- `packages/server/src/routers/chat.ts:170`
- `packages/server/src/routers/chat.ts:185`
- `packages/server/src/routers/chat.ts:188`
- Why suspected: The cursor contains only createdAt, the next page uses a strict comparison, and ordering has no id tie-breaker.
- suggestedOwner: code-review

### 03-B05 — Monster and magic-item cursors do not match their sort orders
- `packages/server/src/routers/monster.ts`
- `packages/server/src/routers/magic-item.ts`
- Why suspected: Both lists use an id cursor while ordering by non-unique name or challengeRating/name without an id tie-breaker.
- suggestedOwner: code-review

### 03-B06 — Notification pagination can drop rows sharing the boundary timestamp
- `packages/server/src/routers/notification.ts`
- Why suspected: The next page filters createdAt strictly below the last timestamp and has no id tie-breaker.
- suggestedOwner: code-review

### 03-B07 — Combat-log pagination can skip rows sharing createdAt
- `packages/server/src/services/encounter-combat/combat-log.ts`
- Why suspected: Pagination resumes with a strict createdAt comparison and no id tie-breaker.
- suggestedOwner: code-review

### 03-B08 — Map update deletes the old image before the database update succeeds
- `packages/server/src/routers/map.ts`
- Why suspected: Image deletion starts fire-and-forget before the Prisma update; a failed update may leave the persisted map referencing a removed image.
- suggestedOwner: code-review

### 03-B09 — Map cascade image cleanup starts before database deletion commits
- `packages/server/src/services/map-tokens/map-cascade.ts`
- Why suspected: Background asset deletion starts before the database transaction, so a failed delete can leave a persisted map referencing a removed image.
- suggestedOwner: code-review

### 03-B10 — Rejected shared-note edits are logged as authorized
- `packages/server/src/utils/note-auth.ts`
- `packages/server/src/routers/note.ts`
- Why suspected: loadNoteForMutation logs allow before note.ts performs the author-specific edit check.
- suggestedOwner: security-review

### 03-B11 — Multiclassing into a level-1-subclass class may not apply the subclass choice
- `packages/server/src/services/level-up/core.ts:162`
- `packages/server/src/services/level-up/level-up.ts:81`
- `packages/server/src/services/level-up/subclass.ts:94`
- Why suspected: The new-class subclassLevel is loaded but not passed to subclass resolution, which substitutes level zero when targetClass is absent.
- suggestedOwner: code-review

### 03-B12 — Homebrew character creation may under-prepare spells
- `packages/server/src/services/character-create-spells.ts:168`
- Why suspected: getMaxPreparedSpells receives abilityMod zero even though the non-SRD fallback formula consumes that modifier.
- suggestedOwner: code-review

### 03-B13 — Unknown starting-equipment ids become synthetic SRD inventory rows
- `packages/server/src/services/starting-equipment-service.ts:42`
- `packages/server/src/services/starting-equipment-service.ts:68`
- Why suspected: Missing references fall back to the submitted id, zero weight, generic properties, and sourceType srd rather than being rejected.
- suggestedOwner: code-review

### 03-B14 — Malformed percent escapes can escape cookie parsing
- `packages/server/src/utils/cookie.ts`
- `packages/server/src/routers/auth.ts`
- Why suspected: parseCookies calls decodeURIComponent without handling malformed percent escapes.
- suggestedOwner: code-review

### 03-B15 — Malformed participant conditions may be replaced with an empty list during turn advance
- `packages/server/src/services/combat-actions/turn-transaction.ts`
- Why suspected: A failed whole-array parse falls back to an empty array that is then written through the locked update.
- suggestedOwner: code-review

### 03-B16 — generate-subclasses emits a structurally incomplete output contract
- `packages/server/src/seed/generate-subclasses.ts`
- `packages/server/src/seed/seed-srd-subclass-data.ts`
- `packages/server/src/seed/seed-srd-classes-and-features.ts`
- Why suspected: The generator omits casterType and spellcastingAbility that the committed output declares and the seeder consumes.
- suggestedOwner: code-review

### 03-B17 — Magic-item reseeding does not converge corrected source rows
- `packages/server/src/seed/seed-srd-magic-items.ts`
- Why suspected: createMany with skipDuplicates never applies regenerated or corrected committed data to existing rows.
- suggestedOwner: code-review

### 03-B18 — Seed failure handlers may exit before asynchronous cleanup completes
- `packages/server/prisma/seed.ts`
- `packages/server/prisma/seed-template.ts`
- Why suspected: Both catch handlers call process.exit before the asynchronous finally can await Prisma disconnection and logger flushing.
- suggestedOwner: code-review

## lane-04-shared (11)

### 04-B01 — Character AC silently chooses the first equipped armor item
- `packages/shared/src/rules/armor-class.ts:133`
- Why suspected: If multiple armor items are equipped, computeCharacterAc uses the first match and makes AC depend on incidental item ordering.
- suggestedOwner: code-review

### 04-B02 — Spell damage dice-count limit is applied only to slot formulas
- `packages/shared/src/schemas/spell.ts:83`
- Why suspected: The generic MAX_DAMAGE_DICE_COUNT is enforced for slot formulas but not fixed or character-level formulas.
- suggestedOwner: code-review

### 04-B03 — dateTimeField accepts arbitrary strings
- `packages/shared/src/constants.ts:104`
- Why suspected: Its string branch is plain z.string(), so non-date text satisfies entity fields described as normalized ISO dates.
- suggestedOwner: code-review

### 04-B04 — Freehand drawings accept an odd coordinate count
- `packages/shared/src/map/drawing.ts:44`
- Why suspected: The documented flat x/y pair format requires even length, but the schema only enforces a minimum of four numbers.
- suggestedOwner: code-review

### 04-B05 — Dice notation accepts a zero die count
- `packages/shared/src/dice/dice-notation.ts:13`
- `packages/shared/src/dice/dice-roller.ts:15`
- Why suspected: 0d20 matches, has no lower count bound, and rolls as an empty dice term.
- suggestedOwner: code-review

### 04-B06 — Dice notation accepts adjacent arithmetic operators
- `packages/shared/src/dice/dice-notation.ts:67`
- Why suspected: Forms such as 1d6++2 and 1d6+-2 replace the current sign instead of being rejected.
- suggestedOwner: code-review

### 04-B07 — Metamagic combination validation accepts duplicate option IDs
- `packages/shared/src/rules/sorcery-points.ts:190`
- Why suspected: The validator resolves each ID but never checks uniqueness, so repeating a combinable option can pass with doubled cost.
- suggestedOwner: code-review

### 04-B08 — Whitespace-only chat messages parse to empty content
- `packages/shared/src/schemas/chat-inputs.ts:26`
- Why suspected: The schema applies min(1) before trim(), allowing whitespace to pass length validation and transform to an empty string.
- suggestedOwner: code-review

### 04-B09 — Campaign members can submit system-generated chat types
- `packages/shared/src/schemas/chat-inputs.ts:16`
- `packages/server/src/routers/chat.ts:100`
- Why suspected: The public send input accepts the full persisted type enum, and the router persists the supplied type after membership validation without restricting system, roll, or combat variants.
- suggestedOwner: security-review

### 04-B10 — Map layer byte limit counts UTF-16 characters
- `packages/shared/src/schemas/map-inputs.ts:177`
- `packages/shared/src/schemas/map.ts:24`
- Why suspected: JSON.stringify(data).length can undercount the UTF-8 bytes occupied by non-ASCII layer data.
- suggestedOwner: code-review

### 04-B11 — Combat-log filtering cannot represent rounds above 999
- `packages/shared/src/schemas/encounter.ts:16`
- `packages/shared/src/schemas/encounter-inputs.ts:278`
- `packages/shared/src/rules/initiative.ts:94`
- Why suspected: Encounter rounds advance without an upper bound, while listCombatLogsInputSchema rejects a round above MAX_ROUND.
- suggestedOwner: code-review

## lane-05-client (24)

### 05-B01 — Actions-tab feature Use buttons only log to the console
- `packages/client/src/components/vtt/drawer/tabs/actions-tab-features.tsx`
- `packages/client/src/components/vtt/drawer/tabs/features-tab.tsx`
- Why suspected: The Actions tab renders an enabled Use control that only logs, while the dedicated tab invokes the mutation.
- suggestedOwner: code-review

### 05-B02 — Drawer spell-slot pips are clickable no-op buttons
- `packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx`
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx`
- `packages/client/src/components/sheet/spell-slot-pips.tsx`
- Why suspected: Both drawer callers pass noop callbacks, causing interactive buttons instead of the component's read-only spans.
- suggestedOwner: code-review

### 05-B03 — Ritual cast selection is not carried into confirmation
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx`
- `packages/client/src/components/vtt/drawer/confirm-cast-strip.tsx`
- `packages/client/src/hooks/vtt-drawer/use-confirm-cast.ts`
- Why suspected: The tab labels Ritual but dispatches the ordinary cast path; confirmation defaults the omitted ritual flag to false.
- suggestedOwner: code-review

### 05-B04 — Actions-tab spells bypass preparation and slot eligibility
- `packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx`
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx`
- `packages/client/src/components/vtt/drawer/cast-rail.tsx`
- Why suspected: The Actions copy enables spells that the dedicated tab disables, and the rail does not recheck preparation.
- suggestedOwner: code-review

### 05-B05 — Sorcery-point selectors can retain an unavailable level
- `packages/client/src/components/sheet/sorcery-points-panel.tsx`
- Why suspected: Selection state initializes from derived options once and can submit a level removed by a later conversion.
- suggestedOwner: code-review

### 05-B06 — Metamagic affordability ignores accumulated selected cost
- `packages/client/src/components/sheet/metamagic-selector.tsx`
- `packages/client/src/components/sheet/cast-spell-dialog.tsx`
- Why suspected: Options are gated by individual cost while the calculated total is not used to gate casting.
- suggestedOwner: code-review

### 05-B07 — Weapon mastery dialog cannot save an empty selection
- `packages/client/src/components/sheet/weapon-mastery-dialog.tsx`
- Why suspected: Save is disabled when selected.size is zero, apparently preventing removal of all masteries.
- suggestedOwner: code-review

### 05-B08 — Point-buy increment rejects an exactly affordable purchase
- `packages/client/src/components/character-create/steps/ability-score-card.tsx`
- Why suspected: The button uses remaining <= costDelta, disabling the purchase when remaining equals its cost.
- suggestedOwner: code-review

### 05-B09 — Character sheet queries an empty id before its missing-param guard
- `packages/client/src/pages/character-sheet-page.tsx`
- Why suspected: character.get is invoked with an empty-string fallback without enabled gating before the missing-id branch renders.
- suggestedOwner: code-review

### 05-B10 — CharacterCard nests action buttons inside a navigation link
- `packages/client/src/components/character-card.tsx`
- Why suspected: Click suppression does not remove the invalid nested interactive semantics for keyboard and assistive-technology users.
- suggestedOwner: code-review

### 05-B11 — Notification relative timestamps do not advance with time
- `packages/client/src/components/notifications/notification-item.tsx`
- Why suspected: The text reads Date.now during render but has no timer or scheduled refresh.
- suggestedOwner: code-review

### 05-B12 — Magic Items navigation appears only in the mobile header
- `packages/client/src/components/app-header.tsx`
- Why suspected: The mobile menu includes the compendium route while desktop navigation omits it.
- suggestedOwner: code-review

### 05-B13 — Create-map success can preserve stale form and upload state
- `packages/client/src/components/campaign/maps/create-map-dialog.tsx`
- `packages/client/src/components/campaign/maps/maps-panel.tsx`
- Why suspected: Mutation success closes the controlled dialog without calling its internal reset checklist.
- suggestedOwner: code-review

### 05-B14 — Map cards and image drop zones contain nested interactive controls
- `packages/client/src/components/campaign/maps/map-card.tsx`
- `packages/client/src/components/campaign/maps/map-image-field.tsx`
- Why suspected: Elements with button semantics contain native Button descendants.
- suggestedOwner: code-review

### 05-B15 — Combat map exposes Place Token without consuming placement state
- `packages/client/src/components/campaign/maps/map-toolbar-dm-tools.tsx`
- `packages/client/src/components/campaign/combat/combat-map-header.tsx`
- `packages/client/src/components/campaign/combat/combat-map-content.tsx`
- Why suspected: The combat toolbar enables placement, but CombatMapContent has no placement slice or AddTokenDialog.
- suggestedOwner: code-review

### 05-B16 — Token sidebar nests a delete button inside button semantics
- `packages/client/src/components/campaign/tokens/token-sidebar.tsx`
- Why suspected: A role=button row contains another Button, producing nested interactive semantics.
- suggestedOwner: code-review

### 05-B17 — TokenContextMenu declares menu roles without a menu keyboard model
- `packages/client/src/components/campaign/tokens/token-context-menu.tsx`
- Why suspected: Menu/menuitem roles are present without arrow-key or roving-focus behavior.
- suggestedOwner: code-review

### 05-B18 — Campaign query failures appear as an empty character roster
- `packages/client/src/components/campaign/encounters/add-participant-dialog.tsx`
- Why suspected: The character tab handles loading but not query errors, so missing data becomes an empty-state message.
- suggestedOwner: code-review

### 05-B19 — Combat-log query failures appear as an empty log
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx`
- `packages/client/src/components/campaign/combat/combat-log-panel.tsx`
- Why suspected: Absent error data is converted to an empty list and rendered as no recorded actions.
- suggestedOwner: code-review

### 05-B20 — Add-log participant default does not follow active-turn changes
- `packages/client/src/components/campaign/combat/combat-log-panel.tsx`
- Why suspected: The current participant prop is copied into local state once and not rebased when turns change.
- suggestedOwner: code-review

### 05-B21 — Condition editing is hidden when a participant lacks HP fields
- `packages/client/src/components/campaign/combat/initiative-tracker/dm-participant-tools.tsx`
- Why suspected: The HP guard wraps the independent condition editor as well as the HP control.
- suggestedOwner: code-review

### 05-B22 — CORS fallback images can publish stale state after URL changes
- `packages/client/src/hooks/use-background-image.ts`
- Why suspected: The fallback Image request is not retained or cancelled, so obsolete onload handlers can update state.
- suggestedOwner: code-review

### 05-B23 — Delete-account password survives dialog close and reopen
- `packages/client/src/pages/settings-page.tsx`
- Why suspected: The dialog remains mounted and neither close path resets its password state.
- suggestedOwner: code-review

### 05-B24 — Collection detail ignores collection-query loading, error, and not-found states
- `packages/client/src/pages/collection-detail-page.tsx`
- Why suspected: Visible state follows only the entries query, leaving a failed collection load with a generic header and active controls.
- suggestedOwner: code-review

## lane-06-tests (22)

### 06-B01 — Freshness smokes regenerate tracked outputs before checking them
- `scripts/tests/test-generate-harness-controls.sh`
- `scripts/tests/test-generate-lint-guidance.sh`
- Why suspected: Both tests can repair pre-existing drift, pass, and leave the worktree modified; missing goldens are also created implicitly.
- suggestedOwner: code-review

### 06-B02 — Slow-tier regular-sentinel assertion is unreachable
- `scripts/tests/test-test-slow.sh`
- Why suspected: The failure condition requires the already-proven slow sentinel to be absent, so the named exclusion assertion cannot fire.
- suggestedOwner: code-review

### 06-B03 — Logs-audit no-sidecar tests do not observe the default write path
- `scripts/logs-audit/logs-audit.test.ts`
- Why suspected: The unset-env cases assert only no throw or nonexistence of an unrelated path, allowing unintended default writes to pass.
- suggestedOwner: code-review

### 06-B04 — Near-duplicate runner assertions can skip their substantive checks
- `scripts/drift-ai/near-duplicates.test.ts`
- Why suspected: Several cases assert only ok and then conditionally assert details for the expected engine; returning the wrong successful engine bypasses the oracle.
- suggestedOwner: code-review

### 06-B05 — Codemod stdout fixtures are partial or empty despite an expectedStdout contract
- `scripts/codemods/lib/fixture-runner.test-helper.ts`
- `scripts/codemods/fixtures`
- Why suspected: The helper uses substring containment and 54 of 90 fixtures omit stdout expectations, so unexpected output is widely unobserved.
- suggestedOwner: code-review

### 06-B06 — Upload tests recursively delete a shared default uploads root
- `packages/server/src/services/upload-service.test.ts`
- `packages/server/src/routes/upload-routes.test.ts`
- `packages/server/src/config/env.ts`
- Why suspected: Parallel workers share the default uploads directory, and test cleanup can delete another worker's files or a developer's existing uploads directory.
- suggestedOwner: code-review

### 06-B07 — Spell-casting fixture can leave the seeded Fireball row mutated
- `packages/server/src/services/spell-casting/spell-casting.test.ts`
- `packages/server/src/test/clean-db.ts`
- Why suspected: The SRD row is mutated before entering try/finally; setup failure leaves ritual=true in a table that cleanDb deliberately preserves.
- suggestedOwner: code-review

### 06-B08 — Presence multi-tab test can false-pass on a delayed leave event
- `packages/server/src/services/presence-multi-tab.test.ts`
- Why suspected: A fixed negative sleep checks a boolean once, after which a late first-tab leave event can satisfy the waiter intended for the second disconnect.
- suggestedOwner: code-review

### 06-B09 — Test database fallback derivation drops PostgreSQL query parameters
- `packages/server/src/test/test-database-url.ts`
- `packages/server/vitest.config.ts`
- `packages/server/vitest.mutation.config.ts`
- Why suspected: Regex replacement consumes the final path segment together with sslmode, schema, or other query parameters.
- suggestedOwner: code-review

### 06-B10 — Destructive test-database guard errors expose full credentials
- `packages/server/src/test/prepare-test-db.ts`
- `packages/server/src/test/test-database-url.ts`
- Why suspected: Refusal errors interpolate the complete database URL, including username and password, into CI or local logs.
- suggestedOwner: security-review

### 06-B11 — Server base preparation and worker cloning use different lock scopes
- `packages/server/src/test/global-setup.ts`
- `packages/server/src/test/prepare-test-db.ts`
- `packages/server/src/test/worker-test-database.ts`
- Why suspected: Concurrent test runs can reset, migrate, seed, and clone the same base database without one shared advisory lock.
- suggestedOwner: code-review

### 06-B12 — Socket test helpers leak listeners, timers, and reconnecting clients
- `packages/server/src/test/socket-helper.ts`
- `packages/server/src/socket/socket-auth.test.ts`
- Why suspected: Success, connection-error, and timeout paths do not consistently remove opposite listeners, clear timers, or disconnect tracked rejected sockets.
- suggestedOwner: code-review

### 06-B13 — Socket rate-limit error test never triggers rate limiting
- `packages/server/src/socket/connection-handler.test.ts`
- Why suspected: The RATE_LIMIT-named case sends one successful ping and asserts only that the socket remains connected.
- suggestedOwner: code-review

### 06-B14 — Refresh and logout tests do not prove the replacement or invalidation lifecycle
- `packages/server/src/routes/auth-refresh.test.ts`
- `packages/server/src/routes/auth-logout.test.ts`
- Why suspected: Logout checks only cookie clearing, while refresh rejects the old token without proving the returned replacement token works.
- suggestedOwner: code-review

### 06-B15 — Character wizard ignores requested equipment option B
- `e2e/page-objects/character-wizard.po.ts`
- Why suspected: CharacterBuildOptions accepts A or B, but fillWizardThroughReview always selects A.
- suggestedOwner: code-review

### 06-B16 — E2E mutation response waits are armed after the action
- `e2e/notifications.spec.ts`
- `e2e/page-objects/campaign-detail.po.ts`
- Why suspected: A sufficiently fast response can arrive before the waiter is registered, producing intermittent timeouts.
- suggestedOwner: code-review

### 06-B17 — A11y baseline suppresses every node sharing an existing rule ID
- `e2e/a11y.spec.ts`
- Why suspected: Filtering by Axe rule ID hides newly introduced violations under color-contrast or another already-baselined rule.
- suggestedOwner: code-review

### 06-B18 — Nested Vitest modifier chains may trigger test-file-location false positives
- `eslint-rules/test-file-location.js`
- `eslint-rules/test-file-location.test.js`
- Why suspected: The visitor recognizes only a MemberExpression directly rooted at an identifier, not valid chains such as test.concurrent.each or it.skip.each.
- suggestedOwner: code-review

### 06-B19 — Multiclass half-caster levels are rounded independently
- `packages/shared/src/rules/spellcasting.ts`
- `packages/shared/src/rules/spellcasting.test.ts`
- Why suspected: Paladin 1 plus Ranger 1 becomes effective caster level 2, although SRD aggregation before rounding yields level 1.
- suggestedOwner: code-review

### 06-B20 — Diagonal cones lose one wing in NE and SW
- `packages/shared/src/map/area-template.ts`
- `packages/shared/src/map/area-template.test.ts`
- Why suspected: For dirX*dirY=-1 the two generated cells are identical, producing duplicates and omitting the reflected wing.
- suggestedOwner: code-review

### 06-B21 — Metamagic validation accepts duplicates and cannot represent Sorcery Incarnate
- `packages/shared/src/rules/sorcery-points.ts`
- `packages/shared/src/rules/sorcery-points.test.ts`
- Why suspected: Duplicate Empowered or Seeking choices are accepted, while the context-free validator globally rejects the two-option SRD exception.
- suggestedOwner: code-review

### 06-B22 — Dice notation and freehand schemas admit impossible boundary shapes
- `packages/shared/src/dice/dice-notation.ts`
- `packages/shared/src/map/drawing.ts`
- `packages/shared/src/dice/dice-notation.test.ts`
- `packages/shared/src/map/drawing.test.ts`
- Why suspected: 0d6 parses successfully, and an odd-length freehand coordinate array passes despite the documented x/y-pair contract.
- suggestedOwner: code-review

## lane-07-docs-dx (1)

### 07-B01 — Root Compose publishes PostgreSQL and Redis on every host interface
- `docker-compose.yml`
- `.devcontainer/docker-compose.yml`
- Why suspected: Root Compose uses unqualified 8002:5432 and 8004:6379 bindings while the devcontainer intentionally binds the same services to 127.0.0.1; the root form can expose development data services to the surrounding network.
- suggestedOwner: security-review

## lane-08-cross-cutting (4)

### 08-B01 — Campaign description controls cap valid input at half the shared contract limit
- `packages/shared/src/constants.ts:52`
- `packages/shared/src/schemas/campaign-inputs.ts:9`
- `packages/client/src/components/campaign/settings/create-campaign-dialog.tsx:42`
- `packages/client/src/components/campaign/settings/campaign-settings-panel.tsx:75`
- Why suspected: Shared campaign validation accepts descriptions up to 10,000 characters, while both browser controls hard-cap input at 5,000.
- suggestedOwner: code-review

### 08-B02 — Duplicate homebrew entry names can bind imported references to an arbitrary entry
- `packages/shared/src/schemas/homebrew-export.ts:44`
- `packages/server/prisma/schema.prisma:1449`
- `packages/server/src/services/homebrew-import-service.ts:81`
- `packages/server/src/services/homebrew-import-service.ts:103`
- Why suspected: The envelope and database permit duplicate type/name entries, while import builds an overwriting name-to-id Map from an unordered query and uses it for subclass and background references.
- suggestedOwner: code-review

### 08-B03 — Date-only campaign and note values may display one day early west of UTC
- `packages/client/src/components/campaign/settings/campaign-settings-panel.tsx:31`
- `packages/client/src/components/campaign/settings/campaign-card.tsx:15`
- `packages/client/src/components/campaign/notes/note-editor.tsx:45`
- `packages/client/src/components/campaign/notes/note-card.tsx:65`
- Why suspected: Date inputs are serialized at UTC midnight and later rendered with local-time toLocaleDateString, allowing negative UTC offsets to display the preceding calendar date.
- suggestedOwner: code-review

### 08-B04 — Several path-containment predicates reject valid in-repo names beginning with two dots
- `scripts/codemods/concurrency-guard/cli.ts:61`
- `scripts/codemods/structured-logging-fix.ts:111`
- `scripts/code-intel/path-utils.ts:7`
- `scripts/harness/skill-projection-files.ts:37`
- Why suspected: The predicates use relative.startsWith(".."), so a valid child such as `..generated/file.ts` is treated as outside; scripts/lib/git.ts uses the separator-aware boundary.
- suggestedOwner: code-review

## lane-09-lint-machinery (9)

### 09-B01 — no-plain-error-in-trpc may treat a shadowed Error binding as the global constructor
- `eslint-rules/no-plain-error-in-trpc.js:8`
- Why suspected: The rule's constructor recognition appears name-based, so a local binding named Error may be reported as the global built-in.
- suggestedOwner: code-review

### 09-B02 — uninvoked-array-callback may treat a shadowed Array binding as the global constructor
- `eslint-rules/uninvoked-array-callback.js:44`
- Why suspected: The rule's Array recognition appears name-based and may misclassify a locally shadowed binding.
- suggestedOwner: code-review

### 09-B03 — no-async-array-callbacks may treat a shadowed Promise binding as the global constructor
- `eslint-rules/no-async-array-callbacks.js:44`
- Why suspected: The rule's Promise recognition appears name-based and may misclassify a locally shadowed binding.
- suggestedOwner: code-review

### 09-B04 — Trend series compare values across metric migrations
- `tools/lint-ratchet/src/governance/trend.ts:173`
- `tools/lint-ratchet/src/governance/trend.ts:228`
- Why suspected: A reused ratchet id preserves prior points while overwriting metric metadata, allowing first, last, and delta calculations across incomparable metrics.
- suggestedOwner: code-review

### 09-B05 — Hook TSV protocols cannot round-trip legal Git paths containing tabs or newlines
- `tools/lint-ratchet/src/governance/edit-check-protocol.ts:28`
- `tools/lint-ratchet/src/governance/ratchet-coverage.ts:17`
- Why suspected: Git permits tab and newline characters in filenames, which can corrupt the unescaped positional protocol.
- suggestedOwner: code-review

### 09-B06 — PnP-aware ESLint launch is paired with root-node_modules-only version hashing
- `tools/lint-ratchet/src/kernel/eslint-runner.ts:54`
- `tools/lint-ratchet/src/kernel/rule-source.ts:123`
- Why suspected: The runner resolves ESLint through createRequire for PnP, but source hashing reads package manifests from repoRoot/node_modules, which a PnP host may not have.
- suggestedOwner: code-review

### 09-B07 — Smoke-source overrides are not used by the fixture-validation precondition
- `scripts/path-policy/smoke-subject-headers.ts`
- `scripts/path-policy/fixture-shell-dependencies.ts`
- `scripts/harness/generate-skill-artifacts.ts`
- Why suspected: Fixture validation reads on-disk smoke files before sourceOverrides are parsed, so a proposed generated source may be checked against its previous copy set.
- suggestedOwner: code-review

### 09-B08 — The public demo merge-driver installer silently depends on flock
- `examples/lint-ratchet-demo/scripts/git/install-baseline-merge-driver.sh:103`
- `examples/lint-ratchet-demo/scripts/git/install-baseline-merge-driver.sh:108`
- Why suspected: When flock is unavailable, including on stock macOS, the advisory exit path returns success while leaving the driver uninstalled.
- suggestedOwner: code-review

### 09-B09 — The demo CLI silently accepts conflicting modes and update-only flags
- `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:56`
- `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:64`
- `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:86`
- `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:176`
- Why suspected: Later mode flags overwrite earlier ones, and --allow-worse is parsed in every mode but consumed only by update.
- suggestedOwner: code-review


## Wave-2 additions (2026-08-02 top-up round 1)


### lane-06-tests wave-2 (4)


#### 06-B23 — Shared generated-file scaffold can truncate a tracked artifact on interruption
- `scripts/lib/doc-generator.ts`
- `scripts/harness/generate-verify-steps.ts`
- Why suspected: doc-generator.ts:90 writes directly with writeFileSync while generate-verify-steps invokes it four times sequentially; interruption can leave a truncated artifact and mixed generations.
- suggestedOwner: code-review

#### 06-B24 — Slow-test config treats a file URL pathname as a decoded filesystem path
- `vitest.slow.config.ts`
- Why suspected: Line 22 uses new URL(import.meta.url).pathname, which preserves URL escaping and has platform-specific semantics; paths containing spaces, non-ASCII characters, or Windows drive letters can derive the wrong root.
- suggestedOwner: code-review

#### 06-B25 — Type-aware single-flight test contains only one type-aware task
- `tools/lint-ratchet/src/kernel/current-collector.test.ts`
- Why suspected: The fixture has exactly one type-aware entry, so maxTypeAwareInFlight cannot exceed one even if the single-flight cap is removed; the named guard is vacuous.
- suggestedOwner: code-review

#### 06-B26 — Absent debt-log test uses a shared fixed temporary pathname
- `tools/lint-ratchet/src/governance/debt-log.test.ts`
- Why suspected: The case assumes a fixed file under the system temp directory is absent without creating an isolated root; stale or concurrent files can invert the assertion.
- suggestedOwner: code-review

### lane-08-cross-cutting wave-2 (2)


#### 08-B05 — Upcast slot-damage validation caps only one increment rather than the maximum cast result
- `packages/shared/src/schemas/spell.ts:99`
- `packages/shared/src/schemas/spell.ts:107`
- `packages/server/src/services/spell-casting/resolve-character-spell.ts:91`
- `packages/shared/src/dice/dice-notation.ts:136`
- Why suspected: The schema accepts baseDice plus one perLevelDice increment at or below 100, but execution multiplies perLevelDice by every slot level above the base. A spell such as base 98d6 plus 2d6 per level can pass validation and later exceed the dice parser's 100-die limit.
- suggestedOwner: code-review

#### 08-B06 — Character sheet AC can disagree with encounter combat AC
- `packages/client/src/pages/character-sheet/sheet-state.ts:135`
- `packages/client/src/components/sheet/combat-stats.tsx:156`
- `packages/server/src/utils/encounter-query.ts:155`
- Why suspected: The sheet displays freshly computed equipment and class AC while encounter combat resolves character AC from persisted stats.ac.
- suggestedOwner: code-review

### lane-09-lint-machinery wave-2 (1)


#### 09-B10 — Smoke-subject projection validates disk sources instead of supplied source overrides
- `scripts/path-policy/smoke-subject-headers.ts:167`
- `scripts/path-policy/smoke-subject-headers.ts:171`
- `scripts/path-policy/smoke-subject-headers.ts:172`
- Why suspected: projectSmokeSubjectOutputs accepts sourceOverrides and uses them when parsing definitions, but validateFixtureShellDependencies reads the on-disk smoke files, so one projection can validate and generate from different source states.
- suggestedOwner: code-review

## Wave-2 additions (2026-08-02 top-up round 2)

### lane-05-client wave-2 r2 (1)

#### 05-B25 — Cancelled homebrew import reopens with the previous file and error
- `packages/client/src/components/homebrew/collections/import-collection-dialog.tsx:41`
- `packages/client/src/pages/homebrew-page.tsx:210`
- Why suspected: Dialog state at import-collection-dialog.tsx:41-42 clears only on successful import at lines 46-52; Cancel at lines 125-130 only closes the still-mounted dialog rendered by homebrew-page.tsx:210, so reopening shows the stale file selection and error.
- suggestedOwner: code-review

### lane-06-tests wave-2 r2 (1)

#### 06-B27 — Type-aware single-flight assertion has only one type-aware fixture
- `tools/lint-ratchet/src/kernel/current-collector.test.ts`
- `tools/lint-ratchet/src/kernel/current-collection-scheduler.ts`
- Why suspected: The fixture registry declares only one type-aware ratchet, so the maxTypeAwareInFlight assertion cannot exercise the branch that defers a second type-aware ratchet.
- suggestedOwner: code-review

## Wave-2 additions (2026-08-02 critic-remediation micro round)

### lane-02-analyzers micro (2)

#### 02-B15 — Logs-audit converts analyzer exceptions into input-read findings
- `scripts/logs-audit.ts:182`
- Why suspected: The catch covers both readFile and auditJsonlText, so an unexpected exception in redaction, request-id, or event-field analysis is reported as "could not read log file" and treated as an ordinary finding rather than a tool failure.
- suggestedOwner: code-review

#### 02-B16 — Drift-triage mislabels packet-preparation failures as report-write failures
- `scripts/drift-triage.ts:116`
- `scripts/drift-triage.ts:136`
- Why suspected: One catch wraps primary output, provenance collection, source reads, packet construction, and bundle writes, but every exception is returned as "could not write report," obscuring failures that occurred before any packet write.
- suggestedOwner: code-review

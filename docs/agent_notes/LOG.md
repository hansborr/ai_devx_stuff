# Log

Curated recent history. Do not use this file as an archive for every landed
task; keep only entries that help orient future sessions. Current state lives
in `STATUS.md`, and the active queue lives in `NEXT.md`.

Newest on top.

---

## 2026-05-15 — Playwright Harness Reference Restored

Restored the upstream Playwright harness surface that had been treated as an
accidental divergence in the reference copy: tracked Claude/Codex
`playwright-cli` skills, `docs/guides/add-e2e-test.md`, Playwright lint wiring,
`local/e2e-prefer-role-selectors`, the `drift:e2e` locator-usage reporter,
`playwright.config.ts`, `tsconfig.e2e.json`, and the upstream `e2e/` examples.
The archived `a11y-tree-playwright-plan.md` now documents the rationale. No
tests were run in this reference repo by request.

---

## 2026-05-10 — drift:ai Current Scope Landed

Finished the promoted `drift:ai --scope current` workstream. Current-mode
comments now audits JS/TS-family inventory files with the same thresholds and
configurable exclusions as changed mode, while chunk output writes a complete
primary report plus deterministic manifest/chunk JSON files for AI handoff.
`docs/ai-harness.md` documents current scope and chunk flags. `NEXT.md` is now
empty until the next explicit re-triage.

---

## 2026-05-10 — 5e Rules Logic Guide

Added `docs/guides/change-rules-logic.md` for SRD-vs-policy source decisions,
shared rules helper reuse, pure rules boundaries, colocated shared rules tests,
focused verification, and manual mutation testing when assertion strength is
uncertain. `docs/ai-harness.md` now maps the guide to shared rules Vitest,
`test:changed`, and `bun run test:mutation`. The BatonLoop ready queue is now
fully landed, with no next ready leaf promoted.

---

## 2026-05-10 — Migration Safety Output Clarity

Grouped `db:migration-safety` findings into `== actionable warnings ==` for
unacknowledged `WARN` findings and `== acknowledged findings ==` for
allowlisted `INFO` history. The scanner still stays warn-only and keeps its
doctor signal lines, while focused shell coverage pins both fully acknowledged
and mixed-output shapes. The next promoted leaf is the 5e/5.5e rules logic
guide.

---

## 2026-05-10 — Module Index Guide Coverage

Tightened `scripts/test-generate-module-index.sh` so `--check` now has
coverage for guide-directed H1 and `Concepts:` breadcrumb changes. The test
mutates a sandbox module doc after index generation, proves the stale index is
reported with the changed metadata, and confirms check mode does not rewrite
`MODULE-INDEX.md`. The next promoted leaf is migration-safety output clarity.

---

## 2026-05-10 — Homebrew Subclass Caster Fields

Exposed `casterType` and `spellcastingAbility` in the homebrew subclass form,
using the shared caster option helpers and preserving the existing form-data
payload shape. Focused component coverage pins visible saved state and caster
select interactions. The next promoted leaf is module-index guide coverage.

---

## 2026-05-10 — Homebrew Class Caster Fields

Exposed `casterType`, `spellcastingAbility`, and `ritualAdept` in the
homebrew class form, using the shared caster option helpers and preserving the
existing form-data payload shape. Focused component coverage pins the visible
saved state, caster select interactions, and ritual-adept toggling. The next
promoted leaf is homebrew subclass caster-field inputs.

---

## 2026-05-10 — SRD Ritual Adept Rename

Renamed `Class.ritualCaster` / `classes.ritual_caster` to `ritualAdept` /
`ritual_adept` across Prisma, shared schemas, SRD seeding, tRPC mapping,
homebrew class form data, and fixtures. The migration renames the class column,
normalizes existing SRD rows so only Wizard is true, and renames stored
homebrew class JSON from `ritualCaster` to `ritualAdept` when needed. The next
promoted leaf is homebrew class caster-field inputs. Review follow-up added
legacy import/form fallback so old exported class payloads with `ritualCaster`
preserve the value as `ritualAdept`.

---

## 2026-05-10 — SRD Ritual Caster Decision

Captured the BatonLoop caster provenance decision in
`followup-srd-castertype-issues.md`: `Class.ritualCaster` should be renamed to
Wizard-style `ritualAdept`, seeded true only for Wizard, and kept distinct from
the general prepared-spell Ritual rule. The next promoted leaf is a
metadata-only rename/migration before homebrew class caster-field UI work.

---

## 2026-05-10 — SRD/Homebrew Mapper Provenance Fixture

Added a reviewed scenario table to `buildExportEnvelope` helper coverage. The
fixture proves homebrew subclass refs get `parentClassName` for import
rebinding, while an SRD class id such as `class-fighter` keeps its `classId`
and is not treated as a homebrew cross-entry ref.

---

## 2026-05-10 — Encounter Transition Fixture

Added a reviewed scenario table to `encounter.transitionState` route coverage.
The fixture proves paused combat resumes without rewinding the combat cursor
after both a mid-round advance and a wrapped-round advance, preserving
`round` and `currentTurnIndex` through `paused -> active`.

---

## 2026-05-10 — Authorization NOT_FOUND Fixture

Added a reviewed scenario table to `campaign.assignCharacter` route coverage.
The fixture compares an existing foreign character id with a missing character
id and asserts both return the same 404 `NOT_FOUND` / `Character not found`
tRPC response shape. Review follow-up stripped stack traces from formatted tRPC
error data so identical authorization denials do not expose different throw
sites.

---

## 2026-05-10 — Shared Rules Stryker Triage And Test

Triaged a focused `attack-roll.ts` Stryker slice for the BatonLoop queue. The
useful survivor was `applyCritDice("10d6")` failing to prove multi-digit dice
counts double to `20d6`; the companion anchor-removal regex mutant is reviewed
as equivalent/noisy under the current pure damage-dice contract. Review
follow-up added the focused `10d6` assertion in `attack-roll.test.ts`.

---

## 2026-05-10 — Module Doc Guide

Added `docs/guides/add-module-doc.md` from the BatonLoop queue. The guide
points contributors at `docs/module-docs.md`, covers when `MODULE.md` versus
`*-MODULE.md` is appropriate, keeps `Concepts:` breadcrumbs search-focused,
and records when to run `bun run module:index` or `bun run module:index:check`.

---

## 2026-05-10 — Scripts Vitest Baseline

Completed shell-migration Leaf 0A after a review pass found a real recursive
scripts-test routing gap. The scripts Vitest project now includes
`scripts/**/*.test.ts`, coverage excludes recursive script tests, and
`test:changed` has smoke coverage for generic nested script tests routing to
the `scripts` project.

---

## 2026-05-10 — Shell Migration Coordination Started

Created `docs/agent_notes/in_progress/shell-migration.md` from the external
shell migration draft and promoted only Leaf 0A: audit and patch the existing
scripts Vitest wiring without repointing production commands, hooks, Husky, or
`test:scripts`. The note records that this checkout already has a scripts
Vitest project, so the first leaf should be a baseline audit unless a concrete
coverage gap appears.

---

## 2026-05-10 — Logs Audit Request Correlation

Extended `bun run logs:audit` beyond parse/redaction checks. It now verifies
business-event request ids against Fastify/Pino request records when present,
requires stable authz/mutation/broadcast outcomes and low-cardinality reasons
where expected, and pins `socket.broadcast` `socketEvent` coverage with a
representative fixture.

---

## 2026-05-10 — Worktree-Local Logs Audit Started

Started the worktree-local observability stream with `bun run logs:audit`.
The first slice is read-only and fixture-backed: it accepts one or more JSONL
log files, reports unparseable/non-object lines, and flags obvious unredacted
sensitive fields, server-redacted chat/whisper content paths, or sensitive URL
query params without echoing secret values. Script Vitest coverage pins the
redacted fixture, leak reporting, JSON output, CLI exits, and `test:changed`
selection for `scripts/logs-audit*` edits. Next leaf extends the audit to
request-id correlation and stable event fields. Review follow-up made blank
JSONL lines fail parsing, added `set-cookie` detection, and covered the
top-level `scripts/logs-audit.test.ts` changed-test path.

---

## 2026-05-10 — AI Drift Sensors Duplicate And Ghost Checks

Leaves 2a, 2b, and 3 of `drift:ai` landed on `feat/misc-loop`: `jscpd` is a
root dev dependency, the duplicate scanner parses JSON reports and shells out
per changed package/script scope, and the custom ghost-file detector flags
suspicious newly added sibling modules. Review follow-ups restored
merge-base-based changed-file scope while preserving uncommitted tracked edits,
broadened `test:changed` coverage for the `scripts/drift-ai/` subtree and
fixtures, made ghost-file test/fixture exclusions path-aware, stabilized
ghost-file peer ordering, treated copied paths as new-file candidates, and
kept the live duplicate/ghost checks report-only and clean.
Leaf 4 (comment-ratio warning) remains next.

---

## 2026-05-09 — Code Intel Daemon Review Fixes

Hardened `code:intel:server` lifecycle recovery after review: `status`,
`stop`, and `restart` now treat corrupt metadata as recoverable state and
validate live daemon ownership with repo/protocol metadata plus a socket probe
before signaling a PID. Cold `refs` daemon requests use a longer timeout and
do not silently duplicate the expensive scan in one-shot mode after a timeout.
The reference project now derives package export and client alias paths from
the shared workspace model, and daemon cache manifests hash source/config
contents so same-size edits invalidate resident state.

---

## 2026-05-09 — Code Intel `refs` (Slice E) landed

Symbol-level reverse search via `bun run code:intel -- refs <file>:<line>:<col>`.
Resolves the identifier at the snapped position and lists every reference as
`<file>:<line>:<col> <import|value|type>`, classifying via parent-chain walk
(import/re-export specifiers → `import`; type queries / type references →
`type`; otherwise `value`). Cross-package resolution uses a workspace-wide
ts-morph reference project keyed by `@musi/{shared,server,client}/*` and
`@/*` paths. The daemon caches it via `ProjectCache.referenceProject(...)`
and reuses the existing manifest fingerprint, so warm `refs` shares
invalidation with `def`/`exports`. Daemon and one-shot output match
byte-for-byte for renamed imports, type-only references, and snap-to-nearest.
The full `code-intel-ux-fixes` workstream is now archived in
`finished_work/`.

---

## 2026-05-09 — Code Intel Recommendation And Output Polish

Refreshed the code-intel daemon notes: the durable next step is a repo-owned
custom TypeScript Language Service daemon, while the globally installed
`typescript-language-server` remains useful only for optional `refs`
prototypes unless added as an explicit repo dependency. The CLI now supports
`--limit` for `dependents` / `tests`, shorter transitive dependent labels,
candidate markers on runtime-import test matches, and subcommand help.

---

## 2026-05-07 — Focused architecture lint sensors

Added repo-local lint gates for three high-signal AI failure modes:
`local/concurrency-guard` mirrors the existing concurrency-gated Prisma
delegate surface, `local/trpc-require-output-schema` gives line-local feedback
when router procedures omit `.output(schema)`, and
`local/no-broadcast-in-transaction` keeps socket broadcasts after committed
writes. Also tightened import restrictions so `packages/shared` stays
runtime-neutral and client code constructs Socket.io only through
`socket-context.tsx`.

---

## 2026-05-07 — ESLint repair-text diagnostics

Added repo-local `local/no-explicit-any` and `local/max-lines` rules so lint
failures include agent-facing repair guidance instead of terse upstream
messages. The project-wide file-size default is back to 300 effective lines;
known larger source/helper modules now have explicit warning-level caps in
`eslint.config.js`, each with a short rationale and a modest ceiling near its
current count.

---

## 2026-05-07 — Client feature cache/socket guide

Added `docs/guides/add-client-feature-module-cache-socket.md` on
`feat/harness-improvements-v2`. The guide covers client feature module
placement, tRPC-derived query keys, shared versus feature-local invalidation,
optimistic cache snapshot/rollback, socket-driven invalidation through
`realtime-invalidation.ts`, reconnect refetch behavior, direct socket cache
writes for complete ephemeral payloads, and the client test seams for mocked
tRPC, QueryClient wrappers, and socket listeners. `NEXT.md` now promotes the
module-doc guide leaf.

---

## 2026-05-06 — Concurrency guard checker

Added manual `bun run codemod:concurrency-guard -- --check` coverage for the
race-sensitive mutation boundary. The checker reports direct writes to gated
Prisma delegates outside `utils/*-mutations.ts`, `RawTxClient` imports outside
the ESLint allowlist, and Pattern A/B/C helper-shape drift. It is check-only,
not wired into hooks/doctor/verify, and the initial `packages/server/src` scan
was clean.

---

## 2026-05-06 — Race-sensitive mutation guide

Added `docs/guides/add-race-sensitive-mutation.md` on
`feat/harness-improvements`. The guide makes the `docs/CONCURRENCY.md`
three-bar gate the first step, then maps Pattern A/B/C to the existing
`utils/*-mutations.ts` helpers, lock order, conflict semantics, invariant
concurrency tests, `RawTxClient` lint restriction, and restricted Prisma
delegate type checks.

---

## 2026-05-06 — Prisma migration guide

Added `docs/guides/add-prisma-migration.md` on `feat/harness-improvements`.
The guide pairs Prisma schema edits with the migration safety sensor: generate
with `bun run --filter @musi/server db:migrate -- --create-only`, inspect
generated SQL, prefer safer multi-step rewrites for risky operations, apply
locally, run `prisma:generate`, run `bun run db:migration-safety`, and either
rewrite unacknowledged `WARN:` findings or add a reviewed reason to
`packages/server/prisma/migrations/.safety-acknowledged`. `docs/ai-harness.md`
now points `db:migration-safety` at the guide instead of a future placeholder.

---

## 2026-05-06 — Structured logging codemod and static-message enforcement

Closed the structured-logging repair path on `feat/harness-improvements`.
`local/structured-logging` now rejects direct server-side `console.*` and
non-static Pino message strings (templates, concatenation, runtime values),
while `bun run codemod:structured-logging-fix` provides single-file,
`--all`, `--dry-run`, and `--check` modes that rewrite obvious runtime
logger calls and seed/generator scripts onto
`packages/server/src/utils/script-logger.ts`'s JSON-line adapter. Templates,
concatenation, multi-count seed summaries, joined output, multiple primitive
args, and raw runtime errors without an `err` field stay unsupported and are
reported with file/line reasons rather than guessed. Direct console remains
allowed only in `script-logger.ts` and `main.ts`'s startup-failure path.
Policy moved to `docs/agent_notes/decisions-build.md` under "Structured
logging repair path".

---

## 2026-05-06 - tRPC shared schema codemod review

Closed the codemod review handoff on `feat/harness-improvements`. The tRPC
shared input/output schema lint sensors are error-level, both codemods have
no-write `--check` discovery, output has `--all` bulk repair, and fixture
coverage pins unsafe target rejection, path-aware import rewrites, failure
messages, local output moves, wrapper/manual failure cases, and unsafe generated
schema identifiers.
Policy moved to `docs/agent_notes/decisions-build.md`: keep lint as the drift
sensor and explicit codemod commands as the repair path.

---

## 2026-04-28 — FU5 Stale Migration Safety Acknowledgements

Closed FU5. `scripts/migration-safety-scan.sh` now resolves each
`.safety-acknowledged` entry against `<allowlist-dir>/<name>/migration.sql`
and emits a per-entry `WARN: <allowlist>:<lineno> — stale acknowledgement
"<name>" — no migration at <dir>/<name>/migration.sql` plus a final `WARN:
migration safety — N stale allowlist entr*y/ies* in <allowlist>` line so a
typo or removed migration cannot silently linger. The check is independent
of the scanned migration set — scanning a single migration cannot make
sibling entries appear stale — and runs even when the scanned migrations are
clean. The allowlist parser also tracks each entry's line number so the
WARN points at the exact typo. Doctor picks the WARN lines up via its
existing tee/grep counter; no doctor changes were needed. Coverage in
`scripts/test-migration-safety-scan.sh` covers single and multi-stale
entries (with allowlist line numbers), mixed stale + unacknowledged-finding
output, valid-allowlist regression, scan-set independence, and a guard that
the shipped repo allowlist has no stale entries. The `feature/devx2`
merge-review queue is now fully exhausted (MR1-MR5, FU1-FU5 all closed) and
the in-progress note can be archived on the next re-triage pass.

---

## 2026-04-28 — FU4 Encounter-Not-Found Authz Log

Closed FU4. `assertEncounterDm` in
`packages/server/src/utils/encounter-helpers.ts` now emits a single
`authz.encounter.dm` deny log with `reason: "encounter_not_found"` (carrying
`actor.userId` and `encounterId`) when the encounter lookup returns null,
before throwing the existing `NOT_FOUND` TRPC error. Found encounters still
delegate the role decision to `assertCampaignDm`, so the campaign-dm
boundary log shape is unchanged. Coverage lives next to the existing
not-found assertion in `utils/encounter-helpers-auth-lifecycle.test.ts`: a
fake logger asserts the new event payload and confirms `authz.campaign.dm`
does not double-emit on the not-found path. `NEXT.md` is now empty; FU5
remains parked pending reviewer promotion.

---

## 2026-04-28 — FU3 Map Toolbar Prop Grouping

Closed FU3. `MapToolbar` props are grouped into stable sections: `view`
(`MapToolbarViewControls`), `fog` (`MapToolbarFogControls`), `drawing`
(`MapToolbarDrawingControls`), and `template` (`MapToolbarTemplateControls`),
alongside the shared `activeTool` / `isDm` / `gridType` / `onToolChange`
props. Internal section components (`PrimaryToolSection`, `DmToolSection`,
`ViewControlSection`) still own their own self-contained prop interfaces; the
toolbar spreads each group into the matching section. Both call sites
(`map-detail-header.tsx`, `combat-map-header.tsx`) construct the grouped
objects from the existing canvas/draw/fog/template stores; no store shapes
changed. The toolbar test renderer now returns a flat `handlers` bag keyed by
event name so existing behavior assertions
(`expect(handlers.onZoomIn).toHaveBeenCalled()`) stay independent of the prop
shape, and the previous inline render at the active-tool case reuses
`renderToolbar({ activeTool: "measure" })`.

---

## 2026-04-28 — FU2 Named Drawing Actions Type

Closed FU2. `packages/client/src/hooks/use-drawing-actions.ts` now exports the
named `DrawingActions` type already used as the hook return annotation.
`map-detail-header.tsx` and `combat-map-header.tsx` import that type directly
instead of using `ReturnType<typeof useDrawingActions>`. `NEXT.md` now
promotes FU3 map toolbar prop grouping; FU4-FU5 remain parked.

---

## 2026-04-28 — FU1 Socket Broadcast Logging Contract

Closed FU1. Registry-owned broadcasts now own the `socket.broadcast` log:
`broadcast()` and `broadcastToUsers()` in
`packages/server/src/socket/broadcast-registry.ts` accept an optional
`logger: RequestLogger` and emit exactly one log per call (`success` with the
registered `socketEvent` plus `logFields(payload)` scope, or `skipped` with
`reason: "no_socket_server"`). Each `BroadcastEntry` requires a
`logFields(payload) => BroadcastLogScope` extractor — a new event cannot omit
the logging contract because TypeScript fails at the registry constant.
`chat:newMessage` deliberately drops content/authorId from the scope to keep
chat bodies out of logs, and a regression test pins this. Per-family helpers
(`broadcastEncounterUpdate`, `broadcastCharacterUpdate`,
`broadcastCampaignUpdate`, `broadcastMapTokenUpdate`,
`broadcastMapLayerUpdate`, `broadcastChatMessage`) thread the optional logger
through; routers and services pass `ctx.logger`. `broadcastChatMessage`
collapsed `dmUserId` and `logger` into a `BroadcastChatMessageOptions`
options object to stay under the project's max-params=4 lint rule.
`emitCharacterUpdate` keeps its targeted `no_campaign` skip log because the
campaign membership check happens before the registry call. Boundary
contract coverage lives in `socket/broadcast-registry.test.ts` (~6 new cases
covering required `logFields`, success/skipped outcomes for all registered
events, the chat scope's content-leak protection, and `broadcastToUsers`
boundary logging). The per-helper outcome assertions in
`socket/encounter-broadcast.test.ts` still pass via the registry path.

## 2026-04-28 — DX8.2d Mutation Boundary Logs

Closed DX8.2d, the last DX5-DX8 leaf. `request-logger.ts` now exposes
`logMutation` (info on success, warn on failure) and `logBroadcast` (info
on success/skipped) with typed `MutationLogPayload` /
`BroadcastLogPayload`. Hot mutation boundaries each emit exactly one
business-event log per committed call: `auth.login`, `auth.refresh` in
`routers/auth.ts`; `character.create`, `character.updateStats`,
`character.adjustHp` in `routers/character.ts`; `encounter.create`,
`encounter.state.transition` in `routers/encounter.ts`. Failures use a
low-cardinality reason (`invalid_credentials`, `invalid_refresh`,
`invalid_transition`); successes carry `actor` plus relevant scope ids.
Broadcast outcomes are logged at the emit boundary. FU1 later centralized
registry-owned broadcast logs in `socket/broadcast-registry.ts`; this DX8.2d
entry is retained only for the original mutation-boundary landing details.
New tests landed in `utils/request-logger.test.ts` (3),
`routers/mutation-logging.test.ts` (7),
`socket/encounter-broadcast.test.ts` (+2), and
`utils/character-campaign.test.ts` (+2).

## 2026-04-28 — DX8.1b Prisma Migration Safety Integration

Closed DX8.1b. `bash scripts/doctor.sh` now runs
`scripts/migration-safety-scan.sh` as a `migration safety` section between
the eslint-disable register and the summary, so doctor surfaces new
destructive operations as `WARN:` lines and a clean scan as a single
`PASS:` line. Acknowledgement allowlist at
`packages/server/prisma/migrations/.safety-acknowledged` (one
`<migration_dir_name>  <reason>` per line, optional reason after first
whitespace; tests can override the path with `MUSI_MIGRATION_ALLOWLIST=...`)
flips findings for listed migrations to `INFO: ... (acknowledged: <reason>)`
and counts them separately in the summary. The two intentional-risk
precedents (`20260408223838_convert_string_fields_to_enums`,
`20260409120000_add_monster_spells_table`) ship in the allowlist. Scanner
remains warn-only; promotion to a hard gate is deferred until local
visibility proves insufficient. Escape-hatch design in
`docs/agent_notes/decisions-build.md`. Test count rose to 24 (added six
allowlist/doctor-signal cases). DECISIONS.md crossed ~400 lines on the new
entry and was split by domain into
`decisions-{concurrency,auth,realtime,schemas,services,build}.md` with
DECISIONS.md kept as an index. `NEXT.md` now queues DX8.2a.

## 2026-04-28 — DX8.1a Prisma Migration Safety Scanner

Closed DX8.1a. Added `scripts/migration-safety-scan.sh` (wired as
`bun run db:migration-safety`) that walks
`packages/server/prisma/migrations/` (or any path passed as an argument) and
emits warn-only `WARN: <file>:<line> — <rule>` findings for four detection
rules: `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... TYPE`, and
`ADD COLUMN ... NOT NULL` without a same-line `DEFAULT`. Each finding
includes one-line risk guidance and the offending statement; the scanner is
warn-only (always exits 0) so DX8.1b can decide blocking semantics.
`scripts/test-migration-safety-scan.sh` runs 18 checks covering each
detection rule, the safe add-nullable + backfill + SET NOT NULL counter
pattern, sandbox-wide aggregation, and the two intentional-risk precedents
already in the migration history
(`20260408223838_convert_string_fields_to_enums` surfaces all six
`ALTER COLUMN ... TYPE` clauses; `20260409120000_add_monster_spells_table`
surfaces the `DROP COLUMN "spellcasting"` line). `NEXT.md` now queues
DX8.1b.

## 2026-04-28 — DX7.1g Spell Casting Service Test Split

Closed DX7.1g. `spell-casting.test.ts` dropped from ~975 lines to ~648
(castCombatSpell only, with the inline `makeMonsterEncounter`,
`setupWizardCharacter`, and `makeCharacterCasterEncounter` helpers it owns).
The other two service entry points moved to
`spell-casting-non-combat.test.ts` (~297, covers `castNonCombatSpell`
including ritual, cantrip, slot, and concentration branches) and
`spell-casting-drop-concentration.test.ts` (~53, covers `dropConcentration`).
Concentration semantics stay covered explicitly across the split: leveled
concentration, ritual concentration, and prior-spell replacement live in the
non-combat file; combat-side concentration set lives in the combat file; and
clear/no-op-when-not-concentrating lives in the drop-concentration file. No
new shared builders: each split file imports the existing
`setupSpellTestContext` / `setupEncounterTestContext` helpers and the only
combat-encounter setup helpers (`makeMonsterEncounter`,
`setupWizardCharacter`, `makeCharacterCasterEncounter`) stay inline in
`spell-casting.test.ts` because no other test file needs them.

## 2026-04-28 — DX7.0c Fixture Builder Inventory

Closed DX7.0c. Parked the inventory at
`docs/agent_notes/finished_work/fixture-builder-inventory.md`. Named the two
outlier client fixture files —
`packages/client/src/test/fixtures-encounter.ts` (460 lines, six pre-baked
`EncounterDetail` constants) and
`packages/client/src/test/fixtures-srd.ts` (347 lines, five frozen `as const`
arrays) — and listed the narrow builder targets each DX7.1 leaf should
extract (e.g. `setupActiveBattle` / `setupActiveWithLog` for DX7.1a, the
inline `createEncounterWithMonsters` / `rollInitiative` /
`activateEncounter` cluster for DX7.1d, `BASE_INPUT` /
`createFighterCharacter` / `levelTo` for DX7.1i). Server-side
setup-context helpers (`encounter-test-helper`, `spell-test-helper`,
`map-test-helper`, `inventory-test-helper`) already follow the
narrow-builder shape; DX7.1 splits should lift in-file helpers next to them
rather than fork new contexts. `TEST_CHARACTER_DETAIL` (~26 callers) is
explicitly out of scope for DX7.1 — override via spread, do not fork. No
code moved in this leaf. `NEXT.md` now queues DX7.1a.

## 2026-04-28 — DX6.3d Combat Map Surface Slices

Split `components/campaign/combat/combat-map-panel.tsx` to mirror the DX6.3c
shape. The panel now keeps only the `mapId` guard, the `map.get` query, and
the loading/error boundary; loaded-map orchestration moved to
`combat-map-content.tsx`, with focused seams in `combat-map-header.tsx`,
`combat-map-mutations.ts` (token + link/unlink mutations),
`combat-map-store-hooks.ts` (combat-map canvas controls), and
`combat-map-bridges.ts` (movement tracking, selection sync, unlinked
participants, active-participant lookup, context HP). Drawing/template store
slices reuse `map-detail-store-hooks.ts` and container sizing reuses
`use-map-container-size.ts` from the maps surface. Existing tests
(`combat-map-panel.test.tsx`) remain green; `NEXT.md` queues DX7.0a Vitest
timing capture.

## 2026-04-28 — DX6.3a Map Canvas Mechanics

Split `components/campaign/maps/map-canvas.tsx` into a small composition shell
plus `map-canvas-grid.tsx` (square/hex grid lines and the `GridBody` switch),
`map-canvas-overlays.tsx` (`CanvasOverlays` and the fog/draw/template/measure
body components), and `use-map-canvas-handlers.ts` (`useCanvasHandlers` wheel/
drag/click handlers and `useMapCanvasStoreSlice`). Pointer-write logic stays
behind `hooks/canvas-input/`; the shell still owns Stage layering, drawing
eraser dispatch, and the fog/drawing layer parsing seam. Existing
`map-detail-view.test.tsx` Konva-layer-budget assertions remain green.
`components/campaign/maps/MODULE.md` now records the new presentational seams;
`NEXT.md` queues DX6.3b map toolbar mechanics.

## 2026-04-28 — DX6.2b Stats Tab Slices

Split `components/vtt/drawer/tabs/stats-tab.tsx` into a small composition
shell plus `stats-tab-summary.tsx` (headline strip and HP bar),
`stats-tab-concentration.tsx` (spell lookup chip), and `stats-tab-rolls.tsx`
(rollable abilities, saves, and proficient skills). Kept the existing
`StatsTab` entry point, test IDs, and read-only roll behavior stable.
`components/vtt/drawer/MODULE.md` now records the stats-tab section
ownership; `NEXT.md` now queues DX6.2c actions tab slices.

## 2026-04-27 — DX5.3f Socket Broadcast Registry Cleanup

Closed Phase DX5.3. Re-grepped server `.emit(` sites: every per-family
adapter (`broadcastCampaignUpdate`, `broadcastCharacterUpdate`,
`broadcastEncounterUpdate`, `broadcastMapTokenUpdate`,
`broadcastMapLayerUpdate`, `broadcastChatMessage`) still has callers and is
preserved as a DX5.3c "stable adapter" over `broadcast(...)` /
`broadcastToUsers(...)`. Remaining direct emits — presence (`presence:*`,
`campaign:player*`), notification (`notification:new`), connection envelope
(`pong`, `error`) — stay in their owning modules and are recorded as
intentionally outside the registry boundary. Parked the DX5.3a inventory at
`docs/agent_notes/finished_work/socket-emit-inventory.md` and updated the
in-tree reference in `socket/broadcast-registry.ts`. `NEXT.md` now queues
DX6.0 client path and module prep.

## 2026-04-27 — DX5.3e Socket Broadcast Registry Combat Fan-Out

Migrated `services/encounter-combat/broadcast-helpers.ts` onto
`broadcast-registry.ts`: the encounter invalidation now calls `broadcast(io,
"encounter:updated", ...)` directly so the registry boundary is visible at the
fan-out site, while character invalidation and combat-chat fan-out still flow
through the stable `emitCharacterUpdate` and `broadcastCombatChat` adapters.
`utils/combat-chat.ts` is split into a service-layer `persistCombatChat` (DB
write, returns mapped payload) and a `broadcastCombatChat` wrapper that pairs
the persist with a registry emit, so the persistence half is separately
auditable from the socket emit. Focused coverage in
`broadcast-helpers.test.ts` exercises the three concerns plus the
fire-and-forget warn path and the no-socket no-op. `NEXT.md` now queues
DX5.3f cleanup.

## 2026-04-27 — DX5.3d Socket Broadcast Registry Chat Routing

Migrated `chat-broadcast.ts` onto `broadcast-registry.ts` while preserving
the room-wide path and whisper recipient filtering for sender, recipient, and
DM. The registry now owns `chat:newMessage` payload validation, room
resolution, room-wide emit, and filtered per-user room fan-out. Registry tests
cover shared schema reference, room-wide chat emit, explicit room preservation,
and whisper recipient filtering. `NEXT.md` now queues DX5.3e combat fan-out.

## 2026-04-27 — DX5.3c Socket Broadcast Registry Simple Events

Migrated `character-broadcast.ts`, `encounter-broadcast.ts`, and
`map-broadcast.ts` onto `broadcast-registry.ts` while keeping the per-family
helper imports stable. Registry tests now pin shared schema references, room
resolution, and emit behavior for character, encounter, and map invalidation
events. `NEXT.md` now queues DX5.3d chat routing.

## 2026-04-27 — DX5.3b Socket Broadcast Registry Foundation

Landed `packages/server/src/socket/broadcast-registry.ts`: a typed registry
binding event names to shared `@musi/shared` payload schemas, room policies,
and literal-typed emit closures. `campaign-broadcast.ts` now routes through
`broadcast(io, "campaign:updated", payload)`. Tests pin the schema reference
to the shared module and cover validation, room resolution, null-io no-op,
and bad-payload rejection. Migration recipe lives in the registry module
header for DX5.3c-DX5.3f.

## 2026-04-27 — DX5-DX8 Sprint Promoted

Promoted the second developer-experience sprint into
`docs/roadmap/developer-experience.md`, removed the stale first-sprint roadmap
content, and queued DX5.1 in `NEXT.md`.

## 2026-04-27 — DX1-DX4 Sprint Closed

The first developer-experience sprint landed through DX4.4. The active queue
now starts from the DX5-DX8 roadmap.

# Codebase Maintainability & Onboarding Audit — 2026-06-13

> **Status: direction-setting, not implementation. No code in this pack has been
> implemented.** Every leaf below is a read-only finding with `file:line` evidence.
> As of 2026-06-13, 10 leaves (#1, #11, #13, #14, #23, #24, #25, #32, #35, #40)
> carry a locked **Decision** block recording the settled approach for the next
> implementing agent; the remaining leaves stay open proposals. See *Decisions
> locked (2026-06-13)* below.

- **Status:** 10 leaves Decided (direction locked 2026-06-13); remainder Proposed (awaiting promotion)
- **Created:** 2026-06-13
- **Source:** Multi-agent maintainability/onboarding survey of Musi at HEAD on `docs/codebase-audit`
- **Scope:** Maintainability, code quality, and first-time-onboarding ease across `packages/{shared,server,client}`, `docs/`, and the human-facing setup path. Read-only. Excludes the in-repo agent-harness tooling lanes already owned elsewhere (see *Out of scope*).

## Executive summary

This pack audits the Musi codebase — a D&D 5.5E virtual tabletop and campaign
manager (~290k LOC of product code across `shared`/`server`/`client`, plus heavy
in-repo tooling) — through three overlapping lenses: **maintainability**, **code
quality**, and, as the requester emphasized, **how easy the codebase is for a new
developer being onboarded for the first time**. Findings are weighted toward
reducing time-to-understanding, improving discoverability ("where does X live /
which builder do I use"), reducing surprise, and lowering the cost of safe change.

It was a **read-only, multi-agent audit**. No files were modified. Every finding
cites concrete `file:line` references that an investigating agent actually opened
and verified, and each was re-checked by an independent adversarial pass before
landing here.

The headline result is that Musi's *deep* documentation is strong — 28+
`MODULE.md` orientation docs, a `services/` taxonomy README, dedicated guides
under `docs/guides/` — but the **canonical first-run happy path and the
high-traffic landing surfaces are where a newcomer actually stalls**. A fresh
clone cannot reach a running, logged-in app by following the README; the densest,
most-imported directories (Zustand `stores/`, the shared contract package, the
`routers/` and `pages/` roots) have no doc to land on; several authoritative docs
point at deleted or renamed code; and the repo's own documented layering and
error-handling rubrics are contradicted by the code in enough places that a
newcomer has no reliable signpost for "which model do I follow when I add a
mutation."

The 43 leaves are independently promotable. The highest-value cluster is
**time-to-first-running-app** (`#1`–`#5`, plus `#43`): `#1` and `#2` are hard
blockers that stop a fresh clone before the app is usable — a `db:seed` `ENOENT`
crash and a boot-crashing sub-minimum `JWT_SECRET`. The rest (`#3`–`#5`, `#43`)
are first-run drift/friction — a phantom env var, undocumented seeded logins, the
undocumented per-worktree flow, and an understated Bun minimum — that confuse or
slow a newcomer rather than hard-block them.

## How to use this pack

- **One leaf = one small, independently-promotable commit.** Each numbered file
  is self-contained with its own evidence and proposed fix; none depend on the
  report itself, and only `#31` depends on another leaf (`#7`).
- **Re-verify `file:line` before implementing.** This audit is a *snapshot* at
  one HEAD; line numbers and even file locations drift quickly. Re-open the cited
  evidence and confirm it still holds before changing anything.
- **Follow TDD and the relevant guide.** For tRPC, Prisma, socket, race-sensitive,
  client cache/socket, e2e, rules, or ratcheted-lint changes, read the matching
  `docs/guides/*` first, and read the nearest `MODULE.md` before editing a feature,
  service, hook, or socket area that has one.
- **Promote per the backlog README rules.** Promote only work that is ready now,
  move the leaf back into `in_progress/`, and add a `LOG.md` line if context is
  needed. Do not promote the whole pack at once; pull one leaf at a time.

## Decisions locked (2026-06-13)

These 10 leaves had open questions that have now been **settled**; each carries a
`## Decision (locked 2026-06-13)` block at the top of its file with the full
rationale. The next agent should implement to the decision, not re-open it. One-line
summary of each:

- **#1 — SRD seed source:** vendor the data into the repo (option b), **not** a
  submodule/fetch script. Size is a non-issue (~290 KB vs ~1.5 MB already
  committed). **Mandatory licensing diligence first:** pin the upstream revision,
  verify `src/2024` is SRD 5.2.1 (CC-BY-4.0) and not OGL 5.1, write a provenance
  manifest. (Upstream README claims OGL 1.0a / MIT, contradicting Musi's
  CC-BY-4.0 doc — Musi's is correct for the 2024 slice it uses.)
- **#13 — damageType:** tighten field-by-field to lowercase `damageTypeNameSchema`,
  normalizing the title-case seed values at the seam; **also tighten
  `subspeciesSchema.damageType`** (missed by the leaf); do **not** touch the
  display catalog (`srd-reference.ts`); collapse the two private `damageTypeField`
  copies into one exported validator.
- **#14 — SRD conditions:** add `srdConditionSchema` and **hard-tighten** to it
  (lowercase canonical); fix fixtures + dev rows rather than adding a permanent
  normalizing shim (safe — dev-seeded, no prod data).
- **#23 — kind vs type:** rename client `kind` → `type` (align to shared; don't
  merge value sets).
- **#24 — get vs getById:** standardize on bare `get`; document + exempt
  multi-noun routers; alias→migrate→remove the two `getById` outliers.
- **#25 — gmNotes:** comment now, **defer** the rename — don't spend a standalone
  Prisma enum migration; batch it into a future map-layer migration.
- **#32 — PRECONDITION_FAILED:** remove it; reconcile the `ux_ui_audit` ask to
  branch on real codes (`FORBIDDEN`/`CONFLICT`/`BAD_REQUEST`).
- **#35 — name caps:** fix the encounter entity-vs-input split (one constant);
  comment the other per-domain caps rather than force-merging.
- **#40 — VttMap:** rename to `MapEntity` (not bare `Map`).
- **#11 — shared orientation:** add `schemas/MODULE.md` only; **defer** the barrel.

## Methodology

1. **Multi-agent survey across 11 maintainability dimensions.** Read-only
   investigation agents fanned out over distinct lenses — onboarding/setup,
   client architecture, server layering, shared contracts, docs coverage,
   error/observability, naming consistency, complexity hotspots, type-safety
   boundaries, testing ergonomics, and tooling/newcomer clarity — each gathering
   `file:line` evidence with grep / read / `code:intel`.
2. **Completeness-critic gap pass.** A dedicated critic pass re-walked the tree
   for high-fan-out surfaces and "where does X live" gaps the per-dimension agents
   might have missed (the `stores/`, shared-contract, `routers/`, `pages/`, and
   `test/` orientation findings came largely from this pass).
3. **Independent adversarial verification of every finding.** Each candidate was
   re-opened by a separate verifier that tried to disprove it — confirming the
   cited lines, checking that the claimed absence (e.g. "no exported enum", "zero
   references", "no MODULE.md") actually held, and downgrading or dropping
   anything that did not survive.
4. **Dedup / triage.** Survivors were deduplicated, sized (XS–L), severity-rated,
   and ordered.

**Explicitly excluded.** Per the audit brief, **near-duplicate code and
dead/unused code findings were excluded entirely** — that class is owned and
actively being implemented under
`docs/agent_notes/backlog/drift-ai-findings/`, so no duplication or dead-code
item appears here. **Already-tracked backlog items were also excluded**: the
agent-harness ergonomics pack, the useEffect-guardrail program, the Storybook
component catalog, the lint-debt drain and ratchet governance, the planned
dependency upgrades, and the production-readiness / UX audits (see *Out of scope*
for owning locations). Findings were cross-checked against those titles before
being filed.

## Themes

1. **First-run onboarding is broken or undocumented at the canonical happy path.**
   The README/devcontainer Quickstart contains two hard blockers plus several
   drifts. The hard blockers stop a fresh clone before the app is usable: `db:seed`
   crashes with `ENOENT` because the SRD JSON source is gitignored and never
   provisioned (#1), and the devcontainer ships a sub-minimum `JWT_SECRET` that
   crashes the server on boot (#2). The rest are first-run drift/friction that
   confuse or slow a newcomer rather than hard-block them: the Quickstart sets a
   phantom `JWT_REFRESH_SECRET` (#3), never documents the seeded login accounts
   (#4), never explains the per-worktree dev flow that auto-provisions DBs/ports
   (#5), and understates the Bun minimum (README `>= 1.2.0` vs the `>= 1.3.0`
   `engines` floor) (#43). Together these are the highest-value cluster for
   time-to-first-running-app. *(Leaves #1–#5, #43.)*

2. **Missing orientation docs for high-traffic, high-fan-out directories.**
   Several of the densest and most-imported surfaces have no `MODULE.md`/README to
   land on, even though 28+ `MODULE.md` docs exist deeper in the tree and a charter
   requires docs for store-owning/contract surfaces. The Zustand `stores/`, the
   shared "contract" package (41 schema files, 683 deep imports), the `routers/`
   dir (largest server files), the `pages/` composition roots, and the `test/`
   helper dirs all force a newcomer to reverse-engineer "where does X live / which
   builder do I use." *(Leaves #10, #11, #18, #20, #22.)*

3. **Authoritative docs have drifted from the code they govern.** The repo's named
   entry-point and rulebook docs point at deleted files or renamed/relocated
   symbols, so a newcomer who follows them lands on nothing: architecture-plan and
   the roadmap route to deleted `STATUS.md`/`NEXT.md`; `CONCURRENCY.md` cites a
   nonexistent `NON_RACING_FIELDS` allowlist and `turn-service.ts`; and `AGENTS.md`'s
   type-assertion guidance omits the lint-enforced marker syntax and the
   heavily-used interop category. These erode trust in docs precisely where
   newcomers rely on them most. *(Leaves #15, #16, #17.)*

4. **Documented server-layering rubric is contradicted by the actual code.**
   `AGENTS.md` and `services/README.md` prescribe a clear rubric —
   transaction-owning, multi-write, broadcast-deciding orchestration belongs in
   `services/`; `utils/` is pure helpers; deeper layers have a contract. In
   practice 8 routers own `$transaction`s inline, `activateEncounter` orchestrates
   in `utils/`, request-facing services use three different calling conventions
   with per-procedure auth/broadcast ownership, and the upload REST surface follows
   a wholly separate error convention. A newcomer has no reliable signpost for
   which model to follow when adding a mutation. *(Leaves #8, #9, #29, #33.)*

5. **Shared contract validates the same domain concept inconsistently.**
   `packages/shared` is "the contract" yet the same concept is validated multiple
   ways with no authoritative source: `damageType` is a closed enum in some schemas
   and a free string (plus two private copies) in others; SRD conditions have a
   canonical tuple but no exported enum so condition-name fields are free strings
   (with observable casing drift); persisted ASI `choiceData` is strictly looser
   than its validated input; and a 100-char name cap is re-declared under five
   different constant names. This makes it hard for a newcomer to tell which
   validation is authoritative and risks silent data drift. *(Leaves #13, #14,
   #35, #36.)*

6. **A good error-handling pattern exists but is under-adopted and partly
   contradictory.** The client's `onTRPCError`/`TOAST_MESSAGES` catalog is
   well-designed and documented as the intended pattern, but only 5 hooks use it:
   18 files hardcode generic "Failed to X" toasts that can't surface
   `FORBIDDEN`/`UNAUTHORIZED` copy, one hook leaks the raw server `error.message`,
   the factory exposes an unreachable `PRECONDITION_FAILED` path the server never
   emits, and the upload REST route uses a different convention entirely.
   Consolidating onto the catalog improves both user-facing copy and newcomer
   clarity about the one right way to handle errors. *(Leaves #7, #29, #31, #32.)*

7. **Naming and discriminator drift across the shared/server/client boundary.**
   The same concept is named differently as it crosses package boundaries, forcing
   translation steps and undermining "grep to understand": combatant kind is
   `.type` server-side vs `.kind` client-side, `CharacterStats` is
   "character-live-state" on the server only, the DM role is `gmNotes` in one map
   layer literal, "fetch one by id" has three router naming styles, the VTT label
   is undefined and unanchored, and the base map type is `VttMap` against an
   otherwise `Map*` family. Each is small, but together they raise the cost of
   forming a mental model. *(Leaves #23, #24, #25, #27, #28, #40.)*

8. **Complex client composition and subtle code without local explanation.**
   Hot spots carry load-bearing complexity that only reveals itself by reading
   several files at once: the character-sheet prop architecture hand-duplicates a
   ~25-field bag across 4 interfaces and drills parallel self/DM handlers to leaves;
   the homebrew `EDITOR_REGISTRY` erases all form typing to `unknown` at its primary
   extension point; `map-canvas-store`'s fire-after-set idiom and confirm-cast
   `unwind()` rely on undocumented side-effect ordering; and AoE template math has
   no coordinate model or WHY-comments. These raise the cost of safe change for the
   exact extension points newcomers touch first. *(Leaves #12, #19, #26, #37, #38,
   #39, #41.)*

9. **Tooling and conventions are discoverable only by insiders.** The repo has
   excellent tooling (doctor diagnostic, 94 scripts, focused-test runners,
   type-assertion-boundary lint, `*.po.ts` e2e convention, colocated rules tests)
   but the human-facing entry points don't surface or tier it: the README documents
   8 of 94 scripts and never mentions doctor or single-test commands, type-safety
   conventions are hand-rolled at 15 `DbClient` downgrade sites with no factory, and
   small convention violations (saving-throw tests in `combat.test.ts`,
   `vtt-drawer.ts` missing `.po.ts`, `srd.ts` split imports) go uncaught. Newcomers
   can't find the right command or follow the implicit conventions. *(Leaves #6,
   #21, #30, #34, #42.)*

## Prioritized tasks

Status is **Proposed** for every leaf. Re-verify `file:line` evidence before
implementing — this table is a snapshot. Sizes are XS–L; severity is the audit
agent's onboarding/maintainability impact rating, not a production-incident
severity.

| # | Task | Track | Size | Severity | Depends on | Status |
|---|------|-------|------|----------|-----------|--------|
| 1 | [README Quickstart db:seed crashes with ENOENT — SRD JSON source in gitignored docs/refs/ is never provisioned or documented](./01-readme-db-seed-missing-srd-source.md) | onboarding-setup | M | high | none | Decided |
| 2 | [Devcontainer .env.example ships a 31-char JWT_SECRET below the enforced 32-char minimum, crashing the server on first boot if copied unedited](./02-devcontainer-jwt-secret-too-short.md) | onboarding-setup | XS | medium | none | Proposed |
| 3 | [README Quickstart sets a phantom JWT_REFRESH_SECRET no code reads and .env.example omits](./03-readme-phantom-jwt-refresh-secret.md) | onboarding-setup | XS | low | none | Proposed |
| 4 | [Seeded dev login accounts (dm@example.com / player1 / player2, password password123) are absent from onboarding docs](./04-seeded-login-accounts-undocumented.md) | onboarding-setup | XS | low | none | Proposed |
| 5 | [Per-worktree dev flow (worktree:* scripts, MUSI_DEV_DRIFT_GATE) auto-runs on `bun run dev` in secondary worktrees but has no human-facing doc](./05-worktree-dev-flow-undocumented-for-humans.md) | onboarding-setup | S | medium | none | Proposed |
| 6 | [Client auth/session token lifecycle is undocumented: in-memory token store, two divergent refresh paths, three consumers](./06-client-auth-token-lifecycle-undocumented.md) | client-architecture | S | medium | none | Proposed |
| 7 | [Existing code-aware error helper (onTRPCError / TOAST_MESSAGES) adopted by only 5 hooks; 18 mutation files hardcode generic 'Failed to X' toasts](./07-trpc-error-helper-low-adoption.md) | error-observability | M | medium | none | Proposed |
| 8 | [Transaction-owning mutation orchestration lives inline in 8 routers, contradicting the services/ rubric the repo documents](./08-router-inline-transaction-orchestration.md) | server-layering | L | medium | none | Proposed |
| 9 | [No single contract for request-facing services: calling convention and auth/broadcast ownership vary per procedure, even within one router](./09-service-calling-convention-inconsistent.md) | server-layering | M | medium | none | Proposed |
| 10 | [Zustand stores/ directory has no MODULE.md despite owning the densest, highest-fan-out client VTT state](./10-stores-dir-no-module-doc.md) | docs-coverage | S | medium | none | Proposed |
| 11 | [packages/shared (the contract package) has no schema orientation doc or barrel: 41 schema files reached via 683 deep imports with no map](./11-shared-package-no-schema-orientation.md) | shared-contracts | S | medium | none | Decided |
| 12 | [Character-sheet prop architecture: ~25-field prop bag hand-duplicated across 4 interfaces, parallel self/DM handlers drilled to leaves, opaque sheet god-object slots](./12-character-sheet-prop-architecture.md) | client-architecture | M | medium | none | Proposed |
| 13 | [damageType validated inconsistently across the shared contract: canonical enum in some schemas, free string in others](./13-damage-type-validation-inconsistent.md) | shared-contracts | S | medium | none | Decided |
| 14 | [SRD_CONDITIONS has no exported derived Zod enum; condition-name fields are bare free strings, unlike sibling damage-types](./14-srd-conditions-no-derived-enum.md) | shared-contracts | S | medium | none | Decided |
| 15 | [AGENTS.md type-assertion guidance omits the lint-enforced marker syntax and the heavily-used interop category](./15-type-assertion-guidance-incomplete.md) | type-safety-boundaries | S | medium | none | Proposed |
| 16 | [Entry-point docs route newcomers to docs/agent_notes/STATUS.md and NEXT.md, which were deleted](./16-orientation-docs-point-to-deleted-status.md) | docs-coverage | XS | medium | none | Proposed |
| 17 | [CONCURRENCY.md cites NON_RACING_FIELDS allowlist and turn-service.ts, both of which no longer exist](./17-concurrency-md-stale-anchors.md) | docs-coverage | S | medium | none | Proposed |
| 18 | [packages/server/src/routers/ has no orientation doc despite 29 router files including the largest non-generated server files](./18-routers-dir-no-orientation-doc.md) | docs-coverage | S | low | none | Proposed |
| 19 | [rules/attack-damage.ts mixes the static SRD weapon data table with rules math; two test files don't match the source that owns their symbols](./19-attack-damage-mixed-data-and-math.md) | complexity-hotspots | M | low | none | Proposed |
| 20 | [pages/ has no orientation doc for the page-as-composition-root pattern, despite 28 MODULE.md docs deeper in the tree](./20-pages-dir-no-composition-root-doc.md) | client-architecture | S | low | none | Proposed |
| 21 | [No human command-tiering: README documents 8 of 94 root scripts, doctor diagnostic and single-test commands are invisible](./21-no-human-command-tiering.md) | tooling-newcomer-clarity | S | low | none | Proposed |
| 22 | [No index/README for server and client test/ helper directories, leaving overlapping encounter fixture builders undiscoverable](./22-test-helper-dirs-no-orientation.md) | testing-ergonomics | S | low | none | Proposed |
| 23 | [Combatant/token 'kind' of thing is discriminated by `type` in shared schemas but `kind` in the client drawer/token UI unions](./23-type-vs-kind-discriminator-split.md) | naming-consistency | S | low | none | Decided |
| 24 | [Single-entity routers disagree on 'fetch one by id' naming (getById vs bare get), hurting cross-router predictability](./24-router-getbyid-naming-inconsistent.md) | naming-consistency | S | low | none | Decided |
| 25 | [Map 'gmNotes' layer type uses GM terminology while the rest of the app models the role as dm/isDm/DM](./25-gmnotes-layer-vs-dm-role-naming.md) | naming-consistency | S | low | none | Decided |
| 26 | [Homebrew EDITOR_REGISTRY boundary erases all per-entry-type form typing to unknown, so handler/formState mismatch only fails at runtime Zod parse](./26-homebrew-editor-registry-erases-form-typing.md) | type-safety-boundaries | M | low | none | Proposed |
| 27 | [Server names the CharacterStats concept 'character-live-state' while shared/Prisma/client all call it 'stats', with no breadcrumb](./27-character-live-state-vs-stats-naming.md) | naming-consistency | S | low | none | Proposed |
| 28 | [No top-level components/vtt/ MODULE.md or glossary line ties the client-only 'VTT' label to the server's Encounter/Map model](./28-vtt-label-no-glossary-or-top-module.md) | naming-consistency | XS | low | none | Proposed |
| 29 | [Upload REST route uses a separate error convention (HTTP status + {error} body) from the repo-wide tRPC pattern, with no orientation note](./29-upload-route-error-convention-unsignposted.md) | error-observability | S | low | none | Proposed |
| 30 | ['single trust boundary' DbClient downgrade comment is contradicted by identical casts in 3+ production/test files with no sanctioned factory](./30-dbclient-downgrade-not-single-boundary.md) | type-safety-boundaries | S | low | none | Proposed |
| 31 | [togglePrepared mutation toasts the raw server error.message, bypassing the onTRPCError copy catalog every sibling hook uses](./31-toggle-prepared-leaks-raw-error-message.md) | error-observability | XS | low | [#7](./07-trpc-error-helper-low-adoption.md) | Proposed |
| 32 | [Client error contract exposes an unreachable PRECONDITION_FAILED recovery path the server never emits](./32-unreachable-precondition-failed-path.md) | error-observability | S | low | none | Decided |
| 33 | [activateEncounter lives in utils/ but owns a $transaction, sequences multi-participant writes, and enforces domain invariants](./33-activate-encounter-misplaced-in-utils.md) | server-layering | S | low | none | Proposed |
| 34 | [resolveSavingThrow tests live in combat.test.ts, breaking the colocated rules-test convention (no saving-throw.test.ts)](./34-saving-throw-tests-misplaced.md) | testing-ergonomics | XS | low | none | Proposed |
| 35 | [Five undocumented 100-char name-cap constants make it unclear whether per-domain name limits are intentional](./35-duplicated-name-cap-constants.md) | shared-contracts | XS | low | none | Decided |
| 36 | [Persisted ASI choiceData schema is strictly looser than its validated input (free string/int vs STR..CHA enum + 1\|2)](./36-asi-choicedata-looser-than-input.md) | shared-contracts | S | low | none | Proposed |
| 37 | [Load-bearing 'fire-after-set' holder idiom repeats 4x in map-canvas-store but its TS-narrowing rationale is documented only once](./37-map-canvas-holder-idiom-under-documented.md) | complexity-hotspots | XS | low | none | Proposed |
| 38 | [confirm-cast-strip unwind() triggers cleanup via setActiveTool('select') side effects instead of the named cancelTargetPick action](./38-unwind-relies-on-setactivetool-side-effects.md) | complexity-hotspots | S | low | none | Proposed |
| 39 | [AoE template geometry (cone/cube/line) lacks a coordinate model and WHY-comments on its reflection/projection math](./39-area-template-geometry-undocumented-math.md) | complexity-hotspots | XS | low | none | Proposed |
| 40 | [Shared map entity type is named VttMap, breaking the Map* prefix family and having zero references](./40-vttmap-type-name-breaks-prefix-family.md) | naming-consistency | XS | low | none | Decided |
| 41 | [srd.ts splits its import section with five module-level const declarations mid-file](./41-srd-imports-split-by-consts.md) | complexity-hotspots | XS | low | none | Proposed |
| 42 | [vtt-drawer page object is the lone e2e page-object file that omits the *.po.ts naming convention](./42-vtt-drawer-po-naming-outlier.md) | testing-ergonomics | XS | low | none | Proposed |
| 43 | [README Quickstart understates the Bun minimum (>= 1.2.0) below the engines-enforced >= 1.3.0 floor](./43-readme-bun-version-understated.md) | onboarding-setup | XS | low | none | Proposed |

## Out of scope / already covered elsewhere

These areas were deliberately **not** re-filed here; each is owned by existing
work. Findings were cross-checked against these titles before landing, and any
duplication/dead-code or already-tracked angle was dropped.

- **Near-duplicate code and dead/unused code** — owned by
  `docs/agent_notes/backlog/drift-ai-findings/` (a different agent is actively
  implementing these). No duplication or dead-code finding appears in this pack.
- **AI-agent harness ergonomics** (coverage-map governance, agent test
  ergonomics, edit hooks/caches, lint-rule ergonomics for agents, drift-scan
  governance) — owned by `docs/agent_notes/backlog/agent-friction-2026-06/`.
  Human-onboarding angles are in scope here; harness-for-agents tooling is not.
- **useEffect-misuse guardrails** (ESLint trial, agent guidance) — owned by
  `docs/agent_notes/backlog/useeffect-guardrails-implementation-plan.md` /
  `useeffect-ai-agents-research.md`.
- **Storybook / component catalog** for `packages/client/src/components/ui/`
  primitives — owned by
  `docs/agent_notes/backlog/storybook-component-catalog.md`.
- **Lint-debt drain & ratchet governance** (max-lines policy, lint follow-ups) —
  owned by `docs/agent_notes/backlog/lint-followups-2026-06/`, the lint-ratchet,
  and the `eslint-max-lines-policy` work.
- **Dependency upgrades** — TypeScript 6, `@types/node` 25, `@fastify/multipart`
  10, `eslint-plugin-jsdoc`, the `eslint-plugin-react` peer exception, and the
  `fast-uri` override removal — each owned by its respective backlog note.
- **Production / infra hardening and UX/product audits** — owned by
  `production-readiness.md`, `polish-and-mobile.md`, `ux_ui_audit/`, and
  `ux-audit-2026-06-p0/`.
- **Test-tier & mutation-testing plans** — owned by
  `mutation-testing-stryker.md` and `slow-test-tier-candidates.md`.

## Post-audit review (2026-06-13)

Before this pack was committed it was independently re-reviewed for document
quality — once by Claude and once by Codex (OpenAI), each re-checking the
load-bearing counts and absence-claims against the code at HEAD. **No finding was
invalidated; no P0/blocker-level errors were found** — every high-priority leaf's
central claim verified (the JWT 31-vs-32 boundary, the 8 inline-`$transaction`
routers, the 5 `onTRPCError` adopters, the 41 schema files / 683 deep imports, the
type-assertion category tallies, the deleted `STATUS.md`/`NEXT.md`, the zero-ref
`VttMap`, the 94-vs-8 script gap, the 28/34 `MODULE.md` counts). The review made
the following accuracy corrections (this section is the only change relative to the
agents' original output, plus leaf #43):

- **Added leaf #43** — the README understates the Bun minimum (`>= 1.2.0` vs the
  `engines` `>= 1.3.0` floor). Theme 1 already named this drift but no leaf carried
  its evidence; it is now filed (count moved 42 → 43).
- **#00 report** — Theme 1 / executive summary reworded: only `#1`/`#2` are hard
  fresh-clone blockers; `#3`–`#5`/`#43` are first-run drift/friction, not blockers.
- **#07** — clarified the count: `toast.error(...Failed...)` matches **19** files;
  18 are generic hardcoded handlers, the 19th (`use-character-spells.ts`) is the
  raw-`error.message` site tracked separately as #31.
- **#10** — corrected store fan-out (was counting `*.test-helper.*` despite saying
  "excl. tests"): non-test importers are `map-canvas-store` 20, `vtt-drawer-store`
  14, `combat-store` 5 (was 21/14/6).
- **#13 / #14** — added the missing `monster.ts:138-141` counterexample
  (`damageResistances`/`damageImmunities`/`damageVulnerabilities`/`conditionImmunities`
  as free `z.array(z.string())`), a strong same-concept split vs. `homebrew.ts`.
- **#17** — corrected the `turn-service` absence overclaim: besides the stale
  `CONCURRENCY.md:92` line there is a corroborating (correct) comment at
  `encounter-combat-concurrency.test.ts:529`; no `turn-service.ts` file exists.
- **#31** — `use-character-spells.test.ts` already exists with `togglePrepared`
  coverage; the leaf now says to **extend** it rather than create a new file.

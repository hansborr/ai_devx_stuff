# Ready Queue 2026-07 — Task Pack

Status: Task index
Created: 2026-07-19
Source: 2026-07-19 whole-backlog readiness sweep — eight parallel
verification agents checked every backlog pack and standalone note against
HEAD and git history; already-landed items were closed out in the same
triage (see that commit). Model follows `../sequential-drain-2026-07/`:
standalone ready notes were **moved into this pack** (leaves 01–10);
pack-resident ready leaves **stay in their source packs** and this index is
the single tracking surface for them. Leaves 11–17 joined 2026-07-19 from
the harness architecture review of the same day (claims verified against
HEAD; design calls consulted with Fable 5 + Codex — rulings encoded in the
leaves).

## Working model

- Every item in tables A–C not yet marked Done is ready now: concrete
  scope, entry points verified against HEAD 2026-07-19, no unfired trigger,
  no pending owner decision. Section D needs a quick owner call before dispatch.
- When an item lands, mark it Done **here and in its source pack's index**;
  retire source leaves per that pack's conventions.
- Re-verify `file:line` seams before editing — they were verified 2026-07-19
  and drift fast.
- Groups are by size to ease lane assignment. Within a group order is a
  suggestion, not a dependency chain, except where a row says otherwise.
- Items are independent unless noted; the A-group rows are natural
  fast-commit lane fodder, C-group rows want one dedicated lane each.

## A — Small, mechanical

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| A1 | [Clamp-test ready/release handshake port](./01-clamp-test-handshake-port.md) — `scripts/ai-hooks/test.sh` timeout-clamp test | this pack | S | Done |
| A2 | Remove dead `getById` compat aliases in `routers/magic-item.ts` + `routers/monster.ts` (zero client callers remain) | codebase-audit / 24 | S | Done |
| A3 | Print `changedDuringScan` in the prototype-advisory text header (`scripts/drift-ai/prototype-advisory.ts`) | drift-triage-2026-07-13 / REVIEW-FOLLOWUPS #5 | S | Done |
| A4 | Column-aware `rangeResolves` in `scripts/drift-triage/triage-packet-staleness.ts` | drift-triage-2026-07-13 / REVIEW-FOLLOWUPS #6 | S | Done |
| A5 | Pin `mapToSpellAttackResult`'s projection boundary (explicit pick, not rest-spread) + pinning test | drift-triage-2026-07-13 / REVIEW-FOLLOWUPS #7 | S | Done |
| A6 | Loader-level test: non-character participants never carry non-null `targetCharacterId` (damage routing) | drift-triage-2026-07-13 / REVIEW-FOLLOWUPS #8 | S | Done |
| A7 | e2e scheduling: drop redundant `describe.serial` in `auth-refresh.spec.ts`, mark the 4 independent specs parallel | testsuite-audit / 04 | S-M | Done |
| A8 | Escalate `eslintChanged`/`agentLintChanged`/`configSensorsChanged` into the shared-collector trigger group (`scripts/path-policy/path-policy.ts`; mirror the existing register blocks) | sequential-drain-2026-07 / 03 (F.1.1) | S | Done |
| A9 | Derive `.husky/pre-push`'s source-extension regex from `BUILT_IN_SOURCE_EXTENSIONS` (`scripts/drift-ai/scope.ts`), or pin the pair via `harness:check` | sequential-drain-2026-07 / 04 (F.2.1) | S | Done |
| A10 | [Merge-driver driverless-window doc paragraph](./02-merge-driver-driverless-window-guard.md) in `docs/guides/lint-ratchet-merges.md` | this pack | S | Done |
| A11 | Golden-path pointer naming one worked shared→server→router→client slice in `docs/guides/add-trpc-procedure.md` | harness-review-tasks / 15 | S | Done |
| A12 | Thin spec/plan template under `docs/agent_notes/` | harness-review-tasks / 51 | S-M | Done — already landed pre-wave (template on `main` in `48cbb9fc` before the lane started) |
| A13 | Demotion rule / noise-budget policy language in `docs/ai-harness.md` | harness-review-tasks / 52 | S | Done |
| A14 | Character-sheet load-error repro spike — timeboxed; try route-transition/refocus repros, then scope or close as unreproducible | `../character-sheet-load-error-after-return.md` | S | Done — fixed in `packages/client/src/pages/character-sheet-page.tsx` (cached data renders over a background-refetch error; full-page error only when there is no data); optional login-redirect deliberately NOT added (GuestGuard bounce makes it a no-op; a real session-expired pathway is a follow-up) |
| A15 | [Harness quick wins, 2026-07-19 review](./17-harness-quick-wins-2026-07-19.md) — doc-length pass-through deletion, wiring-test scaffolding dedupe, `*.generated.sh` naming sweep | this pack | S | Done |
| A16 | [Merge-CLI table + one argv-offset constant](./16-merge-cli-table-and-argv-offset.md) — `runCliMain` kernel recorded rejected with re-open trigger; sequence after B1 | this pack | S | Ready |

## B — Medium

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| B1 | Enumerated `@musi/lint-ratchet` subpath exports (owner-accepted 2026-07-18; the lint lane's P0-next; sequence + rejected shapes in the leaf) | lint-arch-review-2026-07 / 14 | M | Ready |
| B2 | Envelope↔hook bridge step (b): thread the specific repair command into shell advisories (check `--edit-check` JSON metadata first) | lint-messaging-2026-07 / 22 | M | Ready |
| B3 | Property suites for `attack-damage.ts` + `xp.ts` (PB-1 residue; pattern: `character-rules.property.test.ts`) | harness-research-followups-2026-06 / 01 | S-M | Ready |
| B4 | HS-1 discovery pass: per-flag `tsc` error inventories for `exactOptionalPropertyTypes` + `noPropertyAccessFromIndexSignature`, grouped by package — measure before any flip | harness-strictness-comprehension-2026-06 / 01 | M | Ready |
| B5 | [Generalize the fixture-closure guard](./03-fixture-copy-set-import-graph-guard.md) to the remaining hand-written `scripts/tests/` copy sets | this pack | M | Ready |
| B6 | DB-free `server-unit` vitest project so seed/parser tests skip DB setup (per-file audit already in the leaf) | testsuite-audit / 09 | M | Ready |
| B7 | Env-gate `BCRYPT_SALT_ROUNDS` for tests — keep the dummy-hash constant high (timing-oracle caveat in the leaf) | testsuite-audit / 10 | S | Ready |
| B8 | e2e `storageState` reuse — design the per-context/per-worker auth story first (refresh-token rotation hazard in the leaf) | testsuite-audit / 03 | M | Ready |
| B9 | Generator-import ⊆ trigger-list consistency check — rescope first: target `generatedSurface.triggerPaths` via `scripts/harness/generated-surfaces.ts`; the leaf predates the generated-surface move | sequential-drain-2026-07 / 03 (F.1.2) | M | Ready |
| B10 | Widen porting-knob parity scan roots beyond `scripts/` (`scripts/harness/porting-knob-parity.ts`; small scoped-scan design in the leaf) | sequential-drain-2026-07 / 03 (F.1.3) | M | Ready |
| B11 | Lint self-correction exemption audit (inventory pass) | harness-review-tasks / 50 | M | Ready |
| B12 | Green-output backpressure carve-out audit across `scripts/ai-hooks/` | harness-review-tasks / 54 | M | Ready |
| B13 | Slow-lane mutation/timing report-only add-ons on `slow-drift.yml` / `harness-audit.ts` | harness-review-tasks / 25 | M | Ready |
| B14 | M2 aggregate context-budget reporter — sum always-loaded session tokens, report-only line in `doctor` | harness-presentation-2026-06 / 03 (item 4) | M | Ready |
| B15 | Stryker survivor summarizer first, then scoped shared-rules mutation in the weekly `slow-drift.yml` lane | harness-presentation-2026-06 / 03 (item 5) | M | Ready |
| B16 | Rename ambiguous caller-owned service cores (step 2; decided plan in `packages/server/src/services/README.md`) | codebase-audit / 09 | S-M | Ready |
| B17 | [TypeScript 6 upgrade](./06-typescript-6-upgrade.md) — isolated migration, own lane | this pack | M | Ready |
| B18 | [`@fastify/multipart` 10 upgrade](./07-fastify-multipart-10-upgrade.md) — isolated migration | this pack | M | Ready |
| B19 | [`eslint-plugin-jsdoc` 63 upgrade](./08-eslint-plugin-jsdoc-63-upgrade.md) — isolated migration | this pack | S-M | Ready |
| B20 | [`@types/node` 25 upgrade](./09-node-types-25-upgrade.md) — isolated migration | this pack | M | Ready |
| B21 | [Age-gated dependency refresh](./10-dependency-age-gated-followups.md) — rerun `bun outdated` first; the note's version list is stale | this pack | M | Ready |
| B22 | [Typed harness-controls parser](./11-harness-controls-typed-parser.md) — whole-manifest Zod parser in a sibling module + no-direct-read tripwire; phase 2 migrates the 21-ref bypass population; do first in the C7→C8 review chain | this pack | M | Ready |
| B23 | [Envelope emission kernel](./14-envelope-emission-kernel.md) — one validate→route→atomic-write writer behind the keep-listed schema; check the lint-ratchet S3 hold (68a3f000) first | this pack | M | Ready |
| B24 | [git-exec seam growth + no-new-bypassers ratchet](./15-git-exec-seam-consolidation.md) — semantic caller inventory, proven primitives, retire the 3× git-show; bulk migration stays opportunistic drain work | this pack | S-M | Ready |

## C — Large (one dedicated lane each)

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| C1 | [Archgate ADR pilot](./04-archgate-adr-plan.md) — skeleton + `adr:check` + ADR-0001/0003 + retire `decisions-concurrency.md`; expansion stays sequenced behind the pilot | this pack | L | Ready |
| C2 | Finish router `$transaction` extraction into services: `character.ts`, `invite.ts`, `weapon-mastery.ts`, `encounter.ts` `removeParticipant` (pattern already landed for the first three routers) | codebase-audit / 08 | L | Ready |
| C3 | Near-duplicates detector v2 — advisory block-detection tier first (jscpd-style), exact-clone tier before any in-house AST work; conditioned on the gate keeping its verify slot | lint-review-followups-2026-07 / 02 | L | Ready |
| C4 | EV-1 codebase-grounded golden-task eval harness (full spec in the leaf; genuinely unstarted) | harness-research-followups-2026-06 / 03 | L | Ready |
| C5 | `lint-coverage-map-gen.ts` generator with marker-block diff (A5 generation half; precedent: `scripts/harness/generate-verify-steps.ts`) | agent-friction-2026-06 / 01 | M-L | Ready |
| C6 | [VTT drawer schema work](./05-vtt-drawer-followups.md) — structured spell damage + monster Atk/Dmg wiring; design pass first | this pack | L | Ready |
| C7 | [Gate-lifecycle seam](./12-verify-gate-lifecycle-seam.md) — grow `verify-engine.sh` a gate-run interface; per-divergence policy-vs-drift matrix before extraction; after B22, strictly before C8 (same files — never concurrent lanes) | this pack | M-L | Done |
| C8 | [Command-policy TS core](./13-command-policy-ts-core.md) — five-slice port of `policy.sh` + the `common.sh` lexer (lexer first, per-domain authority flips, differential-corpus parity, procedure-pinned perf gate); strictly after C7, one lane re-branched per slice | this pack | L | Ready |

## D — Needs a quick owner call before dispatch

Not ready; listed so orchestration sees the full picture. Each is one
decision away from either joining the queue above or being closed.

- **lint-deep-dive-2026-07 / 14** (propose-mode registry validation):
  implement (S) or trim — the leaf itself flags the one-round-trip blast
  radius as self-correcting.
- **lint-deep-dive-2026-07 / 40 step 2 + 50 step 2** (restricted-syntax
  builder; suppression ledger): designs fully recorded in-leaf with API
  shapes and acceptance tests; confirm the recorded design counts as
  sign-off, then they are M/L implementation work.
- **`../ai-hooks-suite-self-concurrency.md`**: pick doc-wontfix vs
  env-overridable marker path vs flock serialization.
- **`../join-page-auto-join-ux-decision.md`**: silent auto-join vs explicit
  "Join campaign" confirmation.

## Promotion rules

1. Pull from A/B/C only; D needs the owner first.
2. Mark landings Done here and in the source pack index in the same commit.
3. Follow the repo Workflow (TDD, conventional commits, commit-gate
   verification); C-group items get a plan review before code.

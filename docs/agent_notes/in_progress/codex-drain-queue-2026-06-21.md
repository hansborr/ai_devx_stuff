# Codex drain queue — 2026-06-21

Curated, reconciled task set for an **autonomous Codex-delegated run**. Every
item below was verified against current `main` (workflow reconciliation of all
backlog packs, 2026-06-21): each is a real, still-present problem, scoped to a
single concern, with a clear pass/fail and a verify command. Items that needed
product/design judgment or live-app verification were excluded (see
"Deferred — not Codex-suitable" at the bottom).

## How to run this

- One task → one `feat/...` or `fix/...` branch → one conventional commit. TDD.
- Per-task gate: `bun run verify:changed` (stage intended changes first). Use the
  per-task **Verify** command for the focused check.
- Read the **Source** leaf for full file:line evidence before starting; the
  **Do** line is the reconciled, current-as-of-2026-06-21 restatement.
- Delegation hygiene: do **not** pull Codex's diffs back into the orchestrator's
  context — delegate the quality/verify check instead (see memory:
  avoid-inspecting-delegated-diffs).
- Tiers are by leverage/safety, not hard ordering. Tier 1 is the safest pure
  test/code fodder; Tier 3 is docs/process.

## Reconciliation headline

- `testsuite-audit/`: **43/55 leaves already done**, 12 remain (5 partial + 7
  ready); of those, **8 are Codex-suitable** (below). The other 4 are e2e/auth
  changes that need live-suite verification — deferred.
- `mutation-coverage-2026-06/`: **94/95 done** (merged). Only residual **#75**
  remains (Tier 1, inlined). Folder archived.
- `ux-audit-2026-06-p0/`: **all 3 P0 bugs fixed**; only a dev-DB fixture cleanup
  remains (deferred). Folder archived.
- Done/superseded loose notes and the mutation/ux folders were archived this
  pass (see `../LOG.md`).

---

## Tier 1 — pure test/code fodder (self-verifiable, low blast-radius)

#### `testsuite-audit/52` — VTT drawer page object hardcodes CELL_SIZE_PX=40, silently coupled to the client's frozen default grid cell size  _[XS · ready]_
- **Do:** In e2e/page-objects/vtt-drawer.po.ts, add a one-line comment directly above `const CELL_SIZE_PX = 40;` (line 5) stating that this value mirrors the client grid default `DEFAULT_CELL_SIZE_PX` in packages/client/src/stores/map-canvas-store.ts and must be kept in lockstep if that default changes. Do NOT import the client constant into the e2e layer and do NOT change clickCell, the value 40, or any spec. Acceptance: the comment exists naming both the symbol and the file path; lint/format pass; no test or click-math behavior changes.
- **Verify:** `bun run lint:changed (after staging) — the change is comment-only; reviewer confirms the breadcrumb comment is present on vtt-drawer.po.ts:5`
- **Source:** docs/agent_notes/backlog/testsuite-audit/52-e2e-vtt-po-hardcodes-cell-size.md

#### `testsuite-audit/44` — Client tests assert on raw Tailwind utility classes, coupling tests to styling internals  _[S · ready]_
- **Do:** Replace 5 raw-Tailwind-class test assertions with semantic role/text/test-id queries, keeping every behavioral assertion intact. (1) character-sheet-page.test.tsx:42 — add role="status" (or data-testid) to the SRD loading skeleton in character-sheet-page.tsx and query that instead of '.motion-safe\:animate-pulse'. (2) paginated-result-list.test.tsx:55 — add a data-testid (or role) to the container div in paginated-result-list.tsx (currently className={containerClassName}, no hook) and assert that, dropping the '.max-h-64.overflow-y-auto' re-check of the test's own injected string. (3) campaign-homebrew-section.test.tsx:132 — read names via within(row).getByText off the existing data-testid='available-collection-row' instead of '.font-medium'. (4) initiative-tracker-actions.test.tsx:90,92 — query the count via within(button labelled 'Conditions for ${name}').getByText('2') instead of '.absolute'. (5) initiative-row.test.tsx:94,100 — assert aria-pressed on the select button (already exposed at initiative-row.tsx:47; tests already assert it on adjacent lines) instead of toHaveClass('ring-2','ring-amber-500'); leave the ring class in the component. Acceptance: each migrated assertion must still FAIL when the underlying behavior regresses (skeleton absent, badge count wrong, ring not applied) and pass when only a class string is renamed; no source-behavior change beyond adding role/test-id; do NOT touch initiative-row's aria-current test (already the correct pattern). Verify per file with bun run test -- <file>; pass counts unchanged.
- **Verify:** `bun run test -- packages/client/src/pages/character-sheet-page.test.tsx packages/client/src/components/common/paginated-result-list.test.tsx packages/client/src/components/campaign/homebrew-link/campaign-homebrew-section.test.tsx packages/client/src/components/campaign/combat/initiative-tracker-actions.test.tsx packages/client/src/components/campaign/combat/initiative-tracker/initiative-row.test.tsx`
- **Source:** docs/agent_notes/backlog/testsuite-audit/44-client-tests-assert-on-tailwind-utility-classes.md

#### `testsuite-audit/46` — Single-user register+create-character+browser-login e2e block duplicated across two specs with no helper  _[S · ready]_
- **Do:** In e2e/helpers/campaign-setup.ts (alongside setupDmAndPlayer), add a single-user helper setupUserWithCharacter(browser, { prefix, character? }) that centralizes makeUser(prefix) -> createApiContext -> apiRegister -> apiLogin -> apiCreateCharacter (defaulting to DEFAULT_CHARACTER_INPUT, overridable via the character arg) -> apiCtx.dispose() -> browser.newContext() -> newPage() -> loginViaUi -> click the SPA character link and assert toHaveURL(/\/characters\//), carrying the existing comment 'Navigate via SPA link (avoids full-page reload batch query limit)' into the one shared place; return { context, page, user, charName }. Migrate ONLY e2e/character-sheet.spec.ts (default character) and e2e/spell-rest.spec.ts (passes its explicit wizard stats via the character arg) so each beforeAll collapses to one call. Do not touch inventory.spec.ts, character-data-integrity.spec.ts, encounter-combat.spec.ts, campaign-collab.spec.ts, or notifications.spec.ts. Add/remove/change no assertions; character inputs must be byte-for-byte identical. Acceptance: both migrated specs pass with the same count as before.
- **Verify:** `bun run e2e -- character-sheet.spec.ts spell-rest.spec.ts (run both specs; identical pass count before/after)`
- **Source:** docs/agent_notes/backlog/testsuite-audit/46-e2e-single-user-character-setup-duplicated.md

#### `testsuite-audit/02` — Type-heavy client dialog tests omit userEvent.setup({ delay: null })  _[S · partial]_
- **Do:** In the remaining type-heavy client tests that still use bare `userEvent.setup()` AND make multi-character `.type()` calls, change the setup to `userEvent.setup({ delay: null })`. Confirmed remaining targets: packages/client/src/components/campaign/tokens/add-token-dialog.test.tsx (5 setup sites), packages/client/src/components/sheet/personality-panel.test.tsx (multi-char typers at the 189/242 blocks), packages/client/src/components/sheet/inventory-panel.test.tsx (the 'Greatsword' typer block). Do NOT touch: roll-context-menu.test.tsx (intentional advanceTimers fake-timer setup), files using the static userEvent.type(...) API with no setup() instance, or files that type only single-char/numeric strings. Acceptance: each touched file still passes `bun run test -- <file>` with no assertion changes (only the setup() call changes).
- **Verify:** `bun run test -- packages/client/src/components/campaign/tokens/add-token-dialog.test.tsx packages/client/src/components/sheet/personality-panel.test.tsx packages/client/src/components/sheet/inventory-panel.test.tsx`
- **Source:** docs/agent_notes/backlog/testsuite-audit/02-client-userevent-default-delay-typing.md

#### `testsuite-audit/16` — No vitest config enables clearMocks; mock-call-state isolation hand-managed across client tests  _[S · partial]_
- **Do:** Remove now-redundant call-history mock resets from packages/client/src/**/*.test.{ts,tsx} that are made redundant by clearMocks:true (already set in packages/client/vitest.config.ts:15). Delete vi.clearAllMocks() statements (~45 files, mostly the sole or near-sole statement in a beforeEach) and inline .mockClear() call-history resets (~9 files, e.g. invite-panel.test.tsx:96,116). HARD CONSTRAINTS: do NOT touch any vi.resetAllMocks()/.mockReset() site (clearMocks does not reset implementations), do NOT enable mockReset/restoreMocks anywhere, and do NOT alter setup.ts console-restore or the resetMock* helper calls. Acceptance: every deletion site is a call-history-only reset, and `bun run test -- packages/client` stays fully green.
- **Verify:** `bun run test -- packages/client (full client project must stay green after each deletion)`
- **Source:** docs/agent_notes/backlog/testsuite-audit/16-vitest-clearmocks-unset-mock-isolation-hand-managed.md

#### `testsuite-audit/14` — RuleTester invalid cases never assert map-selected {{placeholder}} substitution  _[S · partial]_
- **Do:** In eslint-rules/concurrency-guard.test.js, add one invalid RuleTester case that triggers the rule on a direct write to the 'encounterParticipant' Prisma delegate (e.g. `await ctx.prisma.encounterParticipant.update({ where:{ id }, data });` in a routers/*.ts filename) asserting `messageId:'noDirectWrite'` plus `data:{ delegate:'encounterParticipant', method:'update', suggestion: <the exact string from DIRECT_WRITE_SUGGESTIONS in concurrency-guard.js:30-33> }`, mirroring the existing four invalid cases. In eslint-rules/socket-registry-broadcasts.test.js, add three invalid cases (one each for events 'campaign:updated', 'chat:newMessage', 'map:layerUpdated') asserting `messageId:'noDirectEmit'` plus `data:{ eventName, helper: <exact value from REGISTRY_OWNED_EVENT_HELPERS in socket-registry-broadcasts.js:11-19> }`, mirroring the existing four. Do not modify any rule source, the maps, message templates, or the shared rule-tester/message-guidance harness. Acceptance: every DIRECT_WRITE_SUGGESTIONS delegate and every REGISTRY_OWNED_EVENT_HELPERS event has at least one invalid case pinning its substituted value, and both test files pass.
- **Verify:** `bun run test -- eslint-rules/concurrency-guard.test.js && bun run test -- eslint-rules/socket-registry-broadcasts.test.js`
- **Source:** docs/agent_notes/backlog/testsuite-audit/14-ruletester-invalid-cases-skip-map-selected-placeholder-substitution.md

#### `testsuite-audit/06` — 700+ router tests run cleanDb() twice per test (global beforeEach + redundant helper/per-file clean)  _[S · partial]_
- **Do:** Add an optional `SetupEncounterTestContextOptions extends CleanDatabaseOption` param to setupEncounterTestContext in packages/server/src/test/encounter-test-helper.ts and forward it to setupCampaignTestContext(app, { cleanDatabase: options.cleanDatabase ?? true }). Then at the 24 encounter test files that call setupEncounterTestContext(app) inside a top-level `beforeEach`, pass `{ cleanDatabase: false }` (the global setup.ts beforeEach already cleaned). Do NOT change the 6 mid-it() calls in packages/server/src/routers/character.test.ts (lines 421,450,490,517,616,692) — they run after their own beforeEach seeded a user and rely on the internal clean. Acceptance: encounter and character router tests stay green, and each encounter beforeEach incurs exactly one cleanDb (the global one), not two.
- **Verify:** `bun run test -- packages/server/src/routers/encounter-combat.test.ts packages/server/src/routers/character.test.ts`
- **Source:** docs/agent_notes/backlog/testsuite-audit/06-router-tests-double-cleandb-per-test.md

#### `testsuite-audit/32` — Tmp-dir + git-repo test scaffold reinvented per-file across the scripts suite (no shared helper)  _[M · partial]_
- **Do:** In packages-root scripts/, migrate the remaining scripts tests off their hand-rolled temp-repo scaffolds onto the existing shared helper scripts/test-support/tmp-repo.test-helper.ts (registerTempRootCleanup()). Target the 12 drift-ai *.test.ts files that still declare a local `function writeRepo` (duplicate-shapes, commented-out-code, duplicate-constants, dolos-runner, duplicate-schemas, duplicate-literals, layer-direction, import-cycles, module-doc-paths, semgrep-runner, near-duplicates) plus the 3 lint-ratchet files (lint-ratchet-debt-log/zero-baseline/check-registry.test.ts using writeBaselineFixture/tempDebtLog). For each: delete the module-level `const tempRoots`, the `while (tempRoots.length > 0)` afterEach drain, and the local writeRepo/makeRepo builder; call `const tmp = registerTempRootCleanup()` once at module scope and route file writes through tmp.writeRepo/tmp.writeRepoFile/tmp.makeTmpGitRepo, preserving each file's original mkdtemp prefix and any git-init behavior. Do NOT touch assertions, production code, or fixture corpora. Acceptance: no behavior change; `bun run test:scripts:file -- <each file>` passes with identical pass counts, and `grep -rl 'function writeRepo' scripts/drift-ai` shrinks to 0 for the migrated set.
- **Verify:** `bun run test:scripts:file -- scripts/drift-ai/duplicate-shapes.test.ts (repeat per migrated file); confirm pass counts unchanged`
- **Source:** docs/agent_notes/backlog/testsuite-audit/32-scripts-tmp-repo-scaffold-no-shared-helper.md

#### `mutation-coverage-2026-06/75` — #75 residual: unit tests for cacheKeyHashFor/usesEslintCache, rule-source validators, max-lines-policy throw branches, and license classification  _[M · ready]_
- **Do:** Add four colocated vitest test files (scripts project) for the residual #75 sub-items (full directions inlined below; the original leaf is in git history under docs/agent_notes/backlog/mutation-coverage-2026-06/). (a) scripts/lint-ratchet/eslint-config.test.ts: assert cacheKeyHashFor returns a stable 12-char hash that CHANGES when the ratchet config or ruleSourceHash changes (kills the slice-length and hash-input mutants at eslint-config.ts:15-22), and usesEslintCache returns true only for parser profile 'minimal-ts' (:42). (b) scripts/lint-ratchet/rule-source.test.ts: assert localRuleName throws on a ruleId lacking the 'local/' prefix and strips it correctly (:24-26), and thirdPartySupportFor throws on an allowlist miss (:36). (c) scripts/lint-ratchet/max-lines-policy.test.ts: first extract readMaxLinesPolicy (max-lines-policy.ts:71) to an export with no behavior change (keep the line-89 module-top invocation), then assert each throw branch (non-object input, counting flags not both true, invalid kind, non-empty-string reason). (d) scripts/audit-dependency-licenses.test.ts: extract licenseValue and the STRONG_COPYLEFT_RE/REVIEW_COPYLEFT_RE regexes (audit-dependency-licenses.ts:24-50) into exported pure functions/constants with no behavior change, then assert AGPL/GPL/SSPL classify strong, LGPL/MPL/EPL review, MIT/BSD/ISC neither, plus the SPDX-array OR-join in licenseValue. Use TDD; add as plain colocated *.test.ts files (no smoke-test registration needed). Acceptance: all four files pass under `bun run test:scripts:file -- <files>` and each new assertion fails if the cited mutant is reintroduced.
- **Verify:** `bun run test:scripts:file -- scripts/lint-ratchet/eslint-config.test.ts scripts/lint-ratchet/rule-source.test.ts scripts/lint-ratchet/max-lines-policy.test.ts scripts/audit-dependency-licenses.test.ts`
- **Source:** (inline — source folder archived to finished_work)

#### `lint-fix-dist-preflight-parity` — Give lint:fix the same missing-dist preflight diagnostic as lint  _[S · ready]_
- **Do:** Make `bun run lint:fix` emit the same missing-dist preflight diagnostic that scripts/lint.sh and scripts/lint-changed.sh already produce, instead of bypassing it via the bare `eslint . --fix` in package.json. Add a small preflight wrapper (or route lint:fix through the composite path forwarding --fix only to ESLint) that, when packages/shared/dist or packages/server/dist is missing, prints the actionable 'run bun run typecheck' prerequisite message and exits non-zero before invoking ESLint. Preserve the current ESLint-only repair ergonomics (do NOT add ShellCheck/config sensors to lint:fix). Acceptance: with shared/server dist removed, `bun run lint:fix` shows the same typecheck-prerequisite diagnostic as `bun run lint`; add a scripts smoke test covering the chosen path and register it in the 3 required smoke-test locations (path-policy subjects, query run-order, test-test-scripts ALL_SMOKE_TESTS); `bun run verify:changed` passes.
- **Verify:** `rm -rf packages/shared/dist packages/server/dist && bun run lint:fix 2>&1 | grep -q 'bun run typecheck'; bun run verify:changed`
- **Source:** docs/agent_notes/backlog/lint-fix-dist-preflight-parity.md

#### `drift-ai-ghost-files-agent-noun-pairs` — drift:ai ghost-files env-define noun/agent role-pair false positive  _[XS · ready]_
- **Do:** In drift-ai.config.json, add the exact pair ["scripts/drift-ai/env-define-evaluation.ts", "scripts/drift-ai/env-define-evaluator.ts"] to checks.ghost-files.currentAllowedPairs (these are an intentional evaluation/evaluator split, a confirmed false positive). Do NOT broaden the ghost-files detector or change exit semantics. Acceptance: `bun run drift:ai --scope current --root scripts/drift-ai --check ghost-files --format text` no longer reports that pair, and any existing ghost-files/config tests still pass. Update the calibration record note if one is touched, with before/after counts.
- **Verify:** `bun run drift:ai --scope current --root scripts/drift-ai --check ghost-files --format text`
- **Source:** docs/agent_notes/backlog/drift-ai-ghost-files-agent-noun-pairs.md


---

## Tier 2 — harness / tooling code (scoped, slightly more design)

#### `harness-strictness-comprehension-2026-06/01-noFallthroughCasesInSwitch` — Ratchet TypeScript strictness flag: noFallthroughCasesInSwitch  _[XS · ready]_
- **Do:** Add `"noFallthroughCasesInSwitch": true` to the compilerOptions block in /workspace/tsconfig.base.json (it currently lacks all four extra strictness flags). Do not add the other three flags. Run `bun run typecheck` and confirm it stays green (verified: 0 new diagnostics across shared/server/client/scripts at current HEAD). Acceptance: tsconfig.base.json contains the flag set to true and `bun run typecheck` passes. This is a flag-only change; no source edits should be required.
- **Verify:** `bun run typecheck`
- **Source:** docs/agent_notes/backlog/harness-strictness-comprehension-2026-06/01-typescript-strictness-ratchets.md

#### `harness-strictness-comprehension-2026-06/01-noImplicitOverride` — Ratchet TypeScript strictness flag: noImplicitOverride  _[XS · ready]_
- **Do:** Add `"noImplicitOverride": true` to compilerOptions in /workspace/tsconfig.base.json. Do not enable noPropertyAccessFromIndexSignature or exactOptionalPropertyTypes (those are large/deferred). Run `bun run typecheck`; verified at current HEAD to produce 0 new diagnostics across all projects. Acceptance: flag present and set to true, `bun run typecheck` passes with no source edits.
- **Verify:** `bun run typecheck`
- **Source:** docs/agent_notes/backlog/harness-strictness-comprehension-2026-06/01-typescript-strictness-ratchets.md

#### `harness-research-followups-2026-06/04-runtime-a11y-axe-e2e` — A11Y-1 — Runtime a11y checks (axe-core) in Playwright e2e  _[S-M · ready]_
- **Do:** Add @axe-core/playwright as a devDependency (respect bunfig.toml minimumReleaseAge=604800). Add a focused a11y smoke inside the existing e2e/ project (root playwright.config.ts) covering 3-4 key rendered views using existing page objects: login (login.po.ts) and register (register.po.ts), the character sheet (character-sheet.po.ts), and one campaign/VTT view (campaign-detail.po.ts or vtt-drawer.po.ts). Navigate to a stable rendered state via the page object, run AxeBuilder, and assert no violations at serious/critical impact. If the first run surfaces pre-existing violations, do NOT weaken the threshold: capture them in an explicit, documented per-page allowlist/baseline with a drain note (mirroring the repo ratchet philosophy) rather than fixing app code in this run. Keep it in the e2e job, off the per-commit path; leave the static jsx-a11y gate unchanged. Acceptance: axe runs against >=3 views asserting no serious/critical violations (modulo a documented baseline), `bun run e2e` for the a11y group passes.
- **Verify:** `bun run e2e -- a11y`
- **Source:** docs/agent_notes/backlog/harness-research-followups-2026-06/04-runtime-a11y-axe-e2e.md

#### `harness-research-followups-2026-06/01-property-based-testing-fast-check` — PB-1 — Property-based tests for the rules engine (fast-check)  _[M · ready]_
- **Do:** Add `fast-check` as a devDependency in packages/shared (respect the bunfig.toml minimumReleaseAge=604800 cooldown). Create packages/shared/src/rules/character-rules.property.test.ts as the reference pattern: define reusable fast-check arbitraries bounded to legal D&D ranges (ability scores 1-30, levels 1-20) and assert invariants on existing pure functions — abilityModifier monotonic non-decreasing in score, proficiencyBonus non-decreasing across levels 1-20, passivePerception = 10 + skill modifier. Keep numRuns modest. Do NOT loosen any bound to make a property pass; if a property fails, capture the shrunk counterexample as a regression case in character-rules.test.ts and fix the code. Keep the existing example-based tests. Acceptance: fast-check is a devDependency, character-rules.property.test.ts is committed and green, and `bun run verify:changed` passes.
- **Verify:** `bun run test -- packages/shared/src/rules/character-rules.property.test.ts && bun run verify:changed`
- **Source:** docs/agent_notes/backlog/harness-research-followups-2026-06/01-property-based-testing-fast-check.md

#### `harness-research-followups-2026-06/02-design-token-lint` — DL-1 — Token-aware design lint (arbitrary Tailwind / raw hex)  _[M · ready]_
- **Do:** Author ONLY Phase 1: a local ESLint rule (template: eslint-rules/no-barrel.js) flagging arbitrary Tailwind bracket VALUES in className strings/cva calls (text-[..], w-[..], max-w-[..], min-h-[..], bg-[#..]) in packages/client/src. Explicitly allow arbitrary SELECTORS/properties that are not values (e.g. [appearance:textfield], [&::-webkit-inner-spin-button]:..). Give a teaching message naming the nearest @theme token / scale step. Add meta.docs principle+repairKind, keyed messages, a colocated *.test.js RuleTester with valid (token utilities, allowed arbitrary selectors) and invalid (arbitrary values) cases, and register in eslint-config/local-plugin.js scoped via eslint-config/client-configs.js. Land it as a no-new ratchet baseline at the current count — do NOT drain the ~84 findings and do NOT implement the raw-hex Phase 2 (both need scoping/judgment decisions and are separate follow-ups). Acceptance: rule + RuleTester committed and green, registered for client source, lint reports the existing arbitrary values against a frozen baseline.
- **Verify:** `bun run test -- eslint-rules/no-arbitrary-tailwind-value.test.js && bun run lint`
- **Source:** docs/agent_notes/backlog/harness-research-followups-2026-06/02-design-token-lint.md

#### `harness-review-tasks/10` — Fix character-live-state MODULE.md stale index.ts facade + document no-barrel facade convention  _[S · ready]_
- **Do:** In packages/server/src/services/character-live-state/MODULE.md, replace the stale 'Implementation Map' line 75 ('index.ts is the public facade only.') with the actual public surface: there is no index.ts; external routers import the per-operation files directly (rest.ts longRest/shortRest, spell-slot.ts, sorcery-point.ts, feature.ts useFeature, stats-conditions.ts), and state which files are the intended stable entry points. In packages/server/src/services/README.md add a short convention note that service-module facades are named, logic-bearing `<module>.ts` files (or per-operation files), not re-export-only `index.ts` barrels, and that the no-barrel rule still permits logic-bearing facades. Do NOT change any router imports. Acceptance: bun run module:index:check and bun run format:changed:check pass.
- **Verify:** `bun run module:index:check && bun run format:changed:check`
- **Source:** docs/agent_notes/backlog/harness-review-tasks/10-character-live-state-module-doc.md

#### `harness-review-tasks/53` — Add logs:audit --latest (graceful no-op when no compatible logs) with focused tests  _[M · ready]_
- **Do:** In scripts/logs-audit.ts add a --latest mode (or a logs:audit:latest package.json alias if clearer) that selects the newest compatible verify/hook log set. When no compatible logs exist, exit 0 with a single bounded hint naming the command that produces the logs (do NOT treat no-log as failure). Preserve hard non-zero failure for malformed logs that were explicitly selected by path. Add focused tests in scripts/logs-audit.test.ts covering: newest-log selection, no-log no-op (exit 0 + hint), malformed explicit input (fail), malformed latest input. Add one line in docs/ai-harness.md noting automation should use latest mode only after the no-log path is proven quiet. Do not wire it into Stop hooks or CI. Acceptance: bun run test -- scripts/logs-audit.test.ts passes.
- **Verify:** `bun run test -- scripts/logs-audit.test.ts`
- **Source:** docs/agent_notes/backlog/harness-review-tasks/53-logs-audit-latest-graceful-degrade.md

#### `harness-review-tasks/16` — Add guide-routing path advisories + lint-config tamper advisory + MODULE.md breadcrumbs  _[M · ready]_
- **Do:** Extend scripts/ai-hooks/protected-files.sh ai_protected_file_advisory with path advisories: packages/server/src/routers/** -> docs/guides/add-trpc-procedure.md; packages/server/src/socket/** -> docs/guides/add-socket-broadcast.md; packages/shared/src/rules/** -> docs/guides/change-rules-logic.md; e2e/** -> docs/guides/add-e2e-test.md; plus an advisory-only (non-blocking) tamper note for lint-ratchet.baseline.json, eslint.config.js, and suppression registers. Keep advisories throttled (reuse/add a throttle key via throttle-state.sh) so one session is not spammed. Add a one-line 'See: docs/guides/...' breadcrumb to the nearest MODULE.md for each surface (e.g. socket/MODULE.md). Add focused hook tests for each new advisory. Do not hard-block any edit. Acceptance: bash scripts/ai-hooks/test.sh and bun run module:index:check pass.
- **Verify:** `bash scripts/ai-hooks/test.sh && bun run module:index:check`
- **Source:** docs/agent_notes/backlog/harness-review-tasks/16-guide-breadcrumbs-and-advisories.md


---

## Tier 3 — docs / process (suitable, lower implementation weight)

#### `codebase-audit/05` — Per-worktree dev flow (worktree:* scripts, MUSI_DEV_DRIFT_GATE) auto-runs on `bun run dev` in secondary worktrees but has no human-facing doc  _[S · ready]_
- **Do:** Add a new human-facing guide `docs/guides/per-worktree-dev.md` explaining the per-worktree dev flow that auto-fires on the first `bun run dev` in a secondary git worktree. Cover exactly four things, sourcing prose from the authoritative script comments so it cannot drift: (1) what `bun run dev` does in a linked worktree (auto `worktree:init` provisions per-worktree DBs/ports/Redis index/.env), citing scripts/dev.sh:244-247; (2) a one-line reference for each of the seven `worktree:*` scripts (init/new/drop/gc/status/template-refresh/refresh-data) mirroring the scripts/worktree-db.sh header; (3) the `MUSI_DEV_DRIFT_GATE` warn|fail|off knob and when to use each, sourced from scripts/dev.sh:54-64; (4) the recovery path (`worktree:status` -> `worktree:refresh-data`). Do NOT modify scripts/dev.sh, scripts/worktree-db.sh, or package.json wiring. Add a short pointer to the new guide from README.md and from the AGENTS.md Commands section. If the guide needs a MODULE-INDEX entry, follow docs/guides/add-module-doc.md and update MODULE-INDEX.md so `bun run module:index:check` passes. Acceptance: guide exists with all four sections, README+AGENTS link it, and `bun run module:index:check` is green.
- **Verify:** `bun run module:index:check && rg -n 'per-worktree' README.md AGENTS.md docs/guides/`
- **Source:** docs/agent_notes/backlog/codebase-audit/05-worktree-dev-flow-undocumented-for-humans.md

#### `codebase-audit/20` — pages/ has no orientation doc for the page-as-composition-root pattern, despite 28 MODULE.md docs deeper in the tree  _[S · ready]_
- **Do:** Add `packages/client/src/pages/MODULE.md` in the established orientation-doc format (match an existing client MODULE.md). Document the page-as-composition-root pattern, answering: (1) the layering page/route -> thin `*-page.tsx` wrapper (entry query + loading/error) -> composition root (CharacterSheetContent, CampaignTabs); (2) the character-sheet four-file split — sheet-state.ts = data/mutation hooks via useSheetState, sheet-dialogs.tsx = dialog slots, sheet-sections.tsx = static sub-blocks, sheet-layout.tsx = the wiring — plus the `s.`/`d.` state-vs-dialog convention and the hook-call order seen in sheet-layout.tsx (~lines 108-130); (3) how to add a campaign tab (the campaign-detail-page.tsx + lib/campaign-tabs.ts pair: CampaignTab/isCampaignTab/DEFAULT_CAMPAIGN_TAB). Keep it orientation-only; link to hooks/character-sheet/MODULE.md rather than duplicating per-hook detail. Add a back-link from hooks/character-sheet/MODULE.md:11-12 so the existing handoff resolves. Do NOT refactor or rename any pages/ files. If MODULE-INDEX.md enumerates docs, add the new entry there. Acceptance: file exists with the three sections, the hooks MODULE.md cross-link resolves, and `bun run module:index:check` is green.
- **Verify:** `bun run module:index:check && test -f packages/client/src/pages/MODULE.md`
- **Source:** docs/agent_notes/backlog/codebase-audit/20-pages-dir-no-composition-root-doc.md

#### `harness-strictness-comprehension-2026-06/02-pr-comprehension-template` — Add Intent/Comprehension section to PR template  _[XS · ready]_
- **Do:** Edit /workspace/.github/pull_request_template.md to add an `## Intent / Comprehension` section as the FIRST section (before the existing `## Summary`), containing one line: `- I can explain why this change is needed and how the main code path works:`. Leave the existing Summary, Risk, Test Plan (including the `- [ ] \`bun run verify:changed\`` checkbox at line 12), and Migration/Socket/Auth Notes sections unchanged and in order. Do not weaken or remove the verify:changed checkbox. Acceptance: the new heading is present at the top, the verify:changed checkbox still exists, and the file remains valid markdown.
- **Verify:** `git diff --stat .github/pull_request_template.md`
- **Source:** docs/agent_notes/backlog/harness-strictness-comprehension-2026-06/02-pr-comprehension-template.md

#### `harness-review-tasks/14` — Rewrite tracked skill descriptions into capability + 'Use when ...' two-sentence grammar  _[S · ready]_
- **Do:** Reconfirm which SKILL.md files are git-tracked under .codex/skills and .claude/skills (currently ts-graph, playwright-cli in both, plus codex-cli in .claude). For each tracked skill, rewrite the frontmatter `description` to exactly two sentences: sentence 1 states the capability, sentence 2 begins with 'Use when ...' and gives concrete triggers. Keep .codex and .claude mirrors identical for the same skill. Do not edit skill bodies except to fix drift caused by the description change. Acceptance: bun run format:changed:check passes and git status shows only the intended tracked SKILL.md edits.
- **Verify:** `bun run format:changed:check && git status --short --ignored .claude/skills .codex/skills`
- **Source:** docs/agent_notes/backlog/harness-review-tasks/14-skill-use-when-trigger-grammar.md

#### `harness-review-tasks/51` — Add a thin spec/plan template (scope, acceptance, cross-package contract, discovery, verification)  _[S · partial]_
- **Do:** Add a compact thin-plan template (e.g. under docs/agent_notes/ or as a labelled block in docs/agent_notes/README.md, distinct from the existing handoff-note template at README.md:43-60) for non-trivial cross-package work, with sections: scope & non-goals; acceptance checks; shared/server/client contract impact; required discovery commands (rg, bun run code:intel); verification plan. Add a short 'skip this for trivial docs edits, single-file fixes, or a fully-specified existing leaf' note. Keep it short enough to copy whole. Docs-only; no hook enforcement. Acceptance: bun run format:changed:check passes.
- **Verify:** `bun run format:changed:check`
- **Source:** docs/agent_notes/backlog/harness-review-tasks/51-thin-spec-plan-template.md

---

## Deferred — real but NOT Codex-suitable (needs human / design / live verification)

These are still-valid leaves the reconciliation flagged `codexSuitable:false`. Keep
them for a supervised pass, not the autonomous run. Reason in parens.

- **`testsuite-audit/03`** — e2e re-drives full UI login per test instead of reusing Playwright storageState. _(Risky-defer: not a single-concern mechanical change. The leaf itself flags a refresh-token ROTATION hazard (auth.ts deletes the prior session + mints a new musi_refresh cookie on every boot refresh), so a single shared storageState breaks t)_
- **`testsuite-audit/04`** — e2e fullyParallel:false serializes independent userPage tests + redundant describe.serial. _(The edit is mechanical (drop one describe.serial -> describe; add test.describe.configure({mode:'parallel'}) to 4 top-level describes), but its acceptance criterion is explicitly 'verify on CI for flakiness under concurrency' — up to 4 conc)_
- **`testsuite-audit/09`** — 8 pure-node seed/parser server tests pay the full DB-setup tax for zero DB use. _(Requires designing a second vitest project (split include globs so each file runs in exactly one project, wire a no-setup/no-globalSetup `server-unit` project, keep coverage path-globs intact) — cross-cutting test-infra config judgment with)_
- **`testsuite-audit/10`** — BCRYPT_SALT_ROUNDS hardcoded at 12 makes real-auth-path tests pay ~150ms per hash. _(This is a PRODUCTION code change (config/auth.ts) gated on environment, with a sharp correctness trap: the dummy missing-user/timing-oracle hash shares the same const, and a naive nodeEnv==='test'?4:12 silently breaks the RUN_TIMING_TESTS l)_
- **`harness-research-followups-2026-06/03-golden-task-eval-harness`** — EV-1 — Codebase-grounded golden-task eval harness. _(Open-ended design work, not a single bounded concern. Requires selecting 5-10 fixtures from real project history (closed bugs / representative feature slices), authoring a reproducible starting repo state + task prompt per fixture, and cali)_
- **`harness-strictness-comprehension-2026-06/01-noPropertyAccessFromIndexSignature`** — Ratchet TypeScript strictness flag: noPropertyAccessFromIndexSignature. _(~710 diagnostics spanning all four projects. Correct repair is not purely mechanical: each site needs a judgment call between rewriting to bracket access vs. introducing a typed key union vs. promoting the field to an explicit property, and)_
- **`harness-review-tasks/15`** — Add a single golden-path reference-feature pointer. _(Requires editorial judgment to pick THE one canonical clean end-to-end slice that agents should copy, and a call on whether the pointer belongs in always-loaded AGENTS.md (doc-length sensitive) vs the guide. That is taste/curation, not a me)_
- **`harness-review-tasks/50`** — Audit lint rule / ratchet exemptions for now-self-correctable cases. _(This is an inventory/triage pass that requires judgment per suppression (is repair guidance now strong enough? is it entangled with unrelated lint debt? keep-deferred vs adopt vs split-a-leaf), and the output routes into the canonical lint )_
- **`harness-review-tasks/54`** — Green-output backpressure carve-out audit of hook/verify output. _(Classifying every success line as 'keep as backpressure' vs 'removable chatter' is a subtle judgment about agent feedback behavior with broad blast radius across hooks and verify scripts; wrongly removing a backpressure line causes silent r)_
- **`harness-review-tasks/25`** — Slow-lane mutation and timing add-ons (depends on the now-shipped lane). _(Extends a CI workflow with optional timing capture + mutation-test signal, report-only — design-heavy: needs decisions on timeouts, artifact bounding, whether a stable mutation command exists, and trend-vs-verdict rendering, all verified by)_
- **`archgate-adr-plan`** — Archgate ADR plan: add docs/adr/ layer + adr:check sensor. _(Even the scoped pilot (line 290) touches lint-rule message conventions, a new deterministic checker with its own test, harness-map registration, and source-note retirement with repo-wide reference sweeps. Cross-cutting docs/governance desig)_
- **`ux-audit-2026-06-p0/04-dev-db-fixture-cleanup`** — Reseed the dev DB once audit repro fixtures are no longer needed. _(Not a codebase task: no source edit, no test, no version-controlled artifact to produce. It is a manual local-DB reseed + live-app smoke check requiring a running Postgres and browser session that an autonomous Codex run cannot perform or v)_

## Left parked (unchanged this pass)

Still-active follow-up notes (correctly `risky-defer`/`partial`, not done): the
AI-harness queues (`ai-harness-followups`, `ai-harness-prioritized-backlog`),
`code-intel-followups`, `concurrency-guard-followups`, `cache-budget-followups`,
`slow-test-tier-candidates`, `vtt-drawer-followups`,
`followup-srd-castertype-issues`, `semgrep-drift-sensor-research`. Major
dependency-upgrade plans (`typescript-6`, `fastify-multipart-10`,
`eslint-plugin-jsdoc-63`, `node-types-25`) and watchdog-gated removals
(`fast-uri-override-removal`, `eslint-react-peer-exception-removal`,
`dependency-age-gated-followups`) stay parked — too risky / trigger-driven for an
autonomous run. Large workstreams (`production-readiness`, `polish-and-mobile`,
`phase-7c-2-character-level-homebrew`) remain in the backlog. See
`../backlog/README.md`.

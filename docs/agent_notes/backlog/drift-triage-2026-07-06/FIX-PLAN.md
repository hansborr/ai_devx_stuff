# drift-triage-2026-07-06 — Fix/No-Fix Plan (workflow-ready)

**Status:** review complete 2026-07-06; fixes NOT started.
**Inputs:** `AUDIT.md` + `confirmed-findings.json` (118 confirmed findings).
**Review method:** independent spot-check of 7 load-bearing claims (all confirmed) + codex
second-opinion consult (session `019f3a85-6dd5-7922-84be-a54515ff954e`, worktree-clean trailer).
Codex agreed with all 12 draft verdicts; its refinements are folded in below and marked (codex).

## Verdict summary

| # | AUDIT.md recommended action | Verdict |
|---|---|---|
| 1 | knip-runner include-categories fix + knip.config fixes + re-run | **FIX FIRST** (gates all knip-backed findings) |
| 2 | Import `ParsedSpell`/`ParsedGlossaryEntry` in seed files | **FIX** |
| 3 | Shared git-log args builder + restore `--no-renames` | **FIX** (behavioral bugfix — invariant already violated) |
| 4 | Concurrency-guard triple drift-guard test | **FIX** — drift-guard test only, not forced runtime sharing (codex) |
| 5 | Harness consolidation pass | **FIX** as one lane; use leaf constant/helper modules to avoid import cycles (codex) |
| 6 | max-lines-policy decision | **FIX**: extend validation to cover `.exceptions` (production's actual input); don't delete |
| 7 | Shared-contract constants pass | **FIX**, value-preserving (see hazards) |
| 8 | Server error/authz string constants | **FIX**, narrowed: domain-local constants beside the auth helpers, no global error-string module (codex) |
| 9 | `requireArg` + db-status + two type dedups | **FIX**; generalize the existing `requireArg` rather than inventing a new helper (codex) |
| 10 | Batched hygiene commit | **FIX LAST**, gated on the corrected knip re-run from #1 |
| 11 | Product refactor queue | **DEFER** — as-touched backlog, not standalone lanes |
| 12 | agent-cli harness consolidation decision | **DEFER to maintainer** — judgment call, not automatable |

### Rejected as standalone fixes (keep as as-touched notes)

- `NarrowServiceContext` 3-way merge (`character-live-state/types.ts:4` et al.) — real duplication, but merging hides domain semantics; touch only when a service is already being edited (codex, P1).
- Documented-convention/test-literal clusters: tRPC route strings in tests, HTTP-status literals in tests, Tailwind class clusters, character-live-state command preamble — AUDIT.md already scoped these as leave-alone/batch-later; confirmed.
- Exception: tiny type-import-only fixes (`AdjustHpInput` → import `AdjustHpPayload`, `SpellLevelBlockProps` share) may ride any nearby lane but get no lane of their own (codex).

### Owner decisions (resolved 2026-07-06)

- `MAX_DESCRIPTION_LENGTH`: **unify to 10_000 everywhere** (campaign, encounter,
  homebrew incl. `HOMEBREW_MAX_DESCRIPTION_LENGTH`, npc, inventory). Lane C is
  sanctioned to change these description-cap values — the forgiving direction;
  update any tests asserting the 5000 caps. The value-preservation hazard still
  applies to everything else (`MAX_PAGE_SIZE`, `MAX_SEARCH_LENGTH`, error
  strings): no other runtime values change.
- Item 12: **keep iterating `agent-run.sh` live** through the fix pass; the
  consolidation pass is specced in
  `docs/agent_notes/backlog/agent-cli-consolidation-pass/00-index.md`
  (converted from a single note to a task pack 2026-07-07; the lane-dispatch
  wrapper incidents were appended there — they are its spec inputs).
- Re-triage of capped chunks + failed `chunk:020`: **not now** — owner will
  re-run periodically; next sweep comes after the current workflow finishes.

## Hazards (bake into every lane prompt)

- **[P0] Value preservation.** `MAX_PAGE_SIZE=50` (notifications), `MAX_SEARCH_LENGTH=200` (npc/note), the description caps, and every error string are live Zod limits / API behavior / test-asserted text. Centralize *names*, never change *values or emitted strings*. logs-audit matches authz strings exactly (`scripts/logs-audit/logs-audit-event-fields.ts`).
- **[P0] Stale knip data.** The hygiene lane must consume the corrected knip re-run, not AUDIT.md's pre-fix unused-export list — the include-category bug distorted it (7/10 sampled orphans were false positives).
- **[P1] NOT_FOUND masking semantics** are explicit policy (`docs/authorization.md`); constants must preserve the intentional mismatch messages.
- **[P1] Import cycles.** Harness consolidation adds shared constants between validators and generators — put them in leaf modules.

## Lane plan (dynamic workflow)

Sequential spine: **Lane 0 → corrected knip re-run/triage → parallel lanes → Lane H last.**
Each parallel lane = one worktree (detached at the post-Lane-0 base), dispatched via
`agent-run.sh work codex --branch fix/drift-<lane> --require-feature-branch`, one commit per item.
Provision worktrees per `docs/guides/per-worktree-dev.md` before DB-touching gates.

| Lane | Scope (AUDIT.md refs) | Files (collision domain) |
|---|---|---|
| **0 (first, sequential)** | #1: add `unlisted`/`dependencies` to every `INCLUDE_CATEGORIES_BY_SELECTION` value (or otherwise preserve vitest-plugin entries); knip.config root entry globs for `scripts/{lint-ratchet,path-policy}/*.ts`; `"types"` in `__type-tests__` ignoreIssues. Then re-run orphan-files/unused-exports (incl. capped chunk:034) and write the corrected list beside this file. | `scripts/drift-ai/knip-runner.ts`, `knip.config.ts` |
| **A** | #2: seed type imports (delete `SpellJson`, `GlossaryItem`) | `packages/server/src/seed/**` |
| **B** | #3: `GIT_LOG_BASE_ARGS` builder + restore `--no-renames` in `hotspots-suppression-churn.ts` | `scripts/drift-ai/hotspots-*.ts` |
| **C** | #7: shared-contract constants — `MAX_PAGE_SIZE`/`MAX_SEARCH_LENGTH` into `constants.ts` as named per-domain constants (values unchanged); **description caps unified to `MAX_DESCRIPTION_LENGTH = 10_000`** (owner ruling above — the one sanctioned value change; update tests asserting 5000); import `DAMAGE_TYPES` from shared in both forks; `WeaponName` union keying both SRD weapon tables | `packages/shared/src/schemas/**`, `packages/shared/src/rules/**`, the two DAMAGE_TYPES fork files |
| **D** | #8 (narrowed): per-domain message constants beside `campaign-auth.ts` (Campaign/Encounter/Collection/Participant not found, turn message); literal-typed authz event/reason vocabulary; typed `script-logger` event union — **without** mass-rewriting seed `script.progress` callsites (conflicts with Lane A; leave callsite migration as-touched) | `packages/server/src/utils/**`, auth helpers, routers touching those messages |
| **E** | #4: drift-guard test eslint-rules ⇄ codemods ⇄ prisma-types (copy `no-redundant-central-mock` pattern) | `eslint-rules/`, `scripts/codemods/concurrency-guard/`, one new test |
| **F** | #5: harness consolidation — `HARNESS_MANIFEST_FILENAME` + `loadHarnessManifest()`; harness-check imports generator output-path constants; path-policy imports `DEBT_LOG_FILENAME`/`DEFAULT_ALLOWLIST_PATH`/hook paths/`BASELINE_FILENAME`; single `HARNESS_DIAGNOSTICS_OUTPUT_ENV` home; unify 4-file control-field validation. Leaf modules (upstream merge 979b87f0 added `scripts/harness/hook-timeout-constants.ts` — follow that pattern; AUDIT.md's harness-check line refs predate the merge and may be offset); run `bun run harness:check` | `scripts/harness*/**`, `scripts/path-policy/**`, `scripts/lint-ratchet/lint-ratchet-output.ts` |
| **G** | #6 + #9: validate `maxLinesPolicy.exceptions` on the consumed path; shared `requireArg` (generalize `scripts/code-intel/cli-options.ts:46`, 11 sites); db-status imports `DEFAULT_TEST_DATABASE_NAME`; dedup `ApplyLintRatchetUpdateOptions`/`DecideUpdateOptions` and `ResolvedCloneCandidateConfig`/`ResolvedCompareConfig`; hoist `commonRatchetIgnores` | `scripts/lint-ratchet/**`, `scripts/code-intel/**`, script CLI entry points, `eslint-config/shared-policy.js` |
| **H (last, sequential)** | #10 gated on Lane 0's re-run: drift-ai stray exports/dead barrels, `DAY_MS`, `BANNER`, `parseWindowDays`, delete `mock-zustand-stores.ts` + `setMockTRPCModule` + dead `isStepApplicable` re-export, layer-direction allowlist edge, optional type-only import-cycle leaf fixes | broad `scripts/drift-ai/**` + client test utils — collides with B and G, hence last |

Collision notes (codex D): A∥B∥C∥D∥E∥F∥G are pairwise safe as scoped above; G and F both touch `scripts/lint-ratchet/` — keep G's ratchet files (`max-lines-policy`, `lint-ratchet-config`, `baseline-update-apply`) disjoint from F's (`lint-ratchet-output.ts` only), or merge F+G into one lane if the orchestrator prefers zero risk. H runs alone at the end.

Verification: fast-commit mode is appropriate for multi-commit lanes; run `bun run verify` once on the post-Lane-0 base before fan-out, land lanes with `bash scripts/land.sh`.

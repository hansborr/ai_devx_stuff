# Sources and Verdicts — explore-fixes-2026-07b

## Method

Built 2026-07-03, the same day the first `../explore-fixes-2026-07/` pack
landed, via a second dual-model pass aimed at angles that pack did not
cover:

1. **Codex investigation** (read-only, resumable session): fresh-angle
   sweep with the first pack's kill list, the harness-review-2026-07
   rejected record, the codex drain queue, and all tracked backlog docs
   excluded up front. Produced 6 cited candidates.
2. **Three independent Claude sweeps** (read-only): docs-drift audit of
   all 18 `docs/guides/*` + top-level docs (the first pack only
   spot-checked MODULE.md files), config/shell cross-consistency audit
   (harness manifest ↔ generated steps ↔ CI, knip/playwright/vitest/
   stryker/commitlint/tsconfig, shell traps and atomic-write hygiene),
   and a product-code defect sweep (auth semantics, concurrency-helper
   coverage, broadcast ordering, client cache layer) with rule ideas
   explicitly out of scope.
3. **Codex adversarial triage** (same session resumed): merged 14-item
   pool, every citation re-read at HEAD, tensions between the passes
   resolved, keep/kill with final size/priority.
4. **Orchestrator spot-checks**: every load-bearing keeper claim
   re-verified directly (CI step, commitlint scope rules, cancelQueries
   absence, campaign broadcast sites, worktree mktemp/mv, coverage-map
   guide claim) before pack authoring.

Every keeper's citation was re-verified at HEAD on 2026-07-03 by at least
two of the four passes. Line numbers drift — re-verify seams before
implementing.

## Resolved tensions (where the passes disagreed)

- **Coverage-map audit gap (leaf 10):** Codex called it a one-line CI
  drift; the config sweep found `scripts/harness-check.ts:71-75`
  documenting the tiering as intentional. Resolution: the harness-check
  rationale only justifies *pre-commit* skipping the audit — it says full
  `verify`/`verify:parallel` run it, and `docs/guides/lint-ratchet.md:282`
  says CI should too. CI running plain `:check` is the one surface that
  contradicts the documented design. Keep as a CI-only fix; do NOT wire
  the audit into `verify:changed` (staged `:check` is intentional) and do
  NOT touch the guide (it is correct).
- **RawTxClient citation line (leaf 70):** Codex said
  `eslint-config/package-boundary-configs.js:252`, the docs sweep said
  `:274`. Both verified true: the policy comment block starts at `:252`,
  the `importNames: ["RawTxClient"]` enforcement is at `:274`. The guide
  fix should cite the module (and rule), not a bare line number.
- **commitlint scope (leaf 12):** enforce the scope rather than soften
  `AGENTS.md` — recent history is consistently scoped and the documented
  workflow already treats `(scope)` as mandatory.

## Killed candidates (do not re-propose without new evidence)

| Candidate | Verdict rationale |
|---|---|
| `docs/agent_notes/README.md` folder map omits `harness-engineering-research/` + `harness-review-2026-05/` | Confirmed, but the map is explicitly illustrative orientation; archived research dirs missing from it is not backlog-worthy. |
| `map.update` emits no socket event | Confirmed at `routers/map.ts:79-110`, but the event surface has no `map:*` metadata event at all (`socket-events.ts:71-86`) and `docs/socket-architecture.md` enumerates only token/layer events — adding one is a schema+server+client product decision, not a one-commit leaf. Decision-tier; revisit only if live map-metadata sync becomes a product requirement. |
| Archival cleanup of stale `eslint.config.js` RawTxClient mentions in old backlog/finished notes | Historical records are allowed to be historical; leaf 70 fixes only the two live guides. |

## Verified-clean this pass (don't re-hunt; complements the first pack's list)

- **All 18 `docs/guides/*`**: every `bun run` command resolves to a real
  script and every cited path exists — the only drift found is leaves
  70/71/72. `README.md`, `CONTEXT.md`, `DESIGN.md`, `MODULE-INDEX.md`
  (47 entries == 47 files), `docs/ai-harness.md`, `architecture-plan.md`,
  `authorization.md` (all four auth helpers exist), `socket-architecture.md`,
  `docs/CONCURRENCY.md` line citations: all accurate.
- **Harness manifest reconciliation**: `harness.controls.json` ↔
  `steps.generated.sh` ↔ CI fully aligned via `harness:check`; every
  intentional divergence enumerated with rationale in `EXEMPT_SCRIPTS`.
  Leaf 10 is the single exception found.
- **Configs**: knip entries/projects all resolve; playwright setup
  project real; all vitest project configs + slow config resolve; both
  stryker configs consistent; drift-ai config a documented subset of the
  example with all ghost-file pairs present; tsconfig.configs.json's 12
  includes exist; commitlint numbers (subject≥20, body≥40, leading
  blank) match AGENTS.md except the scope gap (leaf 12).
- **Shell hygiene**: verify.sh / verify-async.sh / parallel-runner.sh /
  land.sh / slow-drift / migration-safety-scan / husky hooks all have
  correct traps, mktemp cleanup, atomic same-dir writes (the two
  exceptions are leaves 11 and 14), and POSIX-safe sourcing.
- **package.json wiring**: all 55 `scripts/…` references resolve; no
  orphaned scripts.
- **eslint-config/rules registration**: all 23 rules registered AND
  enabled; registry meta-test enforces no dead rule; scoping partitions
  verified.
- **Server product code**: auth NOT_FOUND/FORBIDDEN semantics match
  `docs/authorization.md` across routers; every race-sensitive write goes
  through the documented Pattern A/B/C helpers with lock order respected;
  no emit inside `$transaction` — broadcast-after-commit holds everywhere
  checked; `affectedCharacterIds` fan-out correct; whisper routing
  correct; shared rules math (HP/conditions/turns/sorcery/metamagic)
  verified; Zod bounds backed by server enforcement (hpRolled, token
  bounds, ASI, CAS version); encounter visibility redaction correct.
- **Client**: `use-notifications.ts` optimistic pattern fully correct
  (it is the reference for leaf 50); sampled socket-listener cleanup and
  tRPC-derived query keys clean.
- **Flaky-test log**: fully reconciled (entries closed or documented
  wait-for-recurrence). Ratchet debt-log tail: all intentional lifecycle
  retirements. Root artifacts all git-ignored. e2e health: nothing
  outside tracked testsuite-audit leaves.

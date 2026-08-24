# Ownership closure — Code Quality Audit 2026-08-01 (Phase 1)

Status: Working state — not a schedulable note

Matrix-closure record required by the phase plan: every top-level directory
and root file from `git ls-files` at pin `ebf096580` assigned to a lane or
explicitly excluded, before wave-1 dispatch. The lane ownership matrix in
`ORCHESTRATION.md` is the authority; this file records how every actual path
maps onto it, plus the dispatcher rulings for paths the matrix did not name.

Cross-cutting overrides (apply everywhere, restated from the matrix):
`*.test.*` / `*.spec.*` / `*.test-helper.*` files and shared fixtures →
lane 06, wherever they live. Docs-drift findings → lane 07. Cross-package
patterns and all `feature` findings → lane 08. Lane 08 has no exclusive
paths; it reads across other lanes' areas.

## Top-level directories

| Path | Lane | Basis |
|---|---|---|
| `packages/shared/` | 04 (tests → 06) | matrix row 04 |
| `packages/server/` | 03 (tests → 06; `src/generated/` excluded) | matrix row 03 |
| `packages/client/` | 05 (tests → 06) | matrix row 05 |
| `scripts/` | see [scripts/ split](#scripts-split) | matrix rows 01/02/06/09 + default rule |
| `docs/` | 07 (see exclusions for `agent_notes` pack contents + SRD PDF) | matrix row 07 |
| `e2e/` | 06 | matrix row 06 |
| `eslint-rules/` | 09 | matrix row 09 |
| `eslint-config/` | 09 (incl. `max-lines-exceptions.baseline.json`) | matrix row 09 |
| `tools/` | 09 (`lint-ratchet/` + `stryker-lint-ratchet.mjs` — the whole dir today) | matrix row 09 |
| `examples/` | 09 (`lint-ratchet-demo/` — the whole dir today) | matrix row 09 |
| `.claude/`, `.codex/`, `.copilot/`, `.cursor/`, `.playwright/` | 01 | matrix row 01 "agent adapter trees … and siblings"; ruling R1 |
| `.husky/` | 01 | matrix row 01 |
| `.github/` | 01 (`workflows/`, `hooks/`) | matrix row 01 |
| `.devcontainer/` | 07 | matrix row 07 |

## scripts/ split {#scripts-split}

Second-level enumeration of `scripts/` against the matrix:

- **Lane 02:** `drift-ai/`, `drift-triage/`, `logs-audit/`, `code-intel/`,
  plus flat entry points `code-intel.ts`, `code-intel-server.ts`,
  `drift-ai.ts`, `drift-triage.ts`, `logs-audit.ts` (ruling R2: flat CLI
  entries of analyzer dirs belong with their analyzer, not lane 01).
- **Lane 06:** `tests/` (shell-smoke substrate), `scripts/vitest.config.ts`,
  `test-support/`, `fixtures/` (shared test fixtures; ruling R3), and every
  `*.test.ts` flat file in `scripts/` per the tests-override.
- **Lane 09:** `lint-ratchet/`, `lint-message-eval/`, `path-policy/`,
  `codemods/` (fixtures sampled), plus flat entries `lint-ratchet.ts`,
  `lint-ratchet.sh`, `lint-message-eval.ts` (ruling R4: entry shims of
  lane-09 dirs go with lane 09).
- **Lane 01:** everything else under `scripts/` — the flat top-level
  facades and families (`doctor.sh`, `worktree-*`, `sensor-*`,
  `suppression-*`, `lint-*.sh` gate wrappers, `lint-agent*`,
  `lint-coverage-map-*`, `max-lines-*`, `baseline-merge-cli*`,
  `backlog-lint*`, `adr-check*`, `harness-*`, `verify*`, `land.sh`,
  `dev.sh`, `db-status.ts`, seed/db utilities, `stryker-scripts.mjs`,
  `mutation-survivors.ts`, `benchmark-near-duplicates*`,
  `client-test-isolation-*`, `vitest-worker-count.ts`, `cli-option-values.ts`,
  `process-tree.sh`, `README.md`, …) and subdirs `lib/`, `git/`, `harness/`,
  `verify/`, `ai-hooks/`, `drift/`, `harness-audit/`, `data/` — per matrix
  row 01 and the default rule. Ruling R5: the lint-adjacent flat files that
  are *gate plumbing* (`lint-changed.sh`, `lint-agent*`,
  `lint-coverage-map-*`, `max-lines-*`, `eslint-config-shared-policy*`,
  `check-local-eslint-rule-starter*`, `lint-probe-rule.ts`,
  `generate-lint-guidance.ts`) stay lane 01 (default rule); lane 09 gets a
  pointer expectation, not ownership — findings about the *rule/ratchet
  machinery itself* still belong to 09 wherever evidence lives.

## Root files

| Path(s) | Lane | Basis |
|---|---|---|
| `harness.controls.json`, `commitlint.config.js`, `bunfig.toml`, `.gitignore`, `.gitattributes`, `.worktreeinclude`, `.yamllint.yml`, `.prettierrc`, `.prettierignore`, `.blob-size-allowlist`, `suppression-ledger.json`, `sensor-near-duplicates.baseline.json`, `sensor-knip-unused-exports.baseline.json`, `.env.example` | 01 | matrix row 01 + default rule (root harness/config); ruling R6 keeps `.env.example` with gate/env plumbing (01), while per-worktree dev DX *docs* stay 07 |
| `drift-ai.config.json`, `drift-ai.config.example.json`, `semgrep-rules.example.json` | 02 | matrix row 02; ruling R7 adds `semgrep-rules.example.json` (drift-ai rule-source example) |
| `vitest.config.ts`, `vitest.slow.config.ts`, `playwright.config.ts`, `stryker.config.mjs`, `stryker.config.server.mjs`, `stryker.shared.mjs` | 06 | matrix row 06 (vitest/playwright/Stryker configs); ruling R8 reads "package-level Stryker configs" to include these root-level ones |
| `tsconfig.json`, `tsconfig.base.json`, `tsconfig.scripts.json`, `tsconfig.e2e.json`, `tsconfig.configs.json`, `tsconfig.eslint-js.json`, `knip.config.ts`, `package.json` (script surface as UX), `AGENTS.md`, `CLAUDE.md`, `README.md`, `MODULE-INDEX.md`, `DESIGN.md`, `CONTEXT.md`, `docker-compose.yml`, `init-test-db.sql` | 07 | matrix row 07; ruling R9 assigns `MODULE-INDEX.md` (module-doc coverage), `DESIGN.md`, `CONTEXT.md` (top-level orientation docs) to 07 |
| `eslint.config.js`, `lint-ratchet.baseline.json`, `lint-ratchet.debt-log.jsonl` | 09 | matrix row 09; ruling R10 adds root `eslint.config.js` (lint machinery config) and the debt log (baseline sibling) |

## Excluded (recorded as skipped in AUDIT-SUMMARY, not clean)

- `packages/server/src/generated/` — generated Prisma client (plan).
- `bun.lock` — lockfile (plan: build artifacts and lockfiles).
- `LICENSE`, `NOTICE.md`, `docs/SRD_CC_v5.2.1.pdf` — legal text and SRD
  source document; SRD *content* correctness is out of scope (ruling R11;
  how SRD data is *structured* in code remains in scope for lanes 03/04).
- Contents of `docs/agent_notes/` packs — pack *structure* is lane 07's;
  pack contents are records, not audit subjects (plan).
- Drift packet outputs — gitignored, not in `git ls-files`.

## Closure check

Every top-level entry of `git ls-files | cut -d/ -f1 | sort -u` at the pin
appears above (directly or via its directory row). Enumerated 2026-08-01 by
the dispatcher; second-level enumeration done for `packages/`, `scripts/`,
`tools/`, `examples/`, `docs/`. No unassigned paths remain.

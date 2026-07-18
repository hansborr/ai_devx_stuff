# AI/Human DX, copied from a real project

This is a reference mirror of the developer-experience and agent-harness
scaffolding used in a TypeScript/Bun monorepo (a D&D 5e virtual tabletop
called *Musi*). It exists so the patterns are easy to read and borrow without
access to the product repo: the guides, sensors, agent hooks, git hooks,
custom lint rules, codemods, lint ratchet, and the scripts that wire them
into one feedback loop.

It is **not** intended to run as a product. The application code is gutted —
`packages/**` keeps ~18 stub files (out of ~1300 upstream) purely so the
lint/code-intel tooling has a symbol surface — and the bash wires up
upstream-specific paths (`/workspace`, `bun run --filter @musi/server ...`).
Treat it as a catalog of techniques, not a starter template: copy the
relevant scripts and configs into your project and adapt the paths, package
manager, and registry entries.

Licensed under [MIT](LICENSE).

## Start here

| Entry point | What it gives you |
| --- | --- |
| [`docs/harness-tour.md`](docs/harness-tour.md) | A 15-minute open-run-observe tour: the harness manifest check, the lint-ratchet lifecycle demo, and the shared-hook-body/thin-adapter comparison. |
| [`docs/ai-harness.md`](docs/ai-harness.md) | The authoritative inventory and gap map of the whole harness — every guide and every sensor, with timing, mode, pairings, and the promotion rule ("every new control ships a guide, a sensor, and repair text together"). |
| [`docs/README.md`](docs/README.md) | The docs index, grouped by topic. |
| [`harness.controls.json`](harness.controls.json) + [`docs/generated/`](docs/generated/) | The machine-checked manifest of hook wiring, verify slots, skills, and docs, plus the generated references projected from it. |

What actually runs in this clone, after `bun install` (no database, Redis, or
env setup):

- `bun run harness:check` — validates the manifest against the live tree.
  It exits non-zero with exactly two expected drift lines: the local-only
  `sync-from-upstream` skill (its `.claude/skills/` and `.codex/skills/`
  copies) is not in the mirrored manifest. Anything else is real drift.
- `examples/lint-ratchet-demo` — a self-contained ratchet demo; `bun run
  smoke` inside it exercises a green baseline, a blocked regression, an
  accepted increase, and a locked-in improvement in a temp repo.
- `bun run test:eslint-rules` — the `RuleTester` unit tests pass; a handful
  of config-integration tests fail against the gutted `packages/**` tree,
  which is expected.

Everything that needs the app code, a database, or e2e infrastructure will
not run: `dev`, `db:*`, e2e, `verify`, the pre-commit gate, worktree
provisioning.

## The headline ideas

**Wrap noisy verification at the agent-hook layer, not in the scripts.**
`.claude/hooks/bun-run-quiet.sh` intercepts whitelisted `bun run` commands:
on success it replaces hundreds of lines of test output with a one-liner
pointing at the full log; on failure it returns the last ~40 lines through a
noise-stripping filter. Raw logs stay intact for humans; context windows stay
clean for agents.

**Single-writer locks and content-keyed caching across the whole
verification surface.** Pre-commit, manual `verify`, and the agent hooks
share one `flock`, so two agents (or an agent and a commit) queue instead of
corrupting each other. A worktree fingerprint (`HEAD + tracked diff +
untracked hashes`) short-circuits re-runs on an unchanged tree — "cached OK"
replays in milliseconds. Time-based caches can lie; content-keyed markers
can't.

**Every policy block ships a repair string.** `scripts/ai-hooks/policy.sh`
denies bypass envs (`HUSKY=0`), direct `psql` / `redis-cli` / `docker`,
destructive git history rewrites, force pushes, pushes to `main`, and `gh`
mutations — and every denial echoes a one-line "do this instead", so the
agent has a repair path rather than a dead end.

**Shared hook bodies, thin per-tool adapters.** The behavior lives once in
`scripts/ai-hooks/`; `.claude/hooks/`, `.codex/hooks/`, and
`.copilot/hooks/` are shims that translate each tool's payload and response
shape. Same idea for guidance: shared brief in `AGENTS.md`, tool adapters in
`CLAUDE.md` / `.codex/` / skills. `scripts/ai-hooks/README.md` documents the
shim contract.

**A lint ratchet that freezes debt symmetrically.** `tools/lint-ratchet`
pins per-file finding counts in `lint-ratchet.baseline.json`; new debt *and*
unrecorded cleanup both fail until the committed baseline explains the
change, and `lint-ratchet.debt-log.jsonl` keeps the accounting. Merge
drivers keep baselines mergeable. Guides: `docs/guides/lint-ratchet.md` and
siblings (`-adoption`, `-merges`, `-reference`); standalone demo:
`examples/lint-ratchet-demo/`.

**Custom ESLint rules with unit tests, paired with codemods.**
`eslint-rules/` holds hand-rolled rules (tRPC input/output schema
enforcement, socket broadcast registry, concurrency guards, barrel bans,
structured logging, type-assertion boundaries, ...), each with a
`RuleTester` test. When a lint says "no", a codemod in `scripts/codemods/`
fixes it, and the lint message names it — one-shot repair instead of guessed
rewrites. `eslint-config/` splits the flat config into reviewable surfaces
with a manifest check.

**Code intel instead of `rg` archaeology.** `bun run code:intel`
(`scripts/code-intel/`) answers definitions, exports, dependents, symbol
refs, router overviews, and covering-tests deterministically over the
TypeScript project graph, with an optional warm daemon. Usage guide:
`docs/guides/code-intel.md`; per-tool front doors in `.claude/skills/` and
`.codex/skills/`.

**Inventory the harness in one machine-checked place.**
`harness.controls.json` is the manifest; generators project it into
`docs/generated/`, and `bun run harness:check` fails when wiring or docs
drift from the live tree. Without a map, the same check gets implemented
twice in subtly different places.

**Per-worktree dev environments.** `scripts/worktree-db.sh` gives every
secondary git worktree its own database, ports, and Redis index on first
`bun run dev`, so parallel agent lanes don't trip over shared infra.

**Docs with budgets.** `scripts/doc-length-policy.sh` caps the always-loaded
docs (`AGENTS.md`, `CLAUDE.md`, agent notes) and the hooks nudge when they
bloat — feedforward context stays scannable because something checks.

## Map of the tree

### Agent guidance and context

- `AGENTS.md` / `CLAUDE.md` — **local to this clone**: orientation for
  agents working *here*. Upstream's real always-loaded brief is preserved at
  `docs/upstream-AGENTS.md` as an example of the pattern (shared brief in
  `AGENTS.md`, thin `@AGENTS.md` include in `CLAUDE.md`).
- `docs/guides/` — 22 task recipes paired with sensors: adding tRPC
  procedures, socket broadcasts, Prisma migrations, race-sensitive
  mutations, client modules/effects, auth sessions, e2e tests, module docs,
  rules logic; the lint surface (`lint-overview`, `local-eslint-rules`, the
  four-part lint-ratchet family, `biome-lint-adoption`, `lint-message-evals`,
  `coverage-cadence`); plus `code-intel`, `verify-gate-lifecycle`, and
  `per-worktree-dev`.
- `docs/agent_notes/` — the persistent-context system: curated `LOG.md`,
  ADR-lite `DECISIONS.md` plus per-topic `decisions-*.md`, and `backlog/` /
  `in_progress/` / `finished_work/` packs, format-checked by
  `scripts/backlog-lint*` through a hook.
- `docs/module-docs.md` + `MODULE-INDEX.md` — the per-directory `MODULE.md`
  orientation-file convention and its generated index
  (`scripts/generate-module-index.sh`).
- Product and meta docs (`architecture-plan`, `authorization`,
  `socket-architecture`, `CONCURRENCY`, SRD sources, `docs/roadmap/`,
  `design-direction`, `public-release-notes`) are mirrored for context; they
  describe Musi, not the reusable pattern.

### Agent hooks

- `scripts/ai-hooks/` — the shared bodies: JSON hook IO, the policy surface,
  fingerprint/cache markers, commit-output parsing, output filtering,
  read-only Stop-hook checks, and a bash test harness. Start at its
  `README.md`.
- `.claude/` — Claude Code adapters: `settings.json` hook registrations,
  14 hooks (quiet wrappers for `bun run` and `git commit`, DB-access and
  protected-file guards, Prisma-client refresh, doc-length and
  ratchet-regression advisories, session state, Stop reminders), the
  `cadence` output style, `statusline.sh`, and skills (`agent-cli`,
  `playwright-cli`, `ts-graph`, `sync-from-upstream`).
- `.codex/` and `.copilot/` — the same behaviors through each tool's hook
  shape (Codex needs a two-phase pre/post dance where Claude's PreToolUse
  rewrites in one call; Copilot translates yet another payload shape, and
  its registration lives at `.github/hooks/copilot.json`).

### Git hooks and verification

- `.husky/` — `pre-commit` runs the generated slot set in parallel under the
  shared `flock`, with a content-keyed last-verified short-circuit, a
  watchdog, and structured `Passed:`/`Failed:` output the Claude
  commit wrapper parses. `commit-msg` enforces conventional commits
  (subject ≥ 20 chars, body ≥ 40). `post-checkout`/`post-merge` nudge on
  worktree DB drift; `pre-push` and `scripts/land.sh` guard integration
  (land runs the full sequential verify, then `merge --no-ff`).
- `scripts/verify.sh` + `scripts/verify/steps.generated.sh` — the manual
  sibling of pre-commit, same lock and log dir; `verify-async.sh` runs long
  confidence checks detached with status/tail/stop; `verify-logs.sh` and
  `verify-history.sh` inspect cached logs and past runs.
- `scripts/test-slow.sh` + `vitest.slow.config.ts` — an explicit slow-test
  tier for `*.slow.test.*`, kept out of default gates.

### Lint system

- `eslint.config.js` + `eslint-config/` — flat config split into surfaces
  (base, client, package boundaries, script, test, tools) with
  `strictTypeChecked`, a global `complexity: 10`, and a config-surface
  manifest check.
- `eslint-rules/` — the local rules plus tests; `docs/guides/lint-overview.md`
  and `docs/guides/local-eslint-rules.md` are the catalog.
- `tools/lint-ratchet` + `lint-ratchet.baseline.json` +
  `lint-ratchet.debt-log.jsonl` — the ratchet engine, baseline, and debt
  accounting; `lint:ratchet:*` scripts cover check/update/report/trend and
  merge-driver install.
- `scripts/lint-agent*.ts` — agent-facing lint envelopes: structured
  findings with per-rule fix text and guidance
  (`scripts/generate-lint-guidance.ts`).
- `scripts/lint-message-eval*` — an eval harness for lint-message quality,
  so rule text improves with evidence (guide:
  `docs/guides/lint-message-evals.md`).
- `scripts/lint-coverage-map-check*.ts` — keeps
  `docs/generated/lint-coverage-map.md` in step with the live rule surface,
  run from a Claude hook.
- `scripts/codemods/` — the paired repairs (`trpc-shared-input/-output`,
  `structured-logging-fix`, `concurrency-guard`, `expand-barrel`) with
  `--check`/`--all` modes, fixtures, and tests.

### Sensors and audits

- `scripts/doctor.sh` — one-shot environment sanity with exact follow-up
  commands; `dependency-freshness.sh` / `prisma-client-freshness.sh` back
  the pre-commit warnings.
- `scripts/drift-ai.ts`, `scripts/drift-triage*.ts` — report-only drift
  scans (duplicate code, ghost files, comment ratio) and triage packet
  generation; config in `drift-ai.config.json`.
- `scripts/logs-audit.ts` — fixture-backed JSONL log audits for redaction,
  parse failures, and request-correlation fields.
- `scripts/migration-safety-scan.sh` — warn-only Prisma DDL scanner; the
  two fixture migrations under `packages/server/prisma/migrations/` exist to
  demonstrate both the WARN and acknowledged-INFO sides.
- `sensor:knip`, `sensor:near-duplicates`, `sensor:blob-size`,
  `lint:suppressions`, `scripts/eslint-disable-register.sh` — baseline-backed
  drift sensors for unused exports, near-duplicate files, oversized blobs,
  and lint-suppression accumulation.
- `scripts/audit-dependency-licenses.ts` +
  `docs/dependency-license-audit.md` — license audit over the dependency
  tree, with its written report.
- `stryker.config*.mjs` + `tools/stryker-lint-ratchet.ts` — narrow,
  explicitly-invoked mutation-testing lanes.

### Code intel and worktrees

- `scripts/code-intel.ts` + `scripts/code-intel/` + `code-intel-server.ts` —
  the query CLI and optional daemon described above.
- `scripts/worktree-new.sh` / `worktree-db.sh` / `worktree-drift-hook.sh` —
  per-worktree provisioning, drift detection, GC, and status.
- `scripts/dev.sh` — the upstream `bun run dev` entry point (worktree init +
  fan-out); kept for reading, not running.

### Everything else

- `e2e/` — Playwright specs and page objects, mirrored as examples of the
  page-object and fixture conventions the guides reference. Not runnable
  here.
- `packages/` — **local stubs**, not upstream code: just enough exported
  symbols for lint, typecheck-adjacent tooling, and code intel.
- `.devcontainer/`, `.github/` — the container/CI wiring the harness
  assumes (`ci.yml`, `slow-drift.yml`, a standalone lint-ratchet-demo
  workflow, and the Copilot hook registration).
- Root configs (`tsconfig*.json`, `vitest.config.ts`, `commitlint.config.js`,
  `knip.config.ts`, `playwright.config.ts`, ...) — included so the wiring is
  legible even where it can't run.

## Provenance and syncing

Upstream lives at `/workspace` (private). The `sync-from-upstream` skill
(`scripts/sync-from-upstream.sh` + `.claude/` and `.codex/` wrappers)
re-mirrors upstream's git-tracked file list into this repo: files in both
are overwritten, upstream-only files are added, and here-only orphans are
deleted — except the preserve set (`README.md`, `AGENTS.md`, `CLAUDE.md`,
`docs/upstream-AGENTS.md` — regenerated from upstream's `AGENTS.md` on each
apply — `bun.lock`, the `packages/**` stubs, the sync skill itself,
`.claude/statusline.sh`), which stays local. Everything outside that set is
a mirror: don't edit it here, fix it upstream and re-sync.

## Borrow ideas, not the code

Most of these scripts will not work outside the source repo without edits.
The patterns that travel best:

- **Wrap noisy verification commands at the agent-hook layer**, not in the
  underlying scripts — logs stay intact for humans, context stays clean for
  agents.
- **One `flock` across the whole verification surface** — pre-commit, manual
  verify, and agent hooks queue instead of corrupting each other.
- **Content-keyed last-verified markers beat time-based caches** — worktree
  fingerprints are cheap and make "I just ran this" cost zero.
- **Pair every lint with a codemod, and every policy block with a repair
  string** — agents get a one-shot fix path, not a dead end.
- **Ratchet debt symmetrically** — freeze the baseline, block new debt *and*
  silent cleanup, log the accounting.
- **Shared hook bodies, thin per-tool adapters** — one behavior, N tool
  shapes.
- **Custom ESLint rules with unit tests** once conventions matter enough to
  enforce.
- **Bash with real bash tests** (`scripts/test-*.sh`) once the shell is
  load-bearing.
- **Inventory the harness in one machine-checked doc** — a manifest plus a
  drift check keeps N tools honest as the harness grows.
- **Per-worktree dev environments** so parallel work doesn't fight over
  shared infra.
- **Budget the always-loaded docs** and enforce the budget with a hook.

# AI/Human DX, copied from a real project

This is a reference dump of the developer-experience scaffolding used in a
TypeScript/Bun monorepo (a D&D virtual tabletop called *Musi*). It's been
extracted so the patterns are easier to share without giving access to the
whole product repo.

It is **not** intended to run as-is. The bash wires up specific paths
(`/workspace`, `packages/server/...`, `bun run --filter @musi/server ...`),
the eslint plugin assumes the source layout, and the husky/claude/codex
hooks expect Prisma + tRPC + Bun. Treat it as a catalog of techniques to
borrow, not a starter template.

The most interesting parts are probably:

- `docs/ai-harness.md` — the **inventory and gap map** of the whole
  harness: every guide (feedforward context like `AGENTS.md`, module
  docs, codemods, code intel) and every sensor (lint, typecheck,
  tests, doctor, hook adapters, drift checks), grouped by mode and
  paired guide/sensor. Read this first to see how the rest of the
  scripts and rules in this repo fit together as one feedback loop.
- `docs/guides/` — five area-specific "how to add/change this safely"
  guides for tRPC procedures, Socket.io broadcasts, Prisma migrations,
  race-sensitive mutations, and client feature modules. These are the
  inferential half of the guide/sensor pairs listed in `docs/ai-harness.md`.
- `scripts/ai-hooks/` and `.claude/hooks/` and `.codex/hooks/` — agent hooks
  that **wrap noisy verification commands** so failure tails (not 500-line
  successful test logs) hit the model context window, **enforce a
  single-writer lock** so two parallel agent sessions don't trip over each
  other, and **content-key cache** results on a worktree fingerprint so
  re-running `bun run typecheck` on an unchanged tree replays the cached
  pass instantly. `policy.sh` also blocks destructive Git history
  rewrites, force pushes, pushes to `main`/`master`, `gh` mutations,
  and raw shell `grep` — every block ships with a one-line repair string
  the deny message echoes back.
- `scripts/codemods/` and `scripts/code-intel.ts` — paired with the
  ESLint rules. When a lint says "no", the codemod fixes it; when an
  agent needs to look up definitions/dependents/exports/nearby tests,
  `code-intel` answers without `rg` archaeology. This is the
  "computational guide" half of `docs/ai-harness.md`.
- `.husky/pre-commit` — runs lint/typecheck/test in parallel with a
  `flock`-protected lock, a 120s last-verified short-circuit keyed on
  `HEAD + staged-diff hash`, a 240s interactive watchdog, and Passed/Failed structured
  output the Claude commit-wrapper hook parses.
- `scripts/verify.sh` and `scripts/verify-logs.sh` — the manual
  (sequential) sibling of pre-commit, sharing the same lock and log
  directory so manual runs queue cleanly behind a commit in flight.
- `scripts/verify-async.sh` — starts long verification as a detached job
  (`verify:async*`) with status/tail/stop commands, keeping Stop hooks
  read-only and fast.
- `scripts/test-slow.sh` and `vitest.slow.config.ts` — an explicit slow-test
  tier for `*.slow.test.{ts,tsx}` files; default Vitest configs exclude slow
  tests and `test:changed` only prints a hint when a slow file changed.
- `eslint-rules/` — hand-rolled custom ESLint rules with unit tests, plus
  the `eslint.config.js` that loads them.
- `scripts/migration-safety-scan.sh` — a warn-only Prisma migration
  scanner that flags risky DDL (column drops, NOT NULL adds without
  defaults, etc.) before they reach review.
- `scripts/worktree-db.sh` — per-worktree DB/port/Redis-index
  provisioning, so secondary git worktrees get isolated dev environments
  on first `bun run dev`.
- `docs/agent_notes/` and `docs/module-docs.md` — small, shareable examples
  of the persistent-context system the agent instructions refer to.

The rest of this README walks each top-level folder.

## `AGENTS.md` and `CLAUDE.md`

These two files are loaded into every AI coding session.

- `AGENTS.md` is the shared brief — project layout, commands, working
  model, code standards, and gotchas. Codex, Claude, and any future
  Copilot/Gemini wrapper read this.
- `CLAUDE.md` is a thin Claude-specific addendum (`@AGENTS.md` + Claude
  hook notes). The pattern is: **shared agent guidance lives in
  `AGENTS.md`, tool-specific guidance lives in adapter docs**.

The `doc-length-policy.sh` script (described below) enforces a soft
length cap on these files so they stay scannable.

## `docs/`

Only the DX-shaped docs are included here:

- `docs/ai-harness.md` is the inventory and gap map for the harness as a
  whole. It groups every guide (feedforward context like `AGENTS.md`, module
  docs, codemods) and every sensor (lint, typecheck, tests, doctor, hook
  adapters, drift checks) into a single table, with timing, mode
  (computational vs inferential), and the paired sensor or guide. It also
  records the **promotion rule** — every new harness control should add a
  guide, a sensor, and repair text together. Read this first if you are
  borrowing the pattern: it is the map of how the rest of these scripts and
  rules fit into one feedback loop.
- `docs/agent_notes/README.md` explains the session-start pattern:
  `STATUS.md` is the current snapshot, `NEXT.md` is the active leaf queue,
  `LOG.md` is curated recent history, `DECISIONS.md` (and the
  `decisions-*.md` topical splits) record ADR-lite reasoning, and
  `backlog/`, `in_progress/`, and `finished_work/` notes are read only on
  demand.
- `docs/agent_notes/STATUS.md` and `NEXT.md` are sample hot-path docs. In
  the real repo, agents read these first every session; the doc-length hooks
  nudge when they turn into sprawling logs.
- `docs/guides/` contains focused implementation recipes paired with the
  harness sensors: `add-trpc-procedure.md`, `add-socket-broadcast.md`,
  `add-prisma-migration.md`, `add-race-sensitive-mutation.md`, and
  `add-client-feature-module-cache-socket.md`.
- `docs/module-docs.md` is the charter for local `MODULE.md` orientation
  files and pairs with `scripts/generate-module-index.sh`.

The product docs (`authorization`, socket architecture, concurrency, SRD
reference, roadmap details, etc.) are omitted because they explain Musi, not
the reusable DX pattern.

## `.claude/`

Claude Code (CLI) configuration. Real layout:

```
.claude/
├── settings.json           # hook registrations, env vars, plugin gates
└── hooks/
    ├── no-direct-db.sh         # PreToolUse Bash → block psql/redis-cli/docker/HUSKY=0
    ├── git-commit-quiet.sh     # PreToolUse Bash → wrap `git commit` for compact output
    ├── bun-run-quiet.sh        # PreToolUse Bash → wrap `bun run lint/typecheck/test/...`
    ├── protected-files.sh      # PreToolUse Edit/Write → advisory on hot files
    ├── prisma-generate.sh      # PostToolUse Edit/Write → regenerate Prisma client on schema edit
    ├── doc-length.sh           # PostToolUse Edit/Write → advisory on hot-doc bloat
    └── stop-reminder.sh        # Stop → cheap/read-only uncommitted + cached status reminders
```

`settings.local.json` is intentionally **not** in this dump — it holds
per-developer permission allowlists. Likewise `.claude/worktrees/`,
which is a generated working-copy directory.

`bun-run-quiet.sh` is the headline hook. It:

1. Matches a whitelist of `bun run <script>` invocations. Anything else
   passes through unchanged so a `bun run lint:changed && echo next`
   compound is never silently swallowed.
2. Refuses to run in the background — agents that background a verify
   command and poll the log waste tokens on partial output.
3. Takes a short blocking `flock` (25s by default) so brief accidental overlap
   queues, while longer contention gets a clear denial instead of burning the
   whole interactive budget.
4. Computes a worktree fingerprint (HEAD + tracked diff + untracked
   hashes) and short-circuits if a recent run with the same fingerprint
   succeeded — replaying "cached OK" in 1ms instead of rerunning.
5. Has its own 210s watchdog so a hung child stays below the 240s interactive
   cache budget and cannot outlive the hook wrapper.
6. On success, replaces the tool-call output with a one-liner pointing
   at the full log; on failure, returns the last 40 lines through a
   sed-based filter that strips known noisy deprecation warnings.

Claude's Stop hook is intentionally cheap and read-only. It reminds on
uncommitted changes, cached failing e2e results, and running/failing async
verification state, but it never starts e2e or verification. Repeated reminders
are deduped by branch, worktree fingerprint, or async state file, and local
kill switches such as `.no-stop-uncommitted`, `.no-stop-e2e`, and
`.no-stop-async-verify` are ignored by git.

The shared logic for fingerprinting, marker IO, summary formatting, and
policy matching lives in `scripts/ai-hooks/` so the Codex hooks and
verify wrappers can reuse it.

## `.codex/`

Codex configuration (`hooks.json`, `config.toml`) plus the `pre-tool-use.sh`,
`post-tool-use.sh`, and `stop-reminder.sh` adapters. They reuse the same `scripts/ai-hooks/`
helpers as Claude — the only difference is shape, because Codex hooks
fire pre and post (Claude's PreToolUse can rewrite or deny in one call,
Codex needs a two-phase dance). Codex PreToolUse/PostToolUse are capped at 60s;
Stop is capped at 30s.

## `.husky/`

Git hooks, registered by Husky.

- `pre-commit` — runs `lint:changed`, `typecheck`, and `test:changed` in
  parallel, plus `test:scripts:changed` when hook/script files are staged.
  Uses `flock` for single-writer, a content-keyed last-verified marker
  for repeated commit attempts, and a 240s watchdog with a 210s warning
  threshold to stay inside the interactive cache budget. Prints structured
  `Passed:` / `Failed:` lines that `git-commit-quiet.sh` parses to surface
  only failing tails.
- `post-checkout` and `post-merge` — call into
  `scripts/worktree-drift-hook.sh` to nudge if a secondary worktree's DB
  / migrations / SRD seed have drifted from the checked-out branch.

The `_/` directory Husky generates (the actual hook trampolines) is
deliberately omitted — `bun install` regenerates it.

## `eslint.config.js` + `eslint-rules/`

Flat-config ESLint with `typescript-eslint`'s strictTypeChecked preset
plus a set of hand-rolled rules. The general-purpose rules:

- `max-lines` — caps source/helper modules at ~300 effective lines with
  per-file warning overrides for accepted larger files (declared in
  `eslint.config.js`). Catches creeping module sprawl earlier than the
  default ESLint `max-lines` heuristic.
- `no-explicit-any` — bans `any` unless a deliberate line-level
  suppression is registered. Pairs with `eslint-disable-register.sh`.
- `no-barrel` — bans `index.ts` style barrel re-exports outside a small
  allowlist; keeps imports pointed at the source of truth.
- `test-file-location` — enforces "tests live next to source as
  `*.test.ts`, integration tests in `*.integration.test.ts`, etc."
  conventions.
- `structured-logging` — bans `console.log` in server code; forces a
  structured logger with required fields, and forbids direct console use
  in seed/script code.

The Musi-specific architecture rules — included in full so the patterns
are easy to lift, even though the schema and registry shapes are
project-specific:

- `strict-trpc-input` / `trpc-require-output-schema` — every tRPC
  procedure on a hot path must declare `.input(zodSchema)` (with
  `.strict()`) and `.output(zodSchema)`. Caught a real class of "string
  went over the wire untyped" bugs.
- `trpc-shared-input-schema` / `trpc-shared-output-schema` — both the
  input and output schemas must be imported from `@musi/shared/...`, not
  defined inline inside a router. Pairs with the
  `codemod:trpc-shared-input` / `codemod:trpc-shared-output` codemods so
  the lint failure has a one-shot repair command.
- `strict-shared-schemas` / `no-shared-schemas-barrel` — paired rules
  that keep shared Zod schemas the source of truth and ban barrel-file
  re-exports of them.
- `socket-registry-broadcasts` — bans direct literal emits for
  registry-owned Socket.io events outside `broadcast-registry.ts`,
  keeping payload validation and broadcast logging centralized.
- `no-broadcast-in-transaction` — bans calling broadcast helpers inside
  a Prisma `$transaction` callback, since broadcasts must run after
  commit.
- `concurrency-guard` — bans direct `.update`, `.updateMany`,
  `.updateManyAndReturn`, and `.upsert` calls on concurrency-gated Prisma
  delegates outside `utils/*-mutations.ts`. Pairs with the restricted
  Prisma delegate types and the `RawTxClient` import restriction.

Each rule has a sibling `*.test.js` using `RuleTester`. The
`eslint-rules/vitest.config.ts` runs them.

The repo also enables ESLint's `complexity: 10` rule globally — the
README in the source repo notes this as the real design constraint.
The pattern when complexity warns is to refactor, not to disable.

## `scripts/`

Bash + a sprinkle of TS. Everything here is callable by humans, by
`bun run` aliases in `package.json`, by the agent hooks, or by the
husky pre-commit.

### Verification umbrella

| Script | What it does |
|---|---|
| `verify.sh` | Manual lint/typecheck/test umbrella for humans and AIs. Sequential (parallel pre-commit output is hard to read). Reuses pre-commit's lock + log dir, so manual `verify` queues cleanly behind a commit. |
| `verify-async.sh` | Detached verification runner for long confidence checks. `verify:async`, `verify:async:changed`, and `verify:async:slow` return immediately; `status`, `tail`, and `stop` inspect/control the current run. |
| `verify-logs.sh` | Inspect cached logs from the most recent verify/pre-commit run. `bun run verify:logs lint --full` prints the full lint log; with no args, prints the per-task tails again. |
| `lint-changed.sh` | ESLint over files changed vs `main`, including staged + unstaged. Falls back to a full run if `main`/`origin/main` doesn't exist. |
| `test-changed.sh` | Product/app Vitest tests affected by changed source files. Selects package projects where possible, uses Vitest `--changed`, and prints a slow-test hint when `*.slow.test.*` files changed. |
| `test-slow.sh` | Runs only `*.slow.test.{ts,tsx}` through `vitest.slow.config.ts` with `MUSI_RUN_SLOW_TESTS=1`; kept out of default verify/pre-commit. |
| `format-changed.sh` | Prettier on the same set. |

### Agent-hook helpers (`scripts/ai-hooks/`)

Shared library sourced by both Claude and Codex hooks:

- `common.sh` — JSON IO for hook payloads, `ai_emit_continue` /
  `ai_emit_block` / `ai_emit_deny` helpers, line-limited summary
  formatting, payload parsing.
- `policy.sh` — the policy surface used by every hook adapter. Catches
  `HUSKY=0` and other bypass envs; blocks raw shell `grep` (forces
  `rg` / `git grep` so context windows stay clean); blocks
  `psql`/`redis-cli`/`docker` and other shared-infra commands; blocks
  destructive Git history rewrites (`git commit --amend`, `git rebase`
  except the resume forms, dangerous `git reset` modes, force pushes,
  pushes to `main` / `master`, force branch/tag deletion, forced
  worktree removal, force `git clean`); blocks `gh` mutations and auth
  reconfiguration so PR creation and merges go through a human; and
  exposes `ai_is_wrapped_bun_cmd`, the regex deciding which `bun run`
  scripts get wrapped. Each policy ships a one-line repair string so
  the deny message tells the agent exactly what to do instead.
- `cache.sh` — worktree-fingerprint computation, atomic marker
  read/write with corruption guards, success/failure summary
  formatters.
- `commit-output.sh` — pre-commit failure parser, success summary,
  "no commit landed" detector for compound commands that swallow the
  exit code (`git commit … || echo done`).
- `output-filter.sh` — sed pipeline that strips known noisy third-party
  warnings (`pg` deprecation, `--trace-deprecation` hint, etc.) from
  failure tails. Raw logs are unchanged; only displayed tails are
  filtered.
- `process-runner.sh` — small process-tree helper used by async verification
  to start and terminate detached jobs cleanly.
- `stop-policy.sh` / `stop-reminder.sh` — shared read-only Stop-hook checks
  for uncommitted changes, cached e2e failures, and async verification state.
- `protected-files.sh` / `doc-length.sh` / `prisma-generate.sh` —
  reusable hot-file advisory and Prisma-client refresh logic, used by
  both the Claude PostToolUse hook adapter and the human-facing
  pre-commit warnings.
- `test.sh` — bash test harness for the helpers above.

### Doctor / freshness / drift

- `doctor.sh` — one-shot health check: dependencies installed, Prisma
  client fresh, DB reachable, worktree DB drift, etc. The DX equivalent
  of "is my checkout actually working".
- `dependency-freshness.sh` / `prisma-client-freshness.sh` — sourced by
  pre-commit and `db-status` to warn when `bun.lock` is staged but
  `node_modules` is stale, or when `schema.prisma` is staged but the
  generated client is out of date.
- `doc-length-policy.sh` — POSIX-compatible (sourced by both `sh` and
  Bash) hot-doc length thresholds. Hooks call into this to decide when
  to warn that `STATUS.md` / `NEXT.md` / `AGENTS.md` etc. are
  ballooning.
- `worktree-drift-hook.sh` — runs from `post-checkout` / `post-merge`,
  warns when a secondary worktree's checked-out branch implies
  migrations or SRD seed data the worktree's DB doesn't reflect.

### Worktree provisioning

- `worktree-new.sh` — `git worktree add` + `worktree-db.sh init` in one
  step. Prints assigned URLs, DB names, Redis logical-DB index, and the
  next command.
- `worktree-db.sh` — the chunky one. Per-worktree DB clone, port
  allocation, Redis index allocation, drift detection, GC, status
  reporting. Big and project-specific, but the pattern is general:
  every secondary `git worktree` gets an isolated dev environment on
  first `bun run dev`.

### Migration safety, module index, eslint disable register

- `migration-safety-scan.sh` — warn-only scanner over Prisma migrations.
  Flags risky DDL (column drops, NOT NULL without default, large
  table-rewrites) for human review. Has its own test file.
- `stryker.config.mjs` — a deliberately narrow mutation-testing lane for
  shared rule helpers. It is kept out of verify and pre-commit; run it
  explicitly with `bun run test:mutation` when auditing test quality.
- `generate-module-index.sh` — regenerates `MODULE-INDEX.md` from
  per-directory `MODULE.md` files; pre-commit runs `--check` mode.
- `eslint-disable-register.sh` — periodic audit: every
  `eslint-disable` in source has to appear in a tracked register so
  drive-by suppressions don't accumulate.

### Code intel and codemods

- `code-intel.ts` — repo-aware lookup over the TypeScript project graph:
  definitions, dependents, exports, and nearby tests for a symbol or
  file. Replaces the noisy `rg` archaeology pattern with a deterministic
  query an agent can call directly. `code-intel.test.ts` covers the
  query surface; `test-code-intel.sh` is the bash smoke wrapper.
- `codemods/` — TypeScript-AST codemods with `--check` and `--all`
  modes, paired with an ESLint rule each. The headline pattern is
  "lint says no, codemod fixes it":
  - `trpc-shared-input.ts` / `trpc-shared-output.ts` — move inline
    router schemas into `@musi/shared/schemas/...` and rewrite the
    router import.
  - `structured-logging-fix.ts` — rewrite known-safe `console.*` calls
    in server and seed code to the structured logger.
  - `concurrency-guard.ts` — name-based assist for moving
    race-sensitive Prisma writes through a mutation helper. Aliases and
    destructured delegates still need human review.
  - `expand-barrel.ts` — replace barrel imports with direct source
    imports.
  - `lib/` and `fixtures/` — shared codemod plumbing and golden inputs;
    each codemod has a sibling `*.test.ts`.

### Other

- `dev.sh` — the `bun run dev` entry point. On a secondary worktree it
  runs `worktree:init` first, then fans out shared/server/client with
  per-stream colored prefixes.
- `db-status.sh` / `db-status.ts` — quick "is the DB up, is the schema
  current, is the client fresh" readout.
- `test-scripts.sh` and the `test-*.sh` siblings — bash test files for
  bash scripts. `test:scripts:changed` selects smoke tests by the changed
  hook/script paths, so `verify:changed` covers shell-hook edits without
  running every shell smoke on unrelated product changes.

## Root Config

The root config files are included because they make the wiring legible even
when the repo is not meant to run end-to-end:

- `tsconfig.json` / `tsconfig.base.json` show the project-reference shape the
  `typecheck` script expects.
- `tsconfig.scripts.json` is the extra TypeScript project used for the
  repo-owned TS scripts and codemods.
- `vitest.config.ts` shows how package projects and the `eslint-rules`
  project are registered.
- `vitest.slow.config.ts` shows the dedicated slow-test tier. The package
  configs included under `packages/*/vitest.config.ts` show the matching
  default-tier exclude.
- `.prettierrc`, `.prettierignore`, `.gitignore`, and `.worktreeinclude`
  show the surrounding conventions the hooks and worktree scripts assume.

## Minimal Prisma Fixtures

`packages/server/prisma/migrations/` contains only two historical migration
fixtures plus `.safety-acknowledged`. They are not intended to be a schema or
database setup. They exist so `scripts/test-migration-safety-scan.sh` can
demonstrate both sides of the migration scanner contract: destructive DDL is
detected, and reviewed destructive migrations are acknowledged as `INFO`
instead of new `WARN` findings.

## `package.json`

The musi scripts table is the wiring map. The interesting entries:

```jsonc
{
  "scripts": {
    "verify": "bash scripts/verify.sh",
    "verify:changed": "bash scripts/verify.sh --changed",
    "verify:logs": "bash scripts/verify-logs.sh",
    "verify:async": "bash scripts/verify-async.sh start verify",
    "verify:async:changed": "bash scripts/verify-async.sh start changed",
    "verify:async:slow": "bash scripts/verify-async.sh start slow",
    "verify:async:status": "bash scripts/verify-async.sh status",
    "verify:async:tail": "bash scripts/verify-async.sh tail",
    "verify:async:stop": "bash scripts/verify-async.sh stop",
    "lint:changed": "bash scripts/lint-changed.sh",
    "test:changed": "bash scripts/test-changed.sh",
    "test:mutation": "stryker run",
    "code:intel": "bun scripts/code-intel.ts",
    "codemod:trpc-shared-input": "bun scripts/codemods/trpc-shared-input.ts",
    "codemod:trpc-shared-output": "bun scripts/codemods/trpc-shared-output.ts",
    "codemod:structured-logging-fix": "bun scripts/codemods/structured-logging-fix.ts",
    "codemod:concurrency-guard": "bun scripts/codemods/concurrency-guard.ts",
    "codemod:expand-barrel": "bun scripts/codemods/expand-barrel.ts",
    "format:changed": "bash scripts/format-changed.sh",
    "doctor": "bash scripts/doctor.sh",
    "db:migration-safety": "bash scripts/migration-safety-scan.sh",
    "module:index": "bash scripts/generate-module-index.sh",
    "module:index:check": "bash scripts/generate-module-index.sh --check",
    "worktree:new": "bash scripts/worktree-new.sh",
    "worktree:init": "bash scripts/worktree-db.sh init",
    "worktree:status": "bash scripts/worktree-db.sh status",
    "test:scripts": "bash scripts/test-scripts.sh",
    "test:scripts:changed": "bash scripts/test-scripts.sh --changed",
    "prepare": "husky"
  }
}
```

`prepare: husky` is what installs `.husky/_/` on `bun install`.

## Things deliberately left out

- `.claude/settings.local.json` (per-developer)
- `.claude/scheduled_tasks.lock`, `.claude/worktrees/` (runtime state)
- `.husky/_/` (regenerated by `bun install` / `husky install`)
- `.devcontainer/` and other env-specific config (not DX, just env)
- `packages/`, except the tiny Prisma migration-safety fixtures described
  above — the actual product
- `e2e/` and product-specific docs — useful in Musi, not useful as a compact
  DX reference

## Borrow ideas, not the code

Most of these scripts will not work outside the source repo without
edits. The patterns that travel best:

- **Wrap noisy verification commands at the agent-hook layer**, not in
  the underlying scripts. Keeps logs intact for humans, keeps context
  windows clean for agents.
- **Single-writer locks across the whole verification surface** —
  pre-commit, manual verify, agent hooks all share the same `flock`,
  so two agents racing each other queue instead of corrupt.
- **Content-keyed last-verified markers** beat time-based caches every
  time. Worktree fingerprints (`HEAD + diff + untracked hashes`) are
  cheap to compute and let "I just ran this 10 seconds ago" cost zero.
- **Bash files that have real bash tests** (`scripts/test-*.sh`) once
  the shell is load-bearing.
- **Shared agent guidance in `AGENTS.md`, tool-specific adapters in
  `.claude/`, `.codex/`** — keeps the per-tool config thin.
- **Custom ESLint rules with unit tests** when codebase conventions
  matter enough to enforce.
- **Pair every lint with a codemod**. When the lint fails, the deny
  message names the codemod that fixes it, so an agent has a one-shot
  repair path instead of guessing rewrites.
- **Pair every policy with a repair string**. `policy.sh` blocks
  destructive Git, `gh` mutations, raw `grep`, etc., and each block
  ships a one-line repair string the agent sees in the deny.
- **Inventory the harness in one doc** (see `docs/ai-harness.md`).
  Listing every guide, every sensor, their timing/mode, and the
  promotion rule keeps the harness coherent as it grows. Without a map,
  the same kind of check ends up implemented twice in subtly different
  places.
- **Per-worktree dev environments** (DB/ports/Redis index) so
  multi-task workflows don't trip over shared infra.

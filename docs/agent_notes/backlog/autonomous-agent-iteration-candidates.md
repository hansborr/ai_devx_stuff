# Autonomous Agent Iteration Candidates

Status: Promoted autonomous iteration batch
Date: 2026-05-25
Source: User request to gather AI-harness improvements and cleanup/lint-drain
work that agents can iterate on with minimal human input.

This note collects candidate leaves from `in_progress/`, `backlog/`, and live
ratchet state. It is not a FIFO queue. The active promoted batch is mirrored in
`NEXT.md`; stale/provenance items are listed below only to prevent re-promotion.

## Recommended Promotion Set

### 1. Post-edit tidy hook

Status: ready for a shared Claude + Codex implementation.

Goal: after an agent creates or edits a file, run a narrow per-file formatter
and autofix pass so the agent sees feedback immediately instead of waiting for
`verify:changed` or pre-commit.

Existing fit:

- `.claude/settings.json` already wires `PostToolUse` hooks for `Edit|Write`.
- Official Codex hook docs
  (`https://developers.openai.com/codex/hooks#posttooluse`) show `PostToolUse`
  supports file-edit matchers including `apply_patch`, `Edit`, and `Write`.
  Codex `apply_patch` hook input still reports `tool_name: "apply_patch"` and
  carries the patch text under `tool_input.command`.
- `.codex/hooks.json` currently wires only `Bash` hooks, so this leaf should
  add the edit hook registration instead of treating Codex as unsupported.
- Shared hook helpers already parse file paths through
  `scripts/ai-hooks/common.sh` `ai_payload_file_path`.
- Existing post-edit hooks prove the pattern:
  `scripts/ai-hooks/prisma-generate.sh` and
  `scripts/ai-hooks/doc-length.sh`.

Suggested split:

1. Add shared `scripts/ai-hooks/tidy-edited-file.sh`.
   - For Claude payloads, read `tool_input.file_path` via
     `ai_payload_file_path`.
   - For Codex `apply_patch` payloads, parse file paths from
     `tool_input.command` (the patch text), since Codex uses `command`
     not `file_path`. The shared script must handle both shapes.
   - Skip missing/deleted files and unsupported paths.
   - Run `prettier --write --ignore-unknown "$file"`.
   - Run `eslint --fix --no-warn-ignored "$file"` for JS/TS/JSON-like files.
   - Emit bounded feedback with valid hook JSON on every path.
   - Add a clear opt-out env var for debugging hook loops.
2. Add a thin Claude adapter under `.claude/hooks/` and wire it in
   `.claude/settings.json` `PostToolUse` `Edit|Write` after Prisma generation.
3. Add Codex `PostToolUse` hook registration in `.codex/hooks.json` for file
   edits. Use a matcher accepted for `apply_patch` edits (`apply_patch`, `Edit`,
   or `Write`) and keep the adapter thin around the same shared script.
4. Add `scripts/test-ai-hooks.sh` coverage for success, missing file,
   unsupported file, Prettier failure, ESLint failure, and JSON validity.
   Include a Codex-shaped fixture whose input has `tool_name: "apply_patch"`.

Risks to handle in the implementation:

- The hook mutates files after the agent's edit; repair text should tell agents
  to reread a file before further edits when the hook changed it.
- ESLint after a half-finished edit can produce parse errors. Prefer useful
  immediate feedback over silence, but keep the tail bounded.
- `format:changed`, `lint:changed`, and `lint:fix` are too broad for this hook;
  call Prettier/ESLint directly on the edited file.

Verification:

- `bash scripts/test-ai-hooks.sh`
- A real Claude edit/write smoke on a `.ts` file and a Markdown/JSON file.
- A real Codex `apply_patch` smoke that proves the matcher fires and the shared
  script handles the `tool_name: "apply_patch"` payload.

### 2. Verify and commit latency optimization

Status: ready for a measurement-first optimization campaign.

Goal: make the commands agents run directly and the commands hooks run on their
behalf as fast and low-wait as possible, without weakening the checks those
commands enforce. Scope includes the wrapper commands (`bun run verify`,
`bun run verify:changed`, `bun run verify:parallel`, and pre-commit) and their
subcommands (`lint:changed`, `lint:ratchet`, `typecheck`, `test:changed`,
`test:scripts:changed`, full `test:scripts`, and commit-hook-only checks). The
user explicitly wants agents to spend less time blocked on verification and
commits.

Source notes:

- `docs/agent_notes/backlog/cache-budget-followups.md`
- `docs/agent_notes/finished_work/precommit-240-budget-followup.md`
- `docs/agent_notes/finished_work/precommit-240-budget-review-followups.md`
- `docs/agent_notes/finished_work/precommit-lint-parallelization-leaf-2.md`
- `docs/agent_notes/finished_work/precommit-script-smoke-parallelization-leaf-4.md`

Suggested split:

1. Measure current cold and warm timings for the agent-run command surfaces
   (`verify`, `verify:changed`, `verify:parallel`) and hook-run command
   surfaces (pre-commit and AI hook wrappers). Use existing
   `verify:logs budget`, `verify:history`, and wrapper metadata before adding
   new instrumentation.
2. Identify the current long poles by step: `lint:changed`, `lint:ratchet`,
   `typecheck`, `test:changed`, `test:scripts:changed`, full `test:scripts`,
   and any commit-hook-only or AI-hook-only work.
3. Optimize the slowest real bottleneck first. Candidate areas include
   typecheck incremental reuse, ratchet cache behavior, changed-test selection,
   script-smoke selection, pre-commit marker/cache reuse, and avoiding work
   duplicated between agent-run verification and the commit hook.
4. Update `AGENTS.md` if the preferred agent workflow changes, for example when
   agents should run `verify:changed`, `verify:parallel`, `verify:async`, or
   rely on a fresh marker before committing.
5. Update `.husky/pre-commit` and related hook output only when needed to
   reduce wait time, improve marker reuse, or make the commit path avoid
   redundant checks after an equivalent fresh verify run.

Constraints:

- Do not remove a gate just to reduce runtime. Preserve the safety contract or
  replace it with an equivalent faster check.
- Keep local/pre-commit enforcement as the source of truth; external CI is not
  reliable enough to be the only enforcement point.
- Prefer measured, one-bottleneck leaves over broad rewrites. Each leaf should
  report before/after timings.
- If a faster path depends on cached state, make cache invalidation explicit and
  fixture-backed.

Verification:

- Before/after timing table for cold and warm runs.
- `bun run verify:logs budget`
- `bun run verify:history`
- `bash scripts/test-verify.sh`
- `bash scripts/test-verify-async.sh`
- `bash scripts/test-test-scripts.sh`
- `bash scripts/test-dependency-freshness.sh`
- `.husky/pre-commit` smoke or targeted fixture if the commit hook changes.
- `bun run verify:changed`

### 3. Quick lint drain: top-level `unbound-method`

Status: ready, smallest live lint-ratchet drain.

Live state from `bun run lint:ratchet:summary`: one finding remains in
`ratchet/typescript-eslint-unbound-method-top-level-scripts`, scoped to
`scripts/harness-emit-envelope.ts`.

Why promote: tiny autonomous cleanup with low blast radius. Good warm-up before
larger ratchet drains.

Verification:

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`

### 4. Main lint-drain branch: codemod complexity and max-lines

Status: ready, but should be promoted as a named branch and split by file.

Live state:

- `ratchet/core-complexity-codemods`: 24 findings across 9 file entries.
- `ratchet/local-max-lines-codemods`: 3 oversized files:
  `scripts/codemods/concurrency-guard.ts`,
  `scripts/codemods/expand-barrel.ts`, and
  `scripts/codemods/lib/trpc-shared-schema.ts`.

Source notes:

- `docs/agent_notes/backlog/lint-followups/36-codemod-concurrency-and-logging-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/37-codemod-barrel-and-trpc-lint-adoption.md`

Suggested split:

1. `scripts/codemods/lib/trpc-shared-schema.ts` plus
   `scripts/codemods/trpc-shared-output.ts`.
2. `scripts/codemods/expand-barrel.ts`.
3. `scripts/codemods/concurrency-guard.ts`.
4. Remaining structured-logging or tRPC input residuals.

Verification:

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- Relevant codemod smokes
- `bun run test:scripts:changed`
- `bun run verify:changed`

### 5. Runtime max-lines split

Status: ready after or parallel to codemod drain if assigned to a separate
agent/branch.

Live state:

- `ratchet/local-max-lines-runtime`: `scripts/lint-ratchet.ts` and
  `scripts/lint-ratchet-baseline.ts` remain oversized.
- Runtime complexity ratchets are already drained to zero.

Source: `docs/agent_notes/backlog/lint-followups/39-ratchet-runtime-script-lint-adoption.md`.

Verification:

- `bash scripts/test-lint-ratchet.sh`
- `bun test scripts/lint-ratchet*.test.ts`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run typecheck`
- `bun run verify:changed`

### 6. Drift-ai max-lines drain

Status: ready, same pattern as codemod/runtime max-lines splits.

Live state:

- `ratchet/local-max-lines-drift-ai`: 2 findings across
  `scripts/drift-ai.ts` and `scripts/drift-ai/ghost-files.ts`.

Note: the old `ratchet/core-complexity-drift-ai` is already at zero. Only the
max-lines debt remains.

Verification:

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run typecheck`
- `bun run test:scripts:changed`
- `bun run verify:changed`

## Good Follow-on AI Harness Leaves

These are useful but should be explicitly promoted because they need a product
or command-surface choice.

### `docs:intel` / `guide:intel`

Source: `docs/agent_notes/backlog/ai-harness-prioritized-backlog.md`.

Recommended default if promoted: CLI-first `bun run docs:intel -- list` and
`bun run docs:intel -- get <id...>` over guides and module docs. Exclude parked
backlog notes by default; expose them only behind an explicit `--backlog` or
`--include-parked` flag.

### Shared `RepairAction` quick-fix preview

Source: `docs/agent_notes/backlog/ai-harness-prioritized-backlog.md` and
`docs/agent_notes/backlog/ai-harness-external-tooling-ideas.md`.

Recommended first codemod: tRPC shared input/output schemas, because those
already have codemods and clear lint repair text.

### Behavior approved-scenarios fixtures

Source: `docs/agent_notes/backlog/ai-harness-prioritized-backlog.md`.

Recommended first slice: Character Live-State mutation outcomes, because the
harness backlog names behavior confidence as the weakest dimension and this is
a high-risk workflow with existing server/service tests to extend.

### Worktree-local observability

Source: `docs/agent_notes/in_progress/worktree-local-observability.md`.

Recommended next leaf if promoted: `logs:audit:latest` or a narrow doctor
integration for the newest known local server log. Defer `observe:logs` until
dev-session capture/log paths exist.

### Client test-quality plugin follow-ups

Source: `docs/agent_notes/backlog/lint-followups/10-test-quality-followups.md`.

The first `@vitest/eslint-plugin` slice already landed. Remaining work is
client-scoped Testing Library and jest-dom inventory, plus any explicitly named
deferred Vitest style cleanup. Do not re-promote the original Vitest
install/inventory slice.

## Resolved, Stale, Or Blocked Items

- Removed stale `in_progress/` notes for the already-zero
  `ratchet/core-complexity-drift-ai` plan and the already-fixed async
  verify-marker/deletion follow-up. Current drift-ai debt is only
  `ratchet/local-max-lines-drift-ai` on `scripts/drift-ai.ts` and
  `scripts/drift-ai/ghost-files.ts`.
- Moved implemented hook provenance notes for agent git safety and Codex test
  output summarization to `finished_work/`; they are not fresh work.
- The original `@vitest/eslint-plugin` install/inventory slice landed
  2026-05-16. Do not re-promote it.
- `ai-drift-sensors.md` Leaf 6 is blocked on several real uses/noise data.
  Do not add `drift:ai` to pre-commit or `verify:changed`.
- `claude-cache-spanning-commands.md` remains blocked on evidence that slow
  commits still recur after pre-commit performance work.
- Broad `strict-boolean-expressions` rollout is possible but very large; do not
  include it in an autonomous batch unless it is the named campaign.

## Resolved Promotion Questions (2026-05-24)

Human-promoted decisions:

1. **Post-edit tidy hook scope**: all files. Use `prettier --write
   --ignore-unknown` and let Prettier handle filtering. No maintained
   allowlist needed.
2. **Verify/commit latency focus**: start with measurement, then optimize
   the worst bottlenecks. Commits and the commands agents run are too slow;
   script verification in particular takes a long time. Optimization scope
   includes changing what agents naturally run via `AGENTS.md` edits, not
   just the commands themselves.
3. **Lint cleanup order**: start with the one-finding `unbound-method` drain,
   then codemod complexity/max-lines, drift-ai max-lines, and runtime
   max-lines as separate branches.
4. **Vitest inventory**: removed from the active batch after cleanup because
   the `@vitest/eslint-plugin` first slice already landed. Remaining
   test-quality work stays parked in `lint-followups/10-test-quality-followups.md`.
5. **Drift-ai max-lines**: promoted. Same module-split pattern.
6. **Already landed (do not re-promote)**: Leaf 4 (eslint-comments hygiene)
   landed 2026-05-16. Leaf 24 (.sort() comparator fixes) landed in
   `0652826e`. Both confirmed done.

All 6 active items above are promoted for autonomous iteration.

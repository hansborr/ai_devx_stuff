# Status

**Last updated**: 2026-05-08 (agent-hook Git safety)
**Roadmap position**: DX5-DX8 closed. The `feature/devx2` merge-review queue
(MR1-MR5, FU1-FU5) is fully landed; its in-progress note has been archived.
The closed `codebase-review-next-cycle.md` checklist (CR1-CR21) is archived in
`finished_work/` for re-triage history.
**Test suite**: Green at last merge. Keep this line high-level; exact counts belong in `LOG.md` or task notes.

## What's in progress

`feat/harness-improvements-v2` is the active branch and is unpushed. Work landed
on it covers two parked initiatives:

1. **Cache-budget verification** (`finished_work/cache-budget-verification-plan.md`,
   slices 1-4): budget metadata capture, explicit slow-test tier
   (`*.slow.test.{ts,tsx}` + `test:slow` / `verify:slow`), 240s interactive
   budget enforcement (verify + pre-commit + Claude `bun-run-quiet`), and
   the manual async path
   (`verify:async{,:changed,:slow,:status,:tail,:stop}`). Two follow-up
   hardening passes landed after codex review: `dff25d27` bounded the async
   Stop-hook reporter to prevent agent notify loops (kill switch,
   skip-success, dedup counter — required for any future Stop reporter), and
   `0990982b` + `7e103e11` hardened the async runner's process-group
   cleanup, lock-fd hygiene, and timeout ordering. Conditional follow-ups now
   live in `backlog/cache-budget-followups.md`; typecheck optimization is not
   justified unless measurements regularly exceed the 210s warm / 240s cold
   budget.
2. **AI harness improvements** (`finished_work/ai-harness-improvements.md`): the
   harness map (`docs/ai-harness.md`); paired guides
   `docs/guides/add-socket-broadcast.md`, `docs/guides/add-trpc-procedure.md`,
   `docs/guides/add-prisma-migration.md`,
   `docs/guides/add-race-sensitive-mutation.md`, and
   `docs/guides/add-client-feature-module-cache-socket.md`;
   eleven repo-owned lint sensors (`local/max-lines`,
   `local/no-explicit-any`, `local/strict-trpc-input`,
   `local/trpc-require-output-schema`, `local/trpc-shared-input-schema`,
   `local/trpc-shared-output-schema`, `local/strict-shared-schemas`,
   `local/structured-logging` tightened to reject direct server-side
   `console.*` and dynamic Pino message strings,
   `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction`,
   `local/concurrency-guard`); three codemods under
   `scripts/codemods/` (`trpc-shared-input`, `trpc-shared-output` with
   `--all`, `structured-logging-fix` with `--check` / `--all` /
   `--dry-run`); Stop-hook cached-verify replay (`ai_stop_verify_status`);
   and module `Concepts:` breadcrumbs. Conditional follow-ups now live in
   `backlog/ai-harness-followups.md`.

The next leaf is promoted in `NEXT.md`: add the module-doc refresh guide.
Sources to consult when promoting later leaves:
`backlog/ai-harness-followups.md` names remaining narrow guide work first,
followed by migration-safety output improvements before any Stop or commit
wiring.

Human-requested bridge work implemented in the working tree:
`finished_work/precommit-verify-cache-bridge-plan.md` now lets pre-commit trust a
recent matching `verify:changed` or full `verify` marker when the current
worktree fingerprint proves the same state was checked.

Human-requested agent-hook Git safety is implemented in the working tree:
`scripts/ai-hooks/policy.sh` blocks history rewrites, destructive Git/GitHub
mutations, pushes to `main` / `master`, and raw shell `grep`; rollout details
live in `in_progress/agent-hook-git-safety.md`.

Human-requested Codex test-output summarization is implemented in the working
tree; details live in `in_progress/codex-test-output-summarization.md`.

Human-requested `code:intel` v1 and review follow-ups are implemented and
archived in `finished_work/code-intel-review-followups.md`:
`bun run code:intel --` supports `def`, `exports`, `dependents`, and `tests`
with workspace package-export resolution, client alias resolution, runtime test
graph filtering, script Vitest coverage, and shell smoke coverage. `tests` now
ignores per-specifier type-only static imports/re-exports for runtime coverage
edges and supports `--depth <N>`, `--direct`, and
`--project <shared|server|client>`. Conditional future work lives in
`backlog/code-intel-followups.md`; daemon/cache tradeoffs remain in
`backlog/code-intel-daemon-options.md`.

DX8.2d closed mutation-boundary logging earlier in the sprint:
`request-logger.ts` exposes `logMutation` (info on success, warn on failure)
and `logBroadcast` (info on success/skipped). Hot mutation paths each emit
exactly one business-event log per committed call — `auth.login`,
`auth.refresh`, `character.create`, `character.updateStats`,
`character.adjustHp`, `encounter.create`, and `encounter.state.transition`.
Failures carry a low-cardinality reason code (`invalid_credentials`,
`invalid_refresh`, `invalid_transition`); successes carry `actor` plus the
relevant scope ids. Coverage lives in `utils/request-logger.test.ts`,
`routers/mutation-logging.test.ts`, `socket/broadcast-registry.test.ts`,
and `utils/character-campaign.test.ts`.

DECISIONS.md crossed ~400 lines and was split by domain into
`decisions-{concurrency,auth,realtime,schemas,services,build}.md`;
`DECISIONS.md` now serves as the index. Recent closed-leaf details live in
`docs/roadmap/developer-experience.md`. Durable DX7.0c fixture-builder
inventory lives at `docs/agent_notes/finished_work/fixture-builder-inventory.md`;
the DX5.3a socket emit inventory lives at
`docs/agent_notes/finished_work/socket-emit-inventory.md`.

If a session ends mid-flight, update the matching `in_progress` note and this section so the next agent can resume without guessing.

## Read Next

- `NEXT.md` — prioritized queue.
- `DECISIONS.md` — only when you are about to change a cross-cutting pattern.
- `LOG.md` or `finished_work/README.md` — only when you need retained history.
- `backlog/README.md` — only when re-triaging parked work.
- `backlog/ai-harness-followups.md` — source for future harness leaves after
  the current `NEXT.md` item lands.
- `finished_work/codebase-review-next-cycle.md` — closed codebase-review
  checklist; consult only during re-triage.

## Handoff

1. Read this file, then `NEXT.md`.
2. If `NEXT.md` names an active note, open only that note.
3. If `NEXT.md` is empty, wait for human re-triage or promote exactly one
   ready leaf from `backlog/README.md`.
4. Read `backlog/README.md` only when promoting the next workstream or a human
   asks for re-triage.
5. When work lands, retain only durable handoff history and update this file only if the snapshot changed.

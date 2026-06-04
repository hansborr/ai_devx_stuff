# AI Harness Prioritized Backlog

Status: Parked, ordered candidate leaves; landed items removed 2026-06-02
Date: 2026-05-15
Sources: `../../ai-harness.md`, `ai-harness-followups.md`,
`ai-harness-external-tooling-ideas.md`, and the May 2026 harness-engineering
transcript review.

This note is the ordered promotion list for future AI-harness work. Promote
only one leaf at a time into `NEXT.md`. Keep new controls report-only until
they have low noise, stable repair text, and a real consumer.

Execution note 2026-06-01: selected items from this backlog are now decomposed
into small leaves under `harness-review-tasks/00-index.md`. Use that folder for
execution where the scopes overlap; keep this file as ordering rationale.

## Priority Order

1. Behavior approved-scenarios fixtures.
   `docs/ai-harness.md` names behavior confidence as the weakest dimension, so
   promote one narrowly scoped behavior slice early instead of spending several
   leaves only on harness infrastructure. Default to the approved-scenarios
   pattern: human-reviewed input/output scenario fixtures at the tRPC/API
   boundary for server workflows, and table-driven input/output fixtures for
   pure shared rules. Best first slices are Character Live-State mutation
   outcomes, shared rules logic, auth mismatch behavior, socket broadcasts, or
   client cache/socket flows. Use mutation testing to find unassertive
   scenarios, not as a prerequisite for starting the leaf.

2. Stable JSON output for existing diagnostics.
   Add `--format json` to one existing diagnostic command only after naming a
   concrete consumer, such as `harness:audit`, a host-side weekly report, a hook
   summary, or a reviewer handoff script. Best candidates: `verify:logs`,
   `doctor`, `module:index:check`, `db:migration-safety`, and script smoke
   tests. Prefer command name, status, rule/check id, file, location, message,
   repair command, duration, and artifact paths. This unlocks dashboards,
   sidecars, trigger statistics, and scheduled reports without prose scraping.

3. Guide pruning and deletion-candidate audit.
   Split this by guide family instead of hand-walking every doc at once. The
   first leaf should produce a deletion-candidate report for `AGENTS.md` plus
   one guide family, comparing each rule against its paired sensor and repair
   text. Delete or shorten guidance only where a deterministic sensor fully
   covers the rule and the doc no longer adds judgment, context, or repair
   detail. This stays independent of trigger statistics, but it should remain a
   small report-first task rather than a broad documentation rewrite.

4. `docs:intel` / `guide:intel` discovery.
   Add a CLI that lists and retrieves relevant guides and module docs by area,
   concept, or task: tRPC, Prisma, sockets, rules, client cache/socket, e2e,
   concurrency, module docs, and harness. Reuse existing `Concepts:`
   breadcrumbs before inventing new metadata. Parked backlog notes must not
   appear in default results; expose them only behind an explicit
   `--include-parked` / `--backlog` mode so discovery does not reopen work that
   `NEXT.md` has intentionally left parked. Keep this CLI-first; MCP can wrap it
   later if needed.

5. Shared quick-fix preview contract.
   Define a small `RepairAction` JSON shape for codemods and selected lint
   sensors: `id`, `title`, `file`, `span`, `reason`, `command`, optional
   `diff`, and whether a rerun is required. Implement it for one existing
   codemod first, such as tRPC shared input/output schemas, structured logging,
   or concurrency guards. Use focused fixtures that capture input, expected
   diagnostic, expected repair command, and expected fixed output wherever
   diagnostic and repair text must stay aligned.

6. Dependency freshness report with optional AI summary.
   Turn the existing dependency freshness check into a structured report that
   identifies old, vulnerable, deprecated, or unmaintained dependencies. If an
   AI report is useful, feed it only the deterministic package list and lockfile
   metadata so it researches a bounded set instead of wandering.

7. Security and architecture-fitness review reports.
   Start with deterministic checks derived from existing policies: auth helper
   usage, intentional `NOT_FOUND` mismatch semantics, restricted Prisma writes,
   tRPC output schemas and PII exposure risks, socket broadcast registry use,
   no broadcasts inside transactions, package direction, and race-sensitive
   helper boundaries. Keep broad inferential review optional and only after
   deterministic checks pass.

8. Graph drift sensors.
   Use existing `code:intel` graph machinery for report-only dead exports,
   import cycles, stale module docs, changed source without nearby/direct
   candidate tests, and layer drift. Keep these out of `verify:changed` until
   real runs show low noise and clear repair paths.

9. Coverage baseline helper.
    Replace the copy-paste helper in `docs/guides/coverage-cadence.md` with a
    script that reads `coverage/coverage-summary.json`, emits the tracked scope
    summary, and optionally compares against the last tracked baseline. This
    makes the cadence reproducible without promoting coverage into the edit
    loop.

10. Mutation report summarizer.
    Parse `reports/mutation/mutation.json` and list `Survived` and
    `NoCoverage` mutants by file, rule area, and likely covering tests. Keep
    Stryker itself manual and slow; make the output easier for agents and
    reviewers to triage.

11. Scheduled slow harness report.
    Add one report-only command, such as `bun run harness:audit`, that can be
    run weekly or from a host timer. This should aggregate report-only commands
    that already exist when the leaf is promoted, instead of requiring every
    candidate sensor to ship first. Emit artifact paths, summary metrics, and
    suggested candidate leaves. AI summarization may consume the report later,
    but it should not be the source of truth.

12. `logs:audit:latest` or doctor integration.
    Make `scripts/logs-audit.ts` easier to use against the newest known local
    server log. Keep it out of `verify:changed`, but let `doctor` surface it
    when a known log path exists.

13. Stale module-doc sensor.
    Add a report-only check for feature directories with many changed files,
    new subdirectories, or cache/socket/transaction/concurrency keywords but no
    touched or nearby `MODULE.md`. Pair findings with the
    `docs/guides/add-module-doc.md` repair path.

14. Sensor-trigger statistics.
    Aggregate stable sensor ids from lint, verify logs, doctor, drift reports,
    hooks, and quick-fix previews. Use the statistics to decide whether to
    tighten a guide, add a computational repair, or delete redundant markdown
    that sensors already cover. Only build after at least four weeks of
    structured logs and a named guide-pruning hypothesis, so this does not
    become an empty dashboard.

15. Coding-session sidecar.
    Build a lightweight watch-mode sidecar only after structured diagnostics
    exist. It should expose an agent-optimized JSON snapshot of cheap sensors
    such as `lint:changed`, typecheck state, selected changed tests, and
    quick-fix previews. Do not make it a second pre-commit or a gate.

16. Doctor fix-plan mode.
    Add `doctor --fix-plan` for low-risk setup drift only: stale Prisma client,
    missing generated module index, missing local env examples, or worktree port
    metadata. It should preview exact actions without mutating by default.
    Avoid database, migration, and git-history mutation fixes.

17. Rule and codemod metadata registry.
    Add machine-readable metadata for local ESLint rules, drift checks, and
    codemods: category, paired guide, default command, repair command, fixable
    status, examples, and owner notes. Generate parts of `docs/ai-harness.md`
    only after the metadata proves useful.

18. Canonical agent assets with adapter sync.
    If `.claude/skills`, `.codex/skills`, prompts, or subagent templates keep
    growing, move shared source into one repo-owned directory and generate the
    harness-specific adapters. Keep registration details in the adapters.

19. Optional task prompts and fallback skills.
    Add one procedural prompt or skill for a high-risk workflow, such as
    `musi-trpc-task` or `musi-rules-task`: discover docs, run targeted
    `code:intel`, use codemods where applicable, verify shared/server/client
    flow, and produce a concise handoff. Keep it discoverable through
    `docs:intel`, not global startup instructions.

20. CLI-backed MCP adapter, only after CLI contracts stabilize.
    If a concrete client needs MCP, wrap stable repo CLIs such as `code:intel`,
    `docs:intel`, `drift:ai`, `verify:logs`, and quick-fix preview. Add
    protocol-level tests for schema, read-only annotations, structured content,
    and error output before adding more tools. Do not make MCP the source of
    truth.

## Promotion Checklist

Before moving any item into `NEXT.md`, name the exact leaf, command surface,
consumer, output contract, tests, docs to update, and whether it is report-only
or a gate. Prefer one package or workflow slice at a time. If the leaf adds a
diagnostic, include stable repair text and a fixture or script test that proves
the diagnostic shape remains useful.

## Non-Goals

- Do not grow `AGENTS.md` into a cookbook.
- Do not promote broad AI review before deterministic checks pass.
- Do not add slow scans, mutation testing, or AI review to pre-commit or
  `verify:changed`.
- Do not expose parked backlog notes through default docs discovery; require an
  explicit parked/backlog flag.
- Do not build trigger statistics before at least four weeks of structured logs
  and a named guide-pruning hypothesis exist.
- Do not build MCP or a sidecar before the underlying CLI output is stable.
- Do not auto-apply doctor fixes that touch the database, migrations, git
  history, or production-like state.

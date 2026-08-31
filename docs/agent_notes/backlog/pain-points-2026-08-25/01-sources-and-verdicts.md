# Sources and Verdicts

Status: Complete disposition ledger
Date: 2026-08-25

## Method

One reconciliation pass per topic note under
`/home/node/persist/musi/pain_points/`, each checking every observation
against the live tree at HEAD (file reads, `git log`, and where cheap a direct
reproduction), then deduplicating against `../pain-points-2026-07-29/`,
`../agent-pain-points-2026-07-21/`, `../ai-harness-audit-2026-07-21/`, the
code-quality packs, and `../../finished_work/`. Verified-fixed items were moved
into each note's `Resolved` section with a citation; open items were given a
pointer to their owning leaf or prior ruling so later passes do not re-propose
them.

Only bounded S/M changes became leaves. Everything else is below.

## Disposition ledger

| Source | Finding | Verdict | Evidence and disposition |
| --- | --- | --- | --- |
| `agent-cli-and-external-reviews.md` — dispatch paths | Repo-relative wrapper paths exit 127 on cwd drift. | Fixed | `../pain-points-2026-07-29/15-*.md` implemented; `SKILL.md` uses `$(git rev-parse --show-toplevel)` throughout. |
| same — backend lifetime | Wrapper death leaves the backend alive. | Duplicate / owner decision (do not reopen) | `../agent-pain-points-2026-07-21/04-*.md` cancelled by owner 2026-07-22. |
| same — wrapper self-edits | Editing `agent-run.sh` in place from its own run can re-read the rewritten inode. | Accepted as leaf 02 | Not documented anywhere live; doc-only. The separate function-ordering hazard was already Fixed (`c24f502e5`). |
| same — backgrounded consults | Detached dispatch never wakes the dispatcher. | Fixed | `2d1fe918d` ported the harness background mechanism and `agent-wait.sh` exit codes into `SKILL.md:62-64`. |
| same — trailer trust | Backend text could forge wrapper trailers. | Fixed | `../pain-points-2026-07-29/11-*.md` closed as superseded-redesign implemented. |
| same — nested self-review authority | Delegate self-dispatched its own review as a gate. | Owner decision (preserved) | Wrappers cannot infer delegated authority; `SKILL.md:130` fan-out clause is the bounded mitigation. |
| same — retry artifacts | Copilot retry lineage and caller-owned paths. | Fixed / duplicate | `../agent-pain-points-2026-07-21/12-*.md` implemented; `references/trailer-contract.md` specifies the contract. |
| same — provider quota, capacity, stalls | Cursor capacity, Codex quota, Claude stalls. | External | Account state stays out of the skill by convention. |
| same — Claude model-id hyphen, Codex model retirement | Dotted ids and retired slugs misread as auth failures. | Fixed | Documented verbatim in `references/claude.md` and `references/codex.md`; dropped from the note as duplicates. |
| same — non-Grok models via Cursor allowlist | May not honor the shell allowlist. | Insufficient evidence | `cursor.md` documents allowlist as subcommand-keyed; no reproduction. |
| same — `review codex` rejects `-p` with `--base` | `codex.md` claims composition that the real CLI rejects; seat sub-dispatches other backends when it has no instruction slot. | Accepted as leaf 01 | Reproduced live against codex-cli 0.149.0 and through the wrapper (`backend-exit: 2`). Doc-only; the wrapper smoke's `FAKE_BIN` stub does not model the real grammar and is explicitly out of scope. |
| same — panel independence | Shared-scratchpad reviewers are not independent. | Duplicate (mostly institutionalized) | `../code-quality-2026-08-01/DRAIN.md` mission template carries the independence clause; residual only for ad hoc hand-dispatched panels. |
| same — ts-graph under review fan-out | Memory-heavy CLI OOM'd parallel review. | Fixed | Skill removed (`bb240f5b2`); no `ts-graph` under `.claude/skills` or `.codex/skills`. |
| same — `consult claude` summary-only answer | Findings lost, only closing paragraph landed. | Fixed (prophylactic) | `SKILL.md:129` requires a self-contained final message. |
| same — cq-144 read-only preamble vs requested execution | Same seat probes some rounds and refuses others. | Accepted tradeoff | Wrapper's own comment documents the wording as load-bearing. |
| `backlog-and-documentation-drift.md` — status vs git truth | Open prose names landed SHAs; advisory ancestor check. | Duplicate / owner decision | One-time sweep finished; general check owned by `../ai-harness-audit-2026-07-21/12-*.md` and `18-*.md` (accepted, not promoted, still unimplemented — `scripts/backlog-lint-index-table.ts:113` parses only the first table). |
| same — deferred index reconciliation | "Whichever slice lands first" sections get skipped. | Duplicate / owner decision | Same leaves 12/18. |
| same — line-number citations | Plans should cite anchors, not lines. | Fixed (named instances) / duplicate (policy) | The three cited plan files no longer carry `00-index.md:NNN` citations; anchor validation ruled out of scope at `../code-quality-2026-08-01/DEDUP-CORPUS.md:295`. |
| same — leaf-number allocation | Parallel branches pick the same next number. | Owner decision (unchanged) | No allocation mechanism exists; merge-base check cannot see a sibling's pick. |
| same — module/generated-doc drift | Module index checks fail on inherited drift. | Fixed | `bun run module:index:check` → `module:index: OK` at HEAD. |
| `coverage-threshold-drift.md` — `scripts/**` functions | 92.93% vs 93% floor. | Fixed | Re-measured 2026-08-25: functions 93.77%, all four metrics clear `vitest.config.ts:61-67`. |
| same — `eslint-rules/**` | 70/67/69/53 vs 79/74/74/69. | Too large / owner decision | Re-measured: gap unchanged, ~40 files, several under 50%. Real test-writing work or a deliberate re-baseline; `AGENTS.md` forbids opportunistic floor-lowering. |
| same — `tools/lint-ratchet/src/**` | 85/83/76 vs 90/90/80; branches now failing too. | Too large / owner decision | Worst files are CLI/process wrappers (`git-rail/executable-*.ts`) needing process-mocking; `governance/ratchet-coverage.ts` is exercised only by shell fixtures and is invisible to V8. |
| same — `eslint-config` project split | Ruled out as the cause. | Preserved disposition | No live-tree contradiction. |
| `focused-verification-gaps.md` — shell smokes to Vitest wrapper | `.sh` positional exits 0 with no tests. | Fixed | `scripts/vitest.sh:38-39`; `../pain-points-2026-07-29/14-*.md`. |
| same — package test commands | `bun run test -- <file>` from a package falls through to `/usr/bin/test`. | Duplicate / owner decision (unchanged) | No package defines a `test` script; adding aliases vs documenting root-only use is the open contract call. |
| same — concurrency drift parser selection | `verify:changed` misses the drift test. | Duplicate (closed, won't fix) | `../pain-points-2026-07-29/07-*.md`. |
| same — fast-commit defers behavioral checks | Registration catches structural only. | Fixed (documented) | `docs/guides/verify-gate-lifecycle.md:87-98`. |
| same — untyped `safeParse` fixtures | Required-field additions invisible to typecheck. | Fixed | `packages/shared/src/test/parse-helpers.ts:27`; `../agent-pain-points-2026-07-21/11-*.md`. |
| same — 15× fixture-dependency scan slowdown | Escaped fast-commit, timed out under full suite. | Insufficient evidence | No scanner or commit identified. |
| same — non-vacuity precondition broke a synthetic fixture | Empty `scripts/tests` fixture. | Fixed | `scripts/tests/test-harness-check.sh:250-261` seeds a minimal smoke. |
| same — standalone vs gate PATH (hadolint) | Wrapper resolution differs by PATH. | Fixed | `scripts/lint-config-sensors.sh:351-367`; fixture rule at `test-lint-config-sensors.sh:175-179`. |
| same — cache keys omit prerequisite freshness | Rebuilding shared does not invalidate a cached client failure. | Duplicate / owner decision | `../ai-harness-audit-2026-07-21/03-*.md` still Proposed; `bun-run-quiet.sh:227-231` fingerprints source only. |
| `gate-diagnostics-and-process-lifecycle.md` — cross-worktree logs | Stale or cross-worktree log identity. | Fixed | `scripts/lib/verify-state-paths.sh:184-188,264-267`; `verify-evidence-transaction.sh`. |
| same — foreground commands yield before process trees exit | `PRE-COMMIT ALREADY RUNNING` after an apparently returned command. | Insufficient evidence | Wrappers `setsid`, `wait`, and close lock fds (`parallel-step.sh:34-42`); no live reproduction. Needs a `ps`/`lsof` capture at the next occurrence. |
| same — contradictory success reporting | `Commit failed (exit 0)` on a successful commit. | Fixed (reproduced) | Sandbox commit through the live `git-commit-quiet.sh` reports `Commit succeeded`; success branch at `:274-291` exits before the failure summary is reachable. |
| same — long checks lack progress | Sub-step heartbeat. | Duplicate (settled rejected design) | `../ai-harness-audit-2026-07-21/20-verify-output-signal.md`; serial current-step line live at `verify-engine.sh:297`. |
| `gate-timeouts-and-load.md` — memory-fixture wall-clock assertion | `<5s` assertion in a correctness fixture. | Fixed | `test-dependency-freshness.sh` no longer has `elapsed_seconds`. |
| same — registration admission timeout | 5s lacked margin. | Fixed (superseded again) | Now 45s (`verify-state-paths.sh:69`, `.husky/pre-commit:305`, `fc24199cd`); note text corrected. |
| same — actionlint timeout | 10s too tight. | Fixed | `lint-config-sensors.sh:269` defaults to 60s. |
| same — resolved-config hang guard | 30s guard flaked three times under load. | Fixed | `eslint-config-resolution-timeout.js:20` now 60s (`d4ee2cd89`). |
| same — CPU arbitration / load-adaptive budgets | Rejected design. | Preserved disposition | Kept verbatim. |
| same — whole-verify timeout from hung `test-skill-dispatch-wrappers` | Suite has no per-suite deadline and its `cleanup()` does not reap backgrounded wrappers. | Owner decision (open, unowned) | `scripts/test-scripts.sh` has no per-suite `timeout`; `test-skill-dispatch-wrappers.sh:48-55` kills only `FOREIGN_INDEX_HOLDER`. Two remedies (suite self-cleanup vs slot deadline) need a call. |
| same — lock-wait timeout misreported as watchdog | 1s margin; assertion checks only `exit_code -eq 124`. | Owner decision (open) | `test-verify.sh:2795-2830`; `verify-engine.sh:170-178` returns 2 on lock wait with no output discrimination. |
| `git-hooks-and-commit-workflow.md` — command parsing / target attribution | Literal-target defects. | Fixed | `e345e88f`; `git-classify.sh:141`. |
| same — compound targets | `switch -c … && commit` and `$()` cases. | Duplicate | C8 rider `../agent-pain-points-2026-07-21/03-*.md` / `../ready-2026-07/13-*.md`, unlanded. |
| same — stash / partial commits | Stash blocked; no partial-commit flow. | Fixed / owner decision | `AI_POLICY_GIT_STASH` at `git-classify.sh:549`; relaxation is policy. |
| same — merge subjects | `merge(...)` type rejected; `chore(merge)` undocumented. | Owner decision | Reproduced: git-default `Merge branch` subjects pass via commitlint's ignore list; only custom subjects hit `type-enum`. |
| same — `land.sh` invocation ambiguity | Which worktree holds main. | Fixed | `scripts/land.sh:238-261` fails fast with the recovery command. |
| same — stale `origin/main` blocks ratchet retirement | Preflight only resolves `origin/main`. | Owner decision (tracked in lint-ratchet note) | `--base-ref` exists (`cli-catalog.ts:152`); default policy unsettled. |
| `harness-registration-and-generated-surfaces.md` — H8 | Two hand-maintained closure lists. | Fixed (by design) | `test-test-scripts.sh:893-899` documents the intentional two-way lock. |
| same — H14 | Path-policy ownership incomplete. | Fixed | `c5ef1d3bf`, `cff24df1d`, `be16eea1e`, `f49570bda`. |
| same — seed-import closure fingerprint | Input list drifted from the walker. | Fixed | `cb81b2b81`. |
| same — new workspace package (CQ-181) | ~21 surfaces, two uncaught. | Accepted as leaf 05 | Checklist modeled on the doc-generator checklist added in `76674b535`. |
| same — coverage-map hand-editing | Historically hand-edited. | Fixed | `docs/generated/lint-coverage-map.md:14`. |
| same — land.sh order pins with two stub-log formats | Two tests pin the same order differently. | Insufficient evidence | Not re-verified this pass. |
| same — CQ-133 auto-discovered vs inventory count | Briefs conflate registration with count. | Insufficient evidence | No doc addresses it. |
| same — CQ-136 WARN vs hard error | Commit gate warns on staleness that `harness:check` hard-fails at land. | Accepted as leaf 04 | Message-text-only; the commit-time hard-fail alternative is a separate owner call. |
| same — smoke-subject exact-list gotcha (both directions) | Widely-touched subject invalidates exact-set pins. | Fixed (documented) | `scripts/README.md` in `76674b535`. |
| same — manifest overlap validation | No overlap check for `generatedSurface` paths. | Insufficient evidence | Live manifest has no overlap. |
| same — JSON Unicode escapes | Round-trip phantom diffs. | Owner decision | 13 `—` escapes still present; needs a canonical serializer choice. |
| same — slow reduced fixtures | Full fixture rebuilt per case. | Duplicate / too large | `../code-quality-2026-07-25/27-shell-test-substrate.md`. |
| same — per-file line caps force a new module | Five surfaces for a late split. | Owner decision / too large | Unit 110 instance resolved; no headroom-surfacing feature. |
| same — deleting a check drops the smoke-subject header | Pre-push subject swept despite surviving readers. | Fixed | `test-harness-check.sh:28-31`. |
| same — general "who else reads this file" tripwire | Structural reachability check. | Too large | Genuine design question. |
| same — `.husky/pre-commit` smoke-subject asymmetry | Read by `registration-preflight-wiring.ts`, not a `test-harness-check` subject. | Accepted as leaf 03 | Confirmed via subject headers and `path-policy-smoke-subjects-data.ts:135,186`. |
| same — bash facade invisible to knip | Thin exec-forwarder defeats entry-root reachability. | Insufficient evidence | Only one worked-around example. |
| `lint-ratchet-and-source-policy.md` — net-neutral moves | Renames charged as new debt. | Duplicate (open) | `../agent-pain-points-2026-07-21/10-*.md`, Proposed. |
| same — rule-source hash drift | Stale installs give an ambiguous diagnosis. | Owner decision (preserved) | No `ruleSourceHash` diagnosis in doctor. |
| same — `--allow-worse` ignores untracked files | New file's findings invisible to update. | Accepted as leaf 07 | All four entry points fall back to `git ls-files` (`tools/lint-ratchet/src/kernel/git-tracked-files.ts:16`); guide never says to stage first. |
| same — zero-match globs | Dead globs bypass a ratchet. | Fixed | `lint:ratchet:check-registry` rejects them. |
| same — redundant max-lines caps (CQ-143) | Audit never warns on a now-unneeded cap. | Accepted as leaf 06 | `auditEntryCaps` (`max-lines-exceptions.ts:109-163`) has only missing/unreadable/cap-below. |
| same — NUL byte in source | Hidden from Git text tooling. | Fixed | `../pain-points-2026-07-29/09-*.md`. |
| same — static SRD catalogs vs max-lines | Dense tables trip the cap. | Fixed | Baseline carries the durable exception. |
| same — exact-clone counts rise on normalization | Renames reveal latent clones. | Duplicate (open) | Ready C3 / `../lint-review-followups-2026-07/02-*.md`. |
| same — near-duplicate identities after shrink | Fuzzy-tier analog. | Insufficient evidence | Folded under C3 conceptually. |
| same — word-boundary codemods rewrite `.message` | Generic codemod hits property accesses. | Insufficient evidence | Caught by typecheck; no reusable codemod surface. |
| `subagents-and-review-convergence.md` — result delivery | Subagents go idle without reporting. | Duplicate | `../agent-pain-points-2026-07-21/05-*.md` still a probe candidate; `TeammateIdle` unsupported in `hook-wiring-schema.ts:63`. |
| same — scope checkpoint (enforcement) | Wrapper-enforced stop threshold. | Owner decision (preserved) | `../pain-points-2026-07-29/01-*.md` "review loops" row. |
| same — scope checkpoint, coverage-deletion check, fail-open severity bar, settled dispositions, unanswerable-without-checking, blocked reviewer, P2 institutionalization | Working rules not in the skill. | Accepted as leaf 08 | None found in `.claude/skills/agent-cli/SKILL.md`; bundled as one doc-only leaf. |
| same — review independence | Orchestrator owns review dispatch. | Duplicate / external | Same disposition as the 07-29 ledger. |
| `test-fixtures-races-and-environment.md` — lock-fixture setup sleeps | Fixed sleeps. | Fixed | `dc2e58048`, `e17fe50ad`; `../pain-points-2026-07-29/06-*.md`. |
| same — `MUSI_SCRIPTS_CONCURRENCY` leaks into the runner self-test | Ambient override breaks assertions both ways. | Accepted as leaf 09 | Both directions reproduced live; `run_runner()` defaults instead of forcing. |
| same — commit-queue ready-but-expired race | Holder expired before the nested hook checked. | Fixed | `test-dependency-freshness.sh:690-749`. |
| same — repo-root marker race | Suite raced itself on `.allow-protected-edits`. | Fixed | `1fe5b424`, `fec03ab7`. |
| same — ai-hooks suite deadlocks when chained with `git commit` | Outer wrapper's queue lock held through the nested suite. | Accepted as leaf 10 | Mechanism confirmed at `git-commit-quiet.sh:102-146`; which fixture invocations share the real lock is not enumerated and is out of scope. |
| same — combat-store spy leak | Exact-call-count assertion leaks under no-isolate. | Duplicate | `../testsuite-audit/00-report.md` #16; `../client-test-isolation-step3/`. |
| same — Radix Select JSDOM shims | Local duplication. | Fixed | `packages/client/src/test/setup.ts:208-222`. |
| same — import-closure 180s slot exhaustion | Load correlation. | Insufficient evidence | One incident. |
| same — hadolint cache fixture race | Cache creation missed under load. | Duplicate | Already `flock`-guarded; `../ai-harness-audit-2026-07-21/03-*.md`. |
| same — fsmonitor stale cleanup | Cleanup trusted stale state. | Fixed | `test-skill-dispatch-wrappers.sh:4154-4155`. |
| same — deterministic DB race seams | Barrier/jitter over probabilistic races. | Fixed | `docs/CONCURRENCY.md:652`. |
| same — Playwright cache | Shared cache unwritable. | Owner decision | Same as the worktree note. |
| same — Stryker `.tools/lib64` | Sandbox copy failure. | Fixed | `stryker.config.mjs` ignores `.tools`. |
| same — `process.chdir()` in Stryker worker | Unsupported. | Duplicate | Code-quality leaf 31 (H15), partially landed. |
| same — orphaned synthetic-load spinners | Busy-loop cleanup. | External | Not repository code. |
| `tooling-and-skill-documentation.md` — ts-graph `refs --name` | Invalid form in the skill. | Fixed | Skill removed; `docs/guides/code-intel.md:110` uses the positional form. |
| same — migration guide vs blocked `psql` | No Prisma-mediated data-migration recipe; `db:push` wording bug live in `policy-rules.generated.sh:13,77`. | Duplicate / owner decision | `../ai-harness-audit-2026-07-21/10-prisma-guidance-accuracy.md` (accepted, not promoted). |
| same — slow-test one-liner | `MUSI_VITEST_VERBOSE_SUCCESS=1 … --reporter=verbose` undocumented. | Insufficient evidence (doc gap) | Works today (`scripts/vitest.sh:75`); no live failure to bound a fix against. |
| same — ai-hook suite progress | 4,770-line suite prints nothing until done. | Duplicate (rejected design) | Leaf 20 above. |
| same — shared Stryker factory | `.ts`/`.mjs` configs could not share. | Fixed | All four configs import `stryker.shared.mjs`. |
| `worktree-provisioning-and-isolation.md` — stale `node_modules` at init | `ensure_dependencies` checks existence only. | Duplicate / owner decision (preserved) | `worktree-db.sh:956-1000`; freshness digest wired only into doctor/pre-commit. |
| same — partial shared build output | Survived branch switches. | Fixed | `99d223ff1`; `scripts/dev.sh:162-186`. |
| same — unprovisioned peer blocks init | GC failure propagated. | Fixed | `../pain-points-2026-07-29/08-*.md`; `worktree-db.sh:87-90,483-490,1315-1326`. |
| same — lightweight (docs-only) worktrees | No supported setup. | Owner decision (preserved) | No such flag in `worktree-db.sh` / `worktree-new.sh`. |
| same — browser cache isolation | No per-worktree Playwright cache. | Owner decision (preserved) | No `PLAYWRIGHT_BROWSERS_PATH` wiring. |
| same — teardown contract | Recovery needed hand-built commands. | Fixed | `../agent-pain-points-2026-07-21/07-*.md`; `worktree-new.sh:188-191`, `worktree-db.sh:1406-1467`. |

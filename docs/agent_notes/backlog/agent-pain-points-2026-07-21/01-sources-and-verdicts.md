# Sources and Verdicts

Status: Parked — triaged audit evidence
Date: 2026-07-21

## Method

The audit covered every nonblank pain-point entry in the pre-migration source
now preserved at
`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log`
(physical lines 3–33), the available named Claude memories under
`/home/node/.claude/projects/-workspace/memory/`, the live implementation and
focused tests, repository history, and the complete backlog. The memory cited
for the `FORCE_VERIFY` incident was unavailable; the orphan-process memory was
present during initial triage but was pruned before final verification. Those
verdicts were therefore re-established from the archived log, live regression
tests, and history instead of relying on durable memory files.

Ten parallel discovery lanes checked separate subsystems and duplicate
ownership. Six refute-first reviewers then challenged implementation
feasibility, safety, scope, priority, links, and portfolio value. Revision lanes
folded the confirmed findings back into the leaves and existing canonical
owners. The table below is the resulting disposition, not the first-pass claim.

## Reconciliation

| Archived log line | Verdict | Evidence and disposition |
| --- | --- | --- |
| 3 — generated lint-coverage map | **Existing duplicate; partly stale** | `76b5a209` added the checked drift-ai block generator, so “no generator” is stale. The broader authored-Markdown problem remains owned by [coverage map as data](../lint-arch-review-2026-07/07-coverage-map-as-data.md); no duplicate leaf was added. |
| 5 — duplicated `land.sh` test pins | **Live actionable** | Only `test-pre-push.sh` has exact whole-log pins; `test-land.sh` uses a separate semantic event model. Follow-up repairs `0f584804` and `dff40db9` prove the sibling model can go stale. [Leaf 02](./02-consolidate-land-flow-test-ownership.md) moves unique cases before making the land suite authoritative. |
| 7 — full-gate structural flakiness | **Fixed/stale** | Shared heap policy (`8e3afdad`), memory admission (`97e984ae`), serial ESLint partitions (`d714f4ce`), and worker caps addressed the recorded structural load failures. The config smoke is now only a low-priority “act if it repeats” observation; no fresh reproduction justified a leaf. |
| 9 — hook command resolver | **Existing owner plus binding correctness override** | The failures are real, but implementation belongs solely to [ready C8/leaf 13](../ready-2026-07/13-command-policy-ts-core.md). [Rider 03](./03-resolve-hook-command-targets.md) is non-schedulable and now binds C8's target model, corpus overrides, and exact same-target branch transition. |
| 11 — orphaned Codex processes | **Live but not scheduled** | Existing TERM/INT/HUP and clean-exit cleanup does not cover wrapper `SIGKILL`; the current wrapper regression explicitly preserves the surviving backend and manual kill. [Leaf 04](./04-bound-agent-backend-lifetime.md) proposed a cross-adapter supervision contract; the owner cancelled it on 2026-07-22, so manual recovery remains the documented path. |
| 13 — missing implementer report | **Probe-backed actionable; implementation conditional** | The incident is reproduced, and `TeammateIdle` exists but is unwired. Stable teammate/lead/task/cycle attribution is not proven. [Leaf 05](./05-require-attributable-teammate-handoff.md) therefore treats an attributable receipt probe as the task; unsupported/unwired is a valid NO-GO outcome. |
| 15 — shared stash list hazard | **Live actionable** | Git stash is common-dir shared, so neither primary nor linked checkout proves ownership. [Leaf 06](./06-block-linked-worktree-stash-mutations.md) uses a repository-wide agent allowlist (`list`/`show`/`create`/help only) rather than a linked-only or enumerated-mutator rule. |
| 17 — residual registration surfaces | **Mixed** | The portable demo-sync surface was deleted, and generated-surface snapshot arrays remain intentional completeness tests. Earlier skill-inventory work landed comparison but not refresh. [Leaf 08](./08-generate-skill-mirrors-and-subjects.md) owns checked-in skill projection and derived smoke subjects without runtime indirection. |
| 19 — lint-ratchet path renames | **Live actionable; canonical owner established** | The gap previously survived only as prose in a completed package-seam leaf. [Leaf 10](./10-lint-ratchet-path-renames.md) is now authoritative, and the old leaf/index link to it. Ordered identity replay replaces the rejected path-only preprocessing design. |
| 21 — fast-commit late tripwires | **Mixed** | Fast mode still defers structural registration feedback, so [leaf 09](./09-fast-commit-registration-preflight.md) owns a narrow blocking admission seam. It does not claim to catch independent behavioral snapshot assertions; those remain intentional late tripwires until safely single-sourced. |
| 23 — external consult reliability | **Mixed** | Cursor capacity is external, and Copilot intro-only success was fixed by `fd51b55a`. [Leaf 12](./12-decouple-copilot-retry-artifacts.md) owns only safe retry coherence: exclusive per-answer attempt ownership, finalized-no-answer retry, distinct transcripts, and atomic answer publication. |
| 25 — prefixed environment leak | **Fixed/stale** | Merge `a196c01b` unsets `FORCE_VERIFY` before slot launch, and the focused forced-path regression proves every slot sees it unset. A generic composed-proof framework was rejected absent another recurrence. |
| 27 — ai-hooks self-concurrency | **Existing duplicate plus stale half** | The clamp startup race was fixed by `ee1dd689`. The remaining shared-marker race is already owned by [ai-hooks suite self-concurrency](../ai-hooks-suite-self-concurrency.md). |
| 29 — shared-schema fixture blindness | **Live actionable** | The incident fixture was repaired, but direct positive `safeParse` inputs remain type-erased. [Leaf 11](./11-type-positive-schema-fixtures.md) adds a schema-aware positive helper while retaining an explicit result-only helper for wrapper APIs such as `validateHomebrewData`; negative/unknown inputs remain runtime cases. |
| 31 — docs-only lint-rule starter guard | **Fixed/stale** | `167ad8e5` added the executable starter check and `3f97773d` proved rule activation. Generated verify steps run it; no leaf was added. |
| 33 — `worktree:drop` teardown ambiguity | **Mostly fixed; narrow residue** | `worktree:drop <path> --remove` and its safety guards are live. Only `worktree:new`'s stale emitted two-command recovery remains. [Leaf 07](./07-make-worktree-recovery-single-command.md) fixes that output and deliberately retains an explicit second-run “not a git worktree” failure instead of adding teardown receipts. |

## Rejected or narrowed designs

- Do not infer command targets by evaluating shell, add a second command-policy
  task, or preserve known-wrong Bash parity.
- Do not build durable teardown receipts merely to make an already-completed
  removal return success twice.
- Do not parse private teammate transcripts as the assumed handoff design; an
  attributable hook receipt must be proven first.
- Do not treat the primary checkout as stash owner or enumerate only today's
  known mutating stash verbs.
- Do not run full `harness:check` as the fast preflight or claim structural
  checks cover behavior-owned test snapshots.
- Do not model ratchet rename chains by rekeying paths only; accepted-debt
  identity and all lifecycle collectors require ordered replay.

## Queue boundary

This is an evidence pack, not an execution queue. Existing canonical leaves
retain ownership, and accepted candidates enter the normal ready queue only
after an owner priority decision.

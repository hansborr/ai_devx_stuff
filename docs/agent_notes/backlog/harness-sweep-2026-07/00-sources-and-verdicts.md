# 0. Sources, sweep design, and recorded verdicts

Status: Shared context for this pack — read before promoting any leaf.
Created: 2026-07-11

This companion records how the pack was produced and, critically, the full
**kill list**: every candidate the adversarial judging pass rejected, so nothing
in it is silently re-proposed. Leaf verdicts are in [`00-index.md`](./00-index.md);
this file is the provenance and the rejects.

## Provenance

The pack is the accepted residue of a wide multi-model harness sweep run on
2026-07-11, requested with the explicit goal of making the repo a public
reference for harness engineering (copyability and clarity count as much as
correctness). The mission brief focused reviewers on the lint stack and ratchet,
the verify/commit-gate pipeline, the harness meta-tooling, and general
`scripts/`-tree quality, and required that findings already filed in the
2026-07 packs be deduplicated rather than re-proposed.

### 16 sources

**13 lens agents** (Claude Fable / Opus subagents, one focus area each; every
`file:line` citation read from code, speculative items dropped):

- **7 code-reading explorer lenses** over the tree — `copyability`, `dogfood`,
  `eslint-local`, `fresh-eyes`, `gates`, `ratchet-core`, `scripts-quality`.
- **6 web / prior-art researcher lenses** — `agent-harness`,
  `eslint-ecosystem`, `evals-guardrails`, `ratchet-prior-art`,
  `verify-prior-art`, `worktree-lanes`.

**3 cross-CLI consults** on the same mission brief, for model diversity (their
findings are attributed in leaf `Sources:` lines as `codex` / `grok`):

- **GPT-5.6** via the Codex CLI (`codex`).
- **Gemini 3.5 Flash** via the Copilot CLI.
- **Grok 4.5** via the Cursor CLI (`grok`).

### Clustering

The 16 sources' ~105+ raw findings were deduplicated into **99 candidate
clusters** (`clusters.json` in the sweep scratch). Clustering merged
cross-source convergence (the strongest promotion signal) and cross-referenced
each cluster against the already-filed 2026-07 packs.

### Adversarial judging — one judge per cluster

Every one of the 99 clusters was judged independently by a single adversarial
judge instructed to reject speculative infrastructure, already-filed or
already-solved substance, and gold-plating that cuts against the copyability
pitch. The judge split was capacity-driven: **14 clusters judged by Claude
Fable, 85 by Claude Opus**. No cross-judge consensus was required — each verdict
is one judge's call.

Outcome: **40 accepted (each with a drafted, citation-checked leaf), 59
rejected.** The accepted leaves are what this pack contains, renumbered `01`–`40`
and grouped by theme; each was drafted the day it was judged, so its Evidence
block carries the `verified 2026-07-11; re-verify before implementing` framing.

Accepted by theme: ratchet 10, gates 8, docs-copyability 6, dogfood 5,
lint-rules 4, scripts-quality 4, research-adoption 3.

## Kill list — 59 rejected clusters

Recorded so nothing below is re-proposed without new evidence. Reasons are
condensed from the judges' verdicts; the recurring rejection axes are
*already-filed / already-solved substance*, *no triggering scenario*, and
*speculative infrastructure that cuts against a single-author public-reference
repo*. Cluster ids (`cNN`) are the sweep's internal numbering.

### Research-adoption (40)

| id | Candidate | Why rejected |
|---|---|---|
| c57 | Location-aware (per-file/per-scope) baselines so moved debt can't hide | False premise: the baseline is already per-file with sha256 fingerprints and flags any per-path rise, so moved debt already cannot hide. |
| c58 | Split rules into a ratchetable set and a never-suppressable strict layer | The grandfathering danger can't occur here: the ratchet is an explicit opt-in registry, strict rules already run as `error` outside it, and the coverage map already governs classification. |
| c59 | Auto-prune the ratchet baseline downward on every commit | The failure it fixes doesn't exist (the gate is deliberately symmetric and fails on un-reflected improvements), and auto-staging a baseline rewrite violates the never-auto-commit/human-reviewable invariant. |
| c60 | Changed-lines-only (Boy-Scout) strict enforcement on the baseline | Speculative diff-hunk infra whose only gain over the net-count ratchet is catching rare intra-file shuffling, and it reintroduces the unimplemented-mode anti-pattern the maintainer deliberately excised. |
| c61 | Expiry / review-by dates on baseline entries that fail when they lapse | Expiry deadlines are a team-accountability mechanism with no forcing function in a single-author repo, and the ratchet is already monotone with zero stale paths. |
| c62 | Debt ownership via CODEOWNERS with per-owner burndown | Single-author repo (no CODEOWNERS) makes per-owner burndown a one-row table, and the cited "drain lanes" are AI worktrees, not human owners. |
| c63 | Debt-trend history sidecar with velocity/ETA for ratchets | The trend/history substance already ships as lint-ratchet-trend.ts (zero-new-state by design); the velocity/ETA/alert layer is a vanity metric in a single-author repo. |
| c64 | Extend the ratchet to TS strictness via per-line fallback tools | Already filed as HS-1 in harness-strictness-comprehension-2026-06, and the cited example flag (noUncheckedIndexedAccess) is already enabled. |
| c65 | Plan the ESLint v9 -> v10 migration before v9 EOL | The repo is already on ESLint 10.4.0, so the entire migration this candidate proposes to plan has already shipped. |
| c67 | Register the official ESLint MCP server for agent lint-and-fix | Stock @eslint/mcp cannot reproduce this repo's customized gate (ratchet, local rules, shell/cycle/suppression checks), and the existing note already decided CLI-first with MCP as a thin adapter only. |
| c68 | Spike Oxlint as a fast pre-check layer ahead of ESLint | Already explicitly rejected as D7 (harness-review-2026-05): the value is ~18 custom AST rules plus an ESLint-built ratchet with no oxlint equivalent, and per-edit speed is already solved via cached hooks. |
| c69 | Curate repo-tailored AI-guardrail rules from observed agent failures | The repo already does this: the cited patterns are implemented as local rules (no-async-array-callbacks, no-swallowed-errors, no-llm-artifacts), and the cited source already appears in the repo's research. |
| c70 | Document @eslint/config-inspector for unexpected ratchet count deltas | False: the ratchet uses its own generated per-rule configs (not the flat config config-inspector visualizes) and already flags deltas via hashes; the single-rule probe already ships as lint:probe-rule. |
| c71 | Agent-legible error contract + ratcheted linter for house tooling | The enforced contract already exists (message-guidance.test.js) and the surfaces were drained by the Done lint-messaging-2026-07 pack; a blanket ratchet across all CLI exit sites is speculative over-engineering. |
| c72 | Concise/detailed verbosity + truncation steering for agent CLIs | The proposal's own prime candidate (code:intel) already implements truncation-with-steering; the remaining cross-CLI verbosity switch is speculative infra with no cited need. |
| c73 | Harness behavioral eval suite: golden tasks graded on outcomes | Already covered by EV-1 (golden-task-eval-harness); the only extras are minor, and PR-gating is one EV-1 deliberately defers. |
| c74 | Definition-of-done Stop/SubagentStop gate on agent done signals | Exactly what the standing owner ruling arch-review-2026-07/19 (Done) forbids; it already removed hard-stop mode and unwired SubagentStop for this reason. |
| c75 | Runtime-observation CLIs: live DB/socket/log inspection | Already owned by the parked-by-design worktree-local-observability.md, which defers exactly this richer tooling until foundational log capture exists. |
| c76 | Outer-loop /reflect skill distilling session discoveries into docs | Already captured as a deliberately-deferred frontier pattern, its mechanics duplicate add-module-doc.md, and an automated reflection nudge is the doc-slop risk the repo warns against. |
| c77 | Tool-risk annotations driving a generated permission allowlist | Speculative allowlist generation that contradicts the repo's documented no-wildcard-allowlist stance; the policy-as-data substance is already covered by existing leaves. |
| c78 | Spec-as-source-of-truth layer upstream of task packs with drift check | Thin-spec substance already covered by harness-review-tasks/51; the only delta (spec-citation enforcement + spec-to-code drift) is the heavy SDD ceremony that review already rejected. |
| c79 | Generated public HARNESS.md disclosure from harness.controls.json | Already exists as docs/generated/harness-controls.md; the distinctive lane/model/budget disclosure isn't derivable (that data is absent from the source), leaving only a README-link reframe. |
| c80 | Auto-generate backlog leaves from Stryker survivors | The survivor-to-leaf work was already delivered manually (mutation-coverage-2026-06); a script (mutation runs are manual-only) would flood the backlog with equivalent-mutant noise. |
| c81 | Secret-scanning tripwire (ggshield) at the PostToolUse hook layer | Already owned by the design-gated SEC-1, whose open questions cover the placement decision; the hook-layer angle is a candidate answer to that parked question, not new substance. |
| c82 | Process-level sandbox/container isolation for unattended lanes | The idea and its source are already filed, lanes already run in a devcontainer with a network firewall, and port/Redis collisions are handled by the allocator being hardened elsewhere. |
| c83 | LLM-judge advisory review gate with a golden dataset of past bugs | The golden-dataset substance is already covered by EV-1, which defers LLM-as-judge behind a deterministic v1; adding a judge to verify:changed also violates that pack's pre-commit-budget non-goal. |
| c84 | Canary-token tripwire for cross-CLI prompt injection | Speculative security infra from one blog source with no triggering incident; the canary-grep only catches injections that re-emit the exact planted token, and analogous tripwires are already parked. |
| c85 | Conftest/OPA structural policy gate for config-surface changes | Config-surface registration is already CI-enforced in TS, and the repo's idiom for residual gaps is a TS parity test; a Go binary plus a Rego DSL is a worse public reference than the existing manifest pattern. |
| c87 | Toolchain-version-aware verify-marker fingerprints (moonrepo-style) | bun.lock is already folded into the fingerprints, and bun-binary-version drift is deliberately handled by the documented time-bounded freshness window; redundant infra contradicting an existing decision. |
| c88 | Flake pipeline: retry detection, formal quarantine, agent repair | A working lightweight flake pipeline already exists (registry + known-flaky matching + retry-in-isolation), and the centerpiece soft-fail quarantine conflicts with the repo's fix-not-quarantine discipline. |
| c89 | Bisect batched multi-lane merges to attribute post-drain failures | The merge-queue-bisect analogy doesn't fit: land.sh merges one branch at a time, the single integration verify is by-design, and cross-lane defects a per-lane bisect can't attribute are already handled by joint review. |
| c90 | Historical-timing bin-packing to reorder parallel verify slots | Every slot launches as its own concurrent job with no worker pool, so wall time is max(slot durations) and reordering launch order is a no-op. |
| c91 | Name the blocking-vs-informational check tiers; audit slow steps out | The audit-slow-steps substance is already covered by the parked slow-test-tier-candidates.md, and the novel "informational tier" contradicts the repo's deliberate all-blocking gate model. |
| c92 | Risk-ranked predictive ordering of changed-scope tests | Rests on per-test-file timing data the harness doesn't persist, and even so the payoff (ordering within an already-narrow parallel run) is marginal with no triggering pain. |
| c93 | Hook-engine prior art (lefthook, prek) as design references | Speculative deferred-note with no triggering need: the in-house parallel-step.sh works, and prek (a Python hook framework) is inapplicable to a Bun/TS repo. |
| c94 | Copy-on-write thin-clone worktree databases (PG18 clone / CoW volume) | Speculative: the current WITH TEMPLATE clone is a sub-second copy, while adoption demands a PG17->18 major upgrade plus a CoW-filesystem guarantee the devcontainer can't control, for negligible gain. |
| c95 | Decentralize lane provisioning into per-lane files vs allocations.json | The blast-radius problem was fixed by the resolved sibling provisioning leaves; decentralizing still needs the allocation flock and adds a corruption-prone rebuildable index. |
| c96 | Pre-warmed worktree lane pool + baked shared-build step | The pool saves only ~13s of cheap hardlink-backed provisioning while adding claim/refill/staleness complexity, and the salvageable shared-build rider is already documented in the drain recipe. |
| c98 | Branch-per-PR ephemeral CI database for e2e isolation | CI already provisions a fresh isolated Postgres container per run, so the candidate's own trigger is false and its proposal self-negates ("skip if CI already provisions per-run DBs"). |
| c99 | Self-driving CI-fix loop per lane: bounded auto re-dispatch on failure | Single-lens speculative orchestration stacked on unbuilt c97, with a real footgun: auto re-dispatch on verify failure would thrash on the flaky gates the drain recipe already documents. |

### Gates / verify pipeline (8)

| id | Candidate | Why rejected |
|---|---|---|
| c18 | GNU-only stat -c / date -d not portable to macOS/BSD | Real but overstated: pre-push fails closed via a portable marker path and verify-logs/cache degrade fail-safe; with no macOS/BSD runner a shim is speculative, and the one real value (an "assumes GNU coreutils" note) belongs in copyability leaves 19/75. |
| c21 | Commit-gate suppression scanners read the worktree, not the index | Every gate path runs musi_changed_gate_fail_if_unstaged before the suppressions slot, aborting on any unstaged/untracked source file, so the scanner only ever reads a worktree equal to the index; the failure is unreachable. |
| c22 | Heap policy doesn't reach the bun lint:ratchet entrypoint | Already owned by harness-explore-2026-07/02, whose acceptance requires direct full-tree runs (including lint:ratchet:update) to carry the raised heap; this is a fold-in implementation note, not a new leaf. |
| c23 | land.sh current-branch mode merges the mutable ref, not the frozen SHA | Literally true but non-reproducing: the branch is held as worktree HEAD throughout the ~10-min verify, and the tree-comparison gate (land.sh:214) already blocks pushing a divergent merge. |
| c28 | Main-lane ESLint cache identity rotation on TS edits is a defect | The rotation is the documented, tested soundness mechanism (lint-deep-dive-2026-07/21, Done); the "cold at land" claim is false since prune preserves the current, unchanged-tree fingerprint dir. |
| c29 | Pre-commit generated-surface advisories run serially before short-circuit | Single-lens P3 whose pure-time fix duplicates harness-explore-2026-07/14, and whose cheap reorder trades away the only commit-time generator-freshness signal; fold as a note into leaf 05/14 instead. |
| c30 | Diagnostic sensors (harness:audit, blob-size, knip) never run in CI | False: sensor:knip-unused-exports is a blocking CI slot and harness:audit runs in slow-drift.yml; only blob-size lacks CI wiring and it is already subsumed by the parked ci-local-gate-parity-guard.md. |
| c31 | Serial verify run_step omits the parallel launcher's env scrub / FD-8 close | No-ops on the serial path: verify.sh never opens FD 8 and never runs under a git hook, so there is no triggering failure; the DRY angle is subsumed by harness-explore-2026-07/10. |

### Scripts-tree quality (4)

| id | Candidate | Why rejected |
|---|---|---|
| c36 | Fixture lint-stack copy-set hand-duplicated across 6+ shell smokes | The same drift tax is already filed as the parked fixture-copy-set-import-graph-guard.md, which deliberately chose a drift guard over dedup because the copy-sets legitimately vary per smoke. |
| c37 | Split the 4,734-line test-lint-ratchet.sh monolith | Single-lens style refactor of a safety-critical merge-driver/ratchet smoke; splitting the subject map risks decoupling merge-driver edits from the baseline assertions that guard against silent corruption. |
| c39 | doctor.sh remains an ~840-line bash analysis surface | Already written into the substrate ruling (doctor.sh is the cautionary example), and arch-review-2026-07 deliberately chose incremental migration (leaf 14) over the big-bang rewrite c39 proposes. |
| c41 | harness-emit-envelope.ts hand-rolls the option loop cli.ts owns | The "behavior-identical" claim is false: migrating to parseCliArgs would regress the eleven distinct error strings the file's dedicated smoke locks; the guard code is intentional and well-tested. |

### Ratchet (2)

| id | Candidate | Why rejected |
|---|---|---|
| c01 | Serialize concurrent ratchet --update with a lock + baseline CAS | No triggering scenario: --update is a manual single invocation, parallel lanes use separate worktrees reconciled by the merge driver, and any same-worktree clobber is git-visible; locking+CAS is the gold-plating lint-ratchet-audit-2026-07/33 already ruled against. |
| c07 | Validate portable-manifest transitive import closure, not just byte parity | Already filed as the parked fixture-copy-set-import-graph-guard.md; c07 adds only a fresher anchor and an implementation shortcut, i.e. a refresh of that leaf, not new substance. |

### Docs / copyability (2)

| id | Candidate | Why rejected |
|---|---|---|
| c47 | Ship a generic manifest-vs-copy verifier for lint-ratchet adopters | The adopters' fixture consumers are the portable tests they already copy; the demo-sync guard is Musi-internal (it guards an in-repo duplicate adopters never maintain), so a generic verifier solves a non-problem. |
| c48 | examples/ index + parity notes vs the ratchet's demo | Copy-status orientation is already owned by harness-review-2026-07/75 Milestone 1 (the copy-boundary map), and a README index over a one-item examples/ dir is premature padding. |

### Dogfood tooling (2)

| id | Candidate | Why rejected |
|---|---|---|
| c52 | Doctor reports unusable MUSI_*_BIN overrides / version mismatches as PASS | Both behaviors are deliberate and documented at the cited lines (override mirroring of the lint lane; intentional no-version-compare to avoid false mismatches); the proposal contradicts documented intent. |
| c53 | drift:e2e emits a raw ENOENT stack trace when e2e/ is absent | The ENOENT is unreachable under supported use (e2e/ is a permanent dir, cwd is normalized to repo root), and the git-rev-parse self-location half contradicts the repo's uniform process.cwd() convention. |

### Lint rules (1)

| id | Candidate | Why rejected |
|---|---|---|
| c16 | Raw-SQL fence misses object-destructuring of the prisma client | Single-lens, zero-finding hardening against a contrived bypass that likely breaks at runtime (a destructured Prisma $queryRaw loses its `this` binding), so it is not a real green-the-gate path. |


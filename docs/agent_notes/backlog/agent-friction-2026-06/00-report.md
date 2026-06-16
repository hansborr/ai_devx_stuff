# Agent-Friction Backlog — analysis & proposed fixes (2026-06-12)

> **Status: proposals only. Nothing in this folder has been implemented.** Each
> implementation-plan document describes changes for you to review and approve;
> no code, config, or docs outside this folder were modified to produce it.

## Where this came from

Five pain-point logs recorded by AI agents while they worked the lint-debt,
lint-review, and drift-ai backlogs were analysed:

- `/home/node/lint-debt-pain-points.log`
- `/home/node/lint-review-pain-points.log`
- `/home/node/pain-points-drift-ai.log`
- `/home/node/pain-points.log`
- `/home/node/pain-points.log.driftai1`

**The logs are old.** Many entries cite files that have since moved or been
renamed (e.g. the coverage map moved from
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` to
`docs/agent_notes/lint-coverage-map.md`; `scripts/harness-audit.test.ts` moved to
`scripts/harness/harness-audit.test.ts`; the codex-review footguns were since
documented in the codex-cli skill). Every entry below was therefore
**re-verified against current HEAD** before being proposed. Issues that turned
out to be already-fixed or stale are listed in
[`07-already-addressed-and-out-of-scope.md`](07-already-addressed-and-out-of-scope.md)
rather than given a plan.

## Method

1. Deduplicated ~120 log entries into distinct issues (many entries are the same
   pain repeated across dozens of task runs).
2. Fanned out six read-only investigation agents (one per cluster) that each
   confirmed current behaviour with `file:line` evidence, decided
   already-addressed vs. live, and drafted a root-cause fix.
3. Prioritised by **frequency × severity × (1/effort)**.

## Design principle applied throughout

The brief was explicit: where a pain *could* be paved over with an AGENTS.md note
or a stored memory, **prefer a change that removes the need to think about the
workaround at all.** Two of the logged pains prove why this matters:

- The coverage-map `git add` ordering and the "wrong focused-test command" were
  effectively "known workarounds" yet kept recurring for months — documentation
  did not stop them.
- The codex "do not run any commands" refusal was *already in a memory*
  (`feedback_codex_review_phrasing`) and **still bit an agent again**. Memory was
  insufficient; the durable fix was putting the blessed phrasing in the skill
  itself (which has since happened).

So every plan below leads with a tooling/UX fix and only falls back to docs when
a code fix genuinely is not worth it — and says why.

## Prioritised index

Tiering is frequency-and-leverage based. "Freq" = how often the pain recurred
across the logs. Effort/Risk are S/M/L.

### Tier 1 — high frequency, low cost (do first)

| ID | Issue | Plan | Effort | Risk |
|----|-------|------|--------|------|
| B2 | Vitest/`bun test` sweep stale `worktrees/**` duplicates → spurious failures | [02](02-focused-test-ergonomics.md) | S | very low |
| B1 | No discoverable focused script-test command (`test:scripts` rejects file args) | [02](02-focused-test-ergonomics.md) | S | low |
| A1+A6 | Coverage-map: every new file flagged late; error names neither the file nor the row format; no scaffold | [01](01-coverage-map-governance.md) | M | low |
| A2 | Coverage-map `--staged` vs `git ls-files`: new mapped-but-unstaged file → "matched 0 tracked files" | [01](01-coverage-map-governance.md) | S–M | low |
| E1 | `complexity` over-counts optional-chains/dispatch in `*.test.ts` and fakes | [04](04-lint-rule-ergonomics.md) | S | low |
| K1 | `scripts/typecheck.sh` runs bare `tsc` → "command not found" off Bun's PATH | [05](05-commit-codex-typecheck.md) | S | low |

### Tier 2 — correctness or frequent, modest cost

| ID | Issue | Plan | Effort | Risk |
|----|-------|------|--------|------|
| G1 | `git commit --amend` guard fires *after* the amend already ran (real worktree-mutation bug) | [05](05-commit-codex-typecheck.md) | M | med |
| H1+H2 | Test cache keys on worktree state, not argv → broader/corrected commands wrongly skipped/blocked | [03](03-edit-hooks-and-caches.md) | S–M | low–med |
| D1 | Edit-time tidy hook reports unused/complexity/max-lines errors on *intermediate* multi-edit states | [03](03-edit-hooks-and-caches.md) | M | med |
| J1 | `drift:ai --check all` knip self-scan is silent for up to 10 min — hang vs slow indistinguishable | [06](06-drift-scan-harness-governance.md) | S (/L) | low |
| ~~C1~~ | Markdown tidying noise + rare "skipped (binary file)" notice — **RESOLVED** (`*.md` added to `.prettierignore`); heavy fixes dropped | [07](07-already-addressed-and-out-of-scope.md) | done | — |
| F1 | Registry/data files keep crossing the `local/max-lines` floor on one-line additions | [04](04-lint-rule-ergonomics.md) | M | low–med |
| R1 | `type-assertion-boundary` rejects a 2-line `//` marker; message omits the placement rule | [04](04-lint-rule-ergonomics.md) | S | low |
| Q1 | Hand-maintained `runtimeFiles` copy list in the lint-ratchet vitest fixture | [04](04-lint-rule-ergonomics.md) | S | low |
| M1 | `harness:check` "unaccounted script" error names the problem but not the remedy | [06](06-drift-scan-harness-governance.md) | S | very low |

### Tier 3 — valuable, more effort or lower frequency

| ID | Issue | Plan | Effort | Risk |
|----|-------|------|--------|------|
| A4 | Coverage-map "linted vs ratcheted" classification has no internal-consistency check (invisible under `--staged`) | [01](01-coverage-map-governance.md) | M | low |
| A5 | Coverage-map validates ratchet *ids* but not file-membership → prose rots silently | [01](01-coverage-map-governance.md) | M (/L) | low (/med) |
| A3 | Standalone `docs:lint-coverage-map:check` reports reach gaps the real (`--staged`) gate never trips | [01](01-coverage-map-governance.md) | S | low |
| E2/E3 | Re-derived TS-AST idioms (`ts.Node.parent` walk, wrapped `ts.sys`) | [04](04-lint-rule-ergonomics.md) | S | low |
| L1 | Control-byte git-log test fixtures re-derived (and corruptible) in 9 files | [04](04-lint-rule-ergonomics.md) | S–M | low |
| W1 | No blessed way to probe a plugin rule under flat config | [04](04-lint-rule-ergonomics.md) | S | low |
| D2 | Stale type-aware lint output right after editing the eslint config | [03](03-edit-hooks-and-caches.md) | M | med |
| D3 | Real `tsc`-only errors on `scripts/**` surface only at the slow typecheck gate | [03](03-edit-hooks-and-caches.md) | M (/L) | med–high |
| N1 | Retiring a zero-finding ratchet is forced through `--allow-worse` + a debt-log "acceptance" | [06](06-drift-scan-harness-governance.md) | M | med |
| M2 | Ratchet `principle` strings drift from the registry; no `kind` for read-only aggregators | [06](06-drift-scan-harness-governance.md) | M (/S) | med (/low) |
| T1 | `verify:changed` 240s watchdog is tight when `test:changed` + `test:scripts:changed` contend | [06](06-drift-scan-harness-governance.md) | S | low |
| U1 | `bun run harness:check` from a nested package subdir fails ("Script not found") | [06](06-drift-scan-harness-governance.md) | S | low |

### Strategic (largest structural win, own leaf)

| ID | Issue | Plan | Effort | Risk |
|----|-------|------|--------|------|
| A-arch | Replace the 419-line hand-registered coverage table with a derived-coverage + small EXEMPT allowlist | [01](01-coverage-map-governance.md#architectural-recommendation) | L | med |

## The recurring theme

By a wide margin the most-logged friction is the **lint coverage-map governance
gate** (it appears in nearly every drift-ai task log). The tactical fixes in
[01](01-coverage-map-governance.md) (scaffold + edit-time naming + better errors
+ staged consistency) remove the day-to-day pain; the architectural inversion
(derive coverage, hand-maintain only an exemptions list) dissolves the whole
class and is the single highest-leverage change in this backlog.

## Out of scope / not codebase-fixable

A handful of logged pains are harness/tooling-layer (`rg`/`grep` output rendering
some tokens as the literal `ln`/`n`) or pure agent shell-discipline (single-quote
`rg` patterns that contain backticks). These are catalogued in
[07](07-already-addressed-and-out-of-scope.md).

One pain surfaced live while producing this backlog — the edit-time hook
reformatting/flagging markdown — and was **resolved during the session**: `*.md`
was added to `.prettierignore` (joining the already-ignored `docs/`), so markdown
is no longer auto-tidied by the hook or the format gate. The heavier proposals
once sketched for this (a loud binary-file warning + a pre-commit control-byte
gate) were **deliberately dropped** as over-engineering for a rare
harness-transport issue — see **C1** in
[07](07-already-addressed-and-out-of-scope.md). The related test-fixture de-dup
(L1) in [04](04-lint-rule-ergonomics.md#l1) stands on its own.

## Suggested sequencing

- **PR 1 (Tier 1 quick wins):** B2, B1, K1, E1 — all small, low-risk, high-frequency.
- **PR 2 (coverage-map tactical):** A1, A6, A2, A3 — the daily pain.
- **PR 3 (correctness):** G1 (amend bug), H1/H2 (cache argv key).
- **PR 4 (lint rules):** R1, Q1, F1, then E2/E3/L1/W1.
- **PR 5 (hooks):** D1, then D2/D3 (build on the same Stop-hook reconciliation).
  *(C1 resolved during analysis — `*.md` added to `.prettierignore`; no hook build.)*
- **PR 6 (harness/ratchet/drift):** M1, J1, then N1/M2/T1/U1.
- **Leaf (strategic):** coverage-map inversion (A-arch).

See each plan for per-issue files, steps, trade-offs, and test impact.

## Review trail (Codex, 2026-06-12)

These docs were reviewed by Codex (`codex exec`, review-only). Verdict: **no P0**;
sampled `file:line` evidence "mostly accurate, including G1, H1/H2, D1, N1, B1/B2,
K1, and the stale/already-addressed items"; Tier 1 items "look reviewable"; the
higher-risk plans needed tightening. All findings have been folded into the plans:

- **[P1] N1** — a zero baseline alone doesn't prove the guard was replaced.
  → N1 now *requires* explicit `--retire-ratchet` + mandatory promotion proof
  before skipping `--allow-worse`/debt log ([06](06-drift-scan-harness-governance.md#n1)).
- **[P1] D1/D3** — Stop hook has a 30 s timeout and must not run long work.
  → D1/D3 now mandate hard time/path caps + a no-rerun fallback
  ([03](03-edit-hooks-and-caches.md#d1)).
- **[P1] H1** — sorting the whole argv can alias different option orders.
  → H1 now hashes the exact tail; only post-`--` file operands are sorted
  ([03](03-edit-hooks-and-caches.md#h1)).
- **[P1] coverage-map inversion** — scope includes non-JS/TS surfaces (md/sh/
  prisma/sql). → the architecture section now preserves an explicit
  `owned-by/not-code/excluded` taxonomy ([01](01-coverage-map-governance.md#architectural-recommendation)).
- **[P2] G1** — `ai_is_git_commit_cmd` doesn't match `git -c … commit`.
  → G1 adds a placement caveat (widen the gate or check before it)
  ([05](05-commit-codex-typecheck.md#g1)).
- **[P2] D2** — the "transient-config" root cause is an inference.
  → D2 is now marked a hypothesis requiring a repro fixture first
  ([03](03-edit-hooks-and-caches.md#d2)).
- **[P2] D1 detail** — `ai_tidy_emit_residual_warnings` drops JSON on non-zero
  exit. → D1 now specifies a separate JSON collector ([03](03-edit-hooks-and-caches.md#d1)).
- **[P2] F1** — a broad `*.data.ts` lane could hide logic by filename.
  → F1 now sequences the per-file split first; convention only with constraints
  ([04](04-lint-rule-ergonomics.md#f1)).

## Resolved decisions (2026-06-12)

Owner review of the open calls, re-verified against current HEAD. Refinements
folded into the per-leaf docs:

- **G1 — fix first (severity, not frequency).** Scoped self-block right before
  `bash -c` (*after* the gate, not before it); regex + deny-glob widening closes
  the `git -c … commit --amend` form via `no-direct-db`; the deny glob is not a
  backstop. Strongly consider the shared `ai_preflight_or_block` guard across all
  executing hooks ([05](05-commit-codex-typecheck.md#g1)).
- **E1 — `complexity: "off"` for tests** (not `max: 20`), matching the sibling
  size rules already off ([04](04-lint-rule-ergonomics.md#e1)).
- **A3 — adopt the `:check`/`:audit` split, but it is *not* an isolated "S":** it
  edits generated verify steps (manifest+generator+freshness) and the new
  `:audit` script trips `harness:check` parity. **Pair with M1**
  ([01](01-coverage-map-governance.md#a3)).
- **F1 — split the one data file now;** no broad `*.data.ts` lane yet (the file
  mixes `fs` logic into data — the argument against a filename-only escape hatch)
  ([04](04-lint-rule-ergonomics.md#f1)).
- **M2 — do both, separate PRs.** Derive ratchet `principle` from a *dedicated*
  registry field (not `zeroBaselineDisposition.reason`); **defer** the aggregator
  kind until a concrete control needs it
  ([06](06-drift-scan-harness-governance.md#m2)).
- **W1 — documented recipe first;** promote to a small script on first sign the
  incantation is fiddly or on repeat use ([04](04-lint-rule-ergonomics.md#w1)).
- **A-arch — commit to the inversion as a separate leaf, after the tactical
  fixes.** ~157 of ~194 rows vanish (the high-churn covered surface); ~37
  not-code/excluded remain hand-listed. A3 is a precursor (two-speed derivation);
  dual-run de-risks but does not relieve pain (short window + exit criterion)
  ([01](01-coverage-map-governance.md#architectural-recommendation)).

**Sequencing:** G1 (severity), E1, A3 + M1, F1, W1 docs, M2 derivation, then
A-arch. Group the harness-regeneration-touching work (A3, M2 derivation, A-arch)
so manifest/generator/regenerated-doc churn happens together.

# Command-policy analytical core — port policy.sh classifier + lexer to TS

Status: Ready — plan review before code.
Date: 2026-07-19
Source: 2026-07-19 harness architecture review (session artifact, claims
verified against HEAD 544a9d06 the same day; the review's top
recommendation); design calls consulted with Fable 5 + Codex 2026-07-19
(slice plan is the consult consensus, folded in below).
Size: L (C-group sliced campaign; one lane re-branched per slice,
land-per-slice full gates).

## Evidence

The command-policy surface is the largest analytical bash in the repo
(file:line verified 2026-07-19 at HEAD 544a9d06):

- `scripts/ai-hooks/policy.sh` 1,341 L; `scripts/ai-hooks/test.sh`
  3,510 L; `scripts/ai-hooks/protected-files.sh` 257 L.
- policy.sh is sourced by: bash-pre-tool-use.sh:17,
  bash-post-tool-use.sh:16, bun-run-quiet.sh:40, no-direct-db.sh:10,
  git-commit-quiet.sh:28 (+ test harnesses test-cache.sh:20,
  test.sh:15).
- PreToolUse wiring: .claude/settings.json:105 matcher "Bash" →
  no-direct-db.sh, git-commit-quiet.sh, bun-run-quiet.sh (:107-123);
  matcher "Edit|Write" → protected-files.sh (:126-131).
- AI_POLICY_* strings: policy.sh:11-28 (AI_POLICY_HOOK_BYPASS :11,
  POSTGRES :12, REDIS/DOCKER/CHANGEME :13-15, AI_POLICY_GIT_* :16-25,
  GH_* :26-27, ALLOW_PROTECTED_EDITS_ADVISORY :28); regex constant
  AI_POLICY_CMD_START :141.
- Lexer in `scripts/ai-hooks/common.sh` (543 L file):
  ai_unquote_token :98, ai_git_commit_prefixes :112 (self-described
  "deliberately only a lexer, not a shell parser"),
  ai_target_dir_from_cmd :204, ai_resolve_target_dir :321.

The only coverage today is the 3,510-line shell suite. The substrate
ruling supports the port — "Anything analytical lives in TS"
(docs/ai-harness.md:198; ruling section :184, signed off b7c2ce73
2026-07-14) — and policy.sh is NOT on the recorded exception list
(docs/ai-harness.md:208).

## Slice plan (consult consensus)

Lexer foundation first, then vertical policy-domain slices; case tables
become data within their own domain slices, never a horizontal
tables-first rewrite:

- **S1** — TS core skeleton + lexer port + frozen differential corpus,
  wired into nothing (clean revert point).
- **S2** — batched hot-path call for the git policy domain
  (branch/commit/push/hook-bypass), with the per-domain authority flip.
- **S3** — write-path/target-dir resolution + protected-files; the
  case tables become data here, since path resolution feeds the
  protected-file check.
- **S4** — db-CLI rules + the remainder of the classifier.
- **S5** — thin the shell suite. Keep permanently: adapter/wiring
  cases, cross-domain verdict-precedence cases, exact reason strings,
  and fail-closed malformed-input cases.

## Structural invariants (hold in every intermediate state)

- At most ONE core spawn per hook event: the batched entrypoint takes
  the command once and returns verdicts for all ported domains, with
  unported domains staying bash — intermediate states never accumulate
  spawns.
- The core receives structured stdin (command, cwd, required repo
  context), not shell-requoted argv.
- Shell stays authoritative until each domain's flip; after cutover, TS
  startup/protocol/parse failure BLOCKS rather than allows
  (fail-closed).

## Parity strategy

The shell suite stays green as the conformance oracle through the
authority flip, backed by a differential corpus: command strings
harvested from the shell suite plus real hook-log traffic, verdicts
diffed between implementations. Fresh TS unit/property tests are
written per slice via TDD, but the corpus — not the fresh tests — is
the parity proof (fresh tests encode the porter's understanding, which
is exactly what can drift). Time-bomb gotcha: parity tests that execute
working-tree bash become bombs once the bash is thinned — pin both
sides to git revisions or treat parity as land-time proof, not a
permanent test.

## Perf gate (pin the procedure, not an invented number)

Measure BEFORE S1, per the arch-plans-2026-07/05 S2 record (record
:169, table :176-183): bare bun codec spawn measured ~21 ms, ported
step +10 ms vs legacy, revert threshold :150 ("a shim that adds >100ms
to an otherwise-cached commit reverts"; outcome :189-191 was +5 ms
marker-hit, nothing reverted). Procedure: p50/p95 over ≥30 warm runs of
the actual shared hook against the shell baseline; guidance is roughly
≤50 ms p95 incremental overhead; revert the authority flip if any
stable warm measurement exceeds 100 ms. Record cold-start numbers
separately as diagnostics — they are too environment-sensitive to gate.

## Acceptance contract

Define the supported shell grammar and conservative behavior for
unknown syntax. The contract must cover: heredocs, substitutions,
redirections, chained commands, `git -C`/`--git-dir`, cwd resolution,
multi-command verdict precedence across domains (per-domain parity
alone cannot prove the combined classifier safe), and adapter parity
across the Claude/Codex/Copilot hook surfaces.

## Constraints

- Registration surfaces for the new TS/config files: smoke-subjects
  header + `bun run test:scripts:subjects` regen;
  eslint-config/config-surface-manifest.json + generator rerun;
  hand-edited coverage map; fixture-copy/import-closure sweep until
  ready-row B5 generalizes it.
- Review loops on this defensive code need an explicit
  accidental-vs-adversarial calibration in sign-off rounds — the hooks
  guard agent mistakes, not adversaries — or evasion findings never
  converge.
- Landing: gate/config-surface commits trigger full-scan (full eslint +
  full test concurrently); use `NODE_OPTIONS=--max-old-space-size=6144`
  for eslint and the sequential verify-bridge marker, land-per-slice.
- Serialization: strictly AFTER the gate-lifecycle seam (leaf 12). Both
  leaves edit `.husky/pre-commit` and hook surfaces — a dependency
  chain, never concurrent lanes.

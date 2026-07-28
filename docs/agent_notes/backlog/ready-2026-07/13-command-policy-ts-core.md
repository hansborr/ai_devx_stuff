# Command-policy analytical core — port policy.sh classifier + lexer to TS

Status: Plan review complete (2026-07-25) — S1 and S2 are dispatchable as
written below; S3 (and the sequential S4/S5 campaign behind it) is held on one
owner sequencing decision, filed in `00-index.md` §4.

> **2026-07-25 plan review — two rounds, recorded amended.** Codex ruled the
> four design forks (none needed the owner); Grok then reviewed that ruling
> adversarially and returned **"dispatch with these amendments"**. Everything
> below records the **amended** plan. Where the two reviewers disagree, both
> positions are kept and the amendment is marked **← implement this**.
>
> In short: **(1)** parity is a **land-time dual-run proof** with a frozen
> corpus, never a permanent test that executes Bash — *amended*: S1 dual-runs
> only its own analytical rows, not the policy/stash matrices; **(2)** the
> nonexistent "real hook-log traffic" corpus source is replaced by the existing
> `scripts/ai-hooks/test.sh` matrices — **no new S0 logging slice**; **(3)** the
> pre-code perf baseline is built as `scripts/command-policy-perf.ts` inside the
> C8 lane — *amended*: the committed artifact is a summary, since `reports/` is
> gitignored; **(4)** latency gate — the two reviewers **disagree**, see
> [Perf gate](#perf-gate-forks-3-and-4).
>
> The lane's **first action** is the pre-code performance capture, before any TS
> core exists.
>
> **`file:line` provenance.** Every ref below was verified against the live tree
> at HEAD `0bb5c206` on 2026-07-25 by the recording lane — including six ranges
> the Codex "corrected references" table itself got wrong (wrong bounds, not
> fabrications, concentrated on the fixture ranges a corpus harvester would
> use). Those six are corrected here and called out in
> [Corpus sources](#corpus-sources-fork-2-ruling).
Date: 2026-07-19
Source: 2026-07-19 harness architecture review (session artifact, claims
verified against HEAD 544a9d06 the same day; the review's top
recommendation); design calls consulted with Fable 5 + Codex 2026-07-19
(slice plan is the consult consensus, folded in below).
Size: L (C-group sliced campaign; one lane re-branched per slice,
land-per-slice full gates).

## Evidence

The command-policy surface is the largest analytical bash in the repo
(all `file:line` below re-verified 2026-07-25 against HEAD 0bb5c206;
they drift fast — re-check before editing):

- `scripts/ai-hooks/policy.sh` 1,379 L; `scripts/ai-hooks/test.sh`
  3,709 L; `scripts/ai-hooks/protected-files.sh` 257 L.
- policy.sh is sourced by: bash-pre-tool-use.sh:17,
  bash-post-tool-use.sh:16, bun-run-quiet.sh:41, no-direct-db.sh:10,
  git-commit-quiet.sh:28 (+ test harnesses test-cache.sh:20,
  test.sh:15).
- PreToolUse wiring: .claude/settings.json:105 matcher "Bash" →
  no-direct-db.sh, git-commit-quiet.sh, bun-run-quiet.sh (:107-120);
  matcher "Edit|Write" :124 → protected-files.sh (:126-130).
- AI_POLICY_* strings: policy.sh:11-29 (AI_POLICY_HOOK_BYPASS :11,
  POSTGRES :12, REDIS/DOCKER/CHANGEME :13-15, AI_POLICY_GIT_* :16-26,
  GH_* :27-28, ALLOW_PROTECTED_EDITS_ADVISORY :29); regex constant
  AI_POLICY_CMD_START :145.
- Lexer in `scripts/ai-hooks/common.sh` (543 L file):
  ai_unquote_token :98, ai_git_commit_prefixes :112 (self-described
  "deliberately only a lexer, not a shell parser"),
  ai_target_dir_from_cmd :204, ai_resolve_target_dir :321.
- Main violation dispatcher: `ai_policy_violation_reason`
  policy.sh:1051-1205.

The only coverage today is the 3,709-line shell suite. The substrate
ruling supports the port — "Anything analytical lives in TS"
(docs/ai-harness.md:259-263; ruling section :245-276, signed off
b7c2ce73 2026-07-14) — and policy.sh is NOT on the recorded exception
list (docs/ai-harness.md:269-276).

The threat model is bounded and must not be widened by this port:
deliberate bypasses outside the documented accidental-use grammar (SSH
wrapping, double-wrapped `bash -c`) are explicitly out of scope
(policy.sh:3-9), so they are not S1 defects.

## Authoritative correctness rider

The accepted
[C8 command-target correctness rider](../agent-pain-points-2026-07-21/03-resolve-hook-command-targets.md)
is binding on this plan. This C8 leaf is the sole implementation owner; the
rider is a non-schedulable decision record, not a prerequisite lane or a second
port. Where current Bash behavior conflicts with the rider, the differential
corpus records the rider's corrected result as an explicit override rather than
freezing the legacy verdict as parity.

## Slice plan (consult consensus)

Lexer foundation first, then vertical policy-domain slices; case tables
become data within their own domain slices, never a horizontal
tables-first rewrite:

- **S1** — **dispatchable**; full specification in
  [Dispatchable S1 specification](#dispatchable-s1-specification). TS core
  skeleton + lexer port + frozen differential corpus,
  wired into nothing (clean revert point). Implement the rider's
  per-guarded-invocation tokenization and resolved / implicit / indeterminate
  target result here. Repeated `git -C` follows Git's left-to-right relative
  semantics; mixed targets, `--git-dir` / `--work-tree`, target environment
  forms, invalid cwd, and failed canonicalization fail closed. The corpus labels
  the rider rows as correctness overrides.
- **S2** — **dispatchable** after S1. Batched hot-path call for the git policy
  domain
  (branch/commit/push/hook-bypass), with the per-domain authority flip. This
  slice consumes S1's target result and models the rider's sole prospective
  state exception: an exact, statically provable, same-canonical-checkout
  `git switch -c <literal-unprotected-branch> && git commit ...`.
- **S3** — **HELD** on an owner sequencing decision (`00-index.md` §4); do not
  dispatch. Write-path/target-dir resolution + protected-files; the
  case tables become data here, since path resolution feeds the
  protected-file check. Consume S1's target result rather than reparsing the
  command. Both reviewers agree S3 cannot be scheduled ahead of the approved-P1
  [`../ai-harness-audit-2026-07-21/05-edit-hook-target-worktree.md`](../ai-harness-audit-2026-07-21/05-edit-hook-target-worktree.md):
  that P1 moves target resolution into `edited-paths.sh`, adds
  same-repository/unrelated/invalid classifications, groups multi-root payloads,
  and makes `.allow-protected-edits` **target-worktree-local instead of
  repository-wide** (`:18-48`, Prisma/protected-files migrate first at `:32-38`)
  — while this very S3 bullet claims the same protected-file target/path
  resolution. Two approved plans cannot both own that resolver.
- **S4** — sequential behind S3, therefore also held. db-CLI rules + the
  remainder of the classifier — that "remainder" is now enumerated explicitly in
  [S4 predicate enumeration](#s4-predicate-enumeration). Complete
  propagation of the same result through the remaining owning domains and
  adapter state paths, including HEAD correlation and lock/cache keying; do not
  reinterpret indeterminate as an implicit cwd fallback.
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
- S1 owns one per-invocation target classification. Later slices consume and
  propagate it at their authority flips; no adapter or domain silently retries
  resolution and substitutes payload cwd or hook root for indeterminate input.

## Parity strategy (fork 1 ruling, amended)

**Ruled: parity is a land-time dual-run proof, not a permanent test that
executes Bash.** The unpicked "pin both sides to git revisions **or** treat
parity as land-time proof" fork is settled in favour of land-time proof.

Each slice compares the still-authoritative working-tree Bash implementation
against TS *before* that domain flips. The committed corpus then freezes both
the observed Bash result and the expected result; permanent tests exercise only
TS and never invoke Bash. This is the codec precedent's shape
(`scripts/lib/fixtures/verify-metadata-core-corpus.json:2`;
`scripts/lib/verify-metadata-core.test.ts:37-49`). Keeping a live Bash oracle
past S5 would either block thinning or make tests depend on historical Git
objects and old fixture layouts — the time bomb this leaf already flagged.

The shell suite stays green as the conformance oracle through each authority
flip. Fresh TS unit/property tests are written per slice via TDD, but the
corpus — not the fresh tests — is the parity proof (fresh tests encode the
porter's understanding, which is exactly what can drift). The accepted
correctness rider is authoritative over legacy parity: its target and
same-checkout transition rows carry corrected expected results, and a matching
old Bash verdict is not required.

### Corpus row schema

Every corpus row carries:

- `source` — the shell-test path and line, or the binding rider's row.
- `oracleRevision` — the revision whose working-tree Bash was actually run to
  produce `legacyObserved`. **This must be the proof commit, not "the branch
  base weeks ago"**; the dual-run always executes working-tree Bash at proof
  time. (S1's branch base is currently `0bb5c206`.)
- `expectationKind` — `legacyParity`, `correctnessOverride`, or
  `deferredDomain` (see the amendment below).
- `legacyObserved` — the Bash classification/verdict at that revision.
- `expected` — the TS result.
- `overrideReason` — **required** for every intentional divergence, citing the
  rider row it implements.

> **Precedent caveat (Grok).** This schema is richer than the codec corpus,
> which has only a prose `captured` note plus `legacyParity` / `defectFixes`
> arrays with `name` / `argv` / `stdin` / `expectExitCode` / `expectStdout`
> (verified: no per-row `oracleRevision` field exists there). Inventing the
> richer schema is fine; it is **not** "following" the codec layout, so do not
> cite the codec as authority for the extra fields.

### [P0 amendment] S1 dual-runs only its own analytical rows ← implement this

- **Codex position:** freeze one all-slice corpus in S1 and, before S1 commits,
  dual-run "every applicable row" so every `legacyParity` row is equal and every
  mismatch is a labeled override.
- **Grok position (adversarial, accepted as the amendment):** that is not a
  closed S1 scope. **S1 is analytical-only and emits no policy verdicts**, so
  requiring land-time Bash↔TS equality across the harvested allow/block and
  stash matrices either smuggles the S2–S4 classifiers into S1 or commits
  hundreds of rows S1 cannot validate.

**Implement:** S1 dual-runs **only** lexer, target-classification, heredoc, and
protocol rows, plus the rider's target correctness overrides. Policy and stash
rows are still harvested in S1 and frozen for their later owning slice, but they
are recorded as `deferredDomain` with **no S1 TS expectation** and are excluded
from the S1 dual-run. Each later slice extends the same corpus — never a
per-slice corpus — and dual-runs the rows its own domain has just made
answerable, immediately before that authority flip.

**Residual process risk (both reviewers).** Frozen JSON removes the "test checks
out deleted bash" bomb but moves it into process: `legacyObserved` / `expected`
become a second source of truth that drifts if Bash changes between flips
without re-proof. `oracleRevision` is documentation, not enforcement — the
discipline is that every dual-run uses working-tree Bash and stamps the proof
commit.

## Corpus sources (fork 2 ruling)

**Ruled: replace the source; do not create hook logging or a logging S0.**
The leaf's "plus real hook-log traffic" is struck — **no such log exists**, and
adding command capture would drag runtime behavior, retention, privacy,
redaction, and lifecycle scope into a migration. Verified: the Bash aggregate
derives Bun output-log and marker paths (`scripts/ai-hooks/bash-pre-tool-use.sh:69-74`)
and never appends payload commands; current logs hold verification or wrapped
command output only.

The replacement corpus is **the existing repo matrices plus the rider's
acceptance rows**. Ranges below are the recording lane's own verification —
**six of the Codex table's fixture ranges had wrong bounds** and are corrected
here; a harvester using the uncorrected ones would have missed the SD15
assertions entirely and mixed in an unrelated filter test.

| Corpus source | Verified range | Correction |
|---|---|---|
| Destructive-Git cross-harness corpus | `scripts/ai-hooks/test.sh:255-304` | Range is the **function definition**; its invocation is at `:520`. Harvest both. |
| Allow/block policy matrices (DB, Git, GitHub, protected writes) | `scripts/ai-hooks/test.sh:446-1119` | Codex said `:446-1075` — **truncated**; `:1076` is still mid-`gh api` allow list and the matrices continue through `:1083-1119`. |
| Required stash allowlist + denylist | `scripts/ai-hooks/test.sh:617-682` | Confirmed as given. |
| Claude/Codex adapter verdict cases | helpers `scripts/ai-hooks/test.sh:1121-1183`, **verdict calls `:1184-1198`** | Codex said `:1121-1198` without distinguishing them; `:1121-1183` are helper definitions only. |
| Heredocs, substitutions, malformed syntax, quoted Git targets | `scripts/ai-hooks/test.sh:1200-1410` | Confirmed as given. |
| Target-resolution cases | `scripts/ai-hooks/test.sh:2656-2708` (`assert_resolve_target_dir_order` at `:2663-2708`) | Confirmed as given. |
| Worktree / live adapter fixtures | `scripts/ai-hooks/test.sh:2733-2807` | Codex said `:2733-2810`; `:2809+` is an unrelated `ai_commit_truth_up_lines` filter test. |
| Worktree/branch-policy pre/post HEAD fixtures | helpers `scripts/ai-hooks/test.sh:2889-3030`, **SD15 assertions `:3032-3041`** | Codex said `:2889-3030`, which ends on helper definitions — the actual assertion rows are `:3032-3041`. |
| Copilot policy/stash adapter cases | `scripts/ai-hooks/test-copilot-wiring.sh:145-188` | Confirmed as given. |

Per the [S1 scope amendment](#p0-amendment-s1-dual-runs-only-its-own-analytical-rows--implement-this),
most of these rows are **policy verdicts**, not S1 target/lexer outcomes. They
are a legitimate harvest pool for S1 to freeze; they are **not** S1 dual-run
obligations.

### Required repository-wide stash corpus

The frozen corpus must carry the repository-wide stash allowlist implemented
before this port. These rows are policy outcomes, not target-classification
outcomes: primary checkout, linked worktree, payload cwd, literal `cd`, and
`git -C` variants have the same verdict, and no stash row may depend on target
resolution.

- Allow only explicit `list`, `show`, and `create` dispatch, including ordinary
  options and arguments after the selected subcommand, plus the exact help-only
  forms `git stash -h` and `git stash --help`.
- Block bare `git stash`; every option-led form other than those two exact help
  forms; `push`, `save`, `pop`, `apply`, `branch`, `store`, `drop`, and `clear`;
  and representative unknown/future subcommands.
- Preserve cases where a later argument resembles a blocked subcommand, such as
  `git stash show push` and `git stash create pop`, as allowed dispatches.
- Pin the exact shared denial reason and matching Claude, Codex, and Copilot
  adapter decisions so a later authority flip cannot restore the legacy
  two-command denylist.

## Perf gate (forks 3 and 4)

### Fork 3 ruling — the C8 lane owns a pre-code benchmark

**The C8 lane owner builds and runs one narrow benchmark before creating the TS
core.** This is a pre-code commit *inside* the C8 lane, not a separate backlog
row and not a new S0.

Create **`scripts/command-policy-perf.ts`**. It measures end-to-end wall time
with `performance.now()` around spawned real hook adapters:

1. `.codex/hooks/pre-tool-use.sh:1-10` — the thin generated adapter that `exec`s
   the shared aggregate `scripts/ai-hooks/bash-pre-tool-use.sh` (whose sourcing
   body is `:9-19`; note `:1-7` is only the header comment, contra the Codex
   citation).
2. `.claude/hooks/no-direct-db.sh:1-10` — the thin adapter that `exec`s Claude's
   direct policy body `scripts/ai-hooks/no-direct-db.sh:12-37`.

Fixed payloads per surface (six scenarios total):

- Implicit allow: `git status --short`.
- Explicit target allow: `git -C <canonical-current-repo> status --short`.
- Policy block: `git commit --no-verify`.

Use the real current checkout as `cwd`, unique temporary hook-state directories,
and validate the expected JSON response on every invocation. Record the first
invocation separately as cold diagnostic data, then 10 untimed warmups followed
by three batches of 50 measured process invocations per scenario. A compare mode
reads baseline and candidate and reports the deltas below.

The machine is the C8 lane's current Musi devcontainer with no concurrent
verify/build job; the lane owner owns both baseline and candidate captures. If
the container or host changes, the old comparison is void — rerun the
still-authoritative Bash baseline immediately before that slice's authority flip.
This implements the codec precedent's *procedure* (warm-cache, ≥30 iterations on
one lane machine) rather than inheriting its machine-specific numbers
(`docs/agent_notes/backlog/arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md:169-191`;
revert threshold `:190`, outcome `:189-191` was +5 ms marker-hit, nothing
reverted).

> **Caveat (Grok).** End-to-end full-adapter wall time is coarser and noisier
> than the codec S2 procedure, which measured discrete operations. That is the
> root of the fork-4 disagreement below.

### [P0 amendment] The committed artifact is a summary, not the JSON ← implement this

The script writes raw samples and summaries to
`reports/command-policy-perf/{baseline,candidate}.json`, each document recording
phase, Git SHA, UTC timestamp, Bun version, kernel/CPU identity, adapter path,
payload case, samples, and per-batch p50/p95.

**But `reports/` is gitignored (`.gitignore:74`)**, so the Codex done-criterion
"the pre-code baseline report exists" is not mergeable, reviewable, or
CI-checkable — only the script is. **Implement:** keep the script and its compare
mode, and additionally commit the baseline **SHA + summary numbers** in the S1
commit message or a sign-off note under `docs/agent_notes/`. The gitignored JSON
alone does not satisfy the done criterion.

### Fork 4 — latency criterion: **reviewers disagree, owner may want to pick**

For scenario *s*, both reviewers accept the metric:

`delta95(s) = median(candidate batch p95s) - median(baseline batch p95s)`

Let `D` be the maximum `delta95` across all six required surface/payload
scenarios. Cold observations and individual sample maxima are diagnostic only.

- **Codex:** sign-off passes only when `D <= 50.0 ms`; `50.0 < D <= 100.0 ms`
  blocks authority-flip sign-off (optimize and remeasure); `D > 100.0 ms` reverts
  the flip immediately. Rationale: makes the previously unenforceable "roughly
  ≤50 ms" guidance actually enforceable.
- **Grok (partial disagreement):** a hard 50 ms gate on **full-adapter p95
  batches** will reintroduce the sign-off fights it is meant to end, because the
  measured surface is noisy. Keep `D > 100 ms` as the hard block/revert — that is
  the boundary this leaf already carried and the codec precedent used — and treat
  `D <= 50 ms` as a **soft target** until the measured surface is narrowed to the
  policy decision alone.

**Recording lane's read:** the two agree on the metric, on the six scenarios, and
on the 100 ms revert boundary; they differ only on whether 50 ms hard-blocks
sign-off. Grok's is the later and more specific position, so **default to the
soft-50/hard-100 shape** and narrow the measured path before hardening 50. Flag
this at S2 sign-off if a real measurement lands between 50 and 100 ms — that is
the only case where the choice bites.

## Acceptance contract

- Define the supported shell grammar and conservative behavior for unknown
  syntax. Cover heredocs, substitutions, redirections, chained commands,
  `git -C`, `--git-dir`, `--work-tree`, Git target environment forms, cwd
  validation/canonicalization, and multi-command verdict precedence across
  domains (per-domain parity alone cannot prove the combined classifier safe).
- S1 satisfies every target-classification acceptance row in the
  [authoritative rider](../agent-pain-points-2026-07-21/03-resolve-hook-command-targets.md):
  classification is per guarded invocation; irrelevant substitutions do not
  erase a literal target; repeated `-C` ordering is Git-compatible; mixed or
  unsupported targets, invalid cwd, and canonicalization failure are
  indeterminate and fail closed rather than becoming payload-cwd or hook-root
  fallbacks.
- S2 proves the exact same-canonical-checkout `switch -c && commit` exception
  and all of the rider's excluded transition shapes. It does not infer any other
  future branch state.
- As S2-S4 flip authority, branch/commit policy, protected paths, command
  execution, pre/post HEAD observation, locks, cache keys, and all
  Claude/Codex/Copilot adapters consume the same S1 result and return matching
  target/verdict outcomes.
- The differential corpus distinguishes intentional rider overrides from
  accidental parity drift, and focused live fixtures prove the corrected
  outcomes at the real adapter surfaces.

## Dispatchable S1 specification

S1 is dispatchable as written here. The lane's first commit is the fork-3
benchmark; the TS core follows.

### Scope

S1 ports only the analytical foundation and is wired into **no** hook:

- `ai_strip_noncommand_text` heredoc/data filtering from `policy.sh`.
- The lexical responsibilities currently held by `ai_unquote_token`,
  `ai_git_commit_prefixes`, `ai_target_dir_from_cmd`, and
  `ai_resolve_target_dir` (`scripts/ai-hooks/common.sh:97-339`).
- Command segmentation sufficient for each guarded Git invocation.
- A discriminated target result: `resolved`, `implicit`, or `indeterminate`.
- The frozen differential corpus (S1-applicable rows dual-run; policy/stash rows
  frozen as `deferredDomain`).
- A structured stdin/stdout CLI protocol with deterministic operational failures.

It does **not** evaluate policy domains, change Bash authority, add a shim, edit
hook adapters, or implement the S2 branch-transition exception. S1 must not
repair current Bash merely to make its legacy oracle agree: the rider explicitly
makes corrected TS expectations authoritative
(`../agent-pain-points-2026-07-21/03-resolve-hook-command-targets.md:17-19,61-87`).

### [P1] Do not under-budget this slice — it is a redesign, not a line port

Grok's sizing correction, verified by the recording lane:

- **`ai_strip_noncommand_text` is a large awk heredoc engine**, `policy.sh:262-549`
  — 288 lines, not a helper. Porting it is most of S1's parsing work.
- **The resolved/implicit/indeterminate model is a redesign, not a port.**
  Today `ai_target_dir_from_cmd` fails the *whole* command on any `$(`, backtick,
  or `<(` anywhere in it (`scripts/ai-hooks/common.sh:216-218`), and
  `ai_resolve_target_dir` (`:321-339`) then silently falls back to payload cwd
  and finally the hook root. The rider requires **per-guarded-invocation**
  classification where an irrelevant substitution does not erase a literal
  target, and where indeterminate never collapses to a fallback. That is new
  semantics on both counts.

Budget and tests must assume new semantics — not "clone the bash, then apply
overrides".

### Files

Create:

- `scripts/command-policy-perf.ts` — pre-code benchmark prerequisite.
- `scripts/lib/command-policy-core.ts`
- `scripts/lib/command-policy-core.test.ts`
- `scripts/lib/fixtures/command-policy-core-corpus.json`

### [P0 amendment] Smoke registration — not `test-ai-hooks.sh` ← implement this

- **Codex position:** add the core, test, fixture, **and the perf script** as
  smoke subjects of `scripts/tests/test-ai-hooks.sh` (`:2-15`).
- **Grok position (accepted as the amendment):** that binds **every** core edit
  to the full 3,709-line ai-hooks suite. The established precedent for a
  `scripts/lib/*-core.ts` is `scripts/tests/test-verify-metadata.sh:3-5`, which
  subjects the core and its corpus alongside their own library's smoke without
  dragging in the hook harness.

**Implement:** register the core / test / corpus on a dedicated thin smoke, or on
the `test-verify-metadata.sh` pattern — **not** on `test-ai-hooks.sh`. **Omit
`scripts/command-policy-perf.ts` from smoke subjects entirely**; a benchmark is
not a regression surface. Regenerate either way via `bun run test:scripts:subjects`
(which rewrites `scripts/path-policy/path-policy-smoke-subjects-data.ts` and the
fixture) and commit the generated files.

Also update:

- `docs/generated/lint-coverage-map.md` — add the TS pair and corpus following
  the existing core/corpus entries at `:168-169` (hand-edited).
- **No** `eslint-config/config-surface-manifest.json` entry: no new config
  surface is created, and `scripts/lib` cores are not in that manifest today.
- **No** new module doc is required — `docs/guides/add-module-doc.md:11-14`
  reserves docs for surfaces with cross-file flow and explicitly excludes simple
  single-file ones. (Grok notes an optional `*-MODULE.md` would help later slices
  because this file owns grammar and threat-model invariants; not required to
  land S1.)
- **State the fixture-copy/import-closure sweep explicitly.** The leaf's
  Constraints call for it until `B5` generalizes it; for an unwired S1 core it is
  most likely N/A, but the S1 commit must say so rather than skip it silently.

### Module layout

Pin the layout to `scripts/lib/verify-metadata-core.ts`:

- One self-contained core file under `scripts/lib/`.
- Node built-ins only, no sibling production imports (`:16-18` documents exactly
  why: shell tests copy the file into sandbox repos).
- Exported input/output interfaces and a pure callable entrypoint for unit tests.
- Explicit exit constants and a result type carrying `exitCode`, `stdout`,
  `stderr` (`:20-23` for the fail-closed exit-code table).
- One CLI block under `if (import.meta.main)` (`:357-365`), with the central
  dispatch table at `:321-355`.
- Read exactly one complete JSON document from stdin; emit exactly one JSON
  document.
- No `eval`, no shell-requoted argv, no shell execution of user text, no
  environment expansion, no `bash -c`.

The S1 API accepts:

```ts
interface CommandPolicyInput {
  readonly version: 1;
  readonly command: string;
  readonly cwd: string | null;
  readonly hookRepoRoot: string | null;
}
```

Its output contains ordered guarded invocations plus one aggregate target
result. Each invocation records its segment/operator relationship, the
normalized Git verb when statically known, and:

- `resolved` — literal target plus canonical checkout root.
- `implicit` — no target-bearing syntax, plus the validated effective checkout
  from payload cwd or the safely canonicalized compatibility fallback.
- `indeterminate` — a stable reason code: `malformed-syntax`, `dynamic-target`,
  `unsupported-wrapper`, `mixed-checkouts`, `git-dir`, `work-tree`,
  `target-environment`, `invalid-cwd`, or `canonicalization-failed`.

Filesystem and checkout canonicalization use direct argument-vector operations,
never a shell. Export the analytical function with an **injectable checkout
resolver** for focused tests; the CLI implementation may use Node filesystem APIs
and direct `git -C <path> rev-parse --show-toplevel`.

### Grammar and target rules

S1 must:

- Preserve executable segments separated by `;`, `&&`, `||`, pipes, supported
  reserved-word positions, and command substitutions.
- Strip well-formed non-executable heredoc data while conservatively retaining
  executable/interpolated content.
- Recognize quotes and backslash escapes without becoming a general shell parser.
- Associate target syntax with its own guarded invocation; a substitution in a
  message or unrelated segment must not erase a literal target.
- Apply repeated `git -C` left-to-right — relative `-C` resolves against the
  preceding effective target, absolute `-C` resets it.
- Mark mixed checkout targets indeterminate.
- Mark indeterminate: variables/substitutions in target position, `--git-dir`,
  `--work-tree`, target-affecting environment forms, unsupported wrappers,
  malformed quotes, invalid cwd, failed canonicalization.
- Allow payload-cwd/hook-root fallback only for truly implicit invocations, and
  only after successful canonicalization.

These are the binding rider rules at
`../agent-pain-points-2026-07-21/03-resolve-hook-command-targets.md:63-83,110-122`.
Deliberate bypasses outside the documented accidental-use grammar (SSH wrapping,
double-wrapped `bash -c`) are **not** S1 defects unless the threat model is
deliberately changed (`scripts/ai-hooks/policy.sh:3-9`).

### Test strategy

1. **Frozen corpus** — harvest the matrices in
   [Corpus sources](#corpus-sources-fork-2-ruling), using the *corrected* ranges.
   Separate `legacyParity`, `correctnessOverride`, and `deferredDomain`. Include
   every stash row required below, marked `deferredDomain`.
2. **Land-time parity** — while Bash is still authoritative, run Bash and TS
   against every **S1-applicable** row (lexer, target, heredoc, protocol, rider
   overrides). Legacy rows must match; only rider-tagged rows may diverge. Commit
   the actual Bash observation and the proof commit SHA. Permanent tests never
   execute Bash.
3. **Focused TS examples** — cover every target-classification acceptance row,
   heredoc category, malformed quote, operator boundary, repeated `-C`, and the
   compatibility fallback.
4. **Property tests** — generate whitespace/quoting/separator variations around
   literal Git invocations; assert that irrelevant argument substitutions cannot
   change a resolved target, that repeated literal `-C` composition matches the
   specified left-to-right model, and that adding target-affecting dynamic syntax
   never *improves* a result away from indeterminate.
5. **Live checkout fixtures** — temporary primary and linked worktrees prove
   canonical roots, relative targets, invalid cwd, non-checkout paths, symlinks,
   and failed canonicalization. These exercise only the injected/direct resolver
   and never execute the analyzed command.
6. **Protocol tests** — malformed JSON, wrong version/type, empty stdin,
   canonicalization errors, and CLI startup failures each get a distinct nonzero
   result and emit no partial stdout document.

### S1 done criteria

- The pre-code baseline has been captured against the current shell-only
  adapters, **and its SHA + summary numbers are committed** (commit message or a
  `docs/agent_notes/` sign-off note) — not only in gitignored `reports/`.
- All four created files exist, with registration updated per the smoke
  amendment above.
- The core is still unreachable from production hooks.
- The corpus identifies its Bash oracle revision and per-row provenance.
- Every **S1-applicable** legacy-parity row passed the one-time dual-run;
  `deferredDomain` rows are frozen without TS expectations.
- Every intentional mismatch is labeled as a rider correctness override.
- Every rider S1 target row passes focused TS and live-fixture coverage.
- The stash matrix is frozen for its later owning slice.
- No adapter falls back from indeterminate to payload cwd or hook root in the
  modeled output.
- The commit contains only S1 foundation/corpus/registration work — no domain
  authority flip is mixed in.

## S4 predicate enumeration

The leaf's "~40 predicates" was an estimate mixing named status-returning
predicates with inline classifier arms. The review counts **31 named
predicate/verdict surfaces + 12 inline policy-family predicates = 43**, and
assigns the remainder explicitly. All 31 named line numbers were independently
confirmed by both reviewers and re-checked by the recording lane at `0bb5c206`.

> **[P2] 43 is not exhaustive.** The named inventory omits the S3 write-path
> extractors — `ai_policy_clean_shell_path_token` (`policy.sh:725`),
> `ai_policy_resolve_bash_path` (`:745`), `ai_policy_print_resolved_bash_path`
> (`:764`), `ai_policy_bash_redirect_path_from_token` (`:772`),
> `ai_policy_bash_redirect_write_paths` (`:793`), `ai_policy_bash_sed_write_paths`
> (`:821`), `ai_policy_bash_tee_write_paths` (`:859`),
> `ai_policy_emit_copy_like_paths` (`:890`),
> `ai_policy_bash_copy_like_write_paths` (`:909`), and
> `ai_policy_bash_write_candidate_paths` (`:950`). Those are S3's, not S4's, but
> do not treat 43 as the full analytical surface of protected writes.

### Named predicates and verdict surfaces

| Predicate/verdict surface | Owner | Inside S4? |
|---|---|:---:|
| `ai_policy_has_command` (`policy.sh:176`) | S1 lexer/matcher foundation | No |
| `ai_branch_is_protected` (`:200`) | S2 Git branch | No |
| `ai_guard_commit_branch_or_die` (`:213`) | S2 behavior; shell guard stays adapter-side | No |
| `ai_policy_has_git_push_to_main` (`:610`) | S2 push | No |
| `ai_policy_has_git_commit_on_main` (`:636`) | S2 commit | No |
| `ai_policy_has_husky_zero_prefix` (`:664`) | S2 hook bypass | No |
| `ai_policy_has_git_commit_hook_bypass_flag` (`:684`) | S2 hook bypass | No |
| `ai_policy_has_git_push_hook_bypass_flag` (`:694`) | S2 hook bypass | No |
| `ai_is_git_commit_cmd` (`:1239`) | S2 commit routing | No |
| `ai_is_git_commit_dry_run` (`:1251`) | S2 commit routing | No |
| `ai_policy_touches_allow_protected_edits_marker` (`:702`) | S3 protected writes/advisory | No |
| `ai_policy_load_protected_files` (`:714`) | S3 shell loading seam | No |
| `ai_policy_shell_token_ends_segment` (`:738`) | S3 write lexer | No |
| `ai_policy_bash_protected_file_write_context` (`:959`) | S3 protected writes | No |
| `ai_policy_bash_protected_file_violation_reason` (`:982`) | S3 protected writes | No |
| `ai_policy_bash_protected_file_advisory` (`:992`) | S3 protected writes | No |
| `ai_policy_advisory_context` (`:1002`) | S3 advisory dispatcher | No |
| `ai_policy_has_dangerous_git_reset` (`:551`) | Remaining destructive Git | **Yes** |
| `ai_policy_has_disallowed_git_stash` (`:588`) | Repository-wide stash classifier | **Yes** |
| `ai_policy_has_git_worktree_loss` (`:595`) | Checkout/switch/restore loss | **Yes** |
| `ai_policy_has_gh_api_explicit_get` (`:1025`) | GitHub API whitelist helper | **Yes** |
| `ai_policy_has_gh_api_visible_graphql_query` (`:1029`) | GitHub API whitelist helper | **Yes** |
| `ai_policy_has_gh_api_mutation` (`:1037`) | GitHub mutation classifier | **Yes** |
| `ai_policy_is_soft_guidance` (`:1209`) | Final classifier mode; currently inactive | **Yes** |
| `ai_has_force_verify_prefix` (`:1255`) | Bun/cache classifier | **Yes** |
| `ai_is_wrapped_bun_cmd` (`:1268`) | Bun/cache classifier | **Yes** |
| `ai_bun_script_bypasses_cache` (`:1276`) | Bun/cache classifier | **Yes** |
| `ai_bun_cmd_bypasses_cache` (`:1287`) | Bun/cache classifier | **Yes** |
| `ai_bun_cmd_bypasses_lock` (`:1292`) | Bun/cache classifier | **Yes** |
| `ai_policy_violation_reason` (`:1051-1205`) | Cross-domain precedence dispatcher | Completed in S4, not exclusively S4 |
| `ai_preflight_or_block` (`:1220`) | Shell orchestration consuming the verdict | No — stays a thin adapter |

### Inline predicates inside `ai_policy_violation_reason`

| Inline family | Lines | Owner | Inside S4? |
|---|---:|---|:---:|
| PostgreSQL CLIs | `1070-1073` | S4 | **Yes** |
| `redis-cli` | `1075-1078` | S4 | **Yes** |
| Docker/docker-compose | `1080-1083` | S4 | **Yes** |
| Fake database credential literal | `1085-1088` | S4 | **Yes** |
| Commit amend | `1094-1100` | S2 commit | No |
| Rebase except allowed controls | `1102-1107` | Remaining destructive Git | **Yes** |
| History rewrite / direct refs | `1126-1130` | Remaining destructive Git | **Yes** |
| Force push / delete / prune | `1132-1138` | S2 push | No |
| Force branch/tag/worktree mutation | `1145-1162` | S2 branch/ref mutation | No |
| Forced Git clean | `1164-1167` | Remaining destructive Git | **Yes** |
| GitHub auth mutation | `1169-1172` | S4 | **Yes** |
| GitHub remote mutation table | `1174-1194` | S4 | **Yes** |

S4 must also port the non-predicate transforms needed to return one batched
adapter result: allowed-rebase / staged-restore / stash residue handling
(`policy.sh:227-237,563-585`), wrapped-script matching (`:132-144`), force-prefix
stripping and script extraction (`:1259-1274`), and cache/lock identity
derivation (`:1296-1365`). `ai_append_flaky_note` (`:1367-1379`) is presentation
formatting, not part of the classifier.

**S4's exact policy remainder:** reset, rebase, checkout/switch/restore loss,
stash, history rewrite, clean, DB/Redis/Docker/fake-credential, GitHub
auth/API/remote mutation, soft-guidance state, and Bun cache/lock classification
and identity output.

## Constraints

- Registration surfaces for the new TS/config files: smoke-subjects
  header + `bun run test:scripts:subjects` regen (see the
  [smoke registration amendment](#p0-amendment-smoke-registration--not-test-ai-hookssh--implement-this)
  — **not** `test-ai-hooks.sh`);
  eslint-config/config-surface-manifest.json + generator rerun **is not needed
  for S1** (no new config surface);
  hand-edited coverage map; fixture-copy/import-closure sweep until
  ready-row B5 generalizes it — state explicitly in the S1 commit if it is N/A.
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

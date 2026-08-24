# 141. The log auditor re-implements the shell verify state-path protocol in TypeScript, and only a comment holds the two copies together

Status: Landed on fix/cq-141
Theme: Cross-language protocol fork · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/lib/verify-metadata.sh` owns the protocol that decides where every
piece of per-worktree verify state lives: resolve the repository root, resolve
it through the filesystem to a canonical identity path, hash that with SHA-256
to get a worktree key, normalize `MUSI_VERIFY_STATE_ROOT` (defaulting unset or empty values to `/tmp`,
stripping one trailing slash, and preserving `/` as the root case), then join
`<state-root>/<name>.<worktree-key>`. Locks, markers, history dirs and both log
directories are all derived from that one function.

`scripts/logs-audit/logs-audit-latest.ts` needs two of those directories when
asked for `--latest`, and it computes them by attempting to re-derive the protocol in
TypeScript — 45 lines that duplicate the root-resolution, realpath identity,
SHA-256 key, state-root normalization, and `name.key` join logic, but already
diverge from Bash for the non-repository root fallback and empty or
multiply-trailing-slashed `MUSI_VERIFY_STATE_ROOT` values. The file says so itself:
a comment tells the next reader to keep the TypeScript in sync with
`musi_standard_state_path`. That comment is the entire enforcement mechanism.
Nothing fails when the two drift; the auditor simply looks for logs in a
directory nobody writes to, reports "no compatible logs", exits 0, and the
person who ran it concludes their run produced no logs.

The comment also describes a world that does not exist. It justifies the
reconstruction as a "standalone fallback" for direct CLI calls, on the premise
that shell wrappers export `MUSI_STANDARD_VERIFY_LOG_DIR` and
`MUSI_STANDARD_BUN_LOG_DIR`. No script in the repository exports either name —
they exist only as override hooks read inside `verify-metadata.sh` itself and
as env inputs read by this TypeScript file. So the "fallback" is not a fallback
at all; it is the path every `--latest` run actually takes, and the duplicate
protocol is load-bearing rather than defensive. The cost lands on whoever next
changes the state layout: they edit bash, every shell consumer follows, and one
TypeScript file silently keeps pointing at the old scheme.

## Evidence

- `scripts/logs-audit/logs-audit-latest.ts:30-74` — 45 lines reconstructing the
  protocol: `sha256Hex` (`:30-32`), `repoRootForState` with the
  `REPO_ROOT` → git-toplevel → `cwd()`/`"/workspace"` chain (`:34-43`),
  `realpathOrFallback` (`:45-55`), `worktreeStateKey` (`:57-61`),
  `standardStateRoot` (`:63-66`), `standardStatePath` (`:71-74`).
- `scripts/lib/verify-metadata.sh:121-135` (`musi_repo_root_for_state`),
  `:137-147` (`musi_worktree_identity_path`), `:149-153` (`musi_worktree_key`),
  `:181-187` (`musi_standard_state_root`), `:189-204`
  (`musi_standard_state_path`) — the Bash originals, function for function. The hash and
  `<name>.<sha256>` join match, but two edge cases already differ: Bash falls
  back from git directly to `/workspace` while TypeScript uses `cwd()`, and
  Bash's `${MUSI_VERIFY_STATE_ROOT:-/tmp}` maps an empty value to `/tmp` and
  strips one trailing slash while TypeScript maps an empty value to `/` and strips all
  trailing slashes.
- `scripts/logs-audit/logs-audit-latest.ts:68-70` — the sync requirement in
  prose: "Shell wrappers export MUSI_STANDARD_*_LOG_DIR; keep this in sync with
  scripts/lib/verify-metadata.sh's musi_standard_state_path contract."
- No in-tree exporter for that premise: repo-wide, `MUSI_STANDARD_VERIFY_LOG_DIR`
  and `MUSI_STANDARD_BUN_LOG_DIR` appear only at
  `scripts/lib/verify-metadata.sh:232` and `:250` (as `${VAR:-…}` override
  reads inside `musi_standard_verify_log_dir` at `:229-233` and
  `musi_standard_bun_log_dir` at `:247-251`) and at
  `scripts/logs-audit/logs-audit-latest.ts:14-15`, `:102`, `:106` (as env
  inputs). Nothing assigns or exports them.
- `scripts/logs-audit/logs-audit-latest.ts:92-108` — `defaultLatestLogRoots`
  interleaves the two contracts: each root is `override env ?? standard env ??
  locally reconstructed path`, so the duplicated derivation is reached whenever
  a caller has not pre-set the directories — which, per the point above, is
  every real invocation.
- `scripts/logs-audit.ts:31-32`, `:236-246`, `:252-255` — the `--latest` miss
  path returns the "no compatible JSONL logs found in verify/hook log dirs"
  hint with `exitCode: 0`. A wrong directory and an empty directory are
  indistinguishable to the caller, which is why drift here is silent.
- `scripts/ai-hooks/cache.sh:22`, `:30`, `:32` — `musi_worktree_key`,
  `musi_standard_bun_log_dir` and `musi_standard_verify_log_dir` run on the
  per-tool-call hook path, which is why the bash side cannot be made to call
  into TypeScript at runtime.
- `scripts/logs-audit.ts` is the protocol's only TypeScript consumer:
  `findLatestCompatibleLogFiles` is imported at `:22`, re-exported at `:35`, and
  called only from `resolveRunFiles` (`:236-246`), with a
  `latestLogRoots` injection seam (`:203`, `:252`) that the tests already use
  (`scripts/logs-audit/logs-audit.test.ts:1075`, `:1079`, `:1121`, `:1152`).
- `scripts/tests/test-verify-metadata.sh:597-615` exercises
  `musi_standard_verify_log_dir` (`:601`) and `musi_standard_bun_log_dir`
  (`:604`) only for worktree-scoping — inside a nine-helper loop asserting each
  path is non-empty and differs between two
  sibling worktrees. No test anywhere asserts a derived state-path *value*, so
  nothing in the suite would catch a TypeScript/bash divergence.
- `package.json:150` — `"logs:audit": "bun scripts/logs-audit.ts"`; the process
  boundary where the missing env export could be supplied.

## Proposed direction

Eliminate the TypeScript duplicate at the process boundary and leave
`scripts/lib/verify-metadata.sh` as the protocol's single runtime owner.

1. **Repoint the package script at a thin bash shim.** Replace
   `package.json:150`'s `bun scripts/logs-audit.ts` with a small shell script
   that sources `scripts/lib/verify-metadata.sh`, exports
   `MUSI_STANDARD_VERIFY_LOG_DIR=$(musi_standard_verify_log_dir)` and
   `MUSI_STANDARD_BUN_LOG_DIR=$(musi_standard_bun_log_dir)`, and then execs
   `bun scripts/logs-audit.ts "$@"`. The shim may skip the derivation entirely
   when `--latest` is absent, so `--file` runs pay nothing. This is one bash
   spawn on a cold, interactive path; the per-tool-call hook path
   (`scripts/ai-hooks/cache.sh`) is untouched.
2. **Delete the reimplementation.** Remove
   `scripts/logs-audit/logs-audit-latest.ts:30-74` and collapse
   `defaultLatestLogRoots` (`:92-108`) to the pure env chain. When `--latest` is
   requested and neither the override nor the standard env var is present, fail
   closed with a hint pointing at `bun run logs:audit --latest`, in the same
   register as the existing no-logs hint at `scripts/logs-audit.ts:31-32`. The
   keep-in-sync comment goes away because there is nothing left to sync.
3. **Add the parity smoke.** Assert that the shim's exported values equal the
   accessor outputs. This is new coverage, not an extension: as the evidence
   shows, the suite has no derivation-value assertions today. Prefer extending
   `scripts/tests/test-verify-metadata.sh` (already registered) over a new
   sibling file.
4. **Re-register the boundary.** Add the shim to the changed-test mapping in
   `scripts/test-changed.sh:231` beside `scripts/logs-audit.ts` and
   `scripts/logs-audit/*`, and confirm the wrapped-bun hook policy still treats
   `bun run logs:audit` correctly — `logs:audit` sits in the hand-maintained
   `AI_WRAPPED_BUN_SCRIPTS` list at `scripts/ai-hooks/policy.sh:96`, and
   `scripts/ai-hooks/test.sh:2051` asserts `bun run logs:audit --file
   reports/server.jsonl` is wrapped.
5. **Frame the pattern for copiers.** Give the shim a short header comment
   saying what it is: the env contract that `logs-audit-latest.ts:68-69`
   documents partially is being made total. Both halves already have in-repo
   precedent: bash derives state paths from the accessors
   (`scripts/verify.sh:75-77`) and a wrapper hands the derived values to its
   child through the environment (`scripts/verify-async.sh:449-455`). That is
   the transferable lesson — a
   cross-language protocol survives as one implementation plus an env contract
   at the process boundary, not as two implementations plus a comment.

Land the shim, the TypeScript deletion, the smoke and the doc line together;
splitting them leaves a window where `--latest` resolves nothing.

## Scope / caveats

- **Binding: do not make `verify-metadata.sh` or the AI hooks consume a
  TypeScript state-path owner at runtime.** `musi_worktree_key` and
  `musi_standard_bun_log_dir` run per tool call at
  `scripts/ai-hooks/cache.sh:22`, `:30`; a bun spawn there regresses hook
  latency budgets. This is the same cost split CQ25-124 recorded — cheap,
  frequent primitives (git, `date`, path math) stay in bash, only parse and
  serialize moved to TypeScript.
- **Binding: do not extract a shared TypeScript state-path module, and do not
  add a bash↔TypeScript parity corpus to pin the duplicate.** Both shapes keep
  two implementations forever and add surface to guard code that can simply be
  deleted. Note in particular that
  `scripts/lib/fixtures/verify-metadata-core-corpus.json` is **not** a
  dual-asserted pattern to copy: its header states its expectations were
  captured by hand from a pinned bash revision and that "Tests never drive the
  bash implementation."
- **Binding: do not preserve a "direct-CLI fallback" for raw
  `bun scripts/logs-audit.ts --latest`.** Silent local path reconstruction is
  the defect being removed; the missing-env case must say so and point at the
  package script.
- **Decide the exit code deliberately.** `--latest` with no matching logs
  currently exits 0 by design — graceful degradation is a landed contract, and
  `docs/ai-harness.md:589-590` tells automation to use `bun run logs:audit
  --latest` only after its no-log path is proven quiet. "Missing env contract"
  is a different condition from "no logs"; keep the existing zero-exit
  behaviour for the latter and choose the former's exit code on purpose, with
  a distinct message.
- **`--file` behaviour must not change.** `scripts/slow-drift-audit.sh:276-279`
  is the only scripted consumer and invokes `bun run logs:audit --file …`; it
  goes through the package script, so it inherits the shim and must keep
  working (`scripts/tests/test-slow-drift-audit.sh:529-531` pins the call).
- **New shell file, two registration surfaces.** ShellCheck picks up new
  scripts automatically — `scripts/lint-shell.sh:77-78` selects the
  `shell-surface` path-policy set from tracked files — so `bun run lint:shell`
  needs no registration. A smoke *file* does: `scripts/tests/*.sh` carry
  `# smoke-subjects:` headers (see `scripts/tests/test-verify-metadata.sh:2-12`)
  and the subject data is generated. If step 3 adds assertions to
  `test-verify-metadata.sh`, add the shim path as a `# smoke-subjects:` line and
  regenerate with `bun run test:scripts:subjects`, committing the generated
  files.
- **`verify-metadata-core.ts`'s self-containment is not a template here.** Its
  header (`scripts/lib/verify-metadata-core.ts:16-18`) states it is deliberately
  node-builtins-only because shell tests copy it into sandbox repos with no
  sibling imports. That constraint is why a shared-import design was rejected;
  it is not an invitation to add a second such core.
- **Out of scope:** any change to the log-selection logic itself
  (`findLatestCompatibleLogFiles` and its same-millisecond tiebreak,
  `scripts/logs-audit/logs-audit-latest.ts:127-152`), and any renaming of the
  `AI_*` / `MUSI_STANDARD_*` env vars. The prefix inconsistency on
  `AI_BUN_LOG_DIR` vs `MUSI_STANDARD_BUN_LOG_DIR` is the live 2026-07-25 pack's
  leaf [33-env-var-prefixes.md](../code-quality-2026-07-25/33-env-var-prefixes.md),
  which cites the same chain at `logs-audit-latest.ts:105-107`; this leaf keeps
  both names exactly as they are.
- **Prior pack:** CQ25-124 is a do-not-reopen on the bash-facade-over-TypeScript-core
  precedent ([29-bash-to-ts-cores.md](../code-quality-2026-07-25/29-bash-to-ts-cores.md)),
  not on this problem. The core it produced is a run-meta JSON codec and owns no
  state-path derivation, so nothing here reopens it.
- **Sequencing.** Leaf
  [117-verify-metadatash-second-kitchen-sink-shell.md](./117-verify-metadatash-second-kitchen-sink-shell.md)
  proposes decomposing `scripts/lib/verify-metadata.sh`, including its
  repository-identity helpers; if that lands first, this leaf's shim sources
  whatever module then owns `musi_standard_*`, and the work shrinks. Neither
  blocks the other, but they must not edit `verify-metadata.sh` concurrently.

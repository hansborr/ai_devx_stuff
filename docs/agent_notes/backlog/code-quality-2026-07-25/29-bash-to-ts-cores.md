# 29. worktree-db.sh and stop-policy.sh hold seven copies of the same state codec, and the copies have drifted

Status: Partially landed 2026-08-01 on `fix/cq-harness-h1-h2` (merge
`2667ee8e0`) — H1 and H2 landed; H11 and H12 remain blocked on unlanded
28-PLAN slice 28.1
Theme: duplicated persistence codecs in bash · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`scripts/worktree-db.sh` is 2,526 lines defining 126 top-level functions in a
single namespace, covering slug/hash computation, port and Redis allocation,
migration/seed/template fingerprinting, `.env` writing, DB clone/drop/reseed,
status and lanes reporting, tombstones, allocations, and GC — all reachable from
any other function in the file, with no module boundary to say which helpers
belong to which concern.

The concrete cost is not aesthetic. Inside that namespace the same small
persistence codec has been written out repeatedly, and the copies have already
diverged in ways that matter:

- `worktree-db.sh` has three near-identical read/write pairs for JSON state
  files (tombstones, template tombstones, allocations) — same shape, different
  validator and different path helper. Each writer does validate →
  `ensure_state_dir` → `mktemp -p "$(state_dir)"` → `printf` → `mv`. Only
  `tombstone_write` carries the comment explaining *why* the temp file must be
  created on the target filesystem; the other two silently depend on the same
  atomicity invariant with no explanation. And only `allocation_read` validates
  on read — the two tombstone readers `cat` unvalidated JSON. Neither asymmetry
  looks like a decision; both look like copies that stopped being updated
  together.
- `scripts/ai-hooks/stop-policy.sh` has **four** copies of the same `key=value`
  read/validate/atomic-write codec (marker, e2e, async, verify). Their drift is
  already visible: `ai_stop_e2e_write_counter` is the only one of the four
  missing the `mkdir -p "$dir" || return 1` guard that the other three have.

The way out is already prototyped in the repo, not invented here.
`scripts/lib/verify-metadata-core.ts:3-6` states the contract explicitly — the
bash library keeps orchestration (locks, markers, `mktemp`, git, `date`) and
shells out to a TypeScript core for every parse/serialize/transform, "replacing
the deleted sed/awk extractors and printf builders". That core is 366 lines and
works. Note what it did not do: `scripts/lib/verify-metadata.sh` is still 1,334
lines, so adopting a TS core buys a tested parse layer, not a smaller bash file.

## Evidence

- `scripts/worktree-db.sh` — 2,526 lines, 126 top-level functions (plus three
  nested inside `write_worktree_env`).
- `scripts/worktree-db.sh:2505-2520` — `main()` dispatch over 7 subcommands
  (`slug|init|drop|gc|status|template-refresh|refresh-data`).
- `scripts/worktree-db.sh:418` `write_migration_fingerprint_input_digests`,
  `:1061` `write_worktree_env`, `:1521` `cmd_status`, `:2335` `cmd_gc` — four
  unrelated concerns in one namespace.
- `scripts/worktree-db.sh:2092` `tombstone_read` / `:2099` `tombstone_write`,
  with the load-bearing cross-filesystem-rename comment at `:2104-2107`.
- `scripts/worktree-db.sh:2161` `template_tombstone_read` / `:2168`
  `template_tombstone_write` — same body, different validator label and path
  helper, no comment.
- `scripts/worktree-db.sh:2212` `allocation_read` / `:2221` `allocation_write` —
  same body, and the only reader that validates (`assert_allocation_json` at
  `:2231`, which wraps `assert_state_json` plus port-range checks).
- `scripts/ai-hooks/stop-policy.sh:61` `ai_stop_read_marker` / `:85`
  `ai_stop_write_marker` — the fourth copy of the codec; its read side duplicates
  the e2e counter's `LAST_FP`/`LAST_BRANCH` validation almost verbatim (same
  `^[0-9a-f]{64}$` check, same `saw_*` flags, same unknown-key `return 1`).
- `scripts/ai-hooks/stop-policy.sh:187` / `:214` (e2e), `:351` / `:377` (async),
  `:482` / `:512` (verify) — the other three copies. `:214` is the only writer of
  the four without `mkdir -p "$dir" || return 1`.
- `scripts/lib/verify-metadata-core.ts:3-6` — the bash-orchestrates /
  TS-computes contract, stated and already shipped at 366 lines.
- `scripts/README.md:22-26` (facade-plus-family-directory bullet) and `:42-44`
  ("Do not add a new implementation family as `scripts/<topic>-*.ts` or
  `scripts/<topic>-*.sh`") — the contract the decomposition target must follow.
- `package.json:24-30` — six package scripts invoke `bash scripts/worktree-db.sh
  <sub>`.
- The worktree shell smokes — four standalone suites since
  code-quality-2026-08-01 leaf 063 split the former single 2,347-line
  entrypoint. `scripts/tests/test-worktree-db.sh` sources `worktree-db.sh`,
  `worktree-drift-hook.sh` and `dev.sh`; `scripts/tests/test-worktree-new.sh`
  sources `worktree-new.sh`; `scripts/tests/test-worktree-drop-gc.sh` and
  `scripts/tests/test-worktree-locking.sh` source `worktree-db.sh`. Together
  they are the executable check for the whole sourcing surface, not just the
  library, and all four must be run — no single one covers it. Sourcing is safe
  because `main()` is guarded at the end of `scripts/worktree-db.sh`.

## Proposed direction

Take the cheap, isolated wins first. The large decomposition is real work and
should not gate them.

1. Extract one `state_json_read <file> <label> [validator]` /
   `state_json_write <json> <file> <label> [validator]` primitive in
   `scripts/worktree-db.sh` and route `tombstone_*`, `template_tombstone_*`, and
   `allocation_*` through it. Removes ~30 lines, gives the
   cross-filesystem-rename comment one home, and turns the validate-on-read
   asymmetry into an explicit argument at three call sites instead of an
   accident. Behaviour must be byte-identical, including the unvalidated-read
   behaviour of the two tombstone readers unless you deliberately decide
   otherwise and say so in the commit body.

   Write the missing tests first. `allocation_write` is the only one of the
   three writers with behavioural coverage
   (`scripts/tests/test-worktree-db.sh:1812-1827`: refuses empty, malformed, and
   array payloads, preserves the good file, persists a valid object).
   `tombstone_write` and `template_tombstone_write` have none — `tombstone_read`
   and `template_tombstone_read` appear only as GC-test stubs at `:1538`,
   `:1568`, `:1574`, `:1662`, `:1665`. Add writer tests for both modelled on
   `:1812-1827` *before* introducing the primitive, or the refactor lands with
   no net over exactly the paths that carry the atomicity invariant.
2. Extract the **write half only** in `scripts/ai-hooks/stop-policy.sh`:
   `ai_stop_write_kv_file <path> KEY=VAL...` doing mkdir → mktemp → printf →
   `mv -f` → cleanup-on-failure. Route all four writers (`:85`, `:214`, `:377`,
   `:512`) through it. This closes the missing-`mkdir -p` drift at `:214` as a
   side effect. Near-zero risk; one commit.
3. Only then consider the read half. Four `key=value` readers collapse into one
   parameterised reader, but doing it in bash needs namerefs or an eval-based
   out-param, which trades one kind of unreadability for another. Prototype it;
   if the parameterised version is not obviously clearer than four explicit
   readers, stop at step 2 and say so in the commit body for step 2.
4. Decompose `worktree-db.sh` into `scripts/worktree-db/` behind a sourcing
   facade at `scripts/worktree-db.sh`, following `scripts/README.md:22-26`. The
   seams the function inventory already suggests: slug/hash, port + Redis
   allocation, fingerprinting, `.env` writing, DB lifecycle (clone/drop/reseed),
   status/lanes reporting, and tombstones/allocations/GC. One seam per commit.
   Step 1 lands first and becomes the tombstones/allocations slice's clean
   starting point. Read `docs/guides/per-worktree-dev.md` before starting.

   `worktree-db.sh` is both a CLI and a sourced library. Every one of these
   consumers must keep working:

   - `scripts/dev.sh:10`, guarded at `:8` by `declare -F compute_fingerprint`;
     also reads `$META_DB` directly at `:112`.
   - `scripts/worktree-new.sh:30`, guarded at `:28` by `declare -F compute_slug`,
     with the hazard spelled out at `:25-27`.
   - `scripts/worktree-drift-hook.sh:24`, guarded at `:22`; reads `$META_DB` at
     `:53` and `:59`.
   - the four worktree shell smokes: `scripts/tests/test-worktree-db.sh`
     (also `worktree-drift-hook.sh` and `dev.sh`),
     `scripts/tests/test-worktree-new.sh` (via `worktree-new.sh`),
     `scripts/tests/test-worktree-drop-gc.sh`, and
     `scripts/tests/test-worktree-locking.sh`.
   - the six `package.json:24-30` invocations, via `main()` at the facade's top
     level.

   Invariants the split must hold:

   (a) Sourcing the facade alone must define the whole library surface those
   callers use, not just the two probe names. Confirmed callees defined in
   `worktree-db.sh`: `compute_slug`, `compute_fingerprint`,
   `safe_compute_fingerprint`, `compute_migration_fingerprint`,
   `compute_seed_fingerprint`, `current_root`, `is_primary_worktree`,
   `db_exists`, `meta_read_value`, `run_admin`, `run_db`,
   `template_db_for_fingerprint`, `allocation_read`, `worktree_redis_url`,
   `require_cmd`, `die`, `log`. So the facade sources every part unconditionally
   at top level: no lazy or subcommand-scoped sourcing, and nothing moves under
   `main()`.

   (b) The `readonly` constants at `scripts/worktree-db.sh:88-138` are part of
   the sourced surface too. Each constant must be declared in exactly one part,
   *and* no part may be reachable by two sourcing paths — a part that both
   sources a sibling and is sourced by the facade re-runs its `readonly` block
   inside one process and aborts under `set -e`. Give each part an
   `__MUSI_WTDB_<part>_SOURCED` idempotency guard, or forbid part-to-part
   sourcing outright.

   (c) The `declare -F compute_fingerprint` / `compute_slug` probes key off
   exactly those two names, so a split that keeps those two defined but drops
   any other callee passes the guards and fails in production.
   The four worktree shell smokes
   (`bash scripts/tests/test-worktree-{db,new,drop-gc,locking}.sh`) source all
   four files between them and are the only cheap defence; keep all four green
   on every commit of the split.

   (d) Add each new `scripts/worktree-db/*.sh` part to the `# smoke-subjects:`
   header of whichever worktree suites exercise it — the state codec belongs to
   `test-worktree-drop-gc.sh` and `test-worktree-locking.sh` — and regenerate
   with `bun run test:scripts:subjects`, or changes to the parts will not select
   those smokes.
5. Treat TS-core extraction as an *optional, per-cluster* follow-up, not a
   rewrite. Where a decomposed part turns out to be mostly `jq` pipelines
   (fingerprinting and status reporting are the likely candidates), give it a
   `scripts/worktree-db/*-core.ts` sibling following the
   `scripts/lib/verify-metadata-core.ts:3-6` contract, keeping locks, `mktemp`,
   git, and `date` in bash. Do not attempt this for `scripts/ai-hooks/policy.sh`,
   `scripts/doctor.sh`, or `scripts/lib/verify-metadata.sh` as part of this leaf.

## Scope / caveats

- **Do not scope this as a blanket bash→TS parse migration.**
  `worktree-db.sh` has 36 external-tool call sites — 30 `jq`, 6 `sed`, no `awk`
  — spread thinly across concerns rather than concentrated in a parse layer.
  That is why step 5 is opt-in per cluster: extract a `*-core.ts` only where a
  decomposed part turns out to be mostly `jq` pipelines.
- **Step 4 is live infrastructure.** `worktree-db.sh` provisions real databases,
  ports, and Redis DBs for every worktree; a mistake here breaks `bun run dev`
  for everyone. The four worktree shell smokes
  (`test-worktree-db.sh`, `test-worktree-new.sh`, `test-worktree-drop-gc.sh`,
  `test-worktree-locking.sh`) are the safety net — every commit in step 4 must
  keep all four green.
- Two surfaces name `scripts/worktree-db.sh` by path and need updating if
  the referenced content moves: `harness.controls.json:529` pins
  `"source": "scripts/worktree-db.sh"` for `sensor/worktree-status`, and
  `docs/guides/per-worktree-dev.md:28` points at `scripts/worktree-db.sh:4-36`
  for the command headers.
- **Preserve `scripts/worktree-db.sh:2104-2107` verbatim** when it moves into
  the shared primitive. It documents why the temp file must be created on the
  target filesystem (`$TMPDIR` is often tmpfs; a cross-fs `mv` degrades to
  copy+unlink and is not atomic). That is an invariant no type system or test
  will catch once removed.
- The Stop hook's dedup and suppression behaviour rides on the four
  `stop-policy.sh` codecs. Step 2 is safe because it is a pure write-path hoist;
  step 3 is genuinely optional and may correctly be abandoned.
- **Do not fold this into
  `docs/agent_notes/backlog/arch-plans-2026-07/01-harness-atomic-write-completion.md`**
  (Done, landed `7583d55f` 2026-07-19), and do not treat these bash sites as
  leftovers of it. That work covered TypeScript `writeFileSync` sites; these are
  bash `mktemp`+`mv` sites and share no code.
- Steps 1–3 are independent of step 4 and of each other and can land in any
  order. If this leaf gets split, split it there: steps 1–3 are S, step 4 alone
  is L.
- Sequencing: step 4 creates a `scripts/<topic>/` owner directory, which is the
  contract leaf 28 is trying to make enforceable. Land leaf 28 steps 1–2 first so
  this directory is created under a rule that exists.

# 63. The worktree shell suite is four independent test suites hidden in one 1,986-line shared-state script

Status: Not started
Theme: shell smoke suite decomposition · Area: tests · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/tests/test-worktree-db.sh` is one smoke entrypoint that sources four
production scripts — `worktree-db.sh`, `worktree-drift-hook.sh`, `dev.sh`, and
`worktree-new.sh` — into a single mutable shell process and then runs four
independent test narratives back to back: DB/init/dev helpers, `worktree:new`
creation recovery, `worktree:drop`/GC teardown, and init-lock/allocation/state
persistence. All 71 assertions share one `PASS` counter, and `fail()` exits the
process, so the first failure anywhere suppresses every later contract — a
regression in a drop/GC helper is invisible while any DB/init assertion is red.

The bands also share ambient state. Function stubs defined at the top level of
one band (the drop band replaces `is_primary_worktree`, `compute_slug`,
`slug_from_dbname`, `drop_db`, and three forget hooks in the shared process)
remain in scope for everything that runs after them, so later bands pass or
fail against accumulated replacements rather than a clean environment. Cleanup
is a chain of 15 `trap … EXIT` installations in which each replacement must re-list
every earlier band's temp directories or silently leak them.

Contributors cannot run one subject alone: touching the locking helpers means
re-running the DB/init, worktree:new, and drop/GC narratives first, every time.
Worktree provisioning is among the most actively developed harness surfaces in
the repo and one of its flagship copyable recipes, so this tax lands on every
change to that tooling — and the suite's shape is the opposite of what the repo
wants copied.

## Evidence

- `scripts/tests/test-worktree-db.sh:2-12` — one `# smoke-order: 060` and ten
  `# smoke-subjects:` lines: the single entrypoint claims `worktree-db.sh`,
  five `worktree-seed-*` TS modules, `worktree-new.sh`, `worktree-drift-hook.sh`,
  `dev.sh`, and itself.
- `scripts/tests/test-worktree-db.sh:25-33` — sources all four production
  scripts into one process; `:35-38` — the single `PASS=0` counter, `fail()`
  (exit on first failure), and `ok()` shared by all bands.
- Measured at the pin: 1,986 physical lines and 71 top-level `ok` assertions,
  split 39/7/12/13 across the four bands.
- Band boundaries: DB/init/dev band spans `:40-1007` (including the
  worktree-seed fingerprint and import-closure checks at `:370-404`);
  `worktree:new` band starts at `:1008` (`parse_new_args` block); drop/GC band
  at `:1324` (`# --- worktree:drop full teardown (leaf 03) ---`); locking/
  allocation band at `:1698` (`# Init/refresh locking remains per-slug …`).
- `scripts/tests/test-worktree-db.sh:1535-1541` — the CR18 drop-band case
  overrides `is_primary_worktree`, `compute_slug`, `slug_from_dbname`,
  `drop_db`, `forget_worktree_fingerprint`, `tombstone_forget`, and
  `allocation_forget` at the top level of the shared process (plus
  `list_worktree_dbs` at `:1543`); every assertion after `:1543` runs with
  these replacements ambient.
- 15 `trap '…' EXIT` installations — an initial trap plus 14 replacements: the trap at `:1703`
  must enumerate six temp directories spanning all four bands plus kill a
  background lock-holder pid.
- Cross-band fixture styles that a split must inventory: the argv-recording
  `git` stub at `:1043-1051`, per-case `mktemp -d` scaffolds feeding the trap
  chain, fake-`bun` runner stubs at `:393`, `:623`, `:692`, `:725`, `:949`
  (all in band 1), and the fingerprint fixture builders around `:370-404`.
- The live 2026-07-25 pack treats the single filename as whole-surface
  coverage: `docs/agent_notes/backlog/code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:130-131`
  (H11/H12 verify columns) and `:328` ("it sources all four consumers and is
  the only cheap defence"), plus `29-bash-to-ts-cores.md:77` (which already
  drifted — it says "1,829 lines" against today's 1,986) and `:162-186`.
- `scripts/tests/lib/` holds no shared assertion library yet — only
  `test-git-env.sh` (referenced by 24 suites under `scripts/tests/`) and the
  lint-ratchet fixture helper — so per-suite inline `fail()`/`ok()` is the
  prevailing idiom.

## Proposed direction

Split the script at its existing band boundaries into four standalone shell
smokes under `scripts/tests/`, keeping the production facade untouched and
staying shell-native. Ordered plan:

1. **Inventory cross-band fixtures first** (this is the shared-helper plan the
   split needs before any file moves). Candidates: the argv-recording `git`
   stub (`:1043-1051`), the `mktemp -d` + trap scaffolds, the fake-`bun`
   term-file runner stubs from the dev band, and the fingerprint fixture
   builders. Hoist into `scripts/tests/lib/` (beside `test-git-env.sh`) only
   helpers genuinely used by **two or more** of the new suites; single-band
   fixtures stay inline in their suite.
2. **Cut the four suites.** Keep the name `test-worktree-db.sh` for the
   DB/init/dev band (approx. `:40-1007`, including the worktree-seed
   fingerprint/import-closure checks at `:370-404`) — retaining the original
   filename keeps the live prior-pack verify commands resolvable. Create
   `test-worktree-new.sh` (`parse_new_args`/`git_worktree_add`/
   `cleanup_failed_add` recovery band, `:1008-1323`),
   `test-worktree-drop-gc.sh` (`cmd_drop`/`cmd_gc` band, `:1324-1697`), and
   `test-worktree-locking.sh` (init-lock/allocation/state-persistence band,
   `:1698-1986`).
3. **Source only what each suite exercises.** Band 1: `worktree-db.sh` +
   `worktree-drift-hook.sh` + `dev.sh`. Band 2: `worktree-new.sh` only — it
   already sources `worktree-db.sh` idempotently (`scripts/worktree-new.sh:29-30`).
   Bands 3-4: `worktree-db.sh` only.
4. **Give each suite its own registration and framework.** Each declares its
   own `# smoke-order` (keep `060` for the retained file; the three new suites
   take unused values between 060 and 070, e.g. 062/064/066 — 050 and 070 are
   taken) and a precise `# smoke-subjects:` header: the five worktree-seed TS
   subjects stay with band 1; `worktree-db.sh` legitimately appears in bands
   1/3/4; each suite also lists itself, matching current idiom. Duplicate
   subjects across headers are already supported (`test-git-env.sh` appears in
   24 suites), so no registration-system change is needed. Each suite owns its
   own `PASS` counter with inline `fail()`/`ok()` per the prevailing idiom, and
   replaces the accumulated trap chains with **one** per-suite `EXIT` cleanup
   over its own temp dirs.
5. **Make ambient stubs suite-local.** The CR18 top-level overrides at
   `:1535-1543` (and any sibling top-level replacements) move inside the suite
   that needs them, subshelled or redefined per case so nothing leaks forward.
   Each suite must pass standalone via `bash scripts/tests/<name>.sh`.
   Assertion parity is the acceptance check: 71 total `ok`s, split 39/7/12/13
   across the four suites — no assertion silently dropped.
6. **Regenerate registration and gate.** `bun run test:scripts:subjects`,
   commit the two generated files, then `bun run test:scripts:subjects:check`,
   `bun run test:scripts`, and `bun run harness:check`.
7. **Update the live-pack references in the same change** (see caveats): the
   H11/H12 rows at `HARNESS-CLUSTER-PLAN.md:130-131`, the "keep it green"
   sentence at `:328`, and `29-bash-to-ts-cores.md:77` / `:162-186`, which all
   treat `bash scripts/tests/test-worktree-db.sh` as full worktree-suite
   coverage.

## Scope / caveats

- **Out of scope:** any production decomposition of `scripts/worktree-db.sh`
  or its siblings — that is the live pack's H11/H12; Vitest rewrites, renames,
  or substrate migration — rejected by the prior pack's CQ25-125/126/138/140
  rulings; and further sub-splitting of band 1 into drift-hook/dev sub-suites.
- **Hidden cross-band coupling is the main risk.** A later band may currently
  pass only because an earlier band defined a stub, exported a variable, or
  left filesystem state; standalone runs will surface these ordering
  assumptions. Fix them with explicit per-suite setup — never by re-sourcing
  earlier bands and never by dropping assertions. The 71 = 39/7/12/13 parity
  count is the guard.
- **Silent under-verification.** The live 2026-07-25 pack uses
  `bash scripts/tests/test-worktree-db.sh` as its verify command for the whole
  worktree surface (H11/H12 rows, `HARNESS-CLUSTER-PLAN.md:328`,
  `29-bash-to-ts-cores.md:162-186`). Keeping the name while shrinking its
  coverage under-verifies those slices unless step 7's reference updates land
  in the same change.
- **Registration mistakes fail late.** Missing `# smoke-order` headers or
  unregenerated/uncommitted `test:scripts:subjects` outputs fail harness gates
  at commit time, not at edit time — run step 6 before committing.
- **Do not touch production files.** `scripts/tests/test-lint-ratchet.sh:2167`
  reads production `scripts/worktree-db.sh` by hardcoded path (the live pack
  cites `:2125`; the line has since moved). This split is test-side only, so
  that check is unaffected — it stays unaffected only if no production script
  moves.
- **Sequencing (soft edges, no hard blockers).** (1) Live-pack H11/H12 are
  open: H11 instructs adding the new `scripts/worktree-db/state.sh` part to
  this suite's `# smoke-subjects:` header and uses the whole suite as its
  verify. Whichever lands second must retarget: post-split, the state-codec
  subject belongs in the drop-gc and locking suites' headers, and the H11/H12
  verify commands should name all four suites — if this leaf lands first, step
  7 updates those rows. (2) The prior pack's 27.2
  (`scripts/tests/lib/test-assertions.sh`, `27-PLAN.md:97`) is unlanded: if it
  lands first, source the shared assertion lib instead of inlining
  `fail()`/`ok()`; otherwise inline per current idiom and leave migration to
  27.2. (3) [198-worktree-provisioning-hard-wired.md](./198-worktree-provisioning-hard-wired.md)
  touches production `worktree-db.sh` but is test-independent — no ordering
  constraint, just avoid working both concurrently in the same files.
- **Prior pack.** CQ25-27 (`27-shell-test-substrate.md`, proposed / not
  promoted) schedules the two-tier shell-test contract and shared substrate,
  not this suite's split; this leaf instantiates its new-suite-over-extension
  contract and mirrors the per-cluster split mechanics its plan already uses
  elsewhere, with no dependency. CQ25-32's smokeTest-list widening concerns
  skill artifacts, not this registration surface.

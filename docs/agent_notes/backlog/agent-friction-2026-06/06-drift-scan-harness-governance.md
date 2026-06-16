# 06 — drift:ai scan, harness/ratchet governance, verify budget (J1, M1, M2, N1, T1, U1)

> Proposals only — not implemented. Verified against current HEAD.

---

## J1 — `drift:ai --check all` knip self-scan is silent for up to 10 min

**Status: not addressed.** knip runs via **synchronous** `spawnSync`
(`scripts/drift-ai/knip-runner.ts:150-157`, `stdio: ["ignore","pipe","pipe"]`,
`--no-progress` at :148), so it emits nothing while running and the parent thread
is blocked — no heartbeat is even possible in this shape. Default timeout is
**10 min** (`DEFAULT_KNIP_TIMEOUT_MS = 10*60*1000`, `:39`); on timeout it returns
a skip and the command still exits 0. `orphan-files`, `unused-exports`,
`knip-duplicates` are `runByDefault: false` and only run under `--check all` /
explicit id — exactly what the review packs request. No progress infra exists.

**Root-cause fix (recommended hybrid — S/M, keeps the sync architecture):**
1. Print one stderr line immediately before the spawn:
   `drift:ai: running knip self-scan (budget Ns)…`.
2. Lower `DEFAULT_KNIP_TIMEOUT_MS` to ~180 s (the 10-min value is the root of
   "can't tell hang from slow").
3. Route the timeout/skip reason to stderr so a skipped knip phase is *explained*
   rather than silent (the timeout message at `:160-164` already carries the ms).

Result: you see the start banner, then either results or a clear timeout notice
within ~3 min. **Follow-up (L):** a true per-15 s heartbeat needs converting the
spawn to async (`child_process.spawn` + `setInterval`), which ripples through the
synchronous `runWithSelectedConfig` in `report-builder.ts` — reserve unless the
budgeted timeout still feels long.

**Why not doc-only.** "knip can take 10 min, that's expected" does not make a
hang distinguishable from a slow run.

**Effort:** S (banner + timeout) / L (async heartbeat). **Risk:** low (stderr
only; no stdout/JSON contract change) / med (async path changes the check-dispatch
contract).

---

## M1 — `harness:check` "unaccounted script" error names the problem, not the remedy

**Status: partial.** The check fails loudly in aggregate but unhelpfully.
`scripts/harness/harness-check-validation.ts:212-216` (`checkScriptParity`) emits
`package.json script "<name>" is not declared in the manifest and not exempt`,
bucketed under id `"(parity)"`. The control-prefix regex is
`scripts/harness-check.ts:44-45`
(`^(sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint):`);
`EXEMPT_SCRIPTS` is `:52-96`. The agent must already know the two remedies; it
surfaces ~2 min into verify.

**Root-cause fix.** Expand the message (one function, `harness-check-validation.ts:212-216`)
to name the script and both remedies + the regen command:
```
package.json script "<name>" matches the control-prefix convention but is not
declared in harness.controls.json and not exempt. Fix one of:
  1. Add a control entry (with "invocation": "bun run <name>") to
     harness.controls.json, then run `bun run docs:harness-controls`.
  2. If it is an operational utility (not an enforcement gate), add "<name>" to
     EXEMPT_SCRIPTS in scripts/harness-check.ts (with a justifying comment).
```
Optionally promote it from the `"(parity)"` bucket to a per-script id so the name
is the bullet header.

**Why not auto-classify.** Inferring enforcement-vs-operational is the human
judgement `EXEMPT_SCRIPTS` exists to capture; a wrong auto-classification
silently weakens the gate. The message fix is strictly safer.

**Effort:** S. **Risk:** very low (message-only; update any test asserting the old
substring, e.g. `harness-controls-parity.test.ts`).

---

## M2 — Ratchet `principle` strings drift from the registry; no `kind` for aggregators

**Status: not addressed.** Ratchet controls carry hand-written `principle`
strings in `harness.controls.json` decoupled from the registry's
`zeroBaselineDisposition.reason` (compare `harness.controls.json:145` vs
`scripts/lint-ratchet/lint-ratchet-config.ts:153-155`). The generator re-projects
`principle` **only for `lint-rule`** entries
(`generate-harness-controls-validation.ts:61`); ratchets flow through
`resolveNonLintControl`, which copies `raw.principle` verbatim (`:136`) and never
imports `lint-ratchet-config.ts`. `KINDS` (`control-field-validation.ts:11-23`)
has no `aggregator`/`fusion` kind — closest fits `sensor`/`verify-wrapper`.

**Root-cause fix (decided 2026-06-12 — do both, separate PRs).** The drift is
real: `ratchet/strict-boolean-expressions-shared` `principle` in
`harness.controls.json:155` ("Prevent SBE debt from growing… while cleanup
proceeds incrementally") vs its registry `zeroBaselineDisposition.reason`
(`lint-ratchet-config.ts:190`, "normal ESLint deliberately keeps SBE off… without
forcing a package-wide rollout") already diverge in emphasis. A doc note is not
enough.

- **Principle derivation — single source of truth, via a *dedicated* field
  (not `zeroBaselineDisposition.reason`).** In a `kind === "ratchet"` branch of
  `resolveControl` (`generate-harness-controls-validation.ts:147-165`), look up
  the ratchet by id in `lintRatchets` and project `principle` from the registry;
  drop `principle` from ratchet entries in `harness.controls.json` and have
  `harness-check` reject a hand-written ratchet `principle` (parallel to
  `lintRuleRestatementFailures`, `harness-check-validation.ts:152-153`).
  **Do not source it from `zeroBaselineDisposition.reason`** — that field answers a
  *different* question (*why this disposition when the ratchet hits zero*) and
  reads as a rationale, so overloading it couples two concerns and forces awkward
  "light editing." Add a dedicated `principle` field to the ratchet registry entry
  as the single source, projected the same way `lint-rule` principles already are
  (`generate-harness-controls-validation.ts:61`). `lint-ratchet-config.ts` is
  already imported by `harness-check.ts:40`, so the coupling is precedented. Land
  the manifest + generator + regenerated docs + harness checks **together** so the
  freshness check (`harness-check.ts:215-219`) stays green.
- **Aggregator kind — defer (YAGNI).** `KINDS`
  (`control-field-validation.ts:11-23`) already has 11 entries, all in use, and no
  current control is shoehorned into `sensor`/`verify-wrapper` as an aggregator. It
  is a one-line add the day a real aggregator control lands; adding it now means an
  unused enum value plus the unresolved judgement of what "aggregator" means. Add
  `"aggregator"` to `KINDS` + a display label in `generate-harness-controls.ts:27`
  **when a concrete control needs it**, not pre-emptively.

**Effort:** M (derivation) / S (kind, deferred). **Risk:** med (regenerated doc
changes for every ratchet → manifest+doc+generator must land together so the
freshness check `harness-check.ts:215-219` stays green) / low (kind).

---

## N1 — Retiring a zero-finding ratchet is forced through `--allow-worse` + a debt-log "acceptance"

**Status: not addressed.** A ratchet removed from the registry leaves a committed
baseline entry captured by `collectOrphanRemovals`
(`scripts/lint-ratchet/baseline-update.ts:69-87`) **purely by id match — it does
not check whether the orphan was at zero findings**. Without `--allow-worse` the
update fails (`formatOrphanFailure`, `:89-100`); with it, `hasAcceptedDebt`
returns true because `orphanRemovals.length > 0`
(`baseline-update-apply.ts:50-52`), so `maybeRecordDebtLog` (`:82-91`) writes a
debt-log acceptance. So a strict improvement (ratchet at zero, promoted to normal
lint, then deleted) is logged as accepted debt — the exact complaint (3×).

**Root-cause fix — dedicated retire/promote path.**
1. In `collectOrphanRemovals`/`decideLintRatchetUpdate`, split orphans by whether
   their `baselineItems` sum to **zero** (the sum is already available; cf.
   `totalBaselineFindings` in `lint-ratchet-zero-baseline.ts:76-78`): zero =
   *clean retirement*, nonzero = *dropped debt*.
2. Clean retirement: gate it behind an **explicit** `--retire-ratchet <id>` flag
   (`scripts/lint-ratchet/cli.ts:37-46`, `assertUpdateArgs:176-188`) — never an
   implicit consequence of a zero baseline. When invoked, do **not** require
   `--allow-worse` and do **not** write a debt-log entry; emit a distinct success
   line ("Retired ratchet <id> (was at zero findings); coverage promoted. No debt
   logged.").
3. **Promotion proof is mandatory, not optional (Codex review).**
   `baseline-update.ts:69` only knows the orphaned baseline's id/items — *not*
   whether normal lint actually replaced the guard. A zero baseline alone could
   mean "promoted to normal lint" **or** "guard silently dropped with no
   replacement," and only the latter is real debt. So the retire path must
   *prove* promotion before skipping the debt log: require that the removed
   ratchet's `zeroBaselineDisposition.kind` was `promote-to-normal-lint` **and**
   that normal lint now errors on its scope (the `lint:ratchet:zero-baseline`
   audit already computes `normal-error` coverage,
   `lint-ratchet-zero-baseline.ts:143-156`). If promotion can't be proven, fall
   back to the existing `--allow-worse` + debt-log path.
4. Nonzero orphan: keep the current `--allow-worse` + debt-log path unchanged.
5. Adjust `hasAcceptedDebt` (`baseline-update-apply.ts:50-52`) so only a
   *promotion-proven* clean retirement does not count as accepted debt.

**Effort:** M. **Risk:** med (touches the count-protection gate; gate strictly on
a zero-sum baseline so nonzero debt can never slip through the retirement branch;
new cases in `lint-ratchet-baseline.test.ts`, `…debt-log-write.test.ts`,
`…zero-baseline.test.ts`).

---

## T1 — `verify:changed` 240 s watchdog is tight under test contention

**Status: done (budget bump, 2026-06-13).** Raised the default interactive budget
`MUSI_INTERACTIVE_TIMEOUT` 240 → 300 and `MUSI_INTERACTIVE_WARN_AFTER` 210 → 260
across the three coupled defaults (`scripts/verify.sh:82-83`,
`.husky/pre-commit:206-207`, and the `verify:logs budget` reporter at
`scripts/verify-logs.sh:410-411`), so the watchdog covers the measured ~200 s
`test:changed` standalone time even when contended in parallel with
`test:scripts:changed`. Both values stay env-overridable. The contention-reduction
serialization (fix #2 below) is left as the deferred M follow-up. Original
analysis preserved below.

**Was: partial — exit-124-as-timeout is already distinguishable; the budget
is genuinely tight for the contended changed surface.**

`INTERACTIVE_TIMEOUT` defaults to 240 (`scripts/verify.sh:82`); `WARN_AFTER` 210
(`:83`). The watchdog kills at the timeout and the TERM trap does
`write_signal_wrapper_meta 124; report_timeout_budget; exit 124` (`:225`) with a
`=== verify:changed TIMED OUT (240s) ===` banner (`:187`) — a *different* exit
path from a real gate failure (`exit 1`, `=== … FAILED ===`, `:399-423`). So
exit 124 ≠ failure is already legible (consistent with the existing
`verify-changed-budget` memory). The friction is that `test:changed` (~200 s
standalone) gets killed at 240 s when run **contended** in parallel with
`test:scripts:changed`.

**Root-cause fix.**
1. **Raise the budget (S, near-zero risk — already env-overridable):**
   `MUSI_INTERACTIVE_TIMEOUT` 240 → ~300, `MUSI_INTERACTIVE_WARN_AFTER` 210 →
   ~260 (`verify.sh:82-83`). Covers the measured overrun with margin.
2. **Reduce contention (M, follow-up):** in `run_steps_parallel`
   (`verify.sh:275-362`), serialize `test:scripts:changed` after `test:changed`
   (mirroring the existing lint-after-typecheck deferral at `:318-340`), or cap
   per-slot worker concurrency.

Optional clarity: the timeout banner could add "(watchdog timeout, not a gate
failure — steps below may have passed)" and list the already-passed steps
(`$passed` is populated incrementally).

**Why not doc-only.** "Re-run / use `verify:async:changed`" is a workaround; the
budget value is the tunable root cause.

**Effort:** S (bump) / M (serialize). **Risk:** low.

---

## U1 — `bun run harness:check` from a nested package subdir fails (minor)

**Status: partial.** `doctor.sh` always `(cd "$REPO_ROOT" && …)`
(`scripts/doctor.sh:349`), which is why `scripts/` did not reproduce but a deep
dir like `packages/client/src` does. `harness:check` is a relative script
(`package.json:87`); `bun run <name>` resolves the name against the nearest
package.json walking up, so from a `@musi/*` package subdir it errors
`Script not found "harness:check"`. The script *body* self-locates `repoRoot`
(`harness-check.ts:102`) once started, so only the launcher is cwd-fragile.

**Root-cause fix (low priority).** Have *programmatic* callers invoke via the
absolute module path (the `$SCRIPT_DIR`-anchored pattern already used at
`doctor.sh:766`) rather than `bun run harness:check`, so nested-cwd launches
resolve. A doc note that gate scripts run from the worktree root covers the human
case.

**Effort:** S. **Risk:** low.

## Critical files
`scripts/drift-ai/knip-runner.ts` (J1), `scripts/harness/harness-check-validation.ts`
(M1, M2), `scripts/harness/generate-harness-controls-validation.ts` +
`control-field-validation.ts` + `generate-harness-controls.ts` (M2),
`scripts/lint-ratchet/baseline-update.ts` + `baseline-update-apply.ts` (N1),
`scripts/verify.sh` (T1), `scripts/doctor.sh` (U1).

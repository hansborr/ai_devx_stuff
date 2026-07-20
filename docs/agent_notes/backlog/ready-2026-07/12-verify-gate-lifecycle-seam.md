# Gate-lifecycle seam — grow verify-engine.sh a gate-run interface

Status: Ready — plan review before code.
Date: 2026-07-19
Source: 2026-07-19 harness architecture review (session artifact, claims
verified against HEAD 544a9d06 the same day); design calls consulted with
Fable 5 + Codex 2026-07-19 (rulings folded in below).
Size: M-L (C-group, one dedicated lane).

## Evidence

`scripts/verify.sh` (362 L) and `.husky/pre-commit` (522 L) each carry a
private copy of the same gate-run lifecycle glue, while the shared
`scripts/lib/verify-engine.sh` is only 144 L of engine internals. The
duplicated pairs (file:line verified 2026-07-19 at HEAD 544a9d06; they
drift fast):

- flock acquisition/banner: verify.sh:145 || pre-commit:294 (`flock -n`)
- marker short-circuit: verify.sh:193 || pre-commit:380
- child cleanup: `cleanup_children` verify.sh:214 ||
  `cleanup_parallel_children` pre-commit:455
- signal-wrapper metadata: `write_signal_wrapper_meta` verify.sh:228 ||
  pre-commit:465
- signal traps: verify.sh:233 || pre-commit:469

The `write_signal_wrapper_meta` bodies have ALREADY drifted: verify.sh
passes a `"$META_MODE"` variable, `${START_TS:-}` defaults,
`$WRAPPER_COMMAND`, and `$CUR_HEAD`/`$CUR_HASH`; pre-commit hardcodes
`"parallel-precommit"`, `$START_TS`, `$0`, and `$META_HEAD`/`$META_FP`.
The pre-commit EXIT trap additionally carries
`musi_precommit_fast_provenance_on_exit`; verify.sh's does not. This is
partly intentional policy and partly drift — exactly the "duplicates
across the boundary are defects" failure mode the substrate ruling names
(docs/ai-harness.md:203).

This continues the leaf-10/A1 extraction
(arch-review-2026-07/00-report.md candidate A1 :205-212; Done 2026-07-07
in 76bdb9cc, 3805cd2a, 664ca92d; referenced by docs/ai-harness.md:197),
which deliberately stopped at engine internals and left the surrounding
lifecycle glue in the two callers.

## Plan

Grow `scripts/lib/verify-engine.sh` a gate-run lifecycle interface —
acquire lock → marker check → log-dir setup → traps → run slots →
aggregate → finalize — so `scripts/verify.sh` and `.husky/pre-commit`
shrink to policy callers that supply parameters and slot sets rather
than re-implementing the lifecycle. This stays bash per the substrate
ruling: "Repo-local gate orchestration stays bash, sharing engine
libraries" (docs/ai-harness.md:193; ruling section :184, rules
:189-206, signed off b7c2ce73 2026-07-14).

### Required first step (both consults)

Before ANY extraction, produce a per-divergence policy-vs-drift
classification matrix covering every difference between the two copies
(mode string, head/fingerprint sources, wrapper command, start-ts
defaulting, exit-hook payload, lock mode, cleanup shape). Each
divergence is classified as intentional policy or accumulated drift.
Intentional divergences become NAMED policy parameters of the seam —
mode label, fingerprint/head source, wrapper command, exit hook such as
`musi_precommit_fast_provenance_on_exit` — and are never silently
normalized. Drift is converged deliberately, with the matrix as the
review artifact. The plan review approves the matrix before code.

## Constraints

- Preserve exactly (Codex ruling): blocking vs nonblocking lock modes,
  commit-queue ownership, FDs 8/9, marker + verify-bridge ordering,
  fast-commit EXIT provenance, and INT=130 vs TERM=124 exit behavior.
- Land-sequence pins: commit 0f584804 aligned the pre-push
  land-sequence pins, and this work moves exactly those pinned lines —
  pin updates in the scripts tests are expected collateral, not scope
  creep.
- Landing: gate-surface commits trigger full-scan (full eslint + full
  test concurrently); use `NODE_OPTIONS=--max-old-space-size=6144` for
  eslint and the sequential verify-bridge marker to land.
- Serialization: strictly BEFORE the policy.sh port (leaf 13). Both
  leaves edit `.husky/pre-commit` and hook surfaces — they are a
  dependency chain, never concurrent lanes. De-drifting the gate
  lifecycle first means the policy-port slices land against a stable
  gate rather than one being refactored underneath them.

## Sequencing

Second in the review chain: after the typed-manifest-parser leaf (11),
before the command-policy port leaf (13).

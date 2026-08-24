# Bind Adapter Failure Evidence to the Producing Worktree

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `gate-diagnostics-and-process-lifecycle.md` — “Missing, stale, and
cross-worktree logs”; `gate-timeouts-and-load.md`;
`test-fixtures-races-and-environment.md`;
`worktree-provisioning-and-isolation.md`

## Problem

Direct verification state is already isolated. `scripts/verify.sh:54-77`
resolves the current checkout before deriving its lock, log, and history paths.
`scripts/lib/verify-metadata.sh:121-153,181-269` keys ordinary state by the
canonical worktree and only the intentional commit queue by the Git common
directory. The sibling-worktree regression at
`scripts/tests/test-verify-metadata.sh:592-635` proves both halves.

Agent adapters can still select the wrong evidence after a lane-targeted
commit. `git-commit-quiet.sh` binds `AI_PRECOMMIT_LOG_DIR` by sourcing
`cache.sh` before it reads the payload and resolves `WORK_ROOT`
(`scripts/ai-hooks/git-commit-quiet.sh:23-32,38-56`); its failure reader later
uses that early-bound path at `scripts/ai-hooks/git-commit-quiet.sh:289-327`.
The Codex/Copilot post-tool body has the same ordering
(`scripts/ai-hooks/bash-post-tool-use.sh:10-27,33-49,75`). The archive records
the result: a lane failure displayed a two-hour-old `/workspace` log whose
suffix was the hash of `/workspace`, not the target worktree
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:412-418`).

The producer already supplies authoritative identity for aggregated slot
failures. Their summary ends with `verify: failure logs: <dir> ...`,
deliberately as the final line so it survives bounded captures
(`scripts/lib/verify-engine.sh:94-127`). The shared adapter helper ignores that
footer and reconstructs paths from its caller's default
(`scripts/ai-hooks/commit-output.sh:73-110`). A local reproduction with
different same-named logs in the footer directory and caller directory selects
the caller directory today.

The former routing decision is incomplete. C8 mentions eventual adapter
state-path propagation in S4, but S4 is explicitly held behind blocked S3
(`../ready-2026-07/13-command-policy-ts-core.md:108-125`), and the ready index's
§3 “Plan review done; partially dispatchable,” §4 “Blocked on an owner
decision,” and “Promotion rules” permit only S1/S2 to dispatch. C8 also does not
name this footer or a focused failure-evidence acceptance row. The owner
confirmed on 2026-07-29 that this leaf carves out one Bash compatibility repair
while C8 retains target classification and eventual TypeScript adapter-state
propagation. C8 S4 remains the later typed command-policy owner and must
preserve the producer-authoritative behavior established here.

## Scope

- In `scripts/ai-hooks/commit-output.sh`, make
  `ai_precommit_failure_summary` parse the final anchored
  `verify: failure logs: <dir> (per-slot ...` footer and use that directory for
  every failed-slot log and ratchet diagnostic.
- Treat only the final well-formed footer as authoritative. Resolve the evidence
  directory with this explicit ladder:

    1. the final valid `verify: failure logs:` footer;
    2. `musi_standard_verify_log_dir "$WORK_ROOT"` when the adapter has an
       attributable target checkout and neither `MUSI_VERIFY_LOG_DIR` nor
       `AI_PRECOMMIT_LOG_DIR` was explicitly supplied; then
    3. the caller's supplied `log_dir` compatibility default.

  The helper/callers must capture explicit overrides before `cache.sh` applies
  the hook-checkout default. For footer-absent output, an explicit
  `MUSI_VERIFY_LOG_DIR` is the producing gate override; otherwise an explicit
  adapter-specific `AI_PRECOMMIT_LOG_DIR` is the caller fallback. Only when
  neither exists does the target-derived standard path precede the final
  compatibility default.
- Pass the already-resolved `WORK_ROOT` from both adapter families into the
  failure reader. Claude resolves it at
  `scripts/ai-hooks/git-commit-quiet.sh:49-56`; Codex/Copilot read or resolve it
  at `scripts/ai-hooks/bash-post-tool-use.sh:33-49`. This reuses target identity
  the adapters already computed; it does not duplicate command-target parsing.
- In `scripts/ai-hooks/test.sh`, create different sentinel content under a
  producer-reported directory and a wrong caller directory. Prove that the
  footer wins, that footer-absent lane-targeted output derives the target
  checkout's standard directory, that an explicit override retains precedence
  when no footer survives, and that a malformed/non-final footer cannot redirect
  reads.
- Exercise the real Claude `git-commit-quiet` entrypoint and the Codex and
  Copilot post-tool entrypoints with lane-targeted failure payloads. Each must
  return the producing lane's tail and path, never the hook checkout's
  same-named log.
- Do not extend the authoritative reader grammar to the watchdog's
  `logs: <dir>` timeout breadcrumb
  (`scripts/lib/verify-engine.sh:58-63`) or the per-slot
  `full log: <dir>/<slot>.log` headers
  (`scripts/lib/verify-engine.sh:103-116`). The timeout path has no structured
  `Failed:` record, so adapters already preserve its explicit breadcrumb in the
  generic child-output summary rather than reading a possibly stale slot log.
  The per-slot headers precede backend excerpts, are redundant with the final
  producer footer, and are not a safe second authority when output is truncated.
  For structured legacy/truncated summaries, the target-derived rung above
  closes the cross-lane bug without widening the trusted producer grammar.
- Do not change target parsing, lock/cache keys, verify state derivation, the
  failure-footer grammar, generated hook wiring, or C8's eventual TypeScript
  propagation contract.

## Acceptance

- When adapter defaults name the hook checkout but captured output ends in a
  valid target-lane footer, Claude, Codex, and Copilot summaries show only the
  target lane's failed-slot content and full-log paths.
- Footer-absent structured output from a lane-targeted commit, with no explicit
  log override, uses `musi_standard_verify_log_dir "$WORK_ROOT"` and never
  surfaces the hook checkout's same-named logs.
- Footer-absent output with an explicit `MUSI_VERIFY_LOG_DIR` or
  `AI_PRECOMMIT_LOG_DIR` override uses that directory (with the producing
  `MUSI_VERIFY_LOG_DIR` taking precedence when both are explicit);
  unattributable legacy output reaches the final caller-default rung.
- An earlier quoted or malformed footer cannot redirect the reader; only the
  anchored final producer record is trusted.
- A watchdog timeout remains a generic failure summary containing its
  producer-emitted `logs: <dir>` breadcrumb; per-slot `full log:` headers never
  override the footer/fallback ladder.
- `bash scripts/tests/test-ai-hooks.sh` passes.

## Resolved decisions

- Prefer the gate's final failure-log footer because it carries the actual
  producer directory, including explicit overrides. When the footer is absent,
  use the adapters' already-resolved `WORK_ROOT` before the caller default; this
  is the truncation-safe correction and requires no target-grammar duplication.
- Keep the watchdog `logs:` breadcrumb and per-slot `full log:` headers outside
  the trusted directory-reader grammar for the bounded reasons in Scope.
- Apply the owner-confirmed 2026-07-29 compatibility carve-out because C8 S4 is
  neither scheduled nor dispatchable. When C8 eventually propagates typed
  target state, it must preserve the producer-authoritative behavior
  established here.

## Open questions

None.

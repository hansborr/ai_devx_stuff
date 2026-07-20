# Harness quick wins from the 2026-07-19 arch review

Status: Done — landed 2026-07-19 (wave-1 ready-2026-07 drain)
Date: 2026-07-19
Source: 2026-07-19 harness architecture review, quick wins 1-3 (session
artifact; claims verified against HEAD 544a9d06 the same day); quick
win 4 already landed — see closing note.
Size: S.

## Items

1. **Delete the rename-only pass-throughs in
   `scripts/ai-hooks/doc-length.sh`.** The four `ai_doc_length_*`
   one-liners (`ai_doc_length_rule` :15, `ai_doc_length_rule_surface`
   :19, `ai_doc_length_advisory_for_count` :23, `ai_doc_length_advisory`
   :27) each just forward to the real `musi_doc_length_*`
   implementations in `scripts/doc-length-policy.sh` (:14+). Delete the
   wrappers and update callers to the `musi_*` names — a shallow module
   failing the deletion test in the good direction (68 L file, near-zero
   content of its own).

2. **Dedupe wiring-test scaffolding.**
   `scripts/ai-hooks/test-codex-wiring.sh` and
   `scripts/ai-hooks/test-copilot-wiring.sh` both already source
   `test-support.sh` (codex :18, copilot :20) yet re-declare
   scaffolding: copilot re-declares `assert_no_output` :25 and the
   payload builders `copilot_edit_payload` :32 / `copilot_bash_payload`
   :41 / `copilot_bash_result_payload` :50. Shared helpers already in
   `scripts/ai-hooks/test-support.sh`: `fail` :9, `assert_contains`
   :14, `assert_not_contains` :21, `assert_hook_json` :30,
   `assert_hook_continue_json` :36,
   `make_git_optional_locks_guard_shim` :44. Move genuinely shared
   pieces into `test-support.sh` and delete the re-declarations; decide
   during the work whether the payload builders are shared or
   backend-specific (they carry backend-shaped JSON, so they may
   legitimately stay per-backend).

3. **Extend the `*.generated.sh` naming convention to every generated
   shell fragment.** Inventory generated fragments first, then rename
   and update references (generators, sourcing sites, tests,
   harness.controls.json surfaces) so generated-vs-handwritten is
   visible from the filename without opening files.

## Closing note

Review quick win 4 (stale root-level backlog notes) already landed
2026-07-19 in commits 544a9d06 + 01de1897 — closed, no action here.
Before touching anything for items 1-3, re-verify none of the notes it
named remain.

file:line refs verified 2026-07-19 at HEAD 544a9d06; they drift fast —
re-verify before coding.

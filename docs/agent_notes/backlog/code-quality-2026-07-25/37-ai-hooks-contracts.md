# 37. Two ai-hooks shell contracts are unwritten: the tool_response dialect matrix and the inverted lint-coverage return code

Status: Done — landed 2026-07-26 (`9811294b`, `665d5bce`, `f102a89e`); see [`00-index.md`](./00-index.md#landed)
Theme: Implicit shell contracts in the AI hook layer · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Two helpers in `scripts/ai-hooks/` encode a contract that exists only in the head of
whoever wrote them, and in both cases the next maintainer's most natural reading is
the wrong one.

`ai_response_json_from_payload` (`scripts/ai-hooks/common.sh:579`) is the boundary
normalizer that turns a vendor's `tool_response` blob into `{exit_code, stdout,
stderr, raw}` for `bash-post-tool-use.sh`, which uses `exit_code` for failure
detection. It coalesces **fourteen** different exit-code key spellings plus three
stdout aliases, two stderr aliases and two raw aliases. Which harness feeds the hook is
recorded (`bash-post-tool-use.sh:2-6`: Codex execs it directly, the Copilot adapter
normalizes first, Claude deliberately stays out) — but nothing records which of those
inputs, if any, emits which spelling. `rg -n tool_response docs/ scripts/ai-hooks/README.md
--glob '!docs/agent_notes/**'` returns nothing, and the function itself has no header
comment. A reader confronted with fourteen aliases and no provenance has exactly two
options — leave the whole matrix untouched forever, or start deleting spellings that
"look dead" and silently lose failure detection for a producer that never appears in
the test suite. Only four dialects are exercised today
(`scripts/ai-hooks/test.sh:2186-2201`), so "no test covers it" carries no information
about whether a key is live.

`scripts/ai-hooks/lint-coverage-check.sh` has the mirror-image problem: the contract
is written down but inverted. `ai_lint_coverage_check_file` (:63, documented at
:58-62) returns **non-zero as its success signal** — non-zero means "I captured this
file into a tier", zero means "fully covered, nothing to report". The call site at
:184 is therefore `result=$(ai_lint_coverage_check_file …) || { …bucket the result… }`:
a construct that reads as error handling while actually being the happy path. It is
also fragile — if the helper ever failed for an unrelated reason it would fall into
the same branch with an empty `result`, and the `case` would bucket nothing while
looking like it did. The script runs under `set -u` only (`:7`), with no `set -e`, so
the inversion is a free stylistic choice, not something the shell forced.

The single underlying cause is the same in both files: a shell helper whose real
contract lives in its exit status or in an unlabelled data table, with no note saying
who produces the inputs or why the convention is what it is.

## Evidence

- `scripts/ai-hooks/common.sh:579-627` — `ai_response_json_from_payload`; the exit-code
  coalesce list at :601-615 spans `exit_code`, `exitCode`, `return_code`, `returncode`,
  `exit_status`, `statusCode`, the same six under `metadata.*`, `status`, and `code`.
  Also `stdout|out|output` (:617), `stderr|err` (:618), `raw|text` (:622). No header
  comment on the function.
- `scripts/ai-hooks/test.sh:2186-2201` — the only dialect coverage: four
  `assert_response_combined_exit` cases (`raw`+`exit_code`, bare `raw`,
  `output`+`metadata.exit_code`, `raw`+non-numeric `status`).
- `scripts/ai-hooks/copilot-adapter.sh:40-90` — `ai_copilot_normalized_payload`, an
  in-repo producer that emits `{stdout, exit_code}` after parsing the
  `<shellId: N completed with exit code M>` marker. Proof that at least one dialect
  is generated locally and can be named precisely.
- `scripts/ai-hooks/bash-post-tool-use.sh:29-31` — the sole consumer:
  `RESPONSE=$(ai_response_json_from_payload "$PAYLOAD")` then `jq -r '.exit_code // empty'`.
  (`rg -n ai_response_json_from_payload` outside `docs/` returns only this call, the
  definition, and `scripts/ai-hooks/test.sh:410`.)
- **Two live entry paths.** `scripts/ai-hooks/bash-post-tool-use.sh:2-6` —
  "Codex execs this directly and the Copilot adapter normalizes its payload first. Claude
  deliberately keeps commit output handling in its git-commit-quiet adapter instead."
  Confirmed by wiring: `.codex/hooks/post-tool-use.sh:10` (`exec bash …/bash-post-tool-use.sh`),
  `.copilot/hooks/post-tool-use.sh:17` (`ai_copilot_dispatch post-bash bash "$HOOK_LIB/bash-post-tool-use.sh"`),
  and `harness.controls.json` `hook/ai-codex-post-tool-use` / `hook/ai-copilot-post-tool-use`,
  whose `notes.claude` records the Claude exclusion as deliberate. No Claude
  `PostToolUse` entry in `.claude/settings.json` points at this body.
- `scripts/ai-hooks/lint-coverage-check.sh:41-56` — `ai_lint_coverage_is_ratchet_covered`;
  documented at :34-40, returns 0 on match / 1 on miss and prints the rule ids. This one
  is **not** inverted; only its `is_*` name is wrong for a function whose payload is stdout.
- `scripts/ai-hooks/lint-coverage-check.sh:58-86` — `ai_lint_coverage_check_file`; the
  genuinely inverted contract (`return 1` on both capture paths, `return 0` for a covered file).
- `scripts/ai-hooks/lint-coverage-check.sh:184-191` — `result=$(…) || { tier=…; case … esac; }`.
- `scripts/ai-hooks/lint-coverage-check.sh:7` — `set -u` only.

## Proposed direction

1. **Document what is actually knowable about the inputs — do not invent per-key
   attributions.** Add a header comment above `ai_response_json_from_payload` in
   `scripts/ai-hooks/common.sh` recording the two facts the repo can stand behind:

   - There are exactly **two** live entry paths into the sole consumer. Codex execs
     `bash-post-tool-use.sh` directly (`.codex/hooks/post-tool-use.sh:10`) and feeds it a
     raw vendor `tool_response`; Copilot's payload is normalized first by
     `ai_copilot_normalized_payload` (`scripts/ai-hooks/copilot-adapter.sh:40-90`), which
     is the one dialect this repo generates and can name exactly: `{stdout, exit_code}`.
     Claude Code does **not** route through this aggregate at all — that exclusion is
     deliberate and already recorded at `bash-post-tool-use.sh:2-6` and in
     `harness.controls.json` (`hook/ai-codex-post-tool-use` and
     `hook/ai-copilot-post-tool-use`, both carrying the `notes.claude` explanation).
   - Every remaining spelling is **unattributed defensive compatibility** over an
     external, unversioned payload shape the repo does not own. Say that explicitly, and
     say that an alias with no test is therefore not evidence of a dead alias.

   Group the fourteen exit-code keys in the `jq` list by *shape*, not by vendor — the
   six top-level spellings, the same six under `metadata.*`, then the two ambiguous
   generic fallbacks (`status`, `code`, which are last precisely because they are not
   exit-code-specific names) — and mark the Copilot-adapter-generated `exit_code`/`stdout`
   pair as the one entry with a known in-repo producer.
2. **Add one test case per accepted spelling.** Extend the
   `assert_response_combined_exit` block in `scripts/ai-hooks/test.sh` so each of the
   fourteen exit-code keys and each stdout/stderr/raw alias has a case, table-driven
   rather than fourteen hand-written blocks. This pins the normalizer's behaviour without
   requiring an attribution the repo cannot make, and is the only thing that makes a
   future deletion decidable. No behaviour changes.
3. **Rename `ai_lint_coverage_is_ratchet_covered` → `ai_lint_coverage_ratchet_rules_for_path`**
   in `scripts/ai-hooks/lint-coverage-check.sh` (declaration at :41, call site at :77) and
   adjust its doc block at :34-40. Keep the `ai_lint_coverage_` prefix: the script sources
   `common.sh` at :13 into one shared shell namespace, and all seven functions in this file
   (:21, :41, :63, :94, :117, :123, :142) carry it. Its 0-on-match/1-on-miss behaviour is
   correct and stays; only the `is_*` prefix, which promises a boolean and delivers a
   string, changes.
4. **Un-invert `ai_lint_coverage_check_file`.** Have it `return 0` in all three branches,
   printing the tier record for a captured file and printing nothing for a covered one.
   Rewrite the call site at :184 as a plain assignment followed by
   `[ -n "$result" ] || continue`, then the existing `case`. Update the doc block at :58-62
   to describe the new contract. This removes the "empty result silently buckets nothing"
   hazard as a side effect.
5. Run `bun run harness:check` after steps 1-4; the hook wiring and generated harness
   surfaces are validated by it (see `AGENTS.md` and `docs/ai-harness.md`).

## Scope / caveats

- **Do not retire any exit-code alias.** This is a normalizer at a boundary the repo does
  not own — a raw Codex `tool_response` arrives unversioned and unmodelled, and the
  consumer is failure detection. Deleting a spelling that no test covers trades a
  documentation gap for a *silent* detection gap that produces no signal when a vendor
  reverts to an older shape. Being permissive here is the correct design; step 1 exists
  precisely so the permissiveness stops looking accidental.
- **Do not attribute individual key spellings to vendors in the step-1 comment.** Nothing
  in the tree records which spelling any external vendor emits, and only the Copilot
  dialect has an in-repo producer (`copilot-adapter.sh:40-90`). A comment that guesses is
  worse than no comment — it makes the very deletion this leaf prevents look safe.
  Document the entry paths and the Copilot shape as fact, and mark the rest as
  unattributed compatibility.
- **Do not rename `ai_response_json_from_payload`.** The name already says exactly what
  the function does; a rename touches `bash-post-tool-use.sh:29` and the test suite for no
  readability gain.
- **`ai_lint_coverage_is_ratchet_covered` is not the inverted function.** Its
  `if ratchet_rules=$(…)` call site at :77 is the ordinary bash
  predicate-that-also-prints idiom and is consumed correctly. Rename it (step 3); do not
  touch its return codes.
- Steps 1-2 (common.sh + test.sh) and steps 3-4 (lint-coverage-check.sh) are independent
  files with independent causes; land them as separate commits, and split this leaf in two
  if it is convenient to schedule them apart. They are grouped here only because the
  remedy is the same discipline.
- `lint-coverage-check.sh` is hook-local and advisory-only output, so step 4 carries no
  gate risk. It does consult the lint ratchet engine via
  `bun scripts/lint-ratchet.ts --edit-ratchet-coverage`; read `docs/guides/lint-ratchet.md`
  before touching anything about how that row is parsed (the `IFS=$'\t' read` at :53 must
  keep matching the engine's output shape).
- The `# General-purpose: works with any ESLint config by querying ESLint's own
  resolution.` header at `lint-coverage-check.sh:4-5` and the comment at :73-76 explaining
  why an ESLint-ignored file lands in the softer `ratchet` tier are both load-bearing
  design notes — preserve them verbatim through the refactor.

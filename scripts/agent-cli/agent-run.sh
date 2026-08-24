#!/usr/bin/env bash
# Unified dispatch wrapper for delegated/consulted agent CLI runs (claude,
# codex, copilot, cursor — whose CLI binary is confusingly named `agent`).
# The caller-facing `agent-run:` trailer and exit-code contract lives in the
# skill doc projection at .claude/skills/agent-cli/references/trailer-contract.md
# (mirrored under .codex/); keep this script hand-written and portable with no
# generation/build step.
# This bash entrypoint also bypasses interactive-shell aliases that silently
# append blanket permission flags to bare `claude`/`codex`/`copilot` calls.
# The passthrough scan after `--` is a guard, not a full CLI parser: it
# mirrors just enough of each CLI's option syntax to veto dangerous shapes.
#
# Threat model: same-UID processes, including the delegated backend, are
# trusted. This wrapper defends against crashes, fatal signals, concurrent
# instances of itself, and caller mistakes involving -o/--share paths.
# Adversarial same-UID races on wrapper-private paths are out of scope by
# policy: work mode grants the backend full permissions as the same UID, so
# there is no privilege boundary for temporary-path machinery to defend.
set -euo pipefail

# Test-only controls are inert unless the harness opts in explicitly. Discover
# the namespace from all shell variables so both inherited environment entries
# and unexported variables set by a source caller are covered without a
# hand-maintained allowlist. Drop the master switch before backend launch so
# delegated child runs cannot inherit authority to activate hooks.
# Nested delegated runs deliberately cannot inherit that authority.
if [ "${AGENT_RUN_TEST_HOOKS-}" != 1 ]; then
  while IFS= read -r test_hook; do
    unset "$test_hook"
  done < <(compgen -v AGENT_RUN_TEST_)
fi
unset AGENT_RUN_TEST_HOOKS

# --- state and argument parsing ------------------------------------------------

usage() {
  cat >&2 <<'EOF'
Usage: agent-run.sh <consult|work|review> <claude|codex|copilot|cursor> [options] [-- <native args>]
  consult  read-only second opinion / review / investigation
  work     delegated implementation with full permissions (takes the worktree lock)
  review   codex-only: the native priority-tagged diff-review harness
Options (normalized across agents):
  -p, --prompt <text>       non-whitespace mission prompt (required for consult/work)
  -P, --mission-file <file> non-whitespace mission from a file (alternative to -p)
  -f, --prompt-file <file>  supporting material appended as an <attached> block (repeatable)
  -m, --model <id>          model (required for copilot; cursor defaults to cursor-grok-4.6-xhigh)
  -e, --effort <level>      reasoning effort where the model supports it
  -o, --output <file>       answer file (default: auto-generated under $TMPDIR,
                            named in the `agent-run: answer:` trailer)
  -r, --resume <id>         resume a prior session
  --dirty-ok                let work start from a dirty worktree (only when the
                            task is to inspect the current uncommitted diff)
  --require-feature-branch  work-only: refuse to start on main/master/trunk or
                            a detached HEAD (repo-policy branch protection)
  --branch <name>           work-only: create <name> at the current HEAD and
                            switch to it before the backend launches
EOF
  exit 2
}

reject() {
  SIGNAL_DEFERRAL=''
  printf 'agent-run.sh: %s\n' "$1" >&2
  exit 2
}

# One name for "an uninterruptible ownership transaction is open". A fatal
# signal arriving inside one is recorded by on_fatal_signal and re-raised here,
# so the transaction always publishes its cleanup/finalization facts first.
# Transactions never nest, so a single label is enough — and it is what the
# signal handler tests, which keeps adding a fourth one a two-line change.
enter_signal_deferral() {
  SIGNAL_DEFERRAL="$1"
}

leave_signal_deferral() {
  local deferred_signal
  SIGNAL_DEFERRAL=''
  [ -n "$PENDING_FATAL_SIGNAL" ] || return 0
  deferred_signal="$PENDING_FATAL_SIGNAL"
  PENDING_FATAL_SIGNAL=''
  on_fatal_signal "$deferred_signal"
}

# Resolved from this script so a dispatch set copied into another repo still
# names its own procedure, and absolute for the same reason answer paths are:
# the message has to stay resolvable from whatever directory the caller
# dispatched from. The executables live in the provider-neutral
# `scripts/agent-cli/` home while the contract stays in the skill doc
# projections, so probe each provider tree an adopter may have carried and fall
# back to the canonical one when neither is present.
RECOVERY_DOC=''
for recovery_doc_candidate in .claude .codex; do
  recovery_doc_resolved="$(realpath -m \
    "$(dirname -- "${BASH_SOURCE[0]}")/../../$recovery_doc_candidate/skills/agent-cli/references/trailer-contract.md" \
    2>/dev/null)" || continue
  [ -e "$recovery_doc_resolved" ] || continue
  RECOVERY_DOC="$recovery_doc_resolved"
  break
done
if [ -z "$RECOVERY_DOC" ]; then
  RECOVERY_DOC="$(realpath -m \
    "$(dirname -- "${BASH_SOURCE[0]}")/../../.claude/skills/agent-cli/references/trailer-contract.md" \
    2>/dev/null)" \
    || RECOVERY_DOC='.claude/skills/agent-cli/references/trailer-contract.md'
fi
unset recovery_doc_candidate recovery_doc_resolved
readonly RECOVERY_DOC

# Claim-time attempt-ownership rejection. Callers pass only the specific detail;
# this appends the two things they need and cannot infer from that detail — the
# cheap way to make progress right now, and the procedure that governs the
# bundle they must not touch. Most consumers are unattended agents that will
# otherwise either stall or start deleting records, which is the one action
# recovery forbids. The `explicit recovery is required` wording stays in the
# shared suffix so existing log and contract expectations keep matching.
reject_recovery() { # <detail>
  reject "$1; explicit recovery is required. To proceed now, dispatch again with a fresh -o path. To reuse this path, follow 'Explicit Attempt Recovery' in $RECOVERY_DOC: preserve every artifact, and never hand-edit or delete records, current, last-sequence, or ownership links."
}

has_non_whitespace() {
  [[ "$1" =~ [^[:space:]] ]]
}

validate_single_line_path() {
  local label="$1" path="$2"
  case "$path" in
    *$'\n'* | *$'\r'*)
      # Paths are persisted and reported in newline-delimited control records.
      # Do not echo the hostile value: that would reproduce the forged record
      # shape in the rejection itself.
      reject "$label must be a single-line path without newline characters"
      ;;
  esac
}

pause_for_test_release() {
  local ready="$1" release="$2"
  [ -n "$ready" ] || return 0
  : >"$ready"
  while [ ! -e "$release" ]; do sleep 0.01; done
}

# Reject a caller-supplied write path ($2) that resolves inside the worktree
# top ($3): the wrapper's own writes there read as consult drift or a work
# run's leftover changes, so answer/share paths must land outside the repo.
reject_in_tree_path() {
  local label="$1" path="$2" top="$3" abs
  [ -n "$top" ] || return 0
  abs="$(realpath -m -- "$path" 2>/dev/null || true)"
  [ -n "$abs" ] || reject "cannot resolve $label path '$path' for the in-tree write guard; use an absolute path outside the repo"
  case "$abs" in
    "$top" | "$top"/*)
      reject "$label resolves inside this worktree, where the wrapper's own write would read as consult drift or leftover work; write it outside the repo (e.g. /tmp)"
      ;;
  esac
}

agent_run_reset_state() {
  MODE=''
  AGENT=''
  PROMPT=''
  MISSION_FILES=()
  MISSION_SOURCES=()
  PROMPT_FILES=()
  MODEL=''
  EFFORT=''
  OUT=''
  RESUME=''
  DIRTY_OK=0
  REQUIRE_FEATURE_BRANCH=0
  BRANCH_NAME=''
  BRANCH_CREATED_BY_WRAPPER=0
  BRANCH_PRE_HEAD=''
  BRANCH_PRE_REF=''
  PASSTHRU=()
  NORMALIZED_ARGS=()
  AUTO_OUT=0
  OUT_ABS=''
  TMP_RUN=''
  CONSULT_GRANTS=0
  GIT_DIR_PATH=''
  WT_TOP=''
  SAFE_TMPDIR="${TMPDIR:-/tmp}"
  FULL_PROMPT=''
  CONSULT_PREAMBLE=''
  STDIN_SRC=/dev/null
  COPILOT_SHARE=''
  COPILOT_SHARE_ABS=''
  COPILOT_SHARE_LOCK_PATH=''
  COPILOT_SHARE_LOCK_IDENTITY=''
  CALLER_TRANSCRIPT_CLAIMED=0
  CALLER_TRANSCRIPT_CLAIM_IDENTITY=''
  LOCK_NEEDED=0
  LOCK_PATH=''
  LOCK_ACQUIRED=0
  CAN_PROBE=0
  LOCK_PROBE_UNAVAILABLE=0
  DRIFT_CHECKED_MODE=0
  DRIFT_PRE=''
  DRIFT_POST=''
  DRIFT_UNCHECKED=0
  UNCHECKED_REASON='another agent run held the lock; drift cannot be attributed'
  CWD_MOVED=0
  WORK_HEAD_PRE=''
  SIDECAR=''
  ATTEMPT_LOCK_PATH=''
  ATTEMPT_PATH_LOCK_IDENTITY=''
  ATTEMPT_ROOT=''
  ATTEMPT_ROOT_IDENTITY=''
  ATTEMPT_ID=''
  ATTEMPT_DIR=''
  ATTEMPT_RECORD=''
  ATTEMPT_LOCK_IDENTITY=''
  ATTEMPT_SEQUENCE_PATH=''
  ATTEMPT_SEQUENCE=1
  LOADED_LAST_SEQUENCE=0
  PREVIOUS_ATTEMPT_ID=none
  CANDIDATE_ANSWER=''
  ATTEMPT_TRANSCRIPT_OWNER=none
  ATTEMPT_CLAIMED=0
  ATTEMPT_DIR_UNRECORDED=0
  ATTEMPT_BUNDLE_CREATED=0
  SIGNAL_DEFERRAL=''
  PENDING_FATAL_SIGNAL=''
  ATTEMPT_FINALIZED=0
  SIGNAL_ABORTED=0
  ANSWER_PUBLISHED=0
  CANDIDATE_ANSWER_COMPLETE=0
  RETIRED_OUT_PATH=''
  RETIRED_OUT_IDENTITY=''
  BACKEND_DISPOSITION=pending
  BACKEND_EXIT_TRAILER=''
  cmd=()
  CAPTURE=''
  SESSION_ID=''
  SESSION_ID_LOGGED=0
  DIAGNOSTICS_REPLAYED=0
  DISPATCH_HEADER_EMITTED=0
  ORPHANED_CHILDREN=0
  ORPHANED_PGID=''
  code=0
  PARSE_FAIL=0
  IS_ERROR=0
  NO_FINAL_ANSWER=0
  BACKEND_PID=''
  TEE_PID=''
  BACKEND_PID_FILE=''
  BACKEND_PHASE=pre
  WAIT_INTERRUPTED=0
  WAIT_IN_PROGRESS=0
  WAIT_SITE=''
  SETSID=()
}

path_identity() {
  stat -c '%d:%i' -- "$1" 2>/dev/null || true
}

path_matches_identity() {
  local path="$1" expected="$2" expected_type="$3" actual
  [ -n "$expected" ] && [ ! -L "$path" ] || return 1
  case "$expected_type" in
    directory) [ -d "$path" ] || return 1 ;;
    file) [ -f "$path" ] || return 1 ;;
    *) return 1 ;;
  esac
  actual="$(path_identity "$path")"
  [ "$actual" = "$expected" ]
}

remove_owned_attempt_root() {
  [ -n "$ATTEMPT_ROOT" ] || return 0
  path_matches_identity "$ATTEMPT_ROOT" "$ATTEMPT_ROOT_IDENTITY" directory \
    || return 0
  rm -rf -- "$ATTEMPT_ROOT"
}

remove_owned_retired_path() {
  [ -n "$RETIRED_OUT_PATH" ] || return 0
  path_matches_identity "$RETIRED_OUT_PATH" "$RETIRED_OUT_IDENTITY" file \
    || return 0
  [ ! -s "$RETIRED_OUT_PATH" ] || return 0
  rm -f -- "$RETIRED_OUT_PATH"
}

# Generated output paths keep a published answer but otherwise shed ordinary
# finalized/private artifacts; ambiguous attempts retain recovery evidence.
# Explicit -o artifacts always stay, and only a finalized no-answer record
# makes that path eligible for retry. Generation happens later, once the
# worktree top is known.
cleanup() {
  [ -z "$TMP_RUN" ] || rm -rf "$TMP_RUN"
  if [ "$ATTEMPT_DIR_UNRECORDED" = 1 ]; then
    # This directory was generated by mktemp but never gained an attempt record,
    # so it is not recovery evidence. Remove exactly that private allocation;
    # if this claim also initialized the bundle, remove the now-empty lineage so
    # a fresh explicit output does not fail later for a missing current pointer.
    case "$ATTEMPT_DIR" in
      "$ATTEMPT_ROOT"/attempt.*) rm -rf -- "$ATTEMPT_DIR" ;;
    esac
    if [ "$ATTEMPT_BUNDLE_CREATED" = 1 ]; then
      remove_owned_attempt_root
    fi
  fi
  if [ "$CALLER_TRANSCRIPT_CLAIMED" = 1 ] \
    && [ "$BACKEND_PHASE" = pre ] && [ "$ATTEMPT_FINALIZED" = 0 ] \
    && path_matches_identity "$SIDECAR" "$CALLER_TRANSCRIPT_CLAIM_IDENTITY" file \
    && [ ! -s "$SIDECAR" ]; then
    rm -f -- "$SIDECAR"
  fi
  if [ "$AUTO_OUT" = 1 ]; then
    # Generated paths have no caller-managed retry lifecycle. Reap their
    # private namespace after an ordinary finalized run (or a pre-claim
    # rejection), but retain ambiguous/unfinalized attempts for explicit
    # recovery. SIGKILL never reaches this trap, so crash evidence survives.
    # A signal-finalized attempt is a crashed attempt, not an ordinary one: its
    # record and transcript are the only evidence a recovering caller has (and
    # the only copy of the session id), and the already-printed `attempt:`
    # trailer still names them — so a claimed attempt killed by a fatal signal
    # keeps its bundle even though finalization completed.
    if [ "$ATTEMPT_CLAIMED" != 1 ] \
      || { [ "$ATTEMPT_FINALIZED" = 1 ] && [ "$SIGNAL_ABORTED" = 0 ]; }; then
      pause_for_test_release \
        "${AGENT_RUN_TEST_AUTO_CLEANUP_READY-}" "${AGENT_RUN_TEST_AUTO_CLEANUP_RELEASE-}"
      remove_owned_attempt_root
      remove_owned_retired_path
      [ -z "$ATTEMPT_PATH_LOCK_IDENTITY" ] || rm -f -- "$ATTEMPT_PATH_LOCK_IDENTITY"
      [ -z "$ATTEMPT_LOCK_PATH" ] || rm -f -- "$ATTEMPT_LOCK_PATH"
    fi
    if ! [ -s "$OUT" ]; then
      rm -f -- "$OUT"
    fi
  fi
}

# Accept --opt=value (and -o=value) spellings for the wrapper's own options by
# splitting a leading option=value token in two before the option loop, so the
# equals form is handled identically to the spaced form. The passthrough guards
# already normalize every attached/equals *native* spelling; the wrapper's own
# parser should not be the one place that rejects them. Splitting stops at the
# first `--`: native args after it are the backend's and pass through verbatim.
# Only the first `=` splits, so an inline value may itself contain `=`.
# This pass cannot know which pre-`--` tokens are option values. A mission like
# `-p '--dry-run=true safe?'` therefore splits and then fails loud as an
# unknown wrapper option; use -P/--mission-file when the mission itself must be
# a whole token that starts with an equals-style flag shape.
normalize_wrapper_optargs() {
  local a seen_ddash=0
  NORMALIZED_ARGS=()
  for a in "$@"; do
    if [ "$seen_ddash" = 1 ]; then NORMALIZED_ARGS+=("$a"); continue; fi
    case "$a" in
      --) seen_ddash=1; NORMALIZED_ARGS+=("$a") ;;
      --?*=* | -[a-zA-Z]=*) NORMALIZED_ARGS+=("${a%%=*}" "${a#*=}") ;;
      *) NORMALIZED_ARGS+=("$a") ;;
    esac
  done
}

parse_args() {
  local prompt_file
  if [ "$#" -lt 2 ]; then usage; fi
  MODE="$1"
  AGENT="$2"
  shift 2
  case "$MODE" in consult | work | review) ;; *) usage ;; esac
  case "$AGENT" in claude | codex | copilot | cursor) ;; *) usage ;; esac
  if [ "$MODE" = review ] && [ "$AGENT" != codex ]; then
    reject "review is the codex native diff-review harness; use 'review codex' (or consult for the others)"
  fi
  normalize_wrapper_optargs "$@"
  set -- ${NORMALIZED_ARGS[@]+"${NORMALIZED_ARGS[@]}"}

  while [ "$#" -gt 0 ]; do
    case "$1" in
      -p | --prompt)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        [ -z "$PROMPT" ] || reject "duplicate $1 would silently drop the first mission; merge the text into one prompt"
        PROMPT="$2"
        MISSION_SOURCES+=("p")
        shift 2
        ;;
      -P | --mission-file)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        MISSION_FILES+=("$2")
        MISSION_SOURCES+=("P")
        shift 2
        ;;
      -f | --prompt-file)
        { [ -f "${2-}" ] && [ -r "${2-}" ]; } || reject "$1 requires a readable file"
        for prompt_file in "${PROMPT_FILES[@]}"; do
          [ "$prompt_file" != "$2" ] || reject "duplicate $1 '$2' would attach the same material twice"
        done
        PROMPT_FILES+=("$2")
        shift 2
        ;;
      -m | --model)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        MODEL="$2"
        shift 2
        ;;
      -e | --effort)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        EFFORT="$2"
        shift 2
        ;;
      -o | --output)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        validate_single_line_path "-o" "$2"
        OUT="$2"
        shift 2
        ;;
      -r | --resume)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        RESUME="$2"
        shift 2
        ;;
      --dirty-ok)
        DIRTY_OK=1
        shift
        ;;
      --require-feature-branch)
        REQUIRE_FEATURE_BRANCH=1
        shift
        ;;
      --branch)
        [ -n "${2-}" ] || reject "$1 requires a non-empty value"
        BRANCH_NAME="$2"
        shift 2
        ;;
      --)
        shift
        PASSTHRU=("$@")
        break
        ;;
      *)
        reject "unknown option '$1' — wrapper options are -p/-P/-f/-m/-e/-o/-r; native CLI flags go after --"
        ;;
    esac
  done
}

load_mission_file() {
  # -P/--mission-file is -p read from a file. Both -p and -P are repeatable and
  # composable: every mission component is concatenated in the exact order it
  # appeared on the command line, separated by one blank line, then folded into
  # PROMPT so every later step (preamble, assembly, size limits) treats the
  # result identically to a single -p. This makes resume composition a
  # one-command operation — the original mission file plus a recovery preamble
  # (e.g. `-P orig.prompt -P resume-note.prompt`) reach the backend as one
  # prompt, no hand-concatenation. Mission files are caller input, so unlike -o
  # they may live inside the worktree.
  local composed='' src text path fidx=0
  [ ${#MISSION_FILES[@]} -gt 0 ] || return 0
  for src in ${MISSION_SOURCES[@]+"${MISSION_SOURCES[@]}"}; do
    case "$src" in
      p)
        text="$PROMPT"
        has_non_whitespace "$text" \
          || reject "-p mission text has no non-whitespace content; write the mission into it (or use --mission-file)"
        ;;
      P)
        path="${MISSION_FILES[fidx]}"
        fidx=$((fidx + 1))
        [ -e "$path" ] || reject "--mission-file '$path' does not exist"
        [ ! -d "$path" ] || reject "--mission-file '$path' is a directory, not a mission text file"
        { [ -f "$path" ] && [ -r "$path" ]; } || reject "--mission-file '$path' is not a readable file"
        [ -s "$path" ] || reject "--mission-file '$path' is empty; write the mission text into it (or use -p)"
        text="$(cat -- "$path")"
        has_non_whitespace "$text" \
          || reject "--mission-file '$path' has no non-whitespace mission text; write the mission into it (or use -p)"
        ;;
    esac
    if [ -n "$composed" ]; then
      composed="$composed"$'\n\n'"$text"
    else
      composed="$text"
    fi
  done
  PROMPT="$composed"
}

validate_usage_options() {
  if [ "$MODE" = review ]; then
    [ -z "$OUT" ] || reject "review has no last-message file; read the findings from the log"
    [ -z "$RESUME" ] || reject "review has no resume; iterate via consult/work sessions instead"
    [ ${#PROMPT_FILES[@]} -eq 0 ] || reject "review takes only a short custom-instruction -p"
  else
    has_non_whitespace "$PROMPT" \
      || reject "a non-empty mission prompt with non-whitespace text is required: use -p '<text>' or --mission-file <path>; -f only attaches supporting material"
  fi
  if [ "$DIRTY_OK" = 1 ] && [ "$MODE" != work ]; then
    reject "--dirty-ok only applies to work; consult and review are read-only and safe on a dirty tree"
  fi
  if [ "$REQUIRE_FEATURE_BRANCH" = 1 ] && [ "$MODE" != work ]; then
    reject "--require-feature-branch only applies to work; consult and review never commit"
  fi
  if [ -n "$BRANCH_NAME" ] && [ "$MODE" != work ]; then
    reject "--branch only applies to work; consult and review never commit"
  fi
  run_adapter_hook validate_usage
}

validate_usage_copilot() {
  command -v python3 >/dev/null 2>&1 \
    || reject "the copilot backend needs python3 on PATH to parse the structured answer (-o depends on it)"
  [ -n "$MODEL" ] \
    || reject "copilot requires -m <model> (omitting it silently runs the Copilot default model)"
}

validate_usage_claude() {
  command -v python3 >/dev/null 2>&1 \
    || reject "the claude backend needs python3 on PATH to parse the result envelope (-o and the trailers depend on it)"
}

# Cursor's `agent` dispatches a subcommand whenever the first operand token is
# exactly one of these words — even after `--` — so a one-word mission like
# `update` would run `agent update` (a self-update) instead of prompting.
# Keep this in sync with the Commands section of `agent --help`, aliases
# included: `resume` and `ls` resume a chat session, so a bare one under work
# mode would resume the latest unrelated chat with mutation permissions.
CURSOR_SUBCOMMANDS='install-shell-integration uninstall-shell-integration login logout mcp plugin worker status whoami models about update create-chat generate-rule rule agent ls resume help'

validate_usage_cursor() {
  command -v python3 >/dev/null 2>&1 \
    || reject "the cursor backend needs python3 on PATH to parse the result envelope (-o and the trailers depend on it)"
  [ -z "$EFFORT" ] \
    || reject "cursor has no effort flag; effort is encoded in the model id (cursor-grok-4.6-xhigh) or a bracket override (-m 'claude-opus-4-8[effort=high]')"
  # Consults are immune to the subcommand-word collision (the injected
  # preamble prefixes the prompt), as is any mission with -f material appended.
  if [ "$MODE" = work ] && [ ${#PROMPT_FILES[@]} -eq 0 ]; then
    case " $CURSOR_SUBCOMMANDS " in
      *" $PROMPT "*)
        reject "a mission of exactly '$PROMPT' would dispatch the cursor subcommand of that name instead of prompting; rephrase the mission"
        ;;
    esac
  fi
}

validate_resume_id() {
  [ -n "$RESUME" ] || return 0
  case "$AGENT" in
    codex)
      [[ "$RESUME" =~ ^$UUID_RE$ ]] \
        || reject "-r requires a valid Codex session id (UUID); native resume options such as --last are not accepted"
      ;;
    *)
      [[ "$RESUME" =~ ^[[:alnum:]][[:alnum:]_.:-]*$ ]] \
        || reject "-r requires a valid $AGENT session id beginning with an alphanumeric character"
      ;;
  esac
}

parse_and_validate_args() {
  parse_args "$@"
  load_mission_file
  validate_usage_options
  validate_resume_id
}

# --- backend adapters ---------------------------------------------------------
# Every per-backend difference lives in one adapter set per backend, reached
# through a uniform dispatch so the shared lifecycle carries no `case "$AGENT"`.
#
# Required verbs — every backend defines these; dispatched by constructed name:
#   guard_<backend>            passthrough veto scan     (run_passthrough_guards)
#   build_<backend>_command    argv construction         (build_backend_command)
#   launch_<backend>           launch / wait / parse     (run_backend)
# Optional per-phase hooks — defined only by the backends that need them and
# invoked through run_adapter_hook <verb>, which is a no-op where the
# `<verb>_<backend>` function is absent:
#   validate_usage_<backend>          extra usage validation
#   oversized_prompt_guard_<backend>  reject an over-argv prompt where stdin is ignored
#   prepare_answer_<backend>          answer/sidecar path prep before the lock
#   validate_launch_paths_<backend>   answer/sidecar path checks under the lock
#   drift_cwd_<backend>               detect a cwd move for the consult drift check
#   extract_session_<backend>         parse the backend session id
#   flush_diagnostics_<backend>       replay stable private backend diagnostics
#
# Adding a backend is one adapter set plus one entry in the agent registry
# (the `case "$AGENT"` in parse_args) — no edit anywhere else.
run_adapter_hook() {
  local fn="${1}_${AGENT}"
  if declare -F "$fn" >/dev/null 2>&1; then "$fn"; fi
}

# --- passthrough guards -------------------------------------------------------

codex_config_guard() {
  local assignment="${1#=}" key
  # accept the `-c=KEY=VAL` spelling by stripping one leading `=`
  case "$assignment" in
    *=*) key="${assignment%%=*}" ;;
    *) return 0 ;;
  esac
  # Codex parses overrides as TOML and accepts whitespace around `=` and dotted
  # key separators, plus quoted keys. Canonicalize that key syntax before
  # comparing ownership. Escaped quoted keys are rejected conservatively:
  # decoding TOML escapes in shell would otherwise create another bypass.
  key="${key//[[:space:]]/}"
  case "$key" in
    *\\*)
      reject "escaped config keys cannot safely override wrapper-owned Codex configuration"
      ;;
  esac
  key="${key//\"/}"
  key="${key//\'/}"
  case "$key" in
    sandbox_mode)
      reject "sandbox_mode is wrapper-owned: codex sandboxing (bwrap) does not work in this devcontainer"
      ;;
    approval_policy)
      reject "approval_policy is wrapper-owned ('-a never' keeps headless runs from stalling)"
      ;;
    profile)
      reject "profile is wrapper-owned; profiles can override sandbox/approval config"
      ;;
    model)
      reject "model is wrapper-owned; use the wrapper's -m option"
      ;;
    model_provider)
      reject "model provider is wrapper-owned; use the wrapper's -m option"
      ;;
    model_providers | model_providers.*)
      reject "model provider is wrapper-owned; use the wrapper's -m option"
      ;;
    model_reasoning_effort)
      reject "model_reasoning_effort is wrapper-owned; use the wrapper's -e option"
      ;;
  esac
}

# The -X?* patterns catch clap's attached and equals short-value spellings
# (-C/tmp, -C=/tmp, -csandbox_mode=...), which a flag-only match would pass.
guard_codex() {
  local i=0 n=${#PASSTHRU[@]} arg
  while [ "$i" -lt "$n" ]; do
    arg="${PASSTHRU[i]}"
    case "$arg" in
      -C | -C?* | --cd | --cd=*)
        reject "$arg moves the run off this worktree's lock and drift check; dispatch from the worktree the run should own"
        ;;
      -a | -a?* | --ask-for-approval | --ask-for-approval=*)
        reject "$arg overrides the wrapper's approval policy ('-a never' keeps headless runs from stalling)"
        ;;
      -s | -s?* | --sandbox | --sandbox=* | --full-auto | --dangerously-bypass-approvals-and-sandbox | --dangerously-bypass-hook-trust | --yolo)
        reject "$arg is wrapper-owned: codex sandboxing (bwrap) does not work in this devcontainer"
        ;;
      -p | -p?* | --profile | --profile=*)
        reject "$arg can override wrapper-owned sandbox/approval config via a profile; pass explicit wrapper options instead"
        ;;
      -m | -m?* | --model | --model=*)
        reject "$arg is wrapper-owned; use the wrapper's -m option"
        ;;
      -o | -o?* | --output-last-message | --output-last-message=*)
        reject "$arg is wrapper-owned; use the wrapper's -o option"
        ;;
      -c?*)
        codex_config_guard "${arg#-c}"
        ;;
      -c | --config)
        codex_config_guard "${PASSTHRU[i + 1]:-}"
        ;;
      --config=*)
        codex_config_guard "${arg#--config=}"
        ;;
      resume | --last)
        # codex resume is an exec subcommand, so a flag scan alone would let
        # `-- resume --last` re-target another session behind the wrapper.
        reject "$arg re-targets sessions behind the wrapper; resume by explicit id with the wrapper's -r"
        ;;
    esac
    i=$((i + 1))
  done
}

# Quoted case patterns are literal: 'Bash(*)' matches only that exact string
# (an effectively-blanket grant), not narrow shapes like Bash(git diff:*).
# 'Bash(:*)' is the empty-prefix spelling of the same blanket.
claude_blanket_tool_guard() {
  case "$1" in
    Bash | Write | Edit | NotebookEdit | Task | 'Bash(*)' | 'Bash(*:*)' | 'Bash(:*)' | 'Write(*)' | 'Write(*:*)' | 'Write(:*)' | 'Edit(*)' | 'Edit(*:*)' | 'Edit(:*)' | 'NotebookEdit(*)' | 'NotebookEdit(*:*)' | 'NotebookEdit(:*)' | 'Task(*)' | 'Task(*:*)' | 'Task(:*)')
      reject "blanket --allowedTools grant '$1' breaks consult's read-only guarantee; narrow it (e.g. 'Bash(git diff:*)') or use work mode"
      ;;
  esac
}

guard_split_values() {
  local guard_fn="$1" value v vals
  shift
  for value in "$@"; do
    IFS=', ' read -r -a vals <<<"$value"
    for v in "${vals[@]}"; do "$guard_fn" "$v"; done
  done
}

guard_claude() {
  local i=0 n=${#PASSTHRU[@]} arg value
  while [ "$i" -lt "$n" ]; do
    arg="${PASSTHRU[i]}"
    case "$arg" in
      -p | --print | --output-format | --output-format=* | --input-format | --input-format=*)
        reject "$arg is wrapper-owned (print mode and the JSON result envelope)"
        ;;
      -r | -r?* | --resume | --resume=* | --from-pr | --from-pr=* | -c | --continue | --fork-session | --session-id | --session-id=*)
        reject "$arg conflicts with wrapper session handling; use -r <session-id>"
        ;;
      -w | -w?* | --worktree | --worktree=*)
        reject "$arg moves the run into a fresh worktree, off this worktree's lock and drift check; dispatch from the worktree the run should own"
        ;;
      --permission-mode | --permission-mode=*)
        if [ "$MODE" = consult ]; then
          reject "$arg breaks consult's read-only guarantee; use work mode"
        else
          reject "$arg is wrapper-owned: it can downgrade work mode's full-permission profile and stall a headless run"
        fi
        ;;
      --dangerously-skip-permissions | --dangerously-skip-permissions=* | --allow-dangerously-skip-permissions | --allow-dangerously-skip-permissions=*)
        if [ "$MODE" = consult ]; then
          reject "$arg breaks consult's read-only guarantee; use work mode"
        fi
        ;;
      --model | --model=*)
        reject "$arg is wrapper-owned; use the wrapper's -m option"
        ;;
      --settings | --settings=* | --mcp-config | --mcp-config=* | --disallowedTools | --disallowed-tools | --disallowedTools=* | --disallowed-tools=* | --permission-prompt-tool | --permission-prompt-tool=*)
        if [ "$MODE" = consult ]; then
          reject "$arg can widen or override consult's read-only permission profile; use work mode"
        fi
        ;;
      --allowedTools | --allowed-tools)
        # variadic: values are the args that follow, up to the next option
        while [ $((i + 1)) -lt "$n" ]; do
          value="${PASSTHRU[i + 1]}"
          case "$value" in -*) break ;; esac
          if [ "$MODE" = consult ]; then
            guard_split_values claude_blanket_tool_guard "$value"
            CONSULT_GRANTS=1
          fi
          i=$((i + 1))
        done
        ;;
      --allowedTools=* | --allowed-tools=*)
        if [ "$MODE" = consult ]; then
          guard_split_values claude_blanket_tool_guard "${arg#*=}"
          CONSULT_GRANTS=1
        fi
        ;;
    esac
    i=$((i + 1))
  done
}

# Quoted case patterns are literal: 'shell(*)' matches only that exact
# effectively-blanket string, not narrow shapes like shell(git diff:*).
# 'shell(:*)' is the empty-prefix spelling of the same blanket. Copilot's
# grammar is kind(argument) with the argument optional, and `copilot help
# permissions` states an omitted shell command allows every shell command —
# so 'shell()' is the bare `shell` blanket wearing parentheses.
copilot_blanket_grant_guard() {
  case "$1" in
    shell | write | 'shell()' | 'shell(*)' | 'shell(*:*)' | 'shell(:*)' | 'write()' | 'write(*)' | 'write(*:*)' | 'write(:*)')
      reject "blanket grant --allow-tool $1 breaks consult's read-only guarantee; narrow it (e.g. 'shell(git diff:*)') or use work mode"
      ;;
  esac
}

copilot_cwd_flag() {
  case "$1" in
    -C | -C?*) return 0 ;;
    *) return 1 ;;
  esac
}
copilot_cwd_target() {
  case "$1" in
    -C)
      [ -n "${2-}" ] || return 1
      printf '%s\n' "$2"
      ;;
    -C=*)
      printf '%s\n' "${1#-C=}"
      ;;
    -C?*)
      printf '%s\n' "${1#-C}"
      ;;
    *)
      return 1
      ;;
  esac
}
copilot_value_flag_consumes_next() {
  local next="${2-}"

  case "$1" in
    -n | --add-dir | --add-github-mcp-tool | --add-github-mcp-toolset | --additional-mcp-config | --agent | --attachment | --context | --disable-mcp-server | --effort | --reasoning-effort | --extension-sdk-path | --log-dir | --log-level | --max-ai-credits | --max-autopilot-continues | --name | --plugin-dir | --stream)
      return 0
      ;;
    --allow-url | --available-tools | --bash-env | --deny-url | --excluded-tools | --secret-env-vars)
      case "$next" in
        '' | -*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac
}

guard_copilot() {
  local i=0 n=${#PASSTHRU[@]} arg value
  while [ "$i" -lt "$n" ]; do
    arg="${PASSTHRU[i]}"
    case "$arg" in
      -i | -i?* | --interactive | --interactive=*)
        reject "$arg starts the interactive TUI and hangs a headless caller"
        ;;
      --acp | --autopilot | --mode | --mode=*)
        reject "$arg starts or selects an interactive/server mode; the wrapper owns non-interactive dispatch mode"
        ;;
      -p | -p?* | --prompt | --prompt=* | --model | --model=* | -r | -r?* | --resume | --resume=* | --continue | --session-id | --session-id=* | --connect | --connect=*)
        reject "$arg is wrapper-owned; use the wrapper's -p / -m / -r options"
        ;;
      --output-format | --output-format=*)
        reject "$arg is wrapper-owned: the -o answer contract relies on the wrapper's JSONL parser"
        ;;
      -s | --silent)
        reject "$arg is wrapper-owned: output selection is part of the -o answer contract"
        ;;
      --share | --share-gist | --share-gist=*)
        reject "bare --share writes its default path into the worktree and --share-gist publishes externally; use --share=<path outside the worktree>"
        ;;
      --allow-all | --yolo | --allow-all-tools)
        if [ "$MODE" = consult ]; then
          reject "$arg breaks consult's read-only guarantee; use work mode"
        fi
        ;;
      --allow-tool | --deny-tool)
        # variadic: values are the args that follow, up to the next option;
        # split comma lists exactly like the --allow-tool=<...> form does
        while [ $((i + 1)) -lt "$n" ]; do
          value="${PASSTHRU[i + 1]}"
          case "$value" in -*) break ;; esac
          if [ "$arg" = --allow-tool ] && [ "$MODE" = consult ]; then
            guard_split_values copilot_blanket_grant_guard "$value"
            CONSULT_GRANTS=1
          fi
          i=$((i + 1))
        done
        ;;
      --allow-tool=*)
        if [ "$MODE" = consult ]; then
          guard_split_values copilot_blanket_grant_guard "${arg#--allow-tool=}"
          CONSULT_GRANTS=1
        fi
        ;;
      *)
        if copilot_cwd_flag "$arg" && [ "$MODE" = work ]; then
          reject "$arg moves the run off this worktree's lock; dispatch from the worktree the run should mutate"
        fi
        if copilot_value_flag_consumes_next "$arg" "${PASSTHRU[i + 1]:-}"; then
          i=$((i + 1))
        fi
        ;;
    esac
    i=$((i + 1))
  done
}

# Cursor's `agent` is commander-style: long flags take `--flag value` or
# `--flag=value`, and the short flags here are boolean, so there are no
# attached short-value spellings to mirror. Bare subcommand words are vetoed
# like codex's `resume` — they would dispatch behind the wrapper (see
# CURSOR_SUBCOMMANDS above).
guard_cursor() {
  local i=0 n=${#PASSTHRU[@]} arg
  while [ "$i" -lt "$n" ]; do
    arg="${PASSTHRU[i]}"
    case "$arg" in
      -p | --print | --output-format | --output-format=* | --stream-partial-output)
        reject "$arg is wrapper-owned (print mode and the JSON result envelope)"
        ;;
      --model | --model=* | --list-models)
        reject "$arg is wrapper-owned; use the wrapper's -m option"
        ;;
      --resume | --resume=* | --continue)
        reject "$arg conflicts with wrapper session handling; use -r <session-id>"
        ;;
      -f | --force | --yolo | --auto-review)
        if [ "$MODE" = consult ]; then
          reject "$arg breaks consult's read-only guarantee; use work mode"
        else
          reject "$arg is wrapper-owned; work already runs with --force"
        fi
        ;;
      --mode | --mode=* | --plan)
        if [ "$MODE" = consult ]; then
          reject "$arg is wrapper-owned; consult already runs read-only --mode ask"
        else
          reject "$arg would downgrade work to a read-only mode and no-op the mission; use consult for read-only runs"
        fi
        ;;
      --sandbox | --sandbox=*)
        reject "$arg is wrapper-owned sandbox config; permissions come from the wrapper's mode"
        ;;
      --trust)
        reject "$arg is wrapper-owned (the wrapper always trusts the dispatch worktree)"
        ;;
      --approve-mcps)
        if [ "$MODE" = consult ]; then
          reject "$arg can auto-approve MCP servers whose tools mutate outside ask mode's read-only surface; use work mode"
        fi
        ;;
      --workspace | --workspace=*)
        reject "$arg moves the run off this worktree's lock and drift check; dispatch from the worktree the run should own"
        ;;
      -w | --worktree | --worktree=* | --worktree-base | --worktree-base=* | --skip-worktree-setup)
        reject "$arg moves the run into a fresh worktree, off this worktree's lock and drift check; dispatch from the worktree the run should own"
        ;;
    esac
    case " $CURSOR_SUBCOMMANDS " in
      *" $arg "*)
        reject "bare '$arg' would dispatch the cursor subcommand of that name behind the wrapper; drop it"
        ;;
    esac
    i=$((i + 1))
  done
}

run_passthrough_guards() {
  "guard_$AGENT"
}

# COPILOT_ALLOW_ALL is --allow-all-tools by another name; permissions are
# wrapper-owned for every backend, so an inherited grant never leaks in.
clear_backend_permission_env() {
  unset COPILOT_ALLOW_ALL
}

# Read-only Git probes must not opportunistically refresh and rewrite the
# dispatch worktree's index: that races the user's own git add/commit for
# .git/index.lock. Keep this as a per-command environment assignment so it
# never reaches write commands or the delegated backend.
git_read() {
  GIT_OPTIONAL_LOCKS=0 git "$@"
}

load_git_context() {
  GIT_DIR_PATH="$(git_read rev-parse --git-dir 2>/dev/null || true)"
  WT_TOP=''
  if [ -n "$GIT_DIR_PATH" ]; then
    WT_TOP="$(git_read rev-parse --show-toplevel 2>/dev/null || true)"
  fi
}

validate_required_feature_branch() {
  local current_branch

  if [ "$REQUIRE_FEATURE_BRANCH" = 1 ] && [ -z "$BRANCH_NAME" ]; then
    [ -n "$GIT_DIR_PATH" ] || reject "--require-feature-branch needs a git worktree; dispatch from inside the repo"
    current_branch="$(git_read symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    [ -n "$current_branch" ] || reject "--require-feature-branch: HEAD is detached; switch to a feature branch first (git switch -c <branch>)"
    case "$current_branch" in
      main | master | trunk)
        reject "--require-feature-branch: '$current_branch' is a protected branch; switch to a feature branch first (git switch -c <branch>)"
        ;;
    esac
  fi
}

validate_prelock_branch_policy() {
  # --branch names a fresh feature branch the wrapper will create at dispatch;
  # validate the name before the lock is taken (creation happens later, under
  # the lock). With it, --require-feature-branch is satisfied structurally by
  # the created branch, so the current-branch check below is skipped — the
  # common "worktree parked on main, mission starts with a checkout" shape
  # stops depending on the delegate remembering that first step.
  if [ -n "$BRANCH_NAME" ]; then
    [ -n "$GIT_DIR_PATH" ] || reject "--branch needs a git worktree; dispatch from inside the repo"
    git_read check-ref-format --branch "$BRANCH_NAME" >/dev/null 2>&1 \
      || reject "--branch '$BRANCH_NAME' is not a valid branch name"
    case "$BRANCH_NAME" in
      main | master | trunk)
        reject "--branch '$BRANCH_NAME' names a protected branch; pick a feature branch (e.g. feat/<task>)"
        ;;
    esac
  fi

  # Fail fast before taking the worktree lock, then repeat this HEAD-dependent
  # check after acquiring it so a concurrent branch switch in between cannot
  # silently defeat the guard.
  validate_required_feature_branch
}

pause_after_prelock_branch_policy() {
  # Test-only boundary for the feature-branch precheck -> worktree-lock race.
  # The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_PRELOCK_BRANCH_READY-}" "${AGENT_RUN_TEST_PRELOCK_BRANCH_RELEASE-}"
}

select_safe_tmpdir() {
  local tmp_abs
  # The wrapper's own writes (scratch dir, auto-generated answer file) must not
  # dirty the worktree, so a $TMPDIR that resolves inside it (or cannot be
  # resolved) falls back to /tmp.
  SAFE_TMPDIR="${TMPDIR:-/tmp}"
  if [ -n "$WT_TOP" ]; then
    tmp_abs="$(realpath -m -- "$SAFE_TMPDIR" 2>/dev/null || true)"
    case "${tmp_abs:-$WT_TOP}" in
      "$WT_TOP" | "$WT_TOP"/*) SAFE_TMPDIR=/tmp ;;
    esac
  fi
}

# --- prompt assembly ------------------------------------------------------------

assemble_prompt() {
  local prompt_file
  # This wording is load-bearing for consults: reviewers re-running the suite are
  # the biggest wall-clock sink, and "do not run any commands" over-restricts
  # (models read it as forbidding file reads and git diff).
  CONSULT_PREAMBLE='Do not run the test suite/build; reading files and git diff is fine.
Do not modify files. Assume tests pass.'

  FULL_PROMPT="$PROMPT"
  for prompt_file in "${PROMPT_FILES[@]}"; do
    if [ -n "$FULL_PROMPT" ]; then
      FULL_PROMPT="$FULL_PROMPT"$'\n\n'
    fi
    FULL_PROMPT="$FULL_PROMPT<attached>"$'\n'"$(cat -- "$prompt_file")"$'\n'"</attached>"
  done
  if [ "$MODE" = consult ]; then
    if [ "$CONSULT_GRANTS" = 1 ]; then
      CONSULT_PREAMBLE="$CONSULT_PREAMBLE"$'\n''Exception: the caller explicitly granted you specific extra commands for this run; using those granted commands is allowed.'
    fi
    FULL_PROMPT="$CONSULT_PREAMBLE"$'\n\n'"$FULL_PROMPT"
  fi
}

prepare_prompt_transport() {
  local prompt_bytes
  TMP_RUN="$(mktemp -d "$SAFE_TMPDIR/agent-run.XXXXXX")"
  trap cleanup EXIT # also reaps an auto-generated -o that ends up empty

  # Linux caps a single argv string at ~128KiB; hand oversized prompts to the
  # CLIs that read stdin, refuse where stdin is ignored (the caller should let
  # the prompt reference a file path instead).
  STDIN_SRC=/dev/null
  prompt_bytes=$(printf '%s' "$FULL_PROMPT" | wc -c)
  if [ "$prompt_bytes" -gt 100000 ]; then
    if [ "$MODE" = review ]; then
      reject "assembled prompt is too large for a codex review argument; review takes only a short custom-instruction -p"
    fi
    run_adapter_hook oversized_prompt_guard
    printf '%s' "$FULL_PROMPT" >"$TMP_RUN/prompt.txt"
    STDIN_SRC="$TMP_RUN/prompt.txt"
  fi
}

oversized_prompt_guard_copilot() {
  reject "assembled prompt is too large for a copilot argument (copilot ignores stdin); have the prompt reference a file path"
}
oversized_prompt_guard_codex() {
  [ -z "$RESUME" ] \
    || reject "assembled prompt is too large for codex resume (resume ignores stdin); have the prompt reference a file path"
}

# --- answer path preparation ---------------------------------------------------

reject_reserved_attempt_namespace() {
  local label="$1" path="$2" ancestor base
  ancestor="${path%/*}"
  [ -n "$ancestor" ] || ancestor=/
  while [ "$ancestor" != / ]; do
    base="${ancestor##*/}"
    case "$base" in
      *.agent-run)
        if [ -d "$ancestor" ]; then
          reject "$label path '$path' is inside reserved attempt bundle '$ancestor'; choose a path outside every existing .agent-run bundle"
        fi
        ;;
    esac
    ancestor="${ancestor%/*}"
    [ -n "$ancestor" ] || ancestor=/
  done
}

prepare_answer_paths() {
  # Consult and work always land the answer in a plain file: default -o to a
  # generated path so the caller never has to fish the answer out of the log.
  if [ "$MODE" != review ] && [ -z "$OUT" ]; then
    OUT="$(mktemp "$SAFE_TMPDIR/agent-answer.XXXXXX")" \
      || reject "cannot create a default answer file under $SAFE_TMPDIR; pass -o <file>"
    AUTO_OUT=1
  fi
  [ -z "$OUT" ] || validate_single_line_path "-o" "$OUT"
  if [ "$AUTO_OUT" = 0 ] && [ -n "$OUT" ] && [ -L "$OUT" ]; then
    reject "-o path '$OUT' already exists as a symbolic link; use a fresh absent path"
  fi

  COPILOT_SHARE=''
  run_adapter_hook prepare_answer
  if [ "$AUTO_OUT" = 0 ] && [ -n "$GIT_DIR_PATH" ] && [ -n "$OUT" ]; then
    reject_in_tree_path "-o" "$OUT" "$WT_TOP"
  fi
  if [ -n "$OUT" ]; then
    OUT_ABS="$(realpath -m -- "$OUT" 2>/dev/null || true)"
    [ -n "$OUT_ABS" ] \
      || reject "cannot resolve -o path '$OUT'; use an absolute path outside the repo"
    validate_single_line_path "canonical -o" "$OUT_ABS"
    # Derived lock and identity files are created beside OUT. Reject reserved
    # bundle descendants before opening either derived path, or a rejected
    # nested output can pollute and invalidate another output's lineage.
    reject_reserved_attempt_namespace "-o" "$OUT_ABS"
  fi
}

# The wrapper writes -o and copilot's transcript sidecar; inside the worktree
# either write reads as consult drift or, in the work trailers, as the run's own
# leftover changes, so both must resolve outside the repo in every mode. A
# caller-supplied copilot --share=<path> replaces the wrapper's default sidecar,
# so it is captured here and held to the same rule — one per run, and never the
# -o file itself (the transcript would overwrite the answer).
prepare_answer_copilot() {
  local share_arg share_abs out_abs share_index=-1 i
  for i in "${!PASSTHRU[@]}"; do
    share_arg="${PASSTHRU[$i]}"
    case "$share_arg" in
      --share=*)
        [ -z "$COPILOT_SHARE" ] || reject "duplicate --share= would leave two transcript paths; pass one"
        COPILOT_SHARE="${share_arg#--share=}"
        [ -n "$COPILOT_SHARE" ] \
          || reject "--share= requires a non-empty transcript path (omit the flag to use the wrapper-owned transcript)"
        validate_single_line_path "--share" "$COPILOT_SHARE"
        share_index="$i"
        if [ -n "$GIT_DIR_PATH" ]; then
          reject_in_tree_path "--share" "$COPILOT_SHARE" "$WT_TOP"
        fi
        ;;
    esac
  done
  if [ -n "$COPILOT_SHARE" ]; then
    share_abs="$(realpath -m -- "$COPILOT_SHARE" 2>/dev/null || true)"
    out_abs="$(realpath -m -- "$OUT" 2>/dev/null || true)"
    if [ -z "$share_abs" ] || [ -z "$out_abs" ] || [ "$share_abs" = "$out_abs" ]; then
      reject "--share must not resolve to the same file as the -o answer; give the transcript its own path"
    fi
    validate_single_line_path "canonical --share" "$share_abs"
    # Caller-owned shares use adjacent lock artifacts just like public answer
    # paths. Reject bundle descendants before opening either derived lock so a
    # stale transcript path cannot corrupt the wrapper-owned attempt it names.
    reject_reserved_attempt_namespace "--share" "$share_abs"
    COPILOT_SHARE_ABS="$share_abs"
    # Resolve once, before locking, and use only that identity from here on.
    # In particular, do not pass the raw spelling back to Copilot: a relative
    # path or a symlinked parent could otherwise resolve to a different object
    # after the lock was selected.
    COPILOT_SHARE="$share_abs"
    PASSTHRU[share_index]="--share=$share_abs"
  fi
}

# --- per-answer attempt ownership -----------------------------------------------

# Attempt-bundle members are always real files and directories reached without
# traversing a symlink — a symlinked member would redirect a wrapper-owned
# write or read outside the bundle. Naming the pair keeps the two clauses from
# drifting apart across the dozen members that each require both.
plain_file() { [ -f "$1" ] && [ ! -L "$1" ]; }
plain_dir() { [ -d "$1" ] && [ ! -L "$1" ]; }

# read_single_line <path> <regex> <reject-message> — read a one-line attempt
# artifact into SINGLE_LINE, rejecting anything that is not exactly one line
# matching <regex>. Several bundle members are single-line by contract, and
# "exactly one line" is the half that is easy to forget when adding the next
# one: a trailing second line would otherwise be silently ignored.
read_single_line() {
  local path="$1" regex="$2" message="$3"
  local -a lines=()
  mapfile -t lines <"$path"
  { [ "${#lines[@]}" -eq 1 ] && [[ "${lines[0]}" =~ $regex ]]; } \
    || reject_recovery "$message"
  SINGLE_LINE="${lines[0]}"
}

# fd_names_path <fd> <path> — true when <path> still names the very object open
# on <fd>: a plain file, reached without traversing a symlink, on the same
# inode. Every lock acquisition re-checks this after flock, because a symlink
# precheck followed by a separate open leaves a window in which the pathname
# can be swapped. Keeping the three clauses in one predicate keeps them from
# drifting apart across the acquisition sites that each depend on all three.
fd_names_path() {
  local fd_path="/dev/fd/$1" path="$2"
  [ -f "$fd_path" ] && [ ! -L "$path" ] && [ "$path" -ef "$fd_path" ]
}

# The answer path has its own lifecycle lock, independent of the worktree lock:
# consults are deliberately worktree-lock-free, but two runs must never share
# one public answer. The lock is adjacent to the canonical answer path, so
# relative aliases resolve to the same ownership boundary. The wrapper keeps it
# open for its lifetime; launch children close it before exec so an escaped
# backend descendant cannot outlive the wrapper while retaining ownership.
bind_path_lock_identity() {
  local fd="$1" lock_path="$2" identity_path="$3" label="$4"
  local fd_path="/dev/fd/$fd"

  # The adjacent hard link is a persistent inode pin. If the public lock
  # pathname is unlinked and recreated while its old inode remains locked,
  # another legitimate wrapper may open the replacement, but it cannot bind
  # that replacement to the already-existing pin and therefore cannot proceed.
  if [ -e "$identity_path" ]; then
    if [ ! -f "$identity_path" ] || [ -L "$identity_path" ] \
      || [ ! "$identity_path" -ef "$fd_path" ]; then
      printf 'agent-run.sh: %s lock identity %s does not match the owned lock; explicit recovery is required\n' "$label" "$identity_path" >&2
      exit 3
    fi
  elif ! ln -- "$lock_path" "$identity_path" 2>/dev/null \
    || [ ! "$identity_path" -ef "$fd_path" ]; then
    printf 'agent-run.sh: cannot bind %s lock identity %s to the owned lock; explicit recovery is required\n' "$label" "$identity_path" >&2
    exit 3
  fi
}

verify_path_lock_identity() {
  local fd="$1" identity_path="$2" label="$3" fd_path="/dev/fd/$1"
  if [ ! -f "$fd_path" ] || [ ! -f "$identity_path" ] \
    || [ -L "$identity_path" ] || [ ! "$identity_path" -ef "$fd_path" ]; then
    printf 'agent-run.sh: %s lock identity %s changed before use; explicit recovery is required\n' "$label" "$identity_path" >&2
    if [ "$DISPATCH_HEADER_EMITTED" = 1 ]; then
      printf 'agent-run: backend-exit: wrapper-failure (lock identity changed after backend launch; explicit recovery is required)\n'
      exit 1
    fi
    exit 3
  fi
}

acquire_attempt_lock() {
  local parent
  [ -n "$OUT_ABS" ] || return 0 # native codex review has no answer
  parent="$(dirname -- "$OUT_ABS")"
  [ -d "$parent" ] \
    || reject "cannot write the -o answer file '$OUT' (does its directory exist?)"
  command -v flock >/dev/null 2>&1 || {
    printf 'agent-run.sh: flock is required to own answer path %s safely\n' "$OUT" >&2
    exit 3
  }
  # 4.4 is the real floor for the whole script, not just this lock: before it,
  # "${arr[@]}" on an empty array is an unbound-variable error under `set -u`,
  # and assemble_prompt expands "${PROMPT_FILES[@]}" on every run.
  if [ "${BASH_VERSINFO[0]}" -lt 4 ] \
    || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
    printf 'agent-run.sh: Bash 4.4 or newer is required for persistent answer attempts at %s\n' "$OUT" >&2
    exit 3
  fi
  if ! command -v sync >/dev/null 2>&1 || ! sync -- "$parent" >/dev/null 2>&1; then
    printf 'agent-run.sh: file-operand sync is required before claiming answer path %s\n' "$OUT" >&2
    exit 3
  fi
  ATTEMPT_LOCK_PATH="$OUT_ABS.agent-run.lock"
  ATTEMPT_PATH_LOCK_IDENTITY="$ATTEMPT_LOCK_PATH.identity"
  # Open read/write so a hostile FIFO-shaped lock path cannot block waiting
  # for a reader before the opened-object identity checks below reject it.
  if ! { exec 7<>"$ATTEMPT_LOCK_PATH"; } 2>/dev/null; then
    printf 'agent-run.sh: cannot open answer-path lock %s\n' "$ATTEMPT_LOCK_PATH" >&2
    exit 3
  fi
  if ! flock -n 7; then
    printf 'agent-run.sh: another agent run owns answer path %s (lock busy)\n' "$OUT" >&2
    exit 3
  fi
  # Test-only boundary for the pathname-swap regression. The production path
  # never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_LOCK_OPEN_READY-}" "${AGENT_RUN_TEST_LOCK_OPEN_RELEASE-}"
  # Verify the object that was actually opened, after taking its lock. A
  # symlink precheck followed by a separate open lets the pathname be swapped
  # between those operations. Comparing the open fd to the current pathname
  # closes that gap; the bundle identity below keeps future owners bound to
  # this same inode even if the pathname is replaced later.
  if ! fd_names_path 7 "$ATTEMPT_LOCK_PATH"; then
    printf 'agent-run.sh: answer-path lock %s changed identity while it was being opened; explicit recovery is required\n' "$ATTEMPT_LOCK_PATH" >&2
    exit 3
  fi
  bind_path_lock_identity 7 "$ATTEMPT_LOCK_PATH" "$ATTEMPT_PATH_LOCK_IDENTITY" "answer-path"
  ATTEMPT_ROOT="$OUT_ABS.agent-run"
  ATTEMPT_LOCK_IDENTITY="$ATTEMPT_ROOT/lock-identity"
  ATTEMPT_SEQUENCE_PATH="$ATTEMPT_ROOT/last-sequence"
}

acquire_caller_share_lock() {
  local parent
  [ -n "$COPILOT_SHARE_ABS" ] || return 0
  parent="$(dirname -- "$COPILOT_SHARE_ABS")"
  [ -d "$parent" ] \
    || reject "cannot write the copilot transcript sidecar '$COPILOT_SHARE' (does its directory exist?)"
  # Use the same canonical lock namespace as an answer owner. That prevents
  # both two different -o paths sharing one caller transcript and a transcript
  # owner racing a separate run that selected this path as its public answer.
  COPILOT_SHARE_LOCK_PATH="$COPILOT_SHARE_ABS.agent-run.lock"
  COPILOT_SHARE_LOCK_IDENTITY="$COPILOT_SHARE_LOCK_PATH.identity"
  # O_RDWR-style shell redirection keeps FIFO and symlink-to-FIFO objects from
  # blocking before the opened-object identity checks can reject them.
  if ! { exec 6<>"$COPILOT_SHARE_LOCK_PATH"; } 2>/dev/null; then
    printf 'agent-run.sh: cannot open caller transcript-path lock %s\n' "$COPILOT_SHARE_LOCK_PATH" >&2
    exit 3
  fi
  if ! flock -n 6; then
    printf 'agent-run.sh: another agent run owns transcript path %s (lock busy)\n' "$COPILOT_SHARE" >&2
    exit 3
  fi
  if ! fd_names_path 6 "$COPILOT_SHARE_LOCK_PATH"; then
    printf 'agent-run.sh: caller transcript-path lock %s changed identity while it was being opened; explicit recovery is required\n' "$COPILOT_SHARE_LOCK_PATH" >&2
    exit 3
  fi
  bind_path_lock_identity 6 "$COPILOT_SHARE_LOCK_PATH" "$COPILOT_SHARE_LOCK_IDENTITY" "caller transcript-path"
  # Test-only boundary for replacing the public lock pathname after its inode
  # has been pinned. The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_SHARE_LOCK_READY-}" "${AGENT_RUN_TEST_SHARE_LOCK_RELEASE-}"
}

sync_attempt_path() {
  if [ "${AGENT_RUN_TEST_FINAL_SYNC_FAIL-}" = 1 ] \
    && [ "$DISPATCH_HEADER_EMITTED" = 1 ]; then
    :
  elif sync -- "$1" >/dev/null 2>&1; then
    return 0
  fi
  printf 'agent-run.sh: could not durably sync attempt artifact %s; explicit recovery is required\n' "$1" >&2
  if [ "$DISPATCH_HEADER_EMITTED" = 1 ]; then
    printf 'agent-run: backend-exit: wrapper-failure (attempt artifact sync failed after backend launch; explicit recovery is required)\n'
  fi
  exit 1
}

retire_empty_path() {
  local path="$1" label="$2" ready="${3-}" release="${4-}"
  local parent quarantine
  [ -e "$path" ] || return 0
  parent="$(dirname -- "$path")"
  quarantine="$(mktemp "$parent/.agent-run-retired.XXXXXXXX" 2>/dev/null || true)"
  [ -n "$quarantine" ] \
    || reject "cannot allocate a private retirement path for $label '$path'"

  # Rename first, then inspect the inode that was actually removed from the
  # public pathname. Never unlink the moved inode: a writer that opened it
  # before the rename can still add content after any emptiness check. The
  # persistent, non-colliding retirement name is intentionally left for an
  # explicit later cleanup pass.
  if ! mv -fT -- "$path" "$quarantine" 2>/dev/null; then
    rm -f -- "$quarantine"
    [ ! -e "$path" ] && return 0
    reject "cannot move $label '$path' aside before claiming it"
  fi
  if [ -s "$quarantine" ]; then
    if ln -T -- "$quarantine" "$path" 2>/dev/null; then
      reject "$label '$path' gained content before claim; content was preserved"
    fi
    reject_recovery "$label '$path' gained content before claim and was preserved at '$quarantine'"
  fi
  pause_for_test_release "$ready" "$release"
  RETIRED_OUT_PATH="$quarantine"
  RETIRED_OUT_IDENTITY="$(path_identity "$quarantine")"
  [[ "$RETIRED_OUT_IDENTITY" =~ ^[0-9]+:[0-9]+$ ]] \
    || reject_recovery "cannot capture the retired identity for $label '$path'"
}

create_empty_path_exclusive() {
  local path="$1" label="$2" identity_var="${3-}"
  local parent private identity
  parent="$(dirname -- "$path")"
  private="$(mktemp "$parent/.agent-run-claim.XXXXXXXX" 2>/dev/null || true)"
  [ -n "$private" ] \
    || reject "cannot allocate a private claim path for $label '$path'"
  identity="$(path_identity "$private")"
  if ! [[ "$identity" =~ ^[0-9]+:[0-9]+$ ]]; then
    rm -f -- "$private"
    reject "cannot capture the private claim identity for $label '$path'"
  fi
  if ! ln -T -- "$private" "$path" 2>/dev/null; then
    rm -f -- "$private"
    reject "$label '$path' appeared before claim; content was preserved"
  fi
  rm -f -- "$private"
  if [ -n "$identity_var" ]; then
    printf -v "$identity_var" '%s' "$identity"
  fi
}

write_attempt_record() {
  local state="$1" disposition="$2" outcome="$3" count="$4"
  local tmp="$ATTEMPT_DIR/record.tmp.$$" session="${SESSION_ID:-none}"
  {
    printf 'version=2\n'
    printf 'attempt-id=%s\n' "$ATTEMPT_ID"
    printf 'attempt-sequence=%s\n' "$ATTEMPT_SEQUENCE"
    printf 'previous-attempt=%s\n' "$PREVIOUS_ATTEMPT_ID"
    printf 'state=%s\n' "$state"
    printf 'owner-pid=%s\n' "$$"
    printf 'mode=%s\n' "$MODE"
    printf 'agent=%s\n' "$AGENT"
    printf 'transcript-owner=%s\n' "$ATTEMPT_TRANSCRIPT_OWNER"
    printf 'backend-disposition=%s\n' "$disposition"
    printf 'answer-outcome=%s\n' "$outcome"
    printf 'session-id=%s\n' "$session"
    printf 'finalization-count=%s\n' "$count"
  } >"$tmp"
  sync_attempt_path "$tmp"
  mv -f -- "$tmp" "$ATTEMPT_RECORD"
  sync_attempt_path "$ATTEMPT_RECORD"
  sync_attempt_path "$ATTEMPT_DIR"
}

initialize_attempt_bundle() {
  local sequence_tmp="$ATTEMPT_ROOT/last-sequence.tmp.$$" fd_path="/dev/fd/7"

  mkdir -- "$ATTEMPT_ROOT" 2>/dev/null \
    || reject "cannot create attempt bundle '$ATTEMPT_ROOT'"
  # From the first successful namespace write onward, cleanup owns this
  # record-less bundle. Every remaining initialization step is fallible, so
  # publish the cleanup facts before any of them can abort.
  ATTEMPT_BUNDLE_CREATED=1
  ATTEMPT_DIR_UNRECORDED=1
  ATTEMPT_ROOT_IDENTITY="$(path_identity "$ATTEMPT_ROOT")"
  [[ "$ATTEMPT_ROOT_IDENTITY" =~ ^[0-9]+:[0-9]+$ ]] \
    || reject_recovery "cannot capture attempt bundle identity for -o '$OUT'"
  chmod 700 -- "$ATTEMPT_ROOT" 2>/dev/null \
    || reject "cannot secure attempt bundle '$ATTEMPT_ROOT'"
  if ! ln -- "$ATTEMPT_PATH_LOCK_IDENTITY" "$ATTEMPT_LOCK_IDENTITY" 2>/dev/null \
    || [ ! "$ATTEMPT_LOCK_IDENTITY" -ef "$fd_path" ]; then
    reject_recovery "cannot bind attempt provenance to the owned answer lock for -o '$OUT'"
  fi
  printf '0\n' >"$sequence_tmp"
  sync_attempt_path "$sequence_tmp"
  mv -- "$sequence_tmp" "$ATTEMPT_SEQUENCE_PATH"
  sync_attempt_path "$ATTEMPT_LOCK_IDENTITY"
  sync_attempt_path "$ATTEMPT_SEQUENCE_PATH"
  sync_attempt_path "$ATTEMPT_ROOT"
  sync_attempt_path "$(dirname -- "$ATTEMPT_ROOT")"
}

validate_attempt_bundle() {
  local owner

  plain_dir "$ATTEMPT_ROOT" \
    || reject_recovery "malformed attempt bundle '$ATTEMPT_ROOT'"
  fd_names_path 7 "$ATTEMPT_LOCK_IDENTITY" \
    || reject_recovery "malformed attempt provenance for -o '$OUT' (bundle is not bound to the owned lock)"
  owner="$(stat -c '%u' -- "$ATTEMPT_ROOT" 2>/dev/null || true)"
  [ "$owner" = "$(id -u)" ] \
    || reject_recovery "malformed attempt provenance for -o '$OUT' (bundle owner mismatch)"
  ATTEMPT_ROOT_IDENTITY="$(path_identity "$ATTEMPT_ROOT")"
  [[ "$ATTEMPT_ROOT_IDENTITY" =~ ^[0-9]+:[0-9]+$ ]] \
    || reject_recovery "malformed attempt provenance for -o '$OUT' (bundle identity)"
  plain_file "$ATTEMPT_SEQUENCE_PATH" \
    || reject_recovery "malformed attempt lineage for -o '$OUT' (claimed sequence missing)"
  read_single_line "$ATTEMPT_SEQUENCE_PATH" '^(0|[1-9][0-9]*)$' \
    "malformed attempt lineage for -o '$OUT' (claimed sequence contents)"
  LOADED_LAST_SEQUENCE="$SINGLE_LINE"
}

claim_attempt_sequence() {
  local tmp="$ATTEMPT_ROOT/last-sequence.tmp.$$"
  printf '%s\n' "$ATTEMPT_SEQUENCE" >"$tmp"
  sync_attempt_path "$tmp"
  mv -f -- "$tmp" "$ATTEMPT_SEQUENCE_PATH"
  sync_attempt_path "$ATTEMPT_SEQUENCE_PATH"
  sync_attempt_path "$ATTEMPT_ROOT"
}

validate_attempt_record() {
  local id="$1" attempt_dir="$ATTEMPT_ROOT/$1" record transcript_path entry
  local -a lines=()

  plain_dir "$attempt_dir" \
    || reject_recovery "malformed attempt record for -o '$OUT' (attempt directory)"
  { plain_file "$attempt_dir/ownership" \
    && [ "$attempt_dir/ownership" -ef "$ATTEMPT_LOCK_IDENTITY" ]; } \
    || reject_recovery "malformed attempt provenance for -o '$OUT' (attempt ownership)"
  record="$attempt_dir/record"
  plain_file "$record" \
    || reject_recovery "malformed attempt record for -o '$OUT' (record missing)"
  mapfile -t lines <"$record"
  # Pre-removal records carry a fourteenth record-seal line. Its key lived
  # beside the record under the same-UID trust boundary, so it never provided
  # authentication. Accept its old shape as ignored compatibility metadata.
  { [ "${#lines[@]}" -eq 13 ] \
    || { [ "${#lines[@]}" -eq 14 ] \
      && [[ "${lines[13]}" =~ ^record-seal=[0-9a-f]{64}$ ]]; }; } \
    || reject_recovery "malformed attempt record for -o '$OUT'"
  [ "${lines[0]}" = version=2 ] \
    && [ "${lines[1]}" = "attempt-id=$id" ] \
    && [[ "${lines[2]}" =~ ^attempt-sequence=([1-9][0-9]*)$ ]] \
    && [[ "${lines[3]}" =~ ^previous-attempt=(none|attempt\.[A-Za-z0-9_-]+)$ ]] \
    && [[ "${lines[4]}" =~ ^state=(active|finalizing|finalized)$ ]] \
    && [[ "${lines[5]}" =~ ^owner-pid=[0-9]+$ ]] \
    && [[ "${lines[6]}" =~ ^mode=(consult|work)$ ]] \
    && [[ "${lines[7]}" =~ ^agent=(claude|codex|copilot|cursor)$ ]] \
    && [[ "${lines[8]}" =~ ^transcript-owner=(none|wrapper|caller)$ ]] \
    && [[ "${lines[9]}" =~ ^backend-disposition=[A-Za-z0-9._-]+$ ]] \
    && [[ "${lines[10]}" =~ ^answer-outcome=(pending|answer|no-answer)$ ]] \
    && [[ "${lines[11]}" =~ ^session-id=(none|$UUID_RE)$ ]] \
    && [[ "${lines[12]}" =~ ^finalization-count=[01]$ ]] \
    || reject_recovery "malformed attempt record for -o '$OUT'"

  LOADED_ATTEMPT_SEQUENCE="${lines[2]#attempt-sequence=}"
  LOADED_PREVIOUS_ATTEMPT="${lines[3]#previous-attempt=}"
  LOADED_ATTEMPT_STATE="${lines[4]#state=}"
  LOADED_ATTEMPT_AGENT="${lines[7]#agent=}"
  LOADED_TRANSCRIPT_OWNER="${lines[8]#transcript-owner=}"
  LOADED_BACKEND_DISPOSITION="${lines[9]#backend-disposition=}"
  LOADED_ANSWER_OUTCOME="${lines[10]#answer-outcome=}"
  LOADED_FINALIZATION_COUNT="${lines[12]#finalization-count=}"

  case "$LOADED_TRANSCRIPT_OWNER" in
    none)
      [ "$LOADED_ATTEMPT_AGENT" != copilot ] \
        || reject_recovery "malformed attempt record for -o '$OUT' (copilot transcript ownership)"
      [ ! -e "$attempt_dir/transcript-path" ] \
        || reject_recovery "malformed attempt record for -o '$OUT' (unexpected transcript metadata)"
      [ ! -e "$attempt_dir/transcript-identity" ] \
        || reject_recovery "malformed attempt record for -o '$OUT' (unexpected transcript identity)"
      ;;
    wrapper | caller)
      [ "$LOADED_ATTEMPT_AGENT" = copilot ] \
        || reject_recovery "malformed attempt record for -o '$OUT' (non-copilot transcript ownership)"
      plain_file "$attempt_dir/transcript-path" \
        || reject_recovery "malformed attempt record for -o '$OUT' (transcript path missing)"
      read_single_line "$attempt_dir/transcript-path" '^.+$' \
        "malformed attempt record for -o '$OUT' (transcript path contents)"
      transcript_path="$SINGLE_LINE"
      validate_single_line_path "recorded transcript" "$transcript_path"
      if [ "$LOADED_TRANSCRIPT_OWNER" = wrapper ]; then
        [ "$transcript_path" = "$attempt_dir/copilot-transcript.md" ] \
          || reject_recovery "malformed attempt record for -o '$OUT' (wrapper transcript path)"
        plain_file "$transcript_path" \
          || reject_recovery "malformed attempt record for -o '$OUT' (transcript missing)"
        [ ! -e "$attempt_dir/transcript-identity" ] \
          || reject_recovery "malformed attempt record for -o '$OUT' (unexpected transcript identity)"
      else
        [ "$transcript_path" != "$attempt_dir/copilot-transcript.md" ] \
          || reject_recovery "malformed attempt record for -o '$OUT' (caller transcript path)"
        # Caller transcript identity is persisted at finalization. A normal
        # active record therefore has no identity yet; after a crash it must
        # still classify as unfinalized rather than malformed.
        if [ "$LOADED_ATTEMPT_STATE" != active ] \
          || [ -e "$attempt_dir/transcript-identity" ]; then
          plain_file "$attempt_dir/transcript-identity" \
            || reject_recovery "malformed attempt record for -o '$OUT' (transcript identity missing)"
          read_single_line "$attempt_dir/transcript-identity" '^[0-9]+:[0-9]+$' \
            "malformed attempt record for -o '$OUT' (transcript identity contents)"
        fi
      fi
      ;;
  esac

  if [ "$LOADED_ATTEMPT_STATE" = active ]; then
    plain_file "$attempt_dir/answer.tmp" \
      || reject_recovery "malformed attempt record for -o '$OUT' (active candidate missing)"
    [ ! -e "$attempt_dir/answer.publishing" ] \
      || reject_recovery "malformed attempt record for -o '$OUT' (unexpected publication recovery)"
  elif [ "$LOADED_ATTEMPT_STATE" = finalizing ] \
    && [ -e "$attempt_dir/answer.publishing" ]; then
    plain_file "$attempt_dir/answer.publishing" \
      || reject_recovery "malformed attempt record for -o '$OUT' (publication recovery)"
  elif [ "$LOADED_ATTEMPT_STATE" = finalized ]; then
    [ ! -e "$attempt_dir/answer.tmp" ] && [ ! -e "$attempt_dir/answer.publishing" ] \
      || reject_recovery "malformed attempt record for -o '$OUT' (finalized candidate remains)"
  fi

  for entry in "$attempt_dir"/*; do
    [ -e "$entry" ] || continue
    case "${entry##*/}" in
      ownership | record | answer.tmp | answer.publishing | transcript-path | transcript-identity | copilot-transcript.md) ;;
      *) reject_recovery "malformed attempt record for -o '$OUT' (unexpected attempt artifact)" ;;
    esac
  done
}

load_previous_attempt_record() {
  local current="$ATTEMPT_ROOT/current" id current_id current_sequence=0 max_sequence=0
  local attempt_dir entry unfinalized_id='' sequence previous expected_previous
  local current_state='' current_outcome='' current_disposition='' current_count=''
  local -a attempt_dirs=()
  # Only the lineage walk below needs every attempt keyed by sequence; the
  # current attempt's own fields are captured as scalars while its record is
  # loaded.
  local -A id_by_sequence=() previous_by_sequence=()

  validate_attempt_bundle
  plain_file "$current" \
    || reject_recovery "malformed attempt record for -o '$OUT' (missing current attempt)"
  read_single_line "$current" '^.*$' \
    "malformed attempt record for -o '$OUT' (invalid current attempt)"
  current_id="$SINGLE_LINE"
  id="$current_id"
  case "$id" in
    attempt.*) ;;
    *) reject_recovery "malformed attempt record for -o '$OUT' (invalid attempt identity)" ;;
  esac
  case "$id" in
    *[!A-Za-z0-9._-]* | *'..'*) reject_recovery "malformed attempt record for -o '$OUT' (unsafe attempt identity)" ;;
  esac

  for entry in "$ATTEMPT_ROOT"/*; do
    [ -e "$entry" ] || continue
    case "${entry##*/}" in
      # bundle.key is ignored legacy metadata from pre-removal bundles.
      current | bundle.key | lock-identity | last-sequence | attempt.*) ;;
      *) reject_recovery "malformed attempt bundle '$ATTEMPT_ROOT' (unexpected artifact)" ;;
    esac
  done
  for attempt_dir in "$ATTEMPT_ROOT"/attempt.*; do
    [ -e "$attempt_dir" ] || continue
    attempt_dirs+=("$attempt_dir")
    id="${attempt_dir##*/}"
    case "$id" in
      *[!A-Za-z0-9._-]* | *'..'*) reject_recovery "malformed attempt record for -o '$OUT' (unsafe attempt identity)" ;;
    esac
    validate_attempt_record "$id"
    sequence="$LOADED_ATTEMPT_SEQUENCE"
    previous="$LOADED_PREVIOUS_ATTEMPT"
    [ -z "${id_by_sequence[$sequence]-}" ] \
      || reject_recovery "malformed attempt lineage for -o '$OUT' (duplicate sequence)"
    id_by_sequence[$sequence]="$id"
    previous_by_sequence[$sequence]="$previous"
    if [ "$sequence" -gt "$max_sequence" ]; then max_sequence="$sequence"; fi
    if [ "$id" = "$current_id" ]; then
      current_sequence="$sequence"
      current_state="$LOADED_ATTEMPT_STATE"
      current_outcome="$LOADED_ANSWER_OUTCOME"
      current_disposition="$LOADED_BACKEND_DISPOSITION"
      current_count="$LOADED_FINALIZATION_COUNT"
    fi
    if [ "$LOADED_ATTEMPT_STATE" != finalized ]; then unfinalized_id="$id"; fi
  done
  [ "${#attempt_dirs[@]}" -gt 0 ] \
    || reject_recovery "malformed attempt record for -o '$OUT' (no attempts)"
  [ "$max_sequence" -eq "${#attempt_dirs[@]}" ] \
    || reject_recovery "malformed attempt lineage for -o '$OUT' (missing sequence)"
  [ "$LOADED_LAST_SEQUENCE" -eq "$max_sequence" ] \
    || reject_recovery "malformed attempt lineage for -o '$OUT' (missing claimed sequence)"
  expected_previous=none
  for ((sequence = 1; sequence <= max_sequence; sequence++)); do
    [ -n "${id_by_sequence[$sequence]-}" ] \
      || reject_recovery "malformed attempt lineage for -o '$OUT' (missing sequence)"
    [ "${previous_by_sequence[$sequence]}" = "$expected_previous" ] \
      || reject_recovery "malformed attempt lineage for -o '$OUT' (predecessor mismatch)"
    expected_previous="${id_by_sequence[$sequence]}"
  done
  [ "$current_sequence" -eq "$max_sequence" ] \
    || {
      if [ -n "$unfinalized_id" ]; then
        reject_recovery "-o '$OUT' has an unfinalized attempt '$unfinalized_id' outside current"
      fi
      reject_recovery "malformed attempt lineage for -o '$OUT' (current is not newest)"
    }
  [ -z "$unfinalized_id" ] \
    || reject_recovery "-o '$OUT' has an unfinalized attempt '$unfinalized_id'"

  case "$current_state" in
    finalized)
      [ "$current_count" = 1 ] \
        || reject_recovery "malformed attempt record for -o '$OUT' (finalization count)"
      case "$current_outcome" in
        no-answer)
          [ "$current_disposition" != pending ] \
            || reject_recovery "malformed attempt record for -o '$OUT' (pending finalized disposition)"
          ;;
        answer)
          reject "-o '$OUT' belongs to finalized successful attempt '$current_id'; pick a fresh path"
          ;;
        *)
          reject_recovery "malformed attempt record for -o '$OUT' (pending finalized outcome)"
          ;;
      esac
      ;;
  esac
  PREVIOUS_ATTEMPT_ID="$current_id"
  ATTEMPT_SEQUENCE=$((max_sequence + 1))
}

validate_attempt_predecessor() {
  local had_previous=0
  [ -n "$OUT_ABS" ] || return 0
  verify_path_lock_identity 7 "$ATTEMPT_PATH_LOCK_IDENTITY" "answer-path"
  if [ -e "$ATTEMPT_ROOT" ]; then
    had_previous=1
    load_previous_attempt_record
  fi
  if [ -s "$OUT_ABS" ]; then
    reject "-o '$OUT' already holds an answer and a reused path would clobber it; pick a fresh path"
  fi
  if [ -e "$OUT_ABS" ] && [ "$had_previous" = 0 ] && [ "$AUTO_OUT" = 0 ]; then
    reject "-o '$OUT' is empty but has no finalized no-answer attempt record; use a fresh absent path"
  fi
}

emit_attempt_breadcrumb() {
  printf 'agent-run: attempt: %s record %s wrapper-pid %d\n' \
    "$ATTEMPT_ID" "$ATTEMPT_RECORD" "$$"
  if [ "$ATTEMPT_TRANSCRIPT_OWNER" != none ]; then
    printf 'agent-run: transcript: %s (%s-owned)\n' "$SIDECAR" "$ATTEMPT_TRANSCRIPT_OWNER"
  fi
}

claim_attempt() {
  local current_tmp
  [ -n "$OUT_ABS" ] || return 0
  enter_signal_deferral attempt-claim
  verify_path_lock_identity 7 "$ATTEMPT_PATH_LOCK_IDENTITY" "answer-path"

  # Eligibility was checked while holding the answer lock. Atomically move the
  # pathname to a persistent retirement name and retain that inode in case an
  # already-open writer adds content later. From here onward any file that
  # appears at OUT belongs to an external writer and final publication must not
  # clobber it.
  if [ -e "$OUT_ABS" ]; then
    retire_empty_path "$OUT_ABS" "-o predecessor" \
      "${AGENT_RUN_TEST_OUT_REMOVE_READY-}" "${AGENT_RUN_TEST_OUT_REMOVE_RELEASE-}"
  fi
  if [ ! -e "$ATTEMPT_ROOT" ]; then
    initialize_attempt_bundle
  fi
  # Include allocation itself in the unrecorded transaction. If a fresh
  # bundle was initialized but mktemp cannot add its first attempt, cleanup
  # must remove that record-less namespace instead of leaving a missing-current
  # bundle that permanently blocks the untouched output path.
  ATTEMPT_DIR_UNRECORDED=1
  if [ "${AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL-}" = 1 ] \
    || ! ATTEMPT_DIR="$(mktemp -d "$ATTEMPT_ROOT/attempt.XXXXXXXX")"; then
    reject "cannot allocate an attempt record under '$ATTEMPT_ROOT'"
  fi
  chmod 700 -- "$ATTEMPT_DIR" 2>/dev/null \
    || reject "cannot secure attempt record under '$ATTEMPT_ROOT'"
  # Test-only signal boundary for the allocation-before-sequence regression.
  # The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_ATTEMPT_CLAIM_READY-}" "${AGENT_RUN_TEST_ATTEMPT_CLAIM_RELEASE-}"
  # Allocate and fully populate the directory before advancing the persistent
  # high-water mark, so an ordinary setup failure can remove the unrecorded
  # allocation without leaving a claimed sequence gap. Signals are deferred
  # until the complete active record is written below.
  ATTEMPT_ID="$(basename -- "$ATTEMPT_DIR")"
  ATTEMPT_RECORD="$ATTEMPT_DIR/record"
  CANDIDATE_ANSWER="$ATTEMPT_DIR/answer.tmp"
  : >"$CANDIDATE_ANSWER"
  chmod 600 -- "$CANDIDATE_ANSWER" 2>/dev/null \
    || reject "cannot secure answer candidate under '$ATTEMPT_ROOT'"
  ln -- "$ATTEMPT_LOCK_IDENTITY" "$ATTEMPT_DIR/ownership" 2>/dev/null \
    || reject "cannot bind attempt '$ATTEMPT_ID' to the owned answer lock"
  sync_attempt_path "$CANDIDATE_ANSWER"
  sync_attempt_path "$ATTEMPT_DIR/ownership"
  ATTEMPT_TRANSCRIPT_OWNER=none
  if [ "$AGENT" = copilot ]; then
    if [ -n "$COPILOT_SHARE" ]; then
      ATTEMPT_TRANSCRIPT_OWNER=caller
      SIDECAR="$COPILOT_SHARE_ABS"
      verify_path_lock_identity 6 "$COPILOT_SHARE_LOCK_IDENTITY" "caller transcript-path"
    else
      ATTEMPT_TRANSCRIPT_OWNER=wrapper
      SIDECAR="$ATTEMPT_DIR/copilot-transcript.md"
      create_empty_path_exclusive "$SIDECAR" "copilot transcript sidecar"
      sync_attempt_path "$SIDECAR"
    fi
    printf '%s\n' "$SIDECAR" >"$ATTEMPT_DIR/transcript-path"
    sync_attempt_path "$ATTEMPT_DIR/transcript-path"
  fi
  [ "${AGENT_RUN_TEST_ATTEMPT_SETUP_FAIL-}" != 1 ] \
    || reject "cannot complete attempt setup under '$ATTEMPT_ROOT'"
  write_attempt_record active pending pending 0
  ATTEMPT_DIR_UNRECORDED=0
  claim_attempt_sequence
  # Test-only crash point for the record-before-current regression.
  [ "${AGENT_RUN_TEST_CRASH_AFTER_ATTEMPT_RECORD-}" != 1 ] || kill -KILL "$$"
  current_tmp="$ATTEMPT_ROOT/current.tmp.$$"
  printf '%s\n' "$ATTEMPT_ID" >"$current_tmp"
  sync_attempt_path "$current_tmp"
  mv -f -- "$current_tmp" "$ATTEMPT_ROOT/current"
  sync_attempt_path "$ATTEMPT_ROOT/current"
  sync_attempt_path "$ATTEMPT_ROOT"
  ATTEMPT_CLAIMED=1
  # Keep fatal signals deferred until the durable attempt and its pid-bearing
  # log breadcrumb are both published. This makes every later pre-dispatch
  # abort (branch creation, argv construction, runtime initialization) eligible
  # for waiter exit 22 rather than leaving a finalized record with no log path.
  emit_attempt_breadcrumb
  leave_signal_deferral
}

persist_caller_transcript_identity() {
  local identity tmp="$ATTEMPT_DIR/transcript-identity.tmp.$$"
  [ "$ATTEMPT_TRANSCRIPT_OWNER" = caller ] || return 0
  if [ ! -f "$SIDECAR" ] || [ -L "$SIDECAR" ]; then
    printf 'agent-run.sh: caller transcript %s changed type before finalization; explicit recovery is required\n' "$SIDECAR" >&2
    return 1
  fi
  identity="$(path_identity "$SIDECAR")"
  if ! [[ "$identity" =~ ^[0-9]+:[0-9]+$ ]]; then
    printf 'agent-run.sh: cannot record caller transcript identity for %s; explicit recovery is required\n' "$SIDECAR" >&2
    return 1
  fi
  if [ -z "$CALLER_TRANSCRIPT_CLAIM_IDENTITY" ] \
    || [ "$identity" != "$CALLER_TRANSCRIPT_CLAIM_IDENTITY" ]; then
    printf 'agent-run.sh: caller transcript %s changed identity before finalization; explicit recovery is required\n' "$SIDECAR" >&2
    return 1
  fi
  printf '%s\n' "$identity" >"$tmp"
  sync_attempt_path "$tmp"
  mv -f -- "$tmp" "$ATTEMPT_DIR/transcript-identity"
  sync_attempt_path "$ATTEMPT_DIR/transcript-identity"
  sync_attempt_path "$ATTEMPT_DIR"
}

# Abort finalization on a named failure, leaving a durable `finalizing` record.
# That state is intentionally non-retryable: a later wrapper cannot prove
# whether publication or cleanup completed. Callers close the pinned candidate
# descriptor and sync any directory entry they changed before calling, then
# `return 0` from the finalizer — bash cannot return through a helper.
stall_finalization() {
  local disposition="$1" message="${2-}"
  BACKEND_DISPOSITION="$disposition"
  code=1
  [ -z "$message" ] || printf 'agent-run.sh: %s\n' "$message" >&2
  write_attempt_record finalizing "$BACKEND_DISPOSITION" pending 0
}

finalize_attempt_record() {
  local outcome=no-answer candidate_fd_path=/dev/fd/5
  local publication_recovery="$ATTEMPT_DIR/answer.publishing"
  [ "$ATTEMPT_CLAIMED" = 1 ] || return 0
  [ "$ATTEMPT_FINALIZED" = 0 ] || return 0
  verify_path_lock_identity 7 "$ATTEMPT_PATH_LOCK_IDENTITY" "answer-path"

  # Record the cleanup/publication boundary first. A crash from this point
  # leaves `finalizing`, which is intentionally non-retryable: a later wrapper
  # cannot prove whether publication or cleanup completed.
  if ! persist_caller_transcript_identity; then
    stall_finalization caller-transcript-identity-failure
    return 0
  fi
  write_attempt_record finalizing "$BACKEND_DISPOSITION" pending 0

  if [ "$CANDIDATE_ANSWER_COMPLETE" = 1 ] && [ -s "$CANDIDATE_ANSWER" ]; then
    sync_attempt_path "$CANDIDATE_ANSWER"
    if ! { exec 5<"$CANDIDATE_ANSWER"; } 2>/dev/null \
      || [ ! "$CANDIDATE_ANSWER" -ef "$candidate_fd_path" ]; then
      stall_finalization answer-publication-candidate-identity-failure \
        "cannot pin the completed candidate at $CANDIDATE_ANSWER during answer publication; explicit recovery is required"
      return 0
    fi
    # Backends may replace rather than truncate their target, so secure the
    # pinned completed inode again immediately before publication. OUT is a
    # hard link to this inode and therefore inherits this exact mode.
    if ! chmod 600 -- "$candidate_fd_path" 2>/dev/null; then
      exec 5>&-
      stall_finalization answer-publication-candidate-permission-failure \
        "cannot secure the completed candidate at $CANDIDATE_ANSWER during answer publication; explicit recovery is required"
      return 0
    fi
    sync_attempt_path "$CANDIDATE_ANSWER"
    # The candidate lives beside OUT, so a hard link is both same-filesystem
    # atomic and no-clobber. Once linked, removing the private name leaves the
    # fully-written inode published at OUT.
    if ! ln -T -- "$CANDIDATE_ANSWER" "$OUT_ABS" 2>/dev/null; then
      exec 5>&-
      sync_attempt_path "$ATTEMPT_DIR"
      stall_finalization answer-publication-collision \
        "refusing to clobber content that appeared at $OUT during atomic answer publication"
      return 0
    fi
    # Test-only boundary for a replacement after the no-clobber link. The
    # production path never pauses here.
    pause_for_test_release \
      "${AGENT_RUN_TEST_PUBLISH_LINK_READY-}" "${AGENT_RUN_TEST_PUBLISH_LINK_RELEASE-}"
    # The candidate inode was already synced. Sync the directory entry without
    # opening OUT, since an external rename can make that pathname name an
    # unrelated inode after the link succeeds.
    sync_attempt_path "$(dirname -- "$OUT_ABS")"
    if [ ! -f "$OUT_ABS" ] || [ -L "$OUT_ABS" ] \
      || [ ! "$OUT_ABS" -ef "$candidate_fd_path" ]; then
      exec 5>&-
      sync_attempt_path "$ATTEMPT_DIR"
      stall_finalization answer-publication-collision \
        "public answer path $OUT changed identity during atomic answer publication; both answers were preserved for explicit recovery"
      return 0
    fi
    ANSWER_PUBLISHED=1
    # Keep a pathname for the pinned inode while releasing answer.tmp. A plain
    # copy from the descriptor after an identity collision would follow a
    # same-UID racer's symlink at answer.tmp; renaming this private hard link
    # back is atomic and replaces only the directory entry.
    if ! mv -fT -- "$CANDIDATE_ANSWER" "$publication_recovery" \
      || [ ! "$publication_recovery" -ef "$candidate_fd_path" ]; then
      ANSWER_PUBLISHED=0
      exec 5>&-
      sync_attempt_path "$ATTEMPT_DIR"
      stall_finalization answer-publication-candidate-identity-failure \
        "cannot retain a private recovery link while publishing answer at $OUT; explicit recovery is required"
      return 0
    fi
    sync_attempt_path "$ATTEMPT_DIR"
    # Test-only boundary for a racer targeting the released candidate name.
    # The production path never pauses here.
    pause_for_test_release \
      "${AGENT_RUN_TEST_PUBLISH_UNLINK_READY-}" "${AGENT_RUN_TEST_PUBLISH_UNLINK_RELEASE-}"
    if [ ! -f "$OUT_ABS" ] || [ -L "$OUT_ABS" ] \
      || [ ! "$OUT_ABS" -ef "$candidate_fd_path" ]; then
      ANSWER_PUBLISHED=0
      if ! mv -fT -- "$publication_recovery" "$CANDIDATE_ANSWER" \
        || [ ! -f "$CANDIDATE_ANSWER" ] || [ -L "$CANDIDATE_ANSWER" ] \
        || [ ! "$CANDIDATE_ANSWER" -ef "$candidate_fd_path" ]; then
        exec 5>&-
        sync_attempt_path "$ATTEMPT_DIR"
        stall_finalization answer-publication-candidate-recovery-failure \
          "cannot atomically restore the private answer candidate after a publication collision; completed content remains at $publication_recovery for explicit recovery"
        return 0
      fi
      sync_attempt_path "$CANDIDATE_ANSWER"
      sync_attempt_path "$ATTEMPT_DIR"
      exec 5>&-
      stall_finalization answer-publication-collision \
        "public answer path $OUT changed identity while the private publication link was being released; both answers were preserved for explicit recovery"
      return 0
    fi
    rm -f -- "$publication_recovery"
    sync_attempt_path "$ATTEMPT_DIR"
    exec 5>&-
    outcome=answer
  else
    rm -f -- "$CANDIDATE_ANSWER"
    sync_attempt_path "$ATTEMPT_DIR"
    if [ -s "$OUT_ABS" ]; then
      stall_finalization no-answer-state-ambiguous \
        "public answer path $OUT gained content while finalizing no-answer; explicit recovery is required"
      return 0
    fi
    sync_attempt_path "$(dirname -- "$OUT_ABS")"
  fi
  write_attempt_record finalized "$BACKEND_DISPOSITION" "$outcome" 1
  ATTEMPT_FINALIZED=1
}

# --- per-worktree lock and drift checks ----------------------------------------

# Best-effort identity of the process holding the worktree lock, for the exit-3
# busy message. The holder's identity is not stashed in the lock file; instead
# resolve open-file holders from the contender side via fuser/lsof, skip our
# own pid (we hold fd 9 open too), and describe the first real holder with ps.
# Prints nothing (and returns 1) when neither tool exists or nothing matches, so
# the caller falls back to today's generic message.
lock_holder_desc() {
  local lock="$1" pids='' pid desc
  if command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "$lock" 2>/dev/null | tr -s ' ' '\n')"
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -- "$lock" 2>/dev/null || true)"
  fi
  for pid in $pids; do
    case "$pid" in
      '' | *[!0-9]*) continue ;;
      "$$") continue ;;
    esac
    desc="$(ps -o pid=,etime=,args= -p "$pid" 2>/dev/null | sed 's/^ *//')"
    if [ -n "$desc" ]; then
      printf '%s' "$desc"
      return 0
    fi
  done
  return 1
}

# The lock is work-only on every backend. Read-only modes (consult, codex
# review) never take it: their read-only-ness is enforced by backend sandboxes
# where those exist and verified by the post-run drift check everywhere (codex
# has no working sandbox here — see references/codex.md), and the lock probe
# below attributes drift seen while a work run holds the lock.
acquire_worktree_lock() {
  local holder
  LOCK_NEEDED=0
  if [ "$MODE" = work ]; then
    LOCK_NEEDED=1
  fi
  if [ "$LOCK_NEEDED" = 1 ] && [ -n "$GIT_DIR_PATH" ] && command -v flock >/dev/null 2>&1; then
    LOCK_PATH="$GIT_DIR_PATH/agent-run.lock"
    # Open read/write rather than write-only: that neither truncates a raced
    # regular-file target nor blocks on a FIFO before its type can be rejected.
    if ! { exec 9<>"$LOCK_PATH"; } 2>/dev/null; then
      printf 'agent-run.sh: cannot open worktree lock %s\n' "$LOCK_PATH" >&2
      exit 3
    fi
    if ! fd_names_path 9 "$LOCK_PATH"; then
      printf 'agent-run.sh: worktree lock %s changed identity while it was being opened\n' "$LOCK_PATH" >&2
      exec 9>&-
      exit 3
    fi
    if ! flock -n 9; then
      if holder="$(lock_holder_desc "$LOCK_PATH")" && [ -n "$holder" ]; then
        printf 'agent-run.sh: another agent run holds this worktree (lock busy); holder: %s\n' "$holder" >&2
      else
        printf 'agent-run.sh: another agent run holds this worktree (lock busy)\n' >&2
      fi
      exit 3
    fi
    if ! fd_names_path 9 "$LOCK_PATH"; then
      printf 'agent-run.sh: worktree lock %s changed identity while it was being acquired\n' "$LOCK_PATH" >&2
      exec 9>&-
      exit 3
    fi
    LOCK_ACQUIRED=1
  elif [ "$LOCK_NEEDED" = 1 ] && [ -n "$GIT_DIR_PATH" ]; then
    printf 'agent-run.sh: flock is required to serialize this agent run in a git worktree\n' >&2
    exit 3
  fi
}

release_worktree_lock() {
  # The normal run path lets process exit close the lock fd. Calling this while
  # a backend may still hold an inherited fd would break the SIGKILL orphan
  # fail-safe, so it is only for pre-launch/unit-test release paths.
  [ "$LOCK_ACQUIRED" = 1 ] || return 0
  flock -u 9 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  LOCK_ACQUIRED=0
}

check_dirty_work_start() {
  # A dirty work start invites the delegate to absorb unrelated WIP as its own
  # work (see references/codex.md), so it is a usage error unless the caller
  # opted in. Checked while holding the lock, so another run's in-flight edits
  # cannot masquerade as caller dirt.
  if [ "$MODE" = work ] && [ -n "$GIT_DIR_PATH" ] && [ "$DIRTY_OK" = 0 ] \
    && [ -n "$(git_read status --porcelain -uall 2>/dev/null)" ]; then
    reject "work requires a clean worktree (a dirty start invites the delegate to absorb unrelated WIP); commit first, inspect with git diff or git show HEAD:<path>, copy files aside, or ask the user; pass --dirty-ok only when the task is to inspect the current diff"
  fi
}

prepare_lock_probe() {
  # Lock-free read-only runs (all consults, codex review) may legitimately run
  # alongside a work dispatch; drift seen then belongs to the work run, not the
  # read-only run. Probe the lock around the run and report `unchecked` instead
  # of a false DIRTY. (A work run that starts and finishes entirely inside the
  # read-only run's window slips past both probes and would be misattributed —
  # accepted: work runs are long, consults short.)
  CAN_PROBE=0
  LOCK_PROBE_UNAVAILABLE=0
  if { [ "$MODE" = consult ] || [ "$MODE" = review ]; } && [ -n "$GIT_DIR_PATH" ] \
    && command -v flock >/dev/null 2>&1; then
    LOCK_PATH="$GIT_DIR_PATH/agent-run.lock"
    # Match the owning open path: no truncation, no FIFO wait, and do not trust
    # a pathname precheck that can be swapped before the descriptor is opened.
    if { exec 8<>"$LOCK_PATH"; } 2>/dev/null && fd_names_path 8 "$LOCK_PATH"; then
      CAN_PROBE=1
    else
      exec 8>&- 2>/dev/null || true
      LOCK_PROBE_UNAVAILABLE=1
    fi
  fi
}

lock_busy_elsewhere() {
  [ "$CAN_PROBE" = 1 ] || return 1
  if flock -n 8; then
    flock -u 8
    return 1
  fi
  return 0
}

# Status text alone misses content edits to already-modified files, commits,
# ref moves, and .git internals, so the drift snapshot also covers HEAD, the
# current symbolic ref, every ref (including refs/stash), diff checksums,
# tracked index object IDs, worktree identity metadata for tracked file/symlink
# paths, content checksums for tracked paths carrying assume-unchanged,
# skip-worktree, or fsmonitor-valid flags, non-ignored-untracked content
# checksums, local git config, and executable hooks. Ignored files are
# intentionally out of scope: hashing the ignored tree walks large caches like
# node_modules and reports unrelated cache churn as consult drift.
# Git already owns object IDs for the tracked index, while the adjacent
# unstaged-diff component accounts for ordinary worktree edits. Clean filters
# and text/EOL conversion can collapse different raw worktree representations,
# so a cheap lstat identity tuple (including nanosecond mtime/ctime) adds
# sensitivity without hashing all tracked content. It is not content truth:
# coarse timestamp granularity can preserve the tuple across an equal-length
# same-inode rewrite. The Git views also deliberately hide paths tagged
# assume-unchanged, skip-worktree, or fsmonitor-valid, so read/hash that normally
# empty exception set too. Read/hash non-ignored untracked files as well, since
# Git cannot otherwise describe them.
file_content_snapshot() {
  local -a tracked=()
  (
    cd "$WT_TOP" && {
      git_read ls-files -s -z 2>/dev/null | sort -z
      # One stat for the whole tracked set. A fork per tracked path costs
      # seconds in a large worktree, and this snapshot runs twice per consult —
      # the first time on the critical path, before the backend launches.
      # `%n` pairs each tuple with its own path, so the encoding stays
      # unambiguous without the per-path fork; paths stat cannot describe are
      # listed separately so they still move the snapshot when they change.
      mapfile -d '' -t tracked < <(git_read ls-files -z 2>/dev/null | sort -z)
      if [ "${#tracked[@]}" -gt 0 ]; then
        printf '%s\0' "${tracked[@]}" \
          | xargs -0 stat --printf='tracked-path %n\0%d:%i:%f:%s:%y:%z\0' 2>/dev/null
        for path in "${tracked[@]}"; do
          [ -L "$path" ] || [ -f "$path" ] \
            || printf 'tracked-absent-or-nonfile %s\0' "$path"
        done
      fi
      git_read ls-files -v -f -z 2>/dev/null \
        | while IFS= read -r -d '' entry; do
          case "$entry" in
            S\ * | [a-z]\ *)
              path="${entry#??}"
              printf 'flagged-path %s\n' "$entry"
              if [ -L "$path" ]; then
                { readlink -- "$path" || true; } | cksum
              elif [ -f "$path" ]; then
                cksum <"$path" || true
              fi
              ;;
          esac
        done
      git_read ls-files -z -o --exclude-standard 2>/dev/null \
        | sort -z | while IFS= read -r -d '' path; do
        printf 'path %s\n' "$path"
        if [ -L "$path" ]; then
          printf 'type symlink\n'
          { readlink -- "$path" || true; } | cksum
        elif [ -f "$path" ]; then
          printf 'type regular\n'
          cksum <"$path" || true
        else
          printf 'type other\n'
        fi
      done
    }
  )
}
git_config_snapshot() {
  git_read config --local --list --null 2>/dev/null | sort -z
}
git_hooks_snapshot() {
  local hook hooks_dir

  hooks_dir="$(git_read rev-parse --git-path hooks 2>/dev/null || true)"
  [ -n "$hooks_dir" ] && [ -d "$hooks_dir" ] || return 0
  find "$hooks_dir" -maxdepth 1 -type f -perm /111 -print0 2>/dev/null | sort -z \
    | while IFS= read -r -d '' hook; do
      printf 'hook %s\n' "${hook#"$hooks_dir"/}"
      cksum <"$hook" || true
    done
}
# One labeled line per drift component so a DIRTY report can name what moved.
# Any change to a component changes its line, so a plain string compare of the
# whole snapshot still detects drift; the labels only matter when explaining it
# (see worktree_snapshot_diff). Values are checksummed rather than raw so the
# snapshot stays a fixed, single-line-per-component shape.
worktree_snapshot() {
  printf 'status\t%s\n' "$(git_read status --porcelain -uall 2>/dev/null | cksum)"
  printf 'head\t%s\n' "$(git_read rev-parse HEAD 2>/dev/null || true)"
  printf 'branch\t%s\n' "$(git_read symbolic-ref -q HEAD 2>/dev/null || true)"
  printf 'refs\t%s\n' "$({ git_read for-each-ref --format='%(refname) %(objectname) %(symref)' refs 2>/dev/null || true; } | LC_ALL=C sort | cksum)"
  # Compare repository bytes, not user-configured textconv/external views.
  # trustctime=true also defeats a stat-clean mutation when the repo normally
  # ignores ctime; fsmonitor-valid paths are covered by file-content above.
  printf 'unstaged-diff\t%s\n' "$({ git_read -c core.trustctime=true diff --no-textconv --no-ext-diff 2>/dev/null || true; } | cksum)"
  printf 'staged-diff\t%s\n' "$({ git_read -c core.trustctime=true diff --cached --no-textconv --no-ext-diff 2>/dev/null || true; } | cksum)"
  printf 'file-content\t%s\n' "$({ file_content_snapshot 2>/dev/null || true; } | cksum)"
  printf 'git-config\t%s\n' "$({ git_config_snapshot 2>/dev/null || true; } | cksum)"
  printf 'git-hooks\t%s\n' "$({ git_hooks_snapshot 2>/dev/null || true; } | cksum)"
}

# Names the drift components whose snapshot lines differ between the pre ($1) and
# post ($2) captures, as a comma-separated list, for the DIRTY trailer. Empty
# when the two match (no caller should ask in that case). `diff` exits 1 exactly
# when the snapshots differ — the case this function exists to explain — so the
# `|| true` keeps `set -euo pipefail` from aborting the run before the DIRTY
# report is printed (this runs in a plain assignment, where errexit is live).
worktree_snapshot_diff() {
  { diff <(printf '%s\n' "$1") <(printf '%s\n' "$2") 2>/dev/null || true; } \
    | sed -n 's/^[<>] \([a-z-][a-z-]*\)[[:space:]].*/\1/p' | sort -u | paste -sd, -
}

# A copilot consult may pass -C, the one permitted cwd-moving flag. Keep the
# normal dispatch-worktree drift check when -C resolves inside this worktree;
# otherwise flag CWD_MOVED so the caller inspects the target directory instead of
# trusting a clean that vouches for the wrong repo.
drift_cwd_copilot() {
  local i n arg cwd_target cwd_abs
  [ "$MODE" = consult ] || return 0
  i=0
  n=${#PASSTHRU[@]}
  while [ "$i" -lt "$n" ]; do
    arg="${PASSTHRU[i]}"
    if cwd_target="$(copilot_cwd_target "$arg" "${PASSTHRU[i + 1]:-}")"; then
      cwd_abs="$(realpath -m -- "$cwd_target" 2>/dev/null || true)"
      if [ -n "$WT_TOP" ]; then
        case "$cwd_abs" in
          "$WT_TOP" | "$WT_TOP"/*) ;;
          *) CWD_MOVED=1 ;;
        esac
      else
        CWD_MOVED=1
      fi
      if [ "$arg" = -C ]; then i=$((i + 1)); fi
    elif [ "$arg" = -C ]; then
      CWD_MOVED=1
    elif copilot_value_flag_consumes_next "$arg" "${PASSTHRU[i + 1]:-}"; then
      i=$((i + 1))
    fi
    i=$((i + 1))
  done
}

prepare_consult_drift_check() {
  # consult and codex review are both read-only by intent, so both get the
  # drift check; review never gets the consult preamble (the native harness
  # carries its own instructions).
  DRIFT_CHECKED_MODE=0
  case "$MODE" in consult | review) DRIFT_CHECKED_MODE=1 ;; esac

  DRIFT_PRE=''
  DRIFT_UNCHECKED=0
  UNCHECKED_REASON='another agent run held the lock; drift cannot be attributed'
  CWD_MOVED=0
  run_adapter_hook drift_cwd
  if [ "$DRIFT_CHECKED_MODE" = 1 ] && [ -n "$GIT_DIR_PATH" ]; then
    if [ "$CWD_MOVED" = 1 ]; then
      DRIFT_UNCHECKED=1
      UNCHECKED_REASON='-C moved the run off this worktree; inspect the target directory yourself'
    elif [ "$LOCK_PROBE_UNAVAILABLE" = 1 ]; then
      DRIFT_UNCHECKED=1
      UNCHECKED_REASON='worktree lock could not be opened; drift cannot be attributed'
    elif lock_busy_elsewhere; then
      DRIFT_UNCHECKED=1
    else
      DRIFT_PRE="$(worktree_snapshot)"
    fi
  fi
}

capture_work_baseline() {
  WORK_HEAD_PRE=''
  if [ "$MODE" = work ] && [ -n "$GIT_DIR_PATH" ]; then
    WORK_HEAD_PRE="$(git_read rev-parse HEAD 2>/dev/null || true)"
  fi
}

# --- launch-path and branch validation -----------------------------------------

# probe_writable_parent <path> <slug> <reject-message> — prove <path>'s parent
# directory accepts a create, without creating or truncating <path> itself. The
# probe is a temporary sibling so the public artifact stays untouched until the
# attempt is claimed; <slug> only keeps concurrent probes distinguishable.
probe_writable_parent() {
  local path="$1" slug="$2" message="$3" probe
  probe="$(mktemp "$(dirname -- "$path")/.agent-run-$slug.XXXXXXXX" 2>/dev/null || true)"
  [ -n "$probe" ] || reject "$message"
  rm -f -- "$probe"
}

validate_launch_paths() {
  # The per-answer lock is already held. Inspect the persistent predecessor before
  # touching either public artifact: only a finalized no-answer attempt is
  # reusable, while a live, finalizing, crashed, or malformed record fails
  # closed.
  validate_attempt_predecessor
  if [ -n "$OUT_ABS" ]; then
    probe_writable_parent "$OUT_ABS" write \
      "cannot write the -o answer file '$OUT' (does its directory exist?)"
  fi
  SIDECAR=''
  run_adapter_hook validate_launch_paths
}

validate_launch_paths_copilot() {
  # Wrapper-owned transcripts are allocated only after the attempt directory
  # exists, making the path unique by construction. Caller-owned --share stays
  # exactly caller-owned and must be absent before every dispatch.
  SIDECAR=''
  if [ -n "$COPILOT_SHARE" ]; then
    verify_path_lock_identity 6 "$COPILOT_SHARE_LOCK_IDENTITY" "caller transcript-path"
    SIDECAR="$COPILOT_SHARE_ABS"
    if [ -e "$SIDECAR" ]; then
      reject "transcript sidecar '$SIDECAR' already exists and must be absent before dispatch; pick a fresh path per run"
    fi
    probe_writable_parent "$SIDECAR" share-write \
      "cannot write the copilot transcript sidecar '$SIDECAR' (does its directory exist?)"
  fi
}

claim_caller_transcript() {
  [ "$AGENT" = copilot ] && [ -n "$COPILOT_SHARE" ] || return 0
  verify_path_lock_identity 6 "$COPILOT_SHARE_LOCK_IDENTITY" "caller transcript-path"
  # Claim the caller-owned share before any answer-lineage or branch mutation.
  # A handled late-path collision must leave the answer retryable and must not
  # strand a --branch branch that never reached backend dispatch.
  pause_for_test_release \
    "${AGENT_RUN_TEST_SHARE_CLAIM_READY-}" "${AGENT_RUN_TEST_SHARE_CLAIM_RELEASE-}"
  enter_signal_deferral caller-transcript-claim
  create_empty_path_exclusive "$SIDECAR" "copilot transcript sidecar" \
    CALLER_TRANSCRIPT_CLAIM_IDENTITY
  # Test-only boundary for a signal after the exclusive path claim but before
  # the cleanup ownership flag is published. The production path never pauses.
  pause_for_test_release \
    "${AGENT_RUN_TEST_SHARE_LINK_READY-}" "${AGENT_RUN_TEST_SHARE_LINK_RELEASE-}"
  CALLER_TRANSCRIPT_CLAIMED=1
  sync_attempt_path "$SIDECAR"
  sync_attempt_path "$(dirname -- "$SIDECAR")"
  leave_signal_deferral
}

validate_requested_branch_availability() {
  if [ -n "$BRANCH_NAME" ] \
    && git_read show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    reject "--branch '$BRANCH_NAME' already exists; pick a fresh name (or switch to it yourself before dispatching)"
  fi
}

reject_claimed_branch() {
  local disposition="$1" message="$2"
  BACKEND_DISPOSITION="$disposition"
  code=1
  finalize_attempt_record
  reject "$message"
}

create_requested_branch() {
  # --branch makes fresh-branch missions structural: the wrapper creates the
  # branch at the current HEAD while holding the lock, so the delegate cannot
  # skip the checkout step and commit on the dispatch branch instead. An
  # existing name is rejected — switching to a branch with history would be a
  # resume, which is the caller's move, not the wrapper's. This is deliberately
  # the last usage-reject point before launch: any earlier reject (dirty tree,
  # stale -o, unwritable sidecar) must not strand the worktree on a fresh
  # branch it never dispatched from.
  if [ -n "$BRANCH_NAME" ]; then
    # Recheck immediately before the write in case an external git process
    # created the name after the pre-claim validation.
    if git_read show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
      reject_claimed_branch branch-ref-collision \
        "--branch '$BRANCH_NAME' already exists; pick a fresh name (or switch to it yourself before dispatching)"
    fi
    if [ "${AGENT_RUN_TEST_BRANCH_CREATE_FAIL-}" = 1 ]; then
      reject_claimed_branch branch-creation-failure \
        "--branch could not create '$BRANCH_NAME' at the current HEAD"
    fi
    BRANCH_PRE_HEAD="$(git_read rev-parse HEAD 2>/dev/null || true)"
    BRANCH_PRE_REF="$(git_read symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    BRANCH_CREATED_BY_WRAPPER=1
    git switch -q -c "$BRANCH_NAME" 2>/dev/null \
      || reject_claimed_branch branch-creation-failure \
        "--branch could not create '$BRANCH_NAME' at the current HEAD"
    printf 'agent-run: branch: %s (created)\n' "$BRANCH_NAME"
    # Test-only boundary for a fatal signal after branch creation but before
    # backend dispatch. The production path never pauses here.
    pause_for_test_release \
      "${AGENT_RUN_TEST_BRANCH_CREATED_READY-}" "${AGENT_RUN_TEST_BRANCH_CREATED_RELEASE-}"
  fi
}

rollback_pre_dispatch_branch() {
  local current_head current_ref
  [ "$BRANCH_CREATED_BY_WRAPPER" = 1 ] || return 0
  [ "$BACKEND_PHASE" = pre ] || return 0

  current_head="$(git_read rev-parse HEAD 2>/dev/null || true)"
  current_ref="$(git_read symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ "$current_ref" = "$BRANCH_PRE_REF" ] \
    && [ "$current_head" = "$BRANCH_PRE_HEAD" ] \
    && ! git_read show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    BRANCH_CREATED_BY_WRAPPER=0
    return 0
  fi
  if [ "$current_ref" != "$BRANCH_NAME" ] \
    || [ -z "$BRANCH_PRE_HEAD" ] || [ "$current_head" != "$BRANCH_PRE_HEAD" ]; then
    printf 'agent-run.sh: cannot safely roll back wrapper-created branch %s after pre-dispatch signal; explicit recovery is required\n' "$BRANCH_NAME" >&2
    return 1
  fi

  if [ -n "$BRANCH_PRE_REF" ]; then
    git switch -q "$BRANCH_PRE_REF" 2>/dev/null
  else
    git switch -q --detach "$BRANCH_PRE_HEAD" 2>/dev/null
  fi \
    || {
      printf 'agent-run.sh: cannot restore the pre-dispatch branch after signal; explicit recovery is required\n' >&2
      return 1
    }
  if ! git update-ref -d "refs/heads/$BRANCH_NAME" "$BRANCH_PRE_HEAD" 2>/dev/null; then
    printf 'agent-run.sh: cannot remove wrapper-created branch %s after pre-dispatch signal; explicit recovery is required\n' "$BRANCH_NAME" >&2
    return 1
  fi
  BRANCH_CREATED_BY_WRAPPER=0
  printf 'agent-run: branch: %s (rolled back before dispatch)\n' "$BRANCH_NAME"
}

# --- backend command construction ---------------------------------------------

build_codex_command() {
  local answer_target="${CANDIDATE_ANSWER:-$OUT}"
  cmd=(codex -c sandbox_mode=danger-full-access -a never)
  if [ -n "$MODEL" ]; then cmd+=(-m "$MODEL"); fi
  if [ -n "$EFFORT" ]; then cmd+=(-c "model_reasoning_effort=$EFFORT"); fi
  if [ "$MODE" = review ]; then
    cmd+=(review "${PASSTHRU[@]}")
    if [ -n "$FULL_PROMPT" ]; then cmd+=(-- "$FULL_PROMPT"); fi
  else
    cmd+=(exec)
    if [ -n "$RESUME" ]; then cmd+=(resume "$RESUME"); fi
    cmd+=("${PASSTHRU[@]}")
    if [ -n "$answer_target" ]; then cmd+=(-o "$answer_target"); fi
    if [ "$STDIN_SRC" = /dev/null ]; then cmd+=(-- "$FULL_PROMPT"); fi
  fi
}

build_claude_command() {
  cmd=(claude -p --output-format json)
  if [ "$MODE" = consult ]; then
    cmd+=(--disallowedTools "Write,Edit,NotebookEdit,Task")
  else
    cmd+=(--dangerously-skip-permissions)
  fi
  if [ -n "$MODEL" ]; then cmd+=(--model "$MODEL"); fi
  if [ -n "$EFFORT" ]; then cmd+=(--effort "$EFFORT"); fi
  if [ -n "$RESUME" ]; then cmd+=(--resume "$RESUME"); fi
  cmd+=("${PASSTHRU[@]}")
  if [ "$STDIN_SRC" = /dev/null ]; then cmd+=(-- "$FULL_PROMPT"); fi
}

build_copilot_command() {
  cmd=(copilot --no-color --no-auto-update --output-format json)
  if [ "$MODE" = consult ]; then
    cmd+=(--deny-tool write)
  else
    cmd+=(--allow-all)
  fi
  cmd+=(--model "$MODEL")
  if [ -n "$EFFORT" ]; then cmd+=(--effort "$EFFORT"); fi
  if [ -n "$RESUME" ]; then cmd+=(--resume="$RESUME"); fi
  if [ -n "$COPILOT_SHARE" ]; then
    # the caller's --share (already in PASSTHRU) doubles as the sidecar
    cmd+=(-s)
  else
    cmd+=(-s "--share=$SIDECAR")
  fi
  cmd+=("${PASSTHRU[@]}")
  cmd+=(-p "$FULL_PROMPT")
}

build_cursor_command() {
  # cursor's CLI binary is confusingly named `agent`; --trust skips the
  # headless workspace-trust prompt for the dispatch worktree. stream-json (not
  # the single `json` envelope) breaks the run into typed events, so the answer
  # contract can be the final assistant message alone: cursor's envelope
  # `result` has been observed to concatenate every incremental status line
  # before the final summary, which -o must not carry (see the cursor parser in
  # launch_result_envelope_backend and references/cursor.md).
  cmd=(agent -p --output-format stream-json --trust)
  if [ "$MODE" = consult ]; then
    # ask mode is cursor's enforced read-only profile: file reads work and the
    # write tool is refused. Shell is denied by default, but the repo's
    # .cursor/cli.json allowlist re-permits read-only git (diff/log/show/...),
    # so a cursor consult can gather its own branch diff. See references/cursor.md.
    cmd+=(--mode ask)
  else
    # headless denies every shell command without --force
    cmd+=(--force)
  fi
  # cursor's own default is `auto` (a server-side pick), so pin a
  # deterministic default instead of inheriting it
  cmd+=(--model "${MODEL:-cursor-grok-4.6-xhigh}")
  if [ -n "$RESUME" ]; then cmd+=(--resume "$RESUME"); fi
  cmd+=("${PASSTHRU[@]}")
  if [ "$STDIN_SRC" = /dev/null ]; then cmd+=(-- "$FULL_PROMPT"); fi
}

build_backend_command() {
  cmd=()
  "build_${AGENT}_command"
}

# --- run and normalize the result ----------------------------------------------------

initialize_backend_runtime() {
  CAPTURE="$TMP_RUN/capture.log"
  # Test-only: exercise a capture-precreation failure without depending on
  # filesystem permissions (the test suite can run as root).
  if [ -n "${AGENT_RUN_TEST_CAPTURE_PRECREATE_FAIL-}" ]; then CAPTURE="$TMP_RUN/no-such-dir/capture.log"; fi
  SESSION_ID=''
  SESSION_ID_LOGGED=0
  DIAGNOSTICS_REPLAYED=0
  ORPHANED_CHILDREN=0
  ORPHANED_PGID=''
  code=0
  PARSE_FAIL=0
  IS_ERROR=0
  NO_FINAL_ANSWER=0
  BACKEND_PID=''
  TEE_PID=''
  WAIT_INTERRUPTED=0
  WAIT_IN_PROGRESS=0
  WAIT_SITE=''
  # Set by each launch to the file its child records the backend pid in.
  # Empty until then; resolve_backend_pid_file and the finalize poll read it.
  BACKEND_PID_FILE=''
  # Lifecycle phase for the fatal-signal path, so a TERM that lands while
  # BACKEND_PID is momentarily empty can be reported precisely instead of as a
  # single ambiguous trailer:
  #   pre     — no backend dispatched yet (nothing to signal or orphan)
  #   running — the backend was launched; BACKEND_PID may still be uncaptured
  #             (the codex pid-file poll window) but the process is alive
  #   reaped  — the backend was waited/reaped; BACKEND_PID reset on purpose
  #   completed — captured output has been parsed into the candidate answer
  # ("reaped" not "done" only to dodge shellcheck's SC1010 keyword misread)
  BACKEND_PHASE=pre

  # Launch the backend in its own session where setsid exists, so fatal-signal
  # propagation can kill the whole backend process group: a TERM'd delegate's
  # own children would otherwise survive as orphans still holding the inherited
  # lock fd.
  SETSID=()
  if command -v setsid >/dev/null 2>&1; then SETSID=(setsid); fi
}

kill_backend_tree() {
  local sig="$1"
  [ -n "$BACKEND_PID" ] || return 0
  kill -s "$sig" -- "-$BACKEND_PID" 2>/dev/null || kill -s "$sig" "$BACKEND_PID" 2>/dev/null || true
}

report_stale_index_lock() {
  local index_lock holder holder_pid holder_detail
  [ -n "$GIT_DIR_PATH" ] || return 0
  index_lock="$(realpath -m -- "$GIT_DIR_PATH/index.lock" 2>/dev/null || true)"
  [ -n "$index_lock" ] && [ -e "$index_lock" ] || return 0
  if holder="$(lock_holder_desc "$index_lock")" && [ -n "$holder" ]; then
    holder_pid="${holder%% *}"
    holder_detail="${holder#* }"
    printf 'agent-run.sh: git index lock remains after backend termination; held by pid %s (%s) — do not remove %q\n' \
      "$holder_pid" "$holder_detail" "$index_lock" >&2
  else
    printf 'agent-run.sh: git index lock remains after backend termination; no open holder found, likely stale; inspect it and, only if confirmed stale, recover with: rm -f -- %q\n' \
      "$index_lock" >&2
  fi
}

# Liveness of the backend *tree*, not just its leader: a TERM'd leader can
# die while a signal-ignoring child in its process group lives on, holding
# the inherited lock fd — exactly the orphan case KILL escalation exists for.
# Under setsid the group is probed (kill -0 on a pgid whose members are all
# zombies reports dead, unlike a leader-pid probe); without setsid there is
# no dedicated group, so the leader pid is the best signal available.
backend_alive() {
  [ -n "$BACKEND_PID" ] || return 1
  if [ ${#SETSID[@]} -gt 0 ]; then
    kill -0 -- "-$BACKEND_PID" 2>/dev/null
  else
    kill -0 "$BACKEND_PID" 2>/dev/null
  fi
}

# After the backend leader is reaped on a clean (exit 0) run, a process still
# alive in its process group is a child the delegate backgrounded and abandoned
# — the classic case is a headless `scripts/land.sh &` started just before the
# delegate ended its turn "to wait for the notification". That child dies with
# the wrapper at end-of-turn, so reporting an unqualified clean success would
# vouch for work that is unfinished and about to be killed. Detecting it needs a
# real process group, so this is a no-op without setsid; a short grace lets a
# child merely racing the leader's own exit finish first, so only a genuinely
# long-lived background process trips the flag ($1 is the reaped backend pgid).
detect_orphaned_children() {
  local pgid="$1" n=0
  ORPHANED_CHILDREN=0
  ORPHANED_PGID=''
  [ ${#SETSID[@]} -gt 0 ] || return 0
  [ -n "$pgid" ] || return 0
  while [ "$n" -lt 5 ]; do
    kill -0 -- "-$pgid" 2>/dev/null || return 0
    sleep 0.1
    n=$((n + 1))
  done
  ORPHANED_CHILDREN=1
  ORPHANED_PGID="$pgid"
}

# The skill contract promises abandoned background work "dies at end-of-turn",
# but a setsid backend group is its own session: nothing in the wrapper's own
# session reaps it on exit, so a detected orphan can outlive the wrapper and keep
# mutating the worktree while holding the inherited lock fd. Make the contract
# true by TERMing the reaped backend's group once, best-effort and bounded (no
# KILL escalation): a cooperative child stops here; a signal-ignoring one is a
# rarer case the trailer already flagged for the operator. The guard is
# belt-and-suspenders — a setsid group leader's pgid is its own pid, never the
# wrapper's ($$) — so this can never reach the wrapper's own group.
terminate_orphaned_children() {
  local pgid="$ORPHANED_PGID"
  [ -n "$pgid" ] || return 0
  [ "$pgid" != "$$" ] || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
}

# Close every backend's pid-capture race: each launch child records its own pid
# immediately before exec, while the parent may not have copied $! into
# BACKEND_PID yet. A fatal signal can recover the recorded pid during that gap.
resolve_backend_pid_file() {
  [ -z "$BACKEND_PID" ] || return 0
  [ -n "$BACKEND_PID_FILE" ] || return 0
  local n=0
  while [ ! -s "$BACKEND_PID_FILE" ] && [ "$n" -lt 50 ]; do
    sleep 0.01
    n=$((n + 1))
  done
  BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
}

# Work owns the worktree, so instead of a drift check it gets an outcome
# summary: the commit range the run produced (an unchanged head flags a no-op
# run) and whether it finished dirty (uncommitted work left behind) — the
# lifecycle's inspect-the-diff step, pre-located. Shared by the normal
# finalize flow and the fatal-signal path, where the staged-but-uncommitted
# state is exactly what the caller needs for recovery.
emit_work_outcome() {
  local head_post new_commits commit_word dirty_files file_word
  if [ -z "$GIT_DIR_PATH" ]; then
    printf 'agent-run: worktree: unchecked (not a git repository)\n'
    return 0
  fi
  head_post="$(git_read rev-parse HEAD 2>/dev/null || true)"
  if [ -n "$head_post" ] && [ "$head_post" = "$WORK_HEAD_PRE" ]; then
    printf 'agent-run: head: %.12s (unchanged)\n' "$head_post"
  elif [ -n "$head_post" ]; then
    if [ -n "$WORK_HEAD_PRE" ]; then
      new_commits="$(git_read rev-list --count "$WORK_HEAD_PRE..$head_post" 2>/dev/null || printf '?')"
    else
      new_commits="$(git_read rev-list --count "$head_post" 2>/dev/null || printf '?')"
    fi
    commit_word=commits
    if [ "$new_commits" = 1 ]; then commit_word=commit; fi
    printf 'agent-run: head: %.12s..%.12s (+%s %s)\n' "${WORK_HEAD_PRE:-none}" "$head_post" "$new_commits" "$commit_word"
  fi
  dirty_files="$(git_read status --porcelain -uall 2>/dev/null | grep -c . || true)"
  if [ "${dirty_files:-0}" -gt 0 ]; then
    file_word='files'
    if [ "$dirty_files" = 1 ]; then file_word='file'; fi
    printf 'agent-run: worktree: dirty (%s %s)\n' "$dirty_files" "$file_word"
  else
    printf 'agent-run: worktree: clean\n'
  fi
}

UUID_RE='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

# Session ids come only from anchored log regions: the header lines that open
# a codex exec log or copilot share transcript. Logs and transcripts quote
# prompt and file content, so a whole-file scan can be poisoned by any quoted
# session-id string (this skill's own test suite is enough to trigger it).
sid_from_header() {
  head -n 40 -- "$1" 2>/dev/null | grep -iE '^(session.?id|> - \*\*session.?id)' \
    | grep -oE "$UUID_RE" | head -n1 || true
}

# Emit the session-id trailer exactly once, whether it was discovered early
# (from streamed output, before the wait) or at finalization. Idempotent so an
# early emit is never repeated by emit_result_trailers or the fatal-signal path.
log_session_id_once() {
  [ -n "$SESSION_ID" ] || return 0
  [ "$SESSION_ID_LOGGED" != 1 ] || return 0
  printf 'agent-run: session-id: %s\n' "$SESSION_ID"
  SESSION_ID_LOGGED=1
}

# Best-effort finalization when the wrapper itself is killed: without it a
# TERM'd wrapper dies before any trailer exists and callers cannot tell a
# dead run from a healthy quiet one. The signal is propagated to the backend
# (same signal first, KILL after a short grace) so the delegate cannot
# silently outlive the wrapper. SIGKILL of the wrapper still emits nothing —
# that case is covered by the dispatched header already in the log.
# Mark the attempt as signal-aborted and make that durable. Both signal exits —
# the pre-dispatch one and the post-launch one — must settle in exactly this
# order, so neither path spells it out for itself.
settle_signal_attempt() {
  BACKEND_DISPOSITION="signal-SIG$1"
  SIGNAL_ABORTED=1
  code=1
  pause_before_attempt_finalization
  finalize_attempt_record
  rollback_pre_dispatch_branch || true
}

on_fatal_signal() {
  local sig="$1" n=0 kill_escalated=0 reason
  trap '' TERM INT HUP
  # Caller transcript and answer-attempt claims are short ownership
  # transactions. Let either publish its cleanup/finalization facts before
  # handling the signal, so no caller path or sequence can be stranded.
  if [ -n "$SIGNAL_DEFERRAL" ]; then
    PENDING_FATAL_SIGNAL="$sig"
    return 0
  fi
  # Completion anchors are meaningful only after the launch header establishes
  # a run for waiters to match them to. A signal during pre-dispatch setup may
  # still settle private claims and unwind a wrapper-created branch, but it must
  # remain trailer-free just like any other launch that never happened.
  if [ "$DISPATCH_HEADER_EMITTED" != 1 ]; then
    settle_signal_attempt "$sig"
    exit 1
  fi
  # Test-only: hold a real signal handler before its backend liveness probe so
  # a regression can synchronize backend exit with an actually-blocked wait.
  pause_for_test_release \
    "${AGENT_RUN_TEST_SIGNAL_PROBE_READY-}" "${AGENT_RUN_TEST_SIGNAL_PROBE_RELEASE-}"
  # A dead backend makes the capture stable even before its launcher advances
  # BACKEND_PHASE. Only ask wait_for_backend_status to retry when a wait is
  # still in flight: after that helper captures the real status, another wait
  # would target an already-reaped pid and replace the status with 127.
  if [ "$BACKEND_PHASE" = running ]; then
    resolve_backend_pid_file
    if [ -n "$BACKEND_PID" ] && ! backend_alive; then
      if [ "$WAIT_IN_PROGRESS" = 1 ]; then
        WAIT_INTERRUPTED=1
        if [ -n "${AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER-}" ]; then
          printf '%s\n' "$WAIT_SITE" >"$AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER"
        fi
      fi
      BACKEND_PHASE=reaped
      return 0
    fi
  fi
  # Once the backend is reaped, its capture is stable. Defer the signal through
  # the bounded local parse/publication path instead of converting a complete
  # but not-yet-parsed result into a signal no-answer. Leaving the traps ignored
  # makes this equivalent to a signal arriving inside finalize_run.
  if [ "$BACKEND_PHASE" = reaped ]; then
    return 0
  fi
  # The backend result and candidate are complete. Finish the short
  # record/publication boundary rather than discarding a completed answer.
  if [ "$BACKEND_PHASE" = completed ]; then
    finalize_run
  fi
  if backend_alive; then
    kill_backend_tree "$sig"
    while backend_alive && [ "$n" -lt 50 ]; do
      sleep 0.1
      n=$((n + 1))
    done
    if backend_alive; then
      kill_backend_tree KILL
      kill_escalated=1
      n=0
      while backend_alive && [ "$n" -lt 50 ]; do
        sleep 0.1
        n=$((n + 1))
      done
    fi
    wait "$BACKEND_PID" 2>/dev/null || true
    if [ "$kill_escalated" = 1 ] && ! backend_alive; then
      report_stale_index_lock
    fi
    reason="propagated to backend pid $BACKEND_PID"
  elif [ "$BACKEND_PHASE" = running ] && [ -z "$BACKEND_PID" ]; then
    # The backend was launched but its pid was never captured, so it cannot be
    # signaled — it may survive as a lock-holding orphan. Say so distinctly.
    reason="pid capture failed — backend may be orphaned"
  elif [ -n "$BACKEND_PID" ] || [ "$BACKEND_PHASE" = reaped ]; then
    # A backend was dispatched and has already exited; nothing left to signal.
    reason="backend already exited"
  else
    # The signal landed before any backend was dispatched.
    print_launch_abort_pid_line
    reason="no backend dispatched yet"
  fi
  # One trailer prefix for every disposition: waiters grep this line, so the
  # branches must only choose the reason, never re-spell the anchor.
  BACKEND_EXIT_TRAILER="agent-run: backend-exit: killed (SIG$sig, $reason)"
  run_adapter_hook extract_session
  run_adapter_hook flush_diagnostics
  log_session_id_once
  settle_signal_attempt "$sig"
  # Same rule as the ordinary result path: the `backend-exit:` completion
  # anchor is only readable once publication and record finalization are done.
  # The `backend-pid:` launch record above stays immediate — it is evidence a
  # backend was started, not a claim that the run settled.
  printf '%s\n' "$BACKEND_EXIT_TRAILER"
  if [ "$ANSWER_PUBLISHED" = 1 ]; then
    printf 'agent-run: answer: %s\n' "$OUT_ABS"
  fi
  if [ "$MODE" = work ]; then
    emit_work_outcome
  else
    printf 'agent-run: worktree: unchecked (run killed by SIG%s before the drift check)\n' "$sig"
  fi
  exit 1
}

emit_dispatch_header() {
  # The earlier starting/attempt breadcrumbs cover pre-dispatch deaths. This
  # launch header adds mode, backend, and answer identity; waiters must still
  # anchor completion on worktree:/backend-exit:, never a bare '^agent-run:'.
  pause_for_test_release \
    "${AGENT_RUN_TEST_DISPATCH_HEADER_READY-}" "${AGENT_RUN_TEST_DISPATCH_HEADER_RELEASE-}"
  # Defer handled signals across the successful printf -> published-flag
  # handoff. Moving the flag before printf would let completion anchors describe
  # a launch line that never reached the log; deferral preserves both facts.
  enter_signal_deferral dispatch-header-write
  if [ -n "$OUT" ]; then
    printf 'agent-run: dispatched: %s %s wrapper-pid %d answer %s\n' "$MODE" "$AGENT" "$$" "$OUT_ABS"
  else
    printf 'agent-run: dispatched: %s %s wrapper-pid %d\n' "$MODE" "$AGENT" "$$"
  fi
  # Test-only boundary for a fatal signal after the dispatched bytes reach the
  # log but before the emitted flag is published. The production path does not
  # pause here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_DISPATCH_WRITE_READY-}" "${AGENT_RUN_TEST_DISPATCH_WRITE_RELEASE-}"
  DISPATCH_HEADER_EMITTED=1
  leave_signal_deferral
}

install_signal_traps() {
  # Publish the generic pid before any fatal-signal trap becomes active. From
  # the first installed trap onward, even an abort before an answer attempt is
  # durably claimed is therefore classifiable by agent-wait rather than
  # timing out with wrapper-pid=unknown.
  printf 'agent-run: starting: wrapper-pid %d\n' "$$"
  trap 'on_fatal_signal TERM' TERM
  trap 'on_fatal_signal INT' INT
  trap 'on_fatal_signal HUP' HUP
}

pause_before_attempt_finalization() {
  # Test-only boundary proving that an emitted backend-exit trailer does not
  # make --finalized-only waiters return while the attempt is still active.
  # The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_RECORD_FINALIZE_READY-}" "${AGENT_RUN_TEST_RECORD_FINALIZE_RELEASE-}"
}

pause_after_attempt_finalization() {
  # Test-only boundary for a wrapper death after its no-answer record becomes
  # durable but before the worktree completion trailer is emitted.
  # The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_RECORD_FINALIZED_READY-}" "${AGENT_RUN_TEST_RECORD_FINALIZED_RELEASE-}"
}

run_backend() {
  "launch_$AGENT"
  # A launcher that returns has finished parsing its backend's output, so the
  # attempt-private candidate is complete and the phase is settled. Owning both
  # here rather than in each adapter keeps a new backend from silently
  # finalizing `no-answer` while holding a perfectly good answer.
  CANDIDATE_ANSWER_COMPLETE=1
  BACKEND_PHASE=completed
}

close_backend_path_locks() {
  # These locks belong to the wrapper lifecycle, not the backend process tree.
  # Run only in a launch child: the parent wrapper must retain the path-lock
  # descriptors until its attempt/transcript lifecycle is settled, and the
  # probe descriptor until consult/review drift attribution is complete.
  if [ "$CAN_PROBE" = 1 ]; then exec 8>&-; fi
  if [ -n "$ATTEMPT_LOCK_PATH" ]; then exec 7>&-; fi
  if [ -n "$COPILOT_SHARE_LOCK_PATH" ]; then exec 6>&-; fi
}

pause_after_backend_wait() {
  # Test-only boundary for the wait-returned-before-phase signal regression.
  # The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_REAPED_READY-}" "${AGENT_RUN_TEST_REAPED_RELEASE-}"
}

pause_before_backend_status_wait() {
  local site="$1"
  [ "${AGENT_RUN_TEST_WAIT_BEFORE_SITE-}" = "$site" ] || return 0
  pause_for_test_release \
    "${AGENT_RUN_TEST_WAIT_BEFORE_READY-}" "${AGENT_RUN_TEST_WAIT_BEFORE_RELEASE-}"
}

pause_after_backend_status_wait() {
  local site="$1" wait_code="$2"
  if [ "${AGENT_RUN_TEST_WAIT_RETURNED_SITE-}" = "$site" ]; then
    pause_for_test_release \
      "${AGENT_RUN_TEST_WAIT_RETURNED_READY-}" "${AGENT_RUN_TEST_WAIT_RETURNED_RELEASE-}"
  fi
  return "$wait_code"
}

backend_status_wait_once() {
  wait "$1"
}

# Bash returns 128+signum when a trapped signal interrupts a blocked wait, even
# if the child already exited. The fatal-signal handler marks that exact
# running-but-dead case so the child's retained status can be collected by a
# second wait. Temporary assignments on the one-command helper make the entire
# wait a single simple command: before it starts and after it returns Bash has
# already restored WAIT_IN_PROGRESS, so neither command boundary can request a
# stale retry.
wait_for_backend_status() {
  local pid="$1" site="$2" wait_code injected=0
  while :; do
    WAIT_INTERRUPTED=0
    # Test-only: deterministically reproduce the state left by a signal trap
    # after wait returned 128+signum without consuming the child's status. The
    # real path sets the same flag in on_fatal_signal; this hook only avoids a
    # kernel scheduling race in tests.
    if [ "$injected" = 0 ] \
      && [ "${AGENT_RUN_TEST_WAIT_INTERRUPTED_SITE-}" = "$site" ]; then
      WAIT_INTERRUPTED=1
      BACKEND_PHASE=reaped
      wait_code=143
      injected=1
      if [ -n "${AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER-}" ]; then
        printf '%s\n' "$site" >"$AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER"
      fi
    else
      if [ "${AGENT_RUN_TEST_WAIT_READY_SITE-}" = "$site" ] \
        && [ -n "${AGENT_RUN_TEST_WAIT_READY_MARKER-}" ]; then
        printf '%s\n' "$site" >"$AGENT_RUN_TEST_WAIT_READY_MARKER"
      fi
      pause_before_backend_status_wait "$site"
      WAIT_IN_PROGRESS=1 WAIT_SITE="$site" backend_status_wait_once "$pid"
      pause_after_backend_status_wait "$site" "$?"
      wait_code=$?
    fi
    [ "$WAIT_INTERRUPTED" = 1 ] || break
  done
  code="$wait_code"
}

drain_codex_tee() {
  local backend_code="$code"
  [ -n "$TEE_PID" ] || return 0
  wait_for_backend_status "$TEE_PID" codex-drain
  TEE_PID=''
  code="$backend_code"
}

# Arm the launch child's pid record and mark the backend running, in that
# order, immediately before a launch. Both launchers depend on the ordering:
# the backend is live the instant its launch is up, but its pid only reaches
# BACKEND_PID after the poll, and a fatal signal in that gap must see
# phase=running so on_fatal_signal recovers the recorded pid
# (resolve_backend_pid_file) and propagates — instead of the 'pre' branch
# printing "no backend dispatched" while a live backend survives as a
# lock-holding orphan. Assigning the phase after the launch left exactly that
# gap open. The residual window is the sub-instruction gap between this call
# and the launch, and it fails closed: a signal there sees phase=running with
# no pid file yet and reports a possible orphan rather than dropping a real one.
arm_backend_pid_file() {
  BACKEND_PID_FILE="$TMP_RUN/backend.pid"
  # Test-only: point the pid write at an unwritable path so the launch child's
  # `printf … >file` fails and `&& exec` never starts a backend — the
  # launch-abort path both launchers must handle safely. A no-op (the real,
  # writable path) in real runs.
  if [ -n "${AGENT_RUN_TEST_PID_WRITE_FAIL-}" ]; then BACKEND_PID_FILE="$TMP_RUN/no-such-dir/backend.pid"; fi
  BACKEND_PHASE=running
}

# An empty pid record after the launch settled proves the `printf … >file`
# failed and `&& exec` never launched a backend: there is nothing to signal and
# nothing to orphan. Waiters match this line, so every path that concludes it
# must emit the identical text.
print_launch_abort_pid_line() {
  printf 'agent-run: backend-pid: none (launch aborted before exec; no backend started)\n'
}

# Shared non-pipeline launch lifecycle.
# Globals in: cmd, CAPTURE, STDIN_SRC, SETSID, TMP_RUN, ATTEMPT_LOCK_PATH,
# COPILOT_SHARE_LOCK_PATH.
# Globals out: BACKEND_PID, BACKEND_PID_FILE, BACKEND_PHASE,
# ORPHANED_CHILDREN, ORPHANED_PGID, code.
spawn_and_wait_backend() {
  local merge_stderr="$1" stderr_capture="${2-}" n=0 launch_pid
  set +e
  # Keep the parser/finalizer path available even when the pid write aborts
  # before the backend's stdout redirection can create the capture.
  if ! : >"$CAPTURE"; then
    printf 'agent-run.sh: cannot create backend capture %s\n' "$CAPTURE" >&2
    print_launch_abort_pid_line
    code=1
    BACKEND_PID=''
    BACKEND_PHASE=reaped
    set -e
    return
  fi
  arm_backend_pid_file
  {
    printf '%s\n' "$BASHPID" >"$BACKEND_PID_FILE" \
      && close_backend_path_locks \
      && {
        # Non-merged callers must provide a private stderr capture: inherited
        # backend stderr would bypass the stdout namespace filter.
        if [ "$merge_stderr" = 1 ]; then
          exec "${SETSID[@]}" "${cmd[@]}" <"$STDIN_SRC" >"$CAPTURE" 2>&1
        else
          exec "${SETSID[@]}" "${cmd[@]}" <"$STDIN_SRC" >"$CAPTURE" 2>"$stderr_capture"
        fi
      }
  } &
  launch_pid=$!
  # Test-only boundary inside the launch→pid-capture window, so a regression
  # test can land a fatal signal in it without racing a timer. Placed
  # immediately after the launch and before BACKEND_PID is known, so any phase
  # assignment that regressed back to here would land inside the parked window
  # and be caught. The production path never pauses here.
  pause_for_test_release \
    "${AGENT_RUN_TEST_PID_CAPTURE_READY-}" "${AGENT_RUN_TEST_PID_CAPTURE_RELEASE-}"
  BACKEND_PID="$launch_pid"
  while [ ! -s "$BACKEND_PID_FILE" ] && kill -0 "$launch_pid" 2>/dev/null && [ "$n" -lt 200 ]; do
    sleep 0.01
    n=$((n + 1))
  done
  if [ -s "$BACKEND_PID_FILE" ]; then
    BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    printf 'agent-run: backend-pid: %s\n' "$BACKEND_PID"
    wait_for_backend_status "$launch_pid" spawn-backend
    pause_after_backend_wait
  else
    # Re-read after the wait so a delayed but successful write cannot be
    # misclassified as the launch abort.
    wait_for_backend_status "$launch_pid" spawn-backend
    BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [ -n "$BACKEND_PID" ]; then
      printf 'agent-run: backend-pid: %s\n' "$BACKEND_PID"
      pause_after_backend_wait
    else
      print_launch_abort_pid_line
      code=1
    fi
  fi
  if [ "$code" -eq 0 ]; then detect_orphaned_children "$BACKEND_PID"; fi
  set -e
  BACKEND_PID=''
  BACKEND_PHASE=reaped
}

# claude and cursor both end their print-mode output with a JSON result
# envelope; the shared launcher spawns the backend directly (no pipeline) and
# parses it for the answer, session id, and error state. claude emits one
# envelope object; cursor runs in stream-json, so its log is a sequence of typed
# events (the answer parse below normalizes cursor to the final assistant
# message; claude keeps using the envelope's `result` field).
launch_claude() {
  launch_result_envelope_backend
}

launch_cursor() {
  launch_result_envelope_backend
}

emit_backend_stream() {
  # The live form is a pipeline tail: exec keeps TEE_PID bound directly to the
  # line-buffered process that drains stdout.
  if [ "${1-}" = --live ]; then
    exec stdbuf -oL sed 's/^agent-run/[backend] &/'
  fi
  sed 's/^agent-run/[backend] &/' -- "$1"
}

launch_result_envelope_backend() {
  local py_rc answer_target="${CANDIDATE_ANSWER:-$OUT}" session_path="$TMP_RUN/session.id"
  local -r merge_stderr=1
  # the backend buffers until done (a quiet log is normal); the JSON envelope
  # lands in the log for debugging while the parsed answer goes to -o.
  spawn_and_wait_backend "$merge_stderr"
  emit_backend_stream "$CAPTURE" 2>/dev/null || true
  # python exit 0: parsed fine; 3: envelope carries is_error; else: no envelope
  set +e
  python3 - "$CAPTURE" "$answer_target" "$AGENT" "$session_path" <<'PY' # the candidate is always set outside review
import json
import re
import sys

capture_path, out_path, agent, session_path = sys.argv[1:5]
objects = []
with open(capture_path, encoding="utf-8", errors="replace") as fh:
    lines = fh.read().splitlines()
for line in lines:
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        objects.append(json.loads(line))
    except ValueError:
        continue
envelope = None
for data in reversed(objects):
    if data.get("type") == "result":
        envelope = data
        break
if envelope is None:
    sys.exit(1)


def assistant_text(event):
    message = event.get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        block.get("text") or ""
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    )


result = envelope.get("result") or ""
if agent == "cursor":
    # cursor's envelope `result` can accumulate every incremental status line
    # ahead of the final summary; the answer contract is the final assistant
    # message only. Take the text of the last assistant event in the stream, and
    # fall back to the envelope result only when the stream carried no assistant
    # events — so an unanticipated stream shape degrades to today's behaviour
    # rather than an empty answer. Incremental commentary stays in the log.
    finals = [
        text
        for text in (assistant_text(o) for o in objects if o.get("type") == "assistant")
        if text.strip()
    ]
    if finals:
        result = finals[-1]
if not result.strip():
    result = ""
elif not result.endswith("\n"):
    result += "\n"
# an empty result writes an empty file so the no-answer check fires
with open(out_path, "w", encoding="utf-8") as fh:
    fh.write(result)
denials = envelope.get("permission_denials") or []
session_id = envelope.get("session_id") or ""
if re.fullmatch(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    session_id,
):
    with open(session_path, "w", encoding="ascii") as fh:
        fh.write(session_id + "\n")
# claude-only cost/turn metadata; cursor envelopes carry none of these keys
if "total_cost_usd" in envelope or "num_turns" in envelope:
    print(
        "agent-run: cost-usd: %s turns: %s permission-denials: %d"
        % (envelope.get("total_cost_usd", "?"), envelope.get("num_turns", "?"), len(denials))
    )
if envelope.get("is_error"):
    sys.exit(3)
PY
  py_rc=$?
  set -e
  if [ -f "$session_path" ]; then
    SESSION_ID="$(head -n 1 -- "$session_path")"
  fi
  if [ "$py_rc" -eq 3 ]; then
    IS_ERROR=1
  elif [ "$py_rc" -ne 0 ]; then
    PARSE_FAIL=1
  fi
}

launch_copilot() {
  local py_rc answer_target="${CANDIDATE_ANSWER:-$OUT}" stderr_capture="$TMP_RUN/copilot.stderr"
  local -r merge_stderr=0
  # Copilot's text-mode -s stream includes pre-tool intent messages. Capture
  # JSONL for parsing, replay filtered stderr diagnostics, then print only the
  # normalized answer. Raw events would flood the log with tool output and
  # opaque reasoning payloads. Accept only an assistant message with no pending
  # tool requests, so "I will inspect..." cannot masquerade as the final answer.
  spawn_and_wait_backend "$merge_stderr" "$stderr_capture"
  run_adapter_hook flush_diagnostics
  set +e
  python3 - "$CAPTURE" "$answer_target" <<'PY'
import json
import sys

capture_path, out_path = sys.argv[1], sys.argv[2]
objects = []
with open(capture_path, encoding="utf-8", errors="replace") as fh:
    raw_output = fh.read()
    for raw_line in raw_output.splitlines():
        line = raw_line.strip()
        if not line.startswith("{"):
            continue
        try:
            objects.append(json.loads(line))
        except ValueError:
            continue
if not objects:
    sys.exit(1 if raw_output.strip() else 4)

finals = []
for event in objects:
    if event.get("type") != "assistant.message":
        continue
    # Sub-agent events share the session stream and carry an envelope-level
    # agentId; -o is the root agent's answer contract.
    if event.get("agentId") is not None:
        continue
    data = event.get("data") or {}
    content = data.get("content")
    tool_requests = data.get("toolRequests")
    if isinstance(content, str) and content.strip() and not tool_requests:
        finals.append(content)

result = finals[-1] if finals else ""
if result and not result.endswith("\n"):
    result += "\n"
with open(out_path, "w", encoding="utf-8") as fh:
    fh.write(result)
if not result:
    sys.exit(4)
PY
  py_rc=$?
  set -e
  if [ "$py_rc" -eq 4 ]; then
    NO_FINAL_ANSWER=1
  elif [ "$py_rc" -ne 0 ]; then
    PARSE_FAIL=1
  fi
  emit_backend_stream "$answer_target"
  extract_session_copilot
}

# The copilot session id is parsed from the share transcript sidecar, whose
# header carries it (the body quotes decoy ids, so only the header is trusted).
extract_session_copilot() {
  [ -z "$SESSION_ID" ] || return 0
  [ -n "$SIDECAR" ] || return 0
  SESSION_ID="$(sid_from_header "$SIDECAR")"
}

flush_diagnostics_copilot() {
  [ "$DIAGNOSTICS_REPLAYED" != 1 ] || return 0
  DIAGNOSTICS_REPLAYED=1
  [ -f "$TMP_RUN/copilot.stderr" ] || return 0
  emit_backend_stream "$TMP_RUN/copilot.stderr" >&2 || true
}

launch_codex() {
  local n
  # The backend must be a directly signalable and wait-able child even
  # though its output streams through capture and filter stages, so the left
  # segment records its own pid, then execs the backend in place. TEE_PID names
  # the tail filter; waiting it transitively proves the middle tee has exited.
  set +e
  # Arm the pid record before backgrounding the pipeline — see
  # arm_backend_pid_file for why the ordering is load-bearing.
  arm_backend_pid_file
  { printf '%s\n' "$BASHPID" >"$BACKEND_PID_FILE" \
    && close_backend_path_locks \
    && exec "${SETSID[@]}" "${cmd[@]}" <"$STDIN_SRC" 2>&1; } \
    | { close_backend_path_locks; exec tee "$CAPTURE"; } \
    | { close_backend_path_locks; emit_backend_stream --live; } &
  TEE_PID=$!
  # Test-only: widen the launch→pid-read window so a regression test can race
  # a fatal signal into it. Placed immediately after the launch so any phase
  # assignment that regressed back to here would land inside it and be caught.
  # Unset in real runs, where this is a no-op.
  if [ -n "${AGENT_RUN_TEST_PID_CAPTURE_DELAY-}" ]; then sleep "$AGENT_RUN_TEST_PID_CAPTURE_DELAY"; fi
  n=0
  # Bounded time poll only. Do not add a liveness clause on TEE_PID: the filter
  # is the pipeline's reader, not the pid-record writer, so a dead filter
  # does not prove the launch settled. A filter that died early (broken binary,
  # unwritable capture, a signal aimed at the filter) would end the poll while
  # the left segment has yet to write its pid and exec, and the fallback below
  # would then report an abort over a live, lock-holding backend.
  while [ ! -s "$BACKEND_PID_FILE" ] && [ "$n" -lt 200 ]; do
    sleep 0.01
    n=$((n + 1))
  done
  BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
  if [ -n "$BACKEND_PID" ]; then
    printf 'agent-run: backend-pid: %s\n' "$BACKEND_PID"
    early_session_codex
    wait_for_backend_status "$BACKEND_PID" codex-backend
    pause_after_backend_wait
  else
    # The pid file is still empty after the fast poll. Do not guess: settle the
    # pipeline definitively. The filter cannot exit until tee closes, and tee
    # cannot exit until the launch shell (or backend it exec'd) closes its pipe,
    # so this wait makes the launch outcome final. The subshell writes its pid
    # *before* `&& exec`, making the re-read authoritative:
    wait_for_backend_status "$TEE_PID" codex-tee
    TEE_PID=''
    BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [ -n "$BACKEND_PID" ]; then
      # A backend did launch (the pid landed after the poll gave up) and has
      # since finished — we waited the whole pipeline, so it never orphaned.
      # Name it and prefer its own status over the pipeline tail's.
      printf 'agent-run: backend-pid: %s\n' "$BACKEND_PID"
      wait_for_backend_status "$BACKEND_PID" codex-late-backend
      pause_after_backend_wait
    else
      # Empty even after the pipeline settled. Do not rely on wait "$TEE_PID"
      # here: the filter may succeed because no backend ever wrote to it. The
      # worktree lock releases with the wrapper, and the launch abort itself
      # fails the run.
      print_launch_abort_pid_line
      code=1
    fi
  fi
  if [ "$code" -eq 0 ]; then detect_orphaned_children "$BACKEND_PID"; fi
  drain_codex_tee # CAPTURE is complete before the sid parse
  set -e
  BACKEND_PID=''
  BACKEND_PHASE=reaped
  extract_session_codex
}

# Log the codex session id as soon as `codex exec` streams its header, before
# the wrapper waits on the run. A crash before finalization — a container OOM or
# any SIGKILL, neither of which can run the fatal-signal trap — then still leaves
# a resumable id in the log instead of forcing a cold-discovery recovery run. The
# parse is the same anchored sid_from_header used at finalization, so streamed
# prompt content cannot spoof the id. Bounded: give up after ~1s of polling if no
# header has appeared (finalization still extracts it), and stop the instant the
# backend is gone so a headerless run never spins.
early_session_codex() {
  local n=0 sid
  [ -n "$CAPTURE" ] || return 0
  while [ "$n" -lt 100 ]; do
    sid="$(sid_from_header "$CAPTURE")"
    if [ -n "$sid" ]; then
      SESSION_ID="$sid"
      log_session_id_once
      return 0
    fi
    backend_alive || return 0
    sleep 0.01
    n=$((n + 1))
  done
}

# The codex session id is parsed from the exec capture header. The tee is reaped
# first so CAPTURE holds everything the backend printed (in the fatal-signal path
# the header can land within milliseconds of the kill); logs quote prompt content,
# so only the anchored header region is trusted.
extract_session_codex() {
  [ -z "$SESSION_ID" ] || return 0
  drain_codex_tee
  SESSION_ID="$(sid_from_header "$CAPTURE")"
}

normalize_backend_result() {
  local answer_target="${CANDIDATE_ANSWER:-$OUT}"
  # Wrapper exit codes 1/2/3/4 are reserved meanings, so backend failures are
  # normalized to 1 with the original code preserved in a trailer; a "success"
  # that produced no answer where one was requested is also a failure.
  # Computing the disposition is separate from printing its trailer:
  # `backend-exit:` is a completion anchor, so emit_result_trailers only prints
  # the buffered line after the answer is published and the attempt record is
  # settled. Otherwise a default-mode waiter decides on an anchor that precedes
  # publication and reads an empty -o.
  BACKEND_DISPOSITION=success
  BACKEND_EXIT_TRAILER=''
  if [ "$code" -ne 0 ]; then
    BACKEND_DISPOSITION="exit-$code"
    BACKEND_EXIT_TRAILER="agent-run: backend-exit: $code"
    code=1
  elif [ "$ORPHANED_CHILDREN" = 1 ] && [ "$MODE" = consult ]; then
    # A consult is read-only, so a lingering child cannot leave mutating work
    # behind: any real mutation it made is caught by the drift check below, which
    # outranks this and exits 4. Some backends — notably cursor, whose
    # worker-server daemons linger in the backend group — trip the orphan
    # detector on an otherwise clean read-only consult, so reap the group but
    # keep the run a success. A distinct warning-style trailer records the reap
    # without the backend-exit: failure anchor; the answer-landed check below
    # still demotes to exit 1 when no answer arrived, and the worktree: anchor
    # still finalizes the run.
    printf 'agent-run: orphaned-children-reaped: consult backend exited 0; lingering background process reaped; not a failure\n'
    terminate_orphaned_children
  elif [ "$ORPHANED_CHILDREN" = 1 ]; then
    # A distinct completion anchor so a trailer-reading waiter never reads this
    # as an unqualified clean success: the backend exited 0 but abandoned live
    # background work that dies at end-of-turn. For work runs that abandoned work
    # can still be mutating the tree, so this stays a hard failure.
    BACKEND_EXIT_TRAILER='agent-run: backend-exit: orphaned-children (backend exited 0 but left background processes running in its group; they die at end-of-turn — foreground long-running work instead of backgrounding it)'
    BACKEND_DISPOSITION=orphaned-children
    code=1
    # Make "die at end-of-turn" true: a setsid backend group would otherwise
    # outlive this wrapper. TERM it here, with the reap already recorded in the
    # buffered trailer that finalization prints; fatal signals are ignored for
    # the whole of finalize_run, so only SIGKILL can separate the two.
    terminate_orphaned_children
  fi
  if [ "$PARSE_FAIL" = 1 ] && [ "$code" -eq 0 ]; then
    printf 'agent-run.sh: could not parse the %s result envelope from the output\n' "$AGENT" >&2
    BACKEND_DISPOSITION=parse-failure
    code=1
  fi
  if [ "$IS_ERROR" = 1 ] && [ "$code" -eq 0 ]; then
    printf 'agent-run.sh: %s reported an error result envelope (is_error); treating the run as failed\n' "$AGENT" >&2
    BACKEND_DISPOSITION=error-envelope
    code=1
  fi
  if [ "$NO_FINAL_ANSWER" = 1 ] && [ "$code" -eq 0 ]; then
    printf 'agent-run.sh: run reported success but no answer landed in %s (copilot emitted no final answer)\n' "$OUT" >&2
    BACKEND_DISPOSITION=no-final-answer
    code=1
  fi
  if [ -n "$answer_target" ] && [ "$code" -eq 0 ] && ! [ -s "$answer_target" ]; then
    printf 'agent-run.sh: run reported success but no answer landed in %s\n' "$OUT" >&2
    BACKEND_DISPOSITION=no-answer
    code=1
  fi
}

emit_result_trailers() {
  # Completion anchors are published last: by the time `backend-exit:` is
  # readable the answer has landed in -o and the attempt record is settled, so
  # the documented bare `agent-wait.sh <log>` fallback cannot report a decided
  # run whose answer is still empty and whose answer lock is still held.
  [ -z "$BACKEND_EXIT_TRAILER" ] || printf '%s\n' "$BACKEND_EXIT_TRAILER"
  if [ "$ANSWER_PUBLISHED" = 1 ]; then
    printf 'agent-run: answer: %s\n' "$OUT_ABS"
  fi
  log_session_id_once

  if [ "$MODE" = work ]; then
    emit_work_outcome
  fi
}

finalize_consult_drift_check() {
  local changed status_now
  if [ "$DRIFT_CHECKED_MODE" = 1 ]; then
    if [ -z "$GIT_DIR_PATH" ]; then
      DRIFT_UNCHECKED=1
      UNCHECKED_REASON='not a git repository'
    elif [ "$DRIFT_UNCHECKED" = 0 ] && lock_busy_elsewhere; then
      DRIFT_UNCHECKED=1
    fi
    if [ "$DRIFT_UNCHECKED" = 1 ]; then
      printf 'agent-run: worktree: unchecked (%s)\n' "$UNCHECKED_REASON"
    else
      DRIFT_POST="$(worktree_snapshot)"
      if [ "$DRIFT_POST" != "$DRIFT_PRE" ]; then
        changed="$(worktree_snapshot_diff "$DRIFT_PRE" "$DRIFT_POST")"
        status_now="$(git_read status --porcelain 2>/dev/null || true)"
        printf 'agent-run: worktree: DIRTY (%s modified: %s)\n' "$MODE" "${changed:-unknown component}"
        if [ -n "$status_now" ]; then
          printf 'agent-run: drift-status: %s uncommitted path(s) at report time:\n' "$(printf '%s\n' "$status_now" | grep -c .)"
          printf '%s\n' "$status_now" | sed 's/^/agent-run: drift:   /'
        else
          printf 'agent-run: drift-status: git status clean at report time (transient drift already reverted)\n'
        fi
        printf 'agent-run.sh: %s run mutated the worktree; inspect git status before trusting its output\n' "$MODE" >&2
        # A dirty worktree needs cleanup regardless of the backend's own result,
        # so drift outranks a backend failure (its code is kept in the
        # backend-exit trailer). Only 0/1 reach here — usage/lock exit earlier.
        code=4
      else
        # Ordinary tracked content is not hashed. An unchanged composite
        # snapshot is therefore strong evidence under normal Git/filesystem
        # behavior, but it is not an authoritative raw-byte identity proof.
        printf 'agent-run: worktree: best-effort-clean\n'
      fi
    fi
  fi
}

finalize_run() {
  # Finalization is short and record-sensitive. Once the backend is reaped,
  # defer fatal signals until process exit rather than re-entering an in-flight
  # record replacement and risking two final writes.
  trap '' TERM INT HUP
  normalize_backend_result
  pause_before_attempt_finalization
  finalize_attempt_record
  pause_after_attempt_finalization
  emit_result_trailers
  finalize_consult_drift_check
  exit "$code"
}

main() {
  agent_run_reset_state
  parse_and_validate_args "$@"
  run_passthrough_guards
  clear_backend_permission_env
  load_git_context
  validate_prelock_branch_policy
  pause_after_prelock_branch_policy
  select_safe_tmpdir
  assemble_prompt
  prepare_prompt_transport
  prepare_answer_paths
  acquire_worktree_lock
  validate_required_feature_branch
  check_dirty_work_start
  acquire_attempt_lock
  acquire_caller_share_lock
  prepare_lock_probe
  prepare_consult_drift_check
  capture_work_baseline
  validate_launch_paths
  validate_requested_branch_availability
  install_signal_traps
  claim_caller_transcript
  claim_attempt
  create_requested_branch
  build_backend_command
  initialize_backend_runtime
  emit_dispatch_header
  run_backend
  pause_for_test_release \
    "${AGENT_RUN_TEST_FINALIZE_READY-}" "${AGENT_RUN_TEST_FINALIZE_RELEASE-}"
  finalize_run
}

# Keep the wrapper self-contained and sourceable: Bash parses these function
# bodies before `main` starts, so a work run that edits this file cannot corrupt
# the still-running wrapper by shifting unread top-level byte offsets.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

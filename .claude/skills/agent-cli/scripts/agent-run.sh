#!/usr/bin/env bash
# Unified dispatch wrapper for delegated/consulted agent CLI runs (claude,
# codex, copilot, cursor — whose CLI binary is confusingly named `agent`).
# The caller-facing `agent-run:` trailer and exit-code
# contract lives in ../references/trailer-contract.md; keep this script
# hand-written and portable with no generation/build step.
# This bash entrypoint also bypasses interactive-shell aliases that silently
# append blanket permission flags to bare `claude`/`codex`/`copilot` calls.
# The passthrough scan after `--` is a guard, not a full CLI parser: it
# mirrors just enough of each CLI's option syntax to veto dangerous shapes.
set -euo pipefail

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
  -m, --model <id>          model (required for copilot; cursor defaults to grok-4.5-xhigh)
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
  printf 'agent-run.sh: %s\n' "$1" >&2
  exit 2
}

has_non_whitespace() {
  [[ "$1" =~ [^[:space:]] ]]
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
  PASSTHRU=()
  NORMALIZED_ARGS=()
  AUTO_OUT=0
  TMP_RUN=''
  CONSULT_GRANTS=0
  GIT_DIR_PATH=''
  WT_TOP=''
  SAFE_TMPDIR="${TMPDIR:-/tmp}"
  FULL_PROMPT=''
  CONSULT_PREAMBLE=''
  STDIN_SRC=/dev/null
  COPILOT_SHARE=''
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
  cmd=()
  CAPTURE=''
  SESSION_ID=''
  SESSION_ID_LOGGED=0
  ORPHANED_CHILDREN=0
  ORPHANED_PGID=''
  code=0
  PARSE_FAIL=0
  IS_ERROR=0
  BACKEND_PID=''
  TEE_PID=''
  BACKEND_PID_FILE=''
  BACKEND_PHASE=pre
  SETSID=()
}

# An auto-generated answer file that never receives an answer (usage
# rejection, busy lock, failed backend) is litter nobody holds a path to, so
# it is removed on exit; explicit -o leftovers stay, as the retry contract
# accepts empty files. The generation itself happens later, once the worktree
# top is known.
cleanup() {
  [ -z "$TMP_RUN" ] || rm -rf "$TMP_RUN"
  if [ "$AUTO_OUT" = 1 ] && ! [ -s "$OUT" ]; then
    rm -f "$OUT"
    if [ -e "$OUT.transcript.md" ] && ! [ -s "$OUT.transcript.md" ]; then
      rm -f "$OUT.transcript.md"
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
CURSOR_SUBCOMMANDS='install-shell-integration uninstall-shell-integration login logout mcp worker status whoami models about update create-chat generate-rule rule'

validate_usage_cursor() {
  command -v python3 >/dev/null 2>&1 \
    || reject "the cursor backend needs python3 on PATH to parse the result envelope (-o and the trailers depend on it)"
  [ -z "$EFFORT" ] \
    || reject "cursor has no effort flag; effort is encoded in the model id (grok-4.5-xhigh) or a bracket override (-m 'claude-opus-4-8[effort=high]')"
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

parse_and_validate_args() {
  parse_args "$@"
  load_mission_file
  validate_usage_options
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
#   lock_required_<backend>           force the worktree lock on
#   consult_preamble_<backend>        swap the consult preamble for the backend's read-only profile
#   oversized_prompt_guard_<backend>  reject an over-argv prompt where stdin is ignored
#   prepare_answer_<backend>          answer/sidecar path prep before the lock
#   validate_launch_paths_<backend>   answer/sidecar path checks under the lock
#   drift_cwd_<backend>               detect a cwd move for the consult drift check
#   resolve_backend_pid_<backend>     recover a pid the launch had not yet captured
#   early_session_<backend>           log the session id from streamed output before the wait
#   extract_session_<backend>         parse the backend session id
#
# Adding a backend is one adapter set plus one entry in the agent registry
# (the `case "$AGENT"` in parse_args) — no edit anywhere else.
run_adapter_hook() {
  local fn="${1}_${AGENT}"
  if declare -F "$fn" >/dev/null 2>&1; then "$fn"; fi
}

# --- passthrough guards -------------------------------------------------------

codex_config_guard() {
  # accept the `-c=KEY=VAL` spelling by stripping one leading `=`
  case "${1#=}" in
    sandbox_mode=*)
      reject "sandbox_mode is wrapper-owned: codex sandboxing (bwrap) does not work in this devcontainer"
      ;;
    approval_policy=*)
      reject "approval_policy is wrapper-owned ('-a never' keeps headless runs from stalling)"
      ;;
    profile=*)
      reject "profile is wrapper-owned; profiles can override sandbox/approval config"
      ;;
    model=*)
      reject "model is wrapper-owned; use the wrapper's -m option"
      ;;
    model_reasoning_effort=*)
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
        reject "$arg moves the run off this worktree's lock; dispatch from the worktree the run should own"
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
# 'shell(:*)' is the empty-prefix spelling of the same blanket.
copilot_blanket_grant_guard() {
  case "$1" in
    shell | write | 'shell(*)' | 'shell(*:*)' | 'shell(:*)' | 'write(*)' | 'write(*:*)' | 'write(:*)')
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
        reject "$arg is wrapper-owned: the -o answer contract relies on the default text output"
        ;;
      -s | --silent)
        reject "$arg is wrapper-owned: output stripping is part of the -o answer contract"
        ;;
      --share | --share-gist)
        reject "bare --share writes its default path into the worktree; use --share=<path outside the worktree>"
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
        reject "$arg moves the run off this worktree's lock; dispatch from the worktree the run should own"
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

validate_prelock_branch_policy() {
  local current_branch

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

  # Opt-in branch protection for work: some repos forbid agent commits on the
  # mainline, so reject a mutating run parked on a protected branch (or a
  # detached HEAD) before the lock is taken or the backend launches.
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
  run_adapter_hook consult_preamble

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

consult_preamble_cursor() {
  # Ask mode denies all shell, so the shared preamble's "git diff is fine"
  # would promise a tool this session does not have; steer to file reads and
  # the <attached> material the caller supplies instead.
  CONSULT_PREAMBLE='Shell commands are denied in this session; do not attempt them. Reading files is fine, and any diffs or command output you need arrive as <attached> material.
Do not modify files. Assume tests pass.'
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

# --- per-worktree lock ------------------------------------------------------------

prepare_answer_paths() {
  # Consult and work always land the answer in a plain file: default -o to a
  # generated path so the caller never has to fish the answer out of the log.
  if [ "$MODE" != review ] && [ -z "$OUT" ]; then
    OUT="$(mktemp "$SAFE_TMPDIR/agent-answer.XXXXXX")" \
      || reject "cannot create a default answer file under $SAFE_TMPDIR; pass -o <file>"
    AUTO_OUT=1
  fi

  COPILOT_SHARE=''
  run_adapter_hook prepare_answer
  if [ "$AUTO_OUT" = 0 ] && [ -n "$GIT_DIR_PATH" ] && [ -n "$OUT" ]; then
    reject_in_tree_path "-o" "$OUT" "$WT_TOP"
  fi
}

# The wrapper writes -o and copilot's transcript sidecar; inside the worktree
# either write reads as consult drift or, in the work trailers, as the run's own
# leftover changes, so both must resolve outside the repo in every mode. A
# caller-supplied copilot --share=<path> replaces the wrapper's default sidecar,
# so it is captured here and held to the same rule — one per run, and never the
# -o file itself (the transcript would overwrite the answer).
prepare_answer_copilot() {
  local share_arg share_abs out_abs
  for share_arg in "${PASSTHRU[@]}"; do
    case "$share_arg" in
      --share=*)
        [ -z "$COPILOT_SHARE" ] || reject "duplicate --share= would leave two transcript paths; pass one"
        COPILOT_SHARE="${share_arg#--share=}"
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
  fi
}

# Best-effort identity of the process holding the worktree lock, for the exit-3
# busy message. The lock file is opened with `exec 9>` (which truncates it), so
# the holder's identity cannot be stashed in the file itself; instead resolve
# the open-file holders from the contender side via fuser/lsof, skip our own
# pid (we hold fd 9 open too), and describe the first real holder with ps.
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

# codex holds the worktree lock even for read-only consults: a codex consult can
# still touch the tree (and its own busy lock exits 3), so it serializes against
# other codex runs the same way work does.
lock_required_codex() {
  LOCK_NEEDED=1
}

acquire_worktree_lock() {
  local holder
  LOCK_NEEDED=0
  if [ "$MODE" = work ]; then
    LOCK_NEEDED=1
  fi
  run_adapter_hook lock_required
  if [ "$LOCK_NEEDED" = 1 ] && [ -n "$GIT_DIR_PATH" ] && command -v flock >/dev/null 2>&1; then
    LOCK_PATH="$GIT_DIR_PATH/agent-run.lock"
    if ! { exec 9>"$LOCK_PATH"; } 2>/dev/null; then
      printf 'agent-run.sh: cannot open worktree lock %s\n' "$LOCK_PATH" >&2
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
    reject "work requires a clean worktree (a dirty start invites the delegate to absorb unrelated WIP); commit or stash first, or pass --dirty-ok when the task is to inspect the current diff"
  fi
}

prepare_lock_probe() {
  # Lock-free consults (claude/copilot/cursor) may legitimately run alongside a work
  # dispatch; drift seen then belongs to the work run, not the consult. Probe
  # the lock around the run and report `unchecked` instead of a false DIRTY.
  # (A work run that starts and finishes entirely inside the consult's window
  # slips past both probes and would be misattributed — accepted: work runs are
  # long, consults short.)
  CAN_PROBE=0
  LOCK_PROBE_UNAVAILABLE=0
  if [ "$MODE" = consult ] && [ "$LOCK_NEEDED" = 0 ] && [ -n "$GIT_DIR_PATH" ] \
    && command -v flock >/dev/null 2>&1; then
    LOCK_PATH="$GIT_DIR_PATH/agent-run.lock"
    if { exec 8>"$LOCK_PATH"; } 2>/dev/null; then
      CAN_PROBE=1
    else
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
# branch moves, and .git internals, so the drift snapshot also covers HEAD, the
# branch ref, diff checksums, tracked/non-ignored-untracked file content
# checksums, local git config, and executable hooks. Ignored files are
# intentionally out of scope: hashing the ignored tree walks large caches like
# node_modules and reports unrelated cache churn as consult drift.
file_content_snapshot() {
  {
    git_read ls-files -z -c 2>/dev/null || true
    git_read ls-files -z -o --exclude-standard 2>/dev/null || true
  } | sort -z | while IFS= read -r -d '' path; do
    [ -f "$path" ] || continue
    printf 'path %s\n' "$path"
    cksum <"$path" || true
  done
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
  printf 'unstaged-diff\t%s\n' "$({ git_read diff 2>/dev/null || true; } | cksum)"
  printf 'staged-diff\t%s\n' "$({ git_read diff --cached 2>/dev/null || true; } | cksum)"
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

# --- backend command construction ---------------------------------------------------

validate_launch_paths() {
  # Validate the answer file and copilot transcript sidecar up front. A path
  # already holding content is rejected: answers are one-per-path, so a reused
  # path would either clobber the prior answer or (codex writes -o natively; the
  # sidecar feeds the session-id trailer) let stale content masquerade as this
  # run's result. Empty leftovers from a failed run are fine — truncating them
  # also catches an unwritable path before a long run instead of after. Done
  # after the lock is held so a busy-lock exit never touches the files.
  if [ -n "$OUT" ] && [ -s "$OUT" ]; then
    reject "-o '$OUT' already holds an answer and a reused path would clobber it; pick a fresh path per run (or rm it first)"
  fi
  if [ -n "$OUT" ] && ! (: >"$OUT") 2>/dev/null; then
    reject "cannot write the -o answer file '$OUT' (does its directory exist?)"
  fi
  SIDECAR=''
  run_adapter_hook validate_launch_paths
}

validate_launch_paths_copilot() {
  SIDECAR="${COPILOT_SHARE:-$OUT.transcript.md}"
  if [ -s "$SIDECAR" ]; then
    reject "transcript sidecar '$SIDECAR' already holds a prior session; pick a fresh path per run (or rm it first)"
  fi
  if ! (: >"$SIDECAR") 2>/dev/null; then
    reject "cannot write the copilot transcript sidecar '$SIDECAR' (does its directory exist?)"
  fi
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
    if git_read show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
      reject "--branch '$BRANCH_NAME' already exists; pick a fresh name (or switch to it yourself before dispatching)"
    fi
    git switch -q -c "$BRANCH_NAME" 2>/dev/null \
      || reject "--branch could not create '$BRANCH_NAME' at the current HEAD"
    printf 'agent-run: branch: %s (created)\n' "$BRANCH_NAME"
  fi
}

build_codex_command() {
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
    if [ -n "$OUT" ]; then cmd+=(-o "$OUT"); fi
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
  cmd=(copilot --no-color --no-auto-update)
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
    # ask mode is cursor's enforced read-only profile: file reads work, the
    # write tool is refused, and headless shell is denied outright.
    cmd+=(--mode ask)
  else
    # headless denies every shell command without --force
    cmd+=(--force)
  fi
  # cursor's own default is `auto` (a server-side pick), so pin a
  # deterministic default instead of inheriting it
  cmd+=(--model "${MODEL:-grok-4.5-xhigh}")
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
  SESSION_ID=''
  SESSION_ID_LOGGED=0
  ORPHANED_CHILDREN=0
  ORPHANED_PGID=''
  code=0
  PARSE_FAIL=0
  IS_ERROR=0
  BACKEND_PID=''
  TEE_PID=''
  # Set by the codex launch to the file its pipeline records the backend pid in.
  # Empty until then; resolve_backend_pid and the finalize poll read it.
  BACKEND_PID_FILE=''
  # Lifecycle phase for the fatal-signal path, so a TERM that lands while
  # BACKEND_PID is momentarily empty can be reported precisely instead of as a
  # single ambiguous trailer:
  #   pre     — no backend dispatched yet (nothing to signal or orphan)
  #   running — the backend was launched; BACKEND_PID may still be uncaptured
  #             (the codex pid-file poll window) but the process is alive
  #   reaped  — the backend was waited/reaped; BACKEND_PID reset on purpose
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

remove_stale_index_lock() {
  local git_dir index_lock
  [ -n "$GIT_DIR_PATH" ] || return 0
  git_dir="$(git_read rev-parse --git-dir 2>/dev/null || true)"
  [ -n "$git_dir" ] || git_dir="$GIT_DIR_PATH"
  [ -n "$git_dir" ] || return 0
  index_lock="$git_dir/index.lock"
  [ -e "$index_lock" ] || return 0
  rm -f -- "$index_lock" 2>/dev/null || true
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

# Close the codex pid-capture race: the codex launch path records the backend
# pid in a file *before* execing the backend, but the main shell only reads it
# into BACKEND_PID after a poll. A TERM landing in that window would otherwise
# see an empty BACKEND_PID and skip propagation, orphaning a live backend that
# still holds the lock. When BACKEND_PID is empty during a running backend,
# read the pid the pipeline already recorded (a brief poll covers the sub-ms
# gap between backgrounding the pipeline and the subshell writing the file) so
# the fatal-signal path can still reach it.
resolve_backend_pid_codex() {
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
on_fatal_signal() {
  local sig="$1" n=0 kill_escalated=0
  trap '' TERM INT HUP
  # Recover a codex pid that the poll had not yet captured, so a signal in the
  # capture window still propagates instead of silently orphaning the backend.
  if [ "$BACKEND_PHASE" = running ]; then run_adapter_hook resolve_backend_pid; fi
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
      remove_stale_index_lock
    fi
    printf 'agent-run: backend-exit: killed (SIG%s, propagated to backend pid %s)\n' "$sig" "$BACKEND_PID"
  elif [ "$BACKEND_PHASE" = running ] && [ -z "$BACKEND_PID" ]; then
    # The backend was launched but its pid was never captured, so it cannot be
    # signaled — it may survive as a lock-holding orphan. Say so distinctly.
    printf 'agent-run: backend-exit: killed (SIG%s, pid capture failed — backend may be orphaned)\n' "$sig"
  elif [ -n "$BACKEND_PID" ] || [ "$BACKEND_PHASE" = reaped ]; then
    # A backend was dispatched and has already exited; nothing left to signal.
    printf 'agent-run: backend-exit: killed (SIG%s, backend already exited)\n' "$sig"
  else
    # The signal landed before any backend was dispatched.
    printf 'agent-run: backend-exit: killed (SIG%s, no backend dispatched yet)\n' "$sig"
  fi
  run_adapter_hook extract_session
  log_session_id_once
  if [ -n "$OUT" ] && [ -s "$OUT" ]; then
    printf 'agent-run: answer: %s\n' "$OUT"
  fi
  if [ "$MODE" = work ]; then
    emit_work_outcome
  else
    printf 'agent-run: worktree: unchecked (run killed by SIG%s before the drift check)\n' "$sig"
  fi
  exit 1
}

emit_dispatch_header() {
  # Wrapper-owned breadcrumbs from minute zero: a log holding this header but
  # no completion trailers, with the wrapper pid dead, is the signature of a
  # run killed before finalization (recovery in SKILL.md). Waiters must anchor
  # completion on the worktree:/backend-exit: trailers, never a bare
  # '^agent-run:' — that now matches at dispatch.
  if [ -n "$OUT" ]; then
    printf 'agent-run: dispatched: %s %s wrapper-pid %d answer %s\n' "$MODE" "$AGENT" "$$" "$OUT"
  else
    printf 'agent-run: dispatched: %s %s wrapper-pid %d\n' "$MODE" "$AGENT" "$$"
  fi
}

install_signal_traps() {
  trap 'on_fatal_signal TERM' TERM
  trap 'on_fatal_signal INT' INT
  trap 'on_fatal_signal HUP' HUP
}

run_backend() {
  "launch_$AGENT"
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

launch_result_envelope_backend() {
  local py_rc
  # the backend buffers until done (a quiet log is normal); the JSON envelope
  # lands in the log for debugging while the parsed answer goes to -o.
  set +e
  # phase before the launch (see the codex path): a fatal signal in the gap
  # before BACKEND_PID=$! is captured then fails closed (possible-orphan)
  # instead of the 'pre' branch's "no backend dispatched" while a live backend
  # orphans.
  BACKEND_PHASE=running
  "${SETSID[@]}" "${cmd[@]}" <"$STDIN_SRC" >"$CAPTURE" 2>&1 &
  BACKEND_PID=$!
  printf 'agent-run: backend-pid: %d\n' "$BACKEND_PID"
  wait "$BACKEND_PID"
  code=$?
  if [ "$code" -eq 0 ]; then detect_orphaned_children "$BACKEND_PID"; fi
  set -e
  BACKEND_PID=''
  BACKEND_PHASE=reaped
  cat "$CAPTURE"
  # python exit 0: parsed fine; 3: envelope carries is_error; else: no envelope
  set +e
  python3 - "$CAPTURE" "$OUT" "$AGENT" <<'PY' # -o is always set outside review, so the answer always lands in a file
import json
import sys

capture_path, out_path, agent = sys.argv[1], sys.argv[2], sys.argv[3]
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
if session_id:
    print("agent-run: session-id: %s" % session_id)
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
  if [ "$py_rc" -eq 3 ]; then
    IS_ERROR=1
  elif [ "$py_rc" -ne 0 ]; then
    PARSE_FAIL=1
  fi
}

launch_copilot() {
  # -s strips copilot's output to the bare answer: capture it as the answer
  # file, keep the transcript (and session id) in the sidecar.
  set +e
  # phase before the launch (see the codex path): fail closed on a signal in
  # the gap before BACKEND_PID=$! is captured, never "no backend dispatched".
  BACKEND_PHASE=running
  "${SETSID[@]}" "${cmd[@]}" <"$STDIN_SRC" >"$OUT" &
  BACKEND_PID=$!
  printf 'agent-run: backend-pid: %d\n' "$BACKEND_PID"
  wait "$BACKEND_PID"
  code=$?
  if [ "$code" -eq 0 ]; then detect_orphaned_children "$BACKEND_PID"; fi
  set -e
  BACKEND_PID=''
  BACKEND_PHASE=reaped
  cat -- "$OUT"
  extract_session_copilot
}

# The copilot session id is parsed from the share transcript sidecar, whose
# header carries it (the body quotes decoy ids, so only the header is trusted).
extract_session_copilot() {
  [ -z "$SESSION_ID" ] || return 0
  [ -n "$SIDECAR" ] || return 0
  SESSION_ID="$(sid_from_header "$SIDECAR")"
}

launch_codex() {
  local n
  # The backend must be a directly signalable and wait-able child even
  # though its output streams through tee, so the left pipeline segment
  # records its own pid, then execs the backend in place (both pipeline
  # segments are children of this shell, so both pids can be wait-ed).
  set +e
  # Mark the backend running *before* backgrounding the pipeline. The backend
  # is live the instant the pipeline is up, but its pid is only read into
  # BACKEND_PID after the poll below; a fatal signal in that gap must see
  # phase=running so on_fatal_signal recovers the recorded pid
  # (resolve_backend_pid_codex) and propagates, instead of the 'pre' branch printing
  # "no backend dispatched" while the live backend survives as a lock-holding
  # orphan. Assigning the phase *after* the launch left exactly that gap open.
  # The only residual window is the sub-instruction gap between this line and
  # the launch, and it fails closed: a signal there sees phase=running with no
  # pid file yet and reports a possible orphan rather than silently dropping a
  # real one.
  BACKEND_PID_FILE="$TMP_RUN/backend.pid"
  # Test-only: point the pid write at an unwritable path so the launch
  # subshell's `printf … >file` fails and `&& exec` never starts a backend —
  # the launch-abort path the finalize logic below must handle safely. A
  # no-op (the real, writable path) in real runs.
  if [ -n "${AGENT_RUN_TEST_PID_WRITE_FAIL-}" ]; then BACKEND_PID_FILE="$TMP_RUN/no-such-dir/backend.pid"; fi
  BACKEND_PHASE=running
  { printf '%s\n' "$BASHPID" >"$BACKEND_PID_FILE" && exec "${SETSID[@]}" "${cmd[@]}" <"$STDIN_SRC" 2>&1; } | tee "$CAPTURE" &
  TEE_PID=$!
  # Test-only: widen the launch→pid-read window so a regression test can race
  # a fatal signal into it. Placed immediately after the launch so any phase
  # assignment that regressed back to here would land inside it and be caught.
  # Unset in real runs, where this is a no-op.
  if [ -n "${AGENT_RUN_TEST_PID_CAPTURE_DELAY-}" ]; then sleep "$AGENT_RUN_TEST_PID_CAPTURE_DELAY"; fi
  n=0
  while [ ! -s "$BACKEND_PID_FILE" ] && [ "$n" -lt 200 ]; do
    sleep 0.01
    n=$((n + 1))
  done
  BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
  if [ -n "$BACKEND_PID" ]; then
    printf 'agent-run: backend-pid: %s\n' "$BACKEND_PID"
    run_adapter_hook early_session
    wait "$BACKEND_PID"
    code=$?
  else
    # The pid file is still empty after the fast poll. Do not guess: settle
    # the pipeline definitively. tee cannot exit until the launch subshell
    # (and any backend it exec'd) has closed the pipe, so once this wait
    # returns the launch outcome is final. The subshell writes its pid
    # *before* `&& exec`, so a re-read now is authoritative:
    wait "$TEE_PID"
    code=$?
    BACKEND_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [ -n "$BACKEND_PID" ]; then
      # A backend did launch (the pid landed after the poll gave up) and has
      # since finished — we waited the whole pipeline, so it never orphaned.
      # Name it and prefer its own status over the pipeline tail's.
      printf 'agent-run: backend-pid: %s\n' "$BACKEND_PID"
      wait "$BACKEND_PID"
      code=$?
    else
      # Empty even after the pipeline settled: the `printf … >file` failed, so
      # `&& exec` never launched a backend. There is nothing to signal and
      # nothing to orphan — the worktree lock releases with the wrapper, and
      # the launch abort itself fails the run. Do not rely on wait "$TEE_PID"
      # here: tee may report success because no backend ever wrote to it.
      # An empty pid record can no longer coexist with a live, lock-holding
      # backend.
      printf 'agent-run: backend-pid: none (launch aborted before exec; no backend started)\n'
      code=1
    fi
  fi
  if [ "$code" -eq 0 ]; then detect_orphaned_children "$BACKEND_PID"; fi
  wait "$TEE_PID" 2>/dev/null # CAPTURE is complete before the sid parse
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
  if [ -n "$TEE_PID" ]; then wait "$TEE_PID" 2>/dev/null || true; fi
  SESSION_ID="$(sid_from_header "$CAPTURE")"
}

normalize_backend_result() {
  # Wrapper exit codes 1/2/3/4 are reserved meanings, so backend failures are
  # normalized to 1 with the original code preserved in a trailer; a "success"
  # that produced no answer where one was requested is also a failure.
  if [ "$code" -ne 0 ]; then
    printf 'agent-run: backend-exit: %d\n' "$code"
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
    printf 'agent-run: backend-exit: orphaned-children (backend exited 0 but left background processes running in its group; they die at end-of-turn — foreground long-running work instead of backgrounding it)\n'
    code=1
    # Make "die at end-of-turn" true: a setsid backend group would otherwise
    # outlive this wrapper. TERM it here, after the trailer already recorded it.
    terminate_orphaned_children
  fi
  if [ "$PARSE_FAIL" = 1 ] && [ "$code" -eq 0 ]; then
    printf 'agent-run.sh: could not parse the %s result envelope from the output\n' "$AGENT" >&2
    code=1
  fi
  if [ "$IS_ERROR" = 1 ] && [ "$code" -eq 0 ]; then
    printf 'agent-run.sh: %s reported an error result envelope (is_error); treating the run as failed\n' "$AGENT" >&2
    code=1
  fi
  if [ -n "$OUT" ] && [ "$code" -eq 0 ] && ! [ -s "$OUT" ]; then
    printf 'agent-run.sh: run reported success but no answer landed in %s\n' "$OUT" >&2
    code=1
  fi
}

emit_result_trailers() {
  if [ -n "$OUT" ] && [ -s "$OUT" ]; then
    printf 'agent-run: answer: %s\n' "$OUT"
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
        printf 'agent-run: worktree: clean\n'
      fi
    fi
  fi
}

finalize_run() {
  normalize_backend_result
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
  select_safe_tmpdir
  assemble_prompt
  prepare_prompt_transport
  prepare_answer_paths
  acquire_worktree_lock
  check_dirty_work_start
  prepare_lock_probe
  prepare_consult_drift_check
  capture_work_baseline
  validate_launch_paths
  create_requested_branch
  build_backend_command
  initialize_backend_runtime
  emit_dispatch_header
  install_signal_traps
  run_backend
  finalize_run
}

# Keep the wrapper self-contained and sourceable: Bash parses these function
# bodies before `main` starts, so a work run that edits this file cannot corrupt
# the still-running wrapper by shifting unread top-level byte offsets.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

#!/bin/bash

# Shared helpers for agent hook adapters. Keep this file free of Claude- or
# Codex-specific control flow.

# BEGIN PORTING KNOBS — repo-specific shell defaults live together here.
# porting-knob: repo-root-fallback -- retarget the default checkout root
AI_REPO_ROOT_FALLBACK="/workspace"
# porting-knob: hook-state-paths -- retarget Musi-named state and result paths
AI_STATE_ROOT_PREFIX="/tmp/musi-ai-hooks"
AI_RESULT_COMMAND_TMP_PREFIX="${AI_RESULT_COMMAND_TMP_PREFIX:-/tmp/musi-commit-result}"
# Consumed by sourced hook bodies and cache.sh.
# shellcheck disable=SC2034
AI_BUN_RESULT_TMP_PREFIX="/tmp/musi-bun-result"
# Consumed by sourced hook bodies and cache.sh.
# shellcheck disable=SC2034
AI_POLICY_GUIDANCE_TMP_PREFIX="/tmp/musi-policy-guidance"
# Consumed by stop-policy.sh after common.sh is sourced.
# shellcheck disable=SC2034
AI_STOP_ASYNC_STATE_ROOT="${MUSI_VERIFY_ASYNC_STATE_ROOT:-/tmp/musi-verify-async}"
# Consumed by cache.sh after common.sh is sourced.
# shellcheck disable=SC2034
AI_STATE_SWEEP_STOP_GLOB_DEFAULT="$AI_STATE_ROOT_PREFIX.*/stop"
# porting-knob: environment-prefixes -- globally rename MUSI_* and AI_* when porting
# END PORTING KNOBS

ai_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || echo "$AI_REPO_ROOT_FALLBACK"
}

ai_read_payload() {
  cat 2>/dev/null || true
}

ai_payload_command() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true
}

# The invocation cwd the harness reports alongside the command. A session parked
# at /workspace but committing in a linked worktree via `cd <wt> && git commit`
# still reports /workspace here — the command's leading forms (below) resolve
# that shape; this is the fallback for a bare `git commit` run from the worktree.
ai_payload_cwd() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true
}

ai_payload_tool_use_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_use_id // empty' 2>/dev/null || true
}

ai_payload_session_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.session_id // .sessionId // empty' 2>/dev/null || true
}

# The finishing subagent's unique id on a SubagentStop payload (distinct from the
# parent session id). Empty when absent (e.g. a non-subagent caller).
ai_payload_agent_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.agent_id // .agentId // empty' 2>/dev/null || true
}

# Per-agent scope key for the SubagentStop Stop policy, mirroring
# ai_throttle_key's session+identity material. Folds in the subagent's agent_id
# and session id so a finishing subagent's one-shot Stop markers never collide
# with the main loop's repo-only key. Prints empty when the payload carries
# neither id; the stop-policy helpers then fall back to today's repo-only keying.
ai_subagent_stop_scope() {
  local payload="$1"
  local session_id agent_id scope=""

  session_id=$(ai_payload_session_id "$payload")
  agent_id=$(ai_payload_agent_id "$payload")

  [ -n "$session_id" ] && scope="session:${session_id}"
  if [ -n "$agent_id" ]; then
    [ -n "$scope" ] && scope="${scope}:"
    scope="${scope}agent:${agent_id}"
  fi

  printf '%s' "$scope"
}

ai_payload_file_path() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true
}

ai_payload_background() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null || true
}

# Strip one layer of surrounding single or double quotes from a token.
ai_unquote_token() {
  local token="$1"
  case "$token" in
    \'*\') token="${token#\'}"; token="${token%\'}" ;;
    \"*\") token="${token#\"}"; token="${token%\"}" ;;
  esac
  printf '%s' "$token"
}

# Find the first unquoted `commit` token in a simple command whose first token
# is `git`. This is deliberately only a lexer, not a shell parser: it recognizes
# quotes, backslash escapes, and command separators so a path such as
# `/tmp/commit-lane` cannot be mistaken for the commit subcommand. The two output
# variables receive all text before the token and the owning command segment.
ai_git_commit_prefixes() {
  local cmd="$1"
  local prefix_var="$2"
  local segment_var="$3"
  local char token="" quote=""
  local token_start=-1 segment_start=0 segment_first=1 segment_is_git=0
  local git_option_value=0 i length

  length=${#cmd}
  for ((i = 0; i <= length; i++)); do
    if [ "$i" -eq "$length" ]; then
      char=';'
    else
      char="${cmd:i:1}"
    fi

    if [ -n "$quote" ]; then
      if [ "$char" = "$quote" ]; then
        quote=""
      elif [[ "$quote" = '"' && "$char" = \\ && "$i" -lt $((length - 1)) ]]; then
        i=$((i + 1))
        token+="${cmd:i:1}"
      else
        token+="$char"
      fi
      continue
    fi

    case "$char" in
      \'|\")
        [ "$token_start" -ge 0 ] || token_start="$i"
        quote="$char"
        ;;
      \\)
        [ "$token_start" -ge 0 ] || token_start="$i"
        if [ "$i" -lt $((length - 1)) ]; then
          i=$((i + 1))
          token+="${cmd:i:1}"
        fi
        ;;
      [[:space:]]|';'|'|'|'&')
        if [ "$token_start" -ge 0 ]; then
          if [ "$segment_first" -eq 1 ]; then
            # Cheap wrappers and env assignments do not change WHICH program
            # runs, so stay in the "still looking for the command word" state
            # rather than concluding the segment is not git. This is exactly the
            # set ai_target_dir_from_cmd already normalizes below; without it,
            # `env git -C <dir> commit` yields no commit prefix, the
            # substitution scan then covers the whole command instead of the
            # text before the verb, and the named target is lost — which let a
            # commit aimed at a protected checkout be judged against the
            # session's branch.
            case "$token" in
              command|builtin|env) : ;;
              [A-Za-z_]*=*) : ;;
              *)
                [ "$token" = git ] && segment_is_git=1
                segment_first=0
                ;;
            esac
          elif [ "$segment_is_git" -eq 1 ]; then
            if [ "$git_option_value" -eq 1 ]; then
              git_option_value=0
            elif [ "$token" = -C ] || [ "$token" = -c ]; then
              git_option_value=1
            elif [ "$token" = commit ]; then
              printf -v "$prefix_var" '%s' "${cmd:0:token_start}"
              printf -v "$segment_var" '%s' \
                "${cmd:segment_start:token_start-segment_start}"
              return 0
            fi
          fi
          token=""
          token_start=-1
        fi
        case "$char" in
          ';'|'|'|'&')
            segment_start=$((i + 1))
            segment_first=1
            segment_is_git=0
            git_option_value=0
            ;;
        esac
        ;;
      *)
        [ "$token_start" -ge 0 ] || token_start="$i"
        token+="$char"
        ;;
    esac
  done

  return 1
}

# True only for a genuine `git commit` INVOCATION: the lexer above found a
# `commit` subcommand whose owning command segment starts with `git`. Text that
# merely contains the words — a grep pattern, a printf'd log line, a heredoc
# body, a quoted example inside a message — never matches.
#
# Deliberately narrower than policy.sh's ai_is_git_commit_cmd, and the two are
# NOT interchangeable, because the asymmetries run opposite ways:
#   * routing must over-match. Anything that might commit has to reach the
#     wrapper's worktree lock, commit queue, and branch policy; an extra wrap
#     costs a little latency, a missed commit forfeits every guard.
#   * a verdict must under-match. "No commit landed" is a claim about the
#     agent's own work, and a confident wrong one makes an agent in a parallel
#     lane redo or undo work that did land. Where this cannot prove a commit
#     was invoked, the caller says nothing instead.
ai_is_real_git_commit_cmd() {
  local cmd="$1"
  # Same heredoc-safe view the routing classifier uses, when the policy layer is
  # loaded: a heredoc body is data, not a command position. common.sh stays
  # standalone-sourceable, so fall back to the raw text when it is not.
  if declare -F ai_strip_noncommand_text >/dev/null; then
    cmd=$(ai_strip_noncommand_text "$cmd") || cmd="$1"
  fi
  # The lexer treats a newline as ordinary whitespace, which its target-resolution
  # callers want (a newline cannot introduce a `cd` chain they model). For a
  # yes/no verdict a newline IS a command separator, so normalize before lexing
  # or `cd /lane\ngit commit -m x` would not read as an invocation.
  # shellcheck disable=SC2034 # both are set by name via printf -v in the lexer
  local prefix segment
  ai_git_commit_prefixes "${cmd//$'\n'/; }" prefix segment
}

# The slice of CMD that target resolution actually reads: for a commit-bearing
# command everything before the `commit` verb (its leading cd chain and git
# global options), else the whole command. Mirrors ai_target_dir_from_cmd's own
# split so the ambiguity test below cannot drift from what the resolver parses.
ai_target_resolution_region() {
  # shellcheck disable=SC2034 # segment is set by name via printf -v in the lexer
  local prefix segment
  if ai_git_commit_prefixes "$1" prefix segment; then
    printf '%s' "$prefix"
  else
    printf '%s' "$1"
  fi
}

# True when the checkout a git command acts on CANNOT be read from its text: a
# command substitution, backtick, or process substitution sits inside the region
# the resolver parses, so a `cd`/`git -C` could be hiding in there and the
# payload-cwd fallback may name a different repository than the command touched.
# Callers that would otherwise state a before/after HEAD result must decline.
ai_target_dir_is_ambiguous() {
  # These are literal shell-syntax markers, not strings intended to expand.
  # shellcheck disable=SC2016
  case "$(ai_target_resolution_region "$1")" in
    *'$('*|*'`'*|*'<('*) return 0 ;;
  esac
  return 1
}

# True when a git command NAMES a target checkout — a leading cd chain or a
# global `git -C` — that does not resolve to a real checkout. The name is then
# unverifiable: `git -C "$LANE"` (this layer is a lexer, it cannot expand shell
# parameters), a `~` git will not expand, or a stale path.
#
# This is a guard hole, not just a reporting one. Callers resolve a work root as
# `git -C <target> rev-parse --show-toplevel || <their own checkout>`, so an
# unresolvable name silently substitutes the hook's own checkout: the HEAD
# comparison is then fabricated against the wrong repository, AND branch policy
# reads the wrong branch, so `LANE=/main-checkout; git -C "$LANE" commit` is
# judged against the session's feature branch and let through. Callers must fail
# closed rather than vouch for a checkout that was never identified.
ai_named_target_is_unresolvable() {
  local cmd="$1"
  local payload_cwd="$2"
  local fallback="$3"
  local candidate

  candidate=$(ai_target_dir_from_cmd "$cmd") || return 1
  [ -n "$candidate" ] || return 1
  case "$candidate" in
    /*) : ;;
    *) candidate="${payload_cwd:-$fallback}/$candidate" ;;
  esac
  git -C "$candidate" rev-parse --show-toplevel >/dev/null 2>&1 && return 1
  return 0
}

# The umbrella the verdict paths use: the checkout a command acts on cannot be
# pinned down at all, either because a substitution hides the leading forms or
# because the name they carry is unverifiable. Either way the observed root may
# be a different repository than the one the command touched, so no before/after
# HEAD claim — success OR failure — may be stated.
ai_target_is_unattributable() {
  ai_target_dir_is_ambiguous "$1" && return 0
  ai_named_target_is_unresolvable "$1" "$2" "$3"
}

# Extract the directory a git command targets from its *leading forms only* —
# not a general shell parser. Two shapes are recognized:
#   * a `git -C <dir>` global option (matched only in the segment before the
#     `commit` subcommand, so `git commit -C <commit-ish>` — reuse-message, a
#     commit not a directory — is never captured);
#   * a contiguous leading chain of `cd <dir> &&` / `cd <dir>;` commands. The
#     targets are applied in order, so the last absolute cd wins while relative
#     cds remain relative to the directory established before them.
# Returns non-zero for everything else — command substitution, subshells,
# process substitution, or compounds with non-cd commands in the leading chain
# — so the caller falls back to the payload cwd. Passing such compounds through
# unwrapped would forfeit the queue and policy layer, so they resolve to the cwd
# instead.
ai_target_dir_from_cmd() {
  local cmd="$1"
  local prefix commit_segment git_segment path_token_pattern env_assignment_pattern
  local remaining cd_target git_target
  local normalized_commit_segment
  local commit_bearing=0 resolved_cd=""

  path_token_pattern="('[^']*'|\"[^\"]*\"|[^[:space:];|&]+)"
  env_assignment_pattern='^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:];|&]+[[:space:]]+(.*)$'

  # Commit-bearing commands keep their stricter token-aware boundary: only the
  # owning segment BEFORE the commit subcommand may provide global `git -C`.
  # For other git commands, the full leading form remains available for the
  # generic cd / git-C resolution below.
  if ai_git_commit_prefixes "$cmd" prefix commit_segment; then
    commit_bearing=1
  else
    prefix="$cmd"
  fi

  # Decline when a substitution sits in the text this resolver actually reads,
  # because its expansion could be (or hide) the target directory. The check is
  # scoped to `prefix` — everything before the `commit` verb — so a substituted
  # MESSAGE body such as `-m "$(cat file)"`, which cannot change the checkout
  # git acts on, no longer forfeits resolution. Scanning the whole command
  # instead made `git -C <lane> commit -m "$(...)"` fall back to the payload
  # cwd: HEAD was then compared against the SESSION's checkout, producing a
  # confident, wrong "No commit landed" for a commit that had landed in the
  # lane, and letting a commit aimed at a protected lane read the session's
  # branch. Non-commit commands keep the whole-command scope (prefix == cmd).
  # These are literal shell-syntax markers, not strings intended to expand.
  # shellcheck disable=SC2016
  case "$prefix" in
    *'$('*|*'`'*|*'<('*) return 1 ;;
  esac

  # Only a contiguous leading cd chain is resolved. If another command appears
  # between cd and git, declining the shape is deliberate: inferring across an
  # arbitrary compound could key policy and locks to a checkout the shell never
  # reaches. Simple relative targets are composed in execution order.
  remaining="$prefix"
  while [[ "$remaining" =~ ^[[:space:]]*cd[[:space:]]+${path_token_pattern}[[:space:]]*(\&\&|\;)[[:space:]]*(.*)$ ]]; do
    cd_target=$(ai_unquote_token "${BASH_REMATCH[1]}")
    case "$cd_target" in
      /*) resolved_cd="$cd_target" ;;
      *)
        if [ -n "$resolved_cd" ]; then
          resolved_cd="${resolved_cd%/}/$cd_target"
        else
          resolved_cd="$cd_target"
        fi
        ;;
    esac
    remaining="${BASH_REMATCH[3]}"
  done

  git_segment="$remaining"
  [ "$commit_bearing" -eq 0 ] || git_segment="$commit_segment"

  # Recognize cheap wrappers that do not change Git's working directory. Keep
  # this intentionally narrow: it is target selection for the safety policy,
  # not a general shell parser. `env` support consumes only ordinary VAR=value
  # assignments; unfamiliar option shapes keep the safer resolved-cd fallback.
  while :; do
    if [[ "$git_segment" =~ ^[[:space:]]*(command|builtin)[[:space:]]+(.*)$ ]]; then
      git_segment="${BASH_REMATCH[2]}"
      continue
    fi
    if [[ "$git_segment" =~ ^[[:space:]]*env[[:space:]]+(.*)$ ]]; then
      git_segment="${BASH_REMATCH[1]}"
      while [[ "$git_segment" =~ $env_assignment_pattern ]]; do
        git_segment="${BASH_REMATCH[1]}"
      done
      continue
    fi
    # A leading `VAR=value` with no `env` in front runs the same program. The
    # commit lexer looks through these, so this must too: otherwise
    # `FOO=1 git -C <dir> commit` keeps its verb but loses its target, falls back
    # to the payload cwd, and the branch guard reads the wrong checkout.
    if [[ "$git_segment" =~ $env_assignment_pattern ]]; then
      git_segment="${BASH_REMATCH[1]}"
      continue
    fi
    break
  done

  # Prefix normalization can reveal a commit command that the original lexer
  # deliberately ignored because its first token was a wrapper. Reapply the
  # lexer so commit's `-C <commit-ish>` is never treated as a directory.
  if ai_git_commit_prefixes "$git_segment" prefix normalized_commit_segment; then
    git_segment="$normalized_commit_segment"
  fi

  # A global `git -C` wins over any preceding cd. Commit-bearing commands scan
  # only their protected pre-subcommand segment, so `git commit -C <commit-ish>`
  # can never be reinterpreted as a directory. Non-commit commands scan their
  # leading git command, which covers `git -C <dir> push` and similar forms.
  if [[ "$git_segment" =~ ^[[:space:]]*git[[:space:]] ]] \
    && [[ "$git_segment" =~ (^|[[:space:]])-C[[:space:]]+${path_token_pattern} ]]; then
    git_target=$(ai_unquote_token "${BASH_REMATCH[2]}")
    case "$git_target" in
      /*) printf '%s' "$git_target" ;;
      *)
        if [ -n "$resolved_cd" ]; then
          printf '%s/%s' "${resolved_cd%/}" "$git_target"
        else
          printf '%s' "$git_target"
        fi
        ;;
    esac
    return 0
  fi

  if [ -n "$resolved_cd" ] && [[ "$git_segment" =~ ^[[:space:]]*git[[:space:]] ]]; then
    printf '%s' "$resolved_cd"
    return 0
  fi

  # A known cd chain is the conservative target when a trivial wrapper was
  # present but its remaining shape was not understood well enough to prove a
  # bare Git invocation.
  if [ -n "$resolved_cd" ] \
    && [[ "$remaining" =~ ^[[:space:]]*(command|builtin|env)[[:space:]] ]]; then
    printf '%s' "$resolved_cd"
    return 0
  fi

  return 1
}

# Resolve the directory a git command will actually run in, for HEAD tracking,
# lock keying, and branch policy. Order: (a) a leading cd/`git -C` target read
# from the command, else (b) the payload cwd, else (c) the caller's fallback
# root (the hook-file-derived repo root). Emits a directory path; the caller is
# responsible for `git -C … rev-parse --show-toplevel` to get the work root and
# for falling back if that fails.
ai_resolve_target_dir() {
  local cmd="$1"
  local payload_cwd="$2"
  local fallback="$3"
  local candidate

  if candidate=$(ai_target_dir_from_cmd "$cmd") && [ -n "$candidate" ]; then
    case "$candidate" in
      /*) printf '%s' "$candidate" ;;
      *) printf '%s/%s' "${payload_cwd:-$fallback}" "$candidate" ;;
    esac
    return 0
  fi
  if [ -n "$payload_cwd" ]; then
    printf '%s' "$payload_cwd"
    return 0
  fi
  printf '%s' "$fallback"
}

# Current epoch seconds, overridable via AI_FAKE_NOW so throttle state machines
# stay deterministic under test.
ai_now() {
  printf '%s' "${AI_FAKE_NOW:-$(date +%s)}"
}

ai_emit_continue() {
  echo '{"continue":true}'
  exit 0
}

ai_emit_block() {
  jq -Rn --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

ai_emit_additional_context() {
  local event_name="$1"
  local message="$2"
  jq -n --arg event "$event_name" --arg msg "$message" \
    '{hookSpecificOutput:{hookEventName:$event,additionalContext:$msg}}'
  exit 0
}

ai_emit_deny() {
  jq -Rn --arg r "$1" '{decision:"deny", reason:$r}'
  exit 0
}

ai_claude_updated_command() {
  local command="$1"
  jq -n --arg command "$command" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { command: $command }
    }
  }'
  exit 0
}

ai_claude_result_command() {
  local message="$1"
  local prefix="${2:-$AI_RESULT_COMMAND_TMP_PREFIX}"
  local result_file quoted

  result_file=$(mktemp "$prefix.XXXXXX")
  printf '%s\n' "$message" > "$result_file"
  # Real shell escaping (printf %q), not bare double quotes: the rewritten
  # command is re-parsed by the shell when the tool runs, and double quotes
  # still expand $()/backticks and let an embedded " break out. Today's prefixes
  # are metachar-free, so this is defense-in-depth against a future caller.
  printf -v quoted '%q' "$result_file"
  ai_claude_updated_command "cat $quoted; rm -f $quoted"
}

ai_is_integer() {
  [[ "${1:-}" =~ ^-?[0-9]+$ ]]
}

ai_clamp_timeout_below_harness() {
  local label="$1"
  local requested="$2"
  local hook_timeout="$3"
  local margin="$4"
  local max_timeout

  max_timeout=$((hook_timeout - margin))
  if ai_is_integer "$requested" && [ "$requested" -gt "$max_timeout" ]; then
    printf '%s: clamped timeout from %ss to %ss to stay %ss below generated hook timeout %ss\n' \
      "$label" "$requested" "$max_timeout" "$margin" "$hook_timeout" >&2
    printf '%s\n' "$max_timeout"
    return 0
  fi

  printf '%s\n' "$requested"
}

ai_read_state_value() {
  local file="$1"
  local key="$2"

  [ -f "$file" ] || return 1
  while IFS='=' read -r k v; do
    if [ "$k" = "$key" ]; then
      printf '%s' "$v"
      return 0
    fi
  done < "$file"

  return 1
}

ai_limit_lines() {
  local text="$1"
  local max_lines="${2:-80}"
  local suffix="${3:-... truncated. Read the referenced log files for complete output.}"
  local line_count

  line_count=$(printf '%s\n' "$text" | wc -l)
  if [ "$line_count" -gt "$max_lines" ]; then
    printf '%s\n\n%s\n' "$(printf '%s\n' "$text" | head -n "$max_lines")" "${suffix/\{lines\}/$line_count}"
  else
    printf '%s' "$text"
  fi
}

# Normalize a vendor `tool_response` blob into {exit_code, stdout, stderr, raw}
# for bash-post-tool-use.sh, whose only use of exit_code is failure detection.
#
# Exactly two live entry paths reach the sole consumer, and only one of them has
# an in-repo producer:
#   - Codex execs bash-post-tool-use.sh directly (.codex/hooks/post-tool-use.sh)
#     and hands it a raw vendor `tool_response` — external, unversioned, and not
#     modelled anywhere in this repo.
#   - Copilot's payload is normalized first by ai_copilot_normalized_payload
#     (copilot-adapter.sh), the one dialect generated here and therefore the one
#     that can be named exactly: {stdout, exit_code}.
# Claude Code deliberately does not route through this aggregate at all; see the
# bash-post-tool-use.sh header and the notes.claude entries on
# hook/ai-codex-post-tool-use and hook/ai-copilot-post-tool-use in
# harness.controls.json.
#
# Every other spelling accepted below is unattributed defensive compatibility.
# Nothing in the tree records which external vendor emits which key, so do not
# attribute one — a comment that guesses would make deletion look safe. And do
# not retire an alias: scripts/ai-hooks/test.sh pins every accepted spelling, so
# test coverage is evidence about this normalizer, never about a producer. This
# is a boundary the repo does not own and the consumer is failure detection;
# dropping a spelling trades a documentation gap for a silent detection gap the
# moment a vendor reverts to an older shape.
#
# The exit-code list is grouped by shape rather than by vendor: six top-level
# spellings, the same six under metadata.*, then the two generic fallbacks last
# precisely because `status` and `code` are not exit-code-specific names.
ai_response_json_from_payload() {
  local payload="$1"
  printf '%s' "$payload" | jq -c '
    def to_text:
      if . == null then ""
      elif type == "string" then .
      else tostring
      end;
    def decode:
      if . == null then {}
      elif type == "object" then .
      elif type == "string" then (fromjson? // {"raw": .})
      else {"raw": tostring}
      end;
    def to_exit_code:
      if . == null then null
      elif type == "number" then .
      elif type == "string" and test("^-?[0-9]+$") then tonumber
      else null
      end;
    (.tool_response | decode) as $r
    | {
        exit_code: ([
          # Top-level spellings. Only the first has a known in-repo producer
          # (ai_copilot_normalized_payload); the rest are unattributed.
          $r.exit_code,
          $r.exitCode,
          $r.return_code,
          $r.returncode,
          $r.exit_status,
          $r.statusCode,
          # The same six, nested under metadata.
          $r.metadata.exit_code,
          $r.metadata.exitCode,
          $r.metadata.return_code,
          $r.metadata.returncode,
          $r.metadata.exit_status,
          $r.metadata.statusCode,
          # Generic fallbacks, last: these names are not exit-code-specific, so
          # any of the above wins over them.
          $r.status,
          $r.code
        ] | map(to_exit_code) | map(select(. != null)) | .[0] // null),
        # `stdout` is the Copilot-adapter spelling; `out`/`output` are unattributed.
        stdout: ($r.stdout // $r.out // $r.output // "" | to_text),
        stderr: ($r.stderr // $r.err // "" | to_text),
        raw: (
          if ($r | type) == "object"
             and ($r | has("stdout") or has("stderr") or has("out") or has("err") or has("output") or has("raw") or has("text") or has("exit_code") or has("exitCode") or has("return_code") or has("returncode") or has("exit_status") or has("statusCode") or has("metadata") or has("status") or has("code"))
          then ($r.raw // $r.text // "" | to_text)
          else ($r | to_text)
          end
        )
      }' 2>/dev/null || printf '{}'
}

ai_combined_response_text() {
  local response="$1"
  local stdout stderr raw combined

  stdout=$(printf '%s' "$response" | jq -r '.stdout // empty' 2>/dev/null || true)
  stderr=$(printf '%s' "$response" | jq -r '.stderr // empty' 2>/dev/null || true)
  raw=$(printf '%s' "$response" | jq -r '.raw // empty' 2>/dev/null || true)

  combined="$raw"
  if [ -n "$stdout" ] || [ -n "$stderr" ]; then
    combined="$stdout"
    if [ -n "$stderr" ]; then
      if [ -n "$combined" ]; then
        combined="${combined}"$'\n'"$stderr"
      else
        combined="$stderr"
      fi
    fi
  fi

  printf '%s' "$combined"
}

ai_bun_exit_code_from_output() {
  local script="$1"
  local output="$2"

  printf '%s\n' "$output" | awk -v script="$script" '
    index($0, "error: script \"" script "\" exited with code ") == 1 {
      print $NF
    }
    /Process exited with code [0-9]+/ {
      print $NF
    }
  ' | tail -n 1
}

ai_bun_output_has_error_footer() {
  local script="$1"
  local output="$2"

  printf '%s\n' "$output" | awk -v script="$script" '
    index($0, "error: script \"" script "\"") == 1 { found=1 }
    END { exit found ? 0 : 1 }
  '
}

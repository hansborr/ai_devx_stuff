#!/bin/bash

# Shared policy checks and verification command matching.
#
# Command matching is regex-based for accidental agent commands, not full shell
# parsing. It covers direct commands, one prefix level, common shell separators
# and reserved words, and command substitutions. Deliberately-unhandled
# residuals include ssh-wrapped commands and double-wrapped `bash -c` strings;
# do not re-flag those without changing the threat model.

AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY="Protected edit override marker .allow-protected-edits is repo-wide. Use it only for deliberate protected-file maintenance, and remove it immediately after that work is done."
AI_FLAKY_NOTE="Note: If this failure looks flaky (passes in isolation, fails under load), ensure you document it under docs/generated/observed_flaky_tests.md if you are unable to resolve it right now."

# Generated classifier slices (AI_GENERATED_WRAPPED_BUN_SCRIPTS /
# AI_GENERATED_BYPASS_BUN_SCRIPTS) for generator-contributed package scripts,
# rendered from harness.controls.json generatedSurface bunHook facets. Sourced
# relative to this file so every consumer (hooks, tests, other checkouts)
# resolves the sibling fragment without needing REPO_ROOT.
# shellcheck source=classified-bun-scripts.generated.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/classified-bun-scripts.generated.sh"

# Declarative hard-deny rule rows (AI_POLICY_RULE_IDS and the AI_POLICY_RULE_*
# maps), rendered from the harness.controls.json commandPolicy array. Resolved
# as a sibling of this file for the same reason as the fragment above.
#
# The fragment also owns the public AI_POLICY_* reason aliases used by the shell
# corpus. `ai_policy_decision` consumes the ordered rows directly, while
# generation derives .claude/settings.json permissions.deny from the rows that
# declare a native projection. `ai_policy_violation_reason` remains its legacy
# message/status projection.
# shellcheck disable=SC2034 # emitted by policy-eval.sh and asserted by the shell corpus
AI_POLICY_RULE_DATA_ERROR="Command policy rule data is unavailable or malformed. All Bash commands are denied until scripts/ai-hooks/policy-rules.generated.sh is restored and regenerated."
AI_POLICY_RULES_LOADED=0
AI_POLICY_RULES_COMPLETE=0
declare -ga AI_POLICY_RULE_IDS=()
AI_POLICY_RULES_FRAGMENT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/policy-rules.generated.sh"

# shellcheck source=policy-rules.generated.sh
if . "$AI_POLICY_RULES_FRAGMENT" \
  && [ "$AI_POLICY_RULES_COMPLETE" -gt 0 ] \
  && [ "$AI_POLICY_RULES_COMPLETE" -eq "${#AI_POLICY_RULE_IDS[@]}" ]; then
  # shellcheck disable=SC2034 # read by policy-eval.sh's rule loop
  AI_POLICY_RULES_LOADED=1
fi
unset AI_POLICY_RULES_COMPLETE AI_POLICY_RULES_FRAGMENT

# Bounded parser and evaluation modules, resolved as siblings of this file for
# the same reason as the fragment above. No module reads a dependency or does
# anything fallible at source time: they define functions, assign at most a
# literal constant, and end by setting a completion sentinel, so a module may
# be sourced before the constants and helpers its functions read at call time.
#
# Loading fails closed exactly like the rule fragment: this file is the deny
# gate on every agent Bash command, so a checkout that is missing a module must
# not keep scanning with a partial policy. Without this guard the vanished
# function is merely "command not found", the scan continues, and the gate
# degrades silently. A module that will not load therefore denies everything
# until it is restored.
# The guard itself is at the foot of this file, because it must override the
# evaluator entry point rather than be overridden by it.
#
# Completion is decided by a per-module sentinel rather than by `.`'s exit
# status, for the same reason the rule fragment is checked with
# AI_POLICY_RULES_COMPLETE: an empty or cleanly truncated module sources
# successfully, so exit status alone would report a load that never defined the
# functions the gate depends on. An empty policy-eval.sh would leave
# ai_policy_decision undefined, so the pre-hooks could not obtain the required
# fail-closed record; an empty command-paths.sh would silently stop finding the
# write paths the protected-file guard denies on. Every sentinel is reset before
# sourcing so a re-source cannot carry a previous load's success forward.
#
# It carries its own reason rather than reusing the rule-data one: an agent in
# this state has every Bash command denied, including the ones that would
# recover it, so the reason has to name the files that are actually missing.
AI_POLICY_MODULE_DATA_ERROR="Command policy modules are unavailable or malformed. All Bash commands are denied until scripts/ai-hooks/command-normalize.sh, scripts/ai-hooks/command-paths.sh, scripts/ai-hooks/git-classify.sh and scripts/ai-hooks/policy-eval.sh are restored."
AI_POLICY_MODULES_LOADED=0
AI_POLICY_MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_POLICY_MODULE_COMMAND_NORMALIZE_COMPLETE=0
AI_POLICY_MODULE_COMMAND_PATHS_COMPLETE=0
AI_POLICY_MODULE_GIT_CLASSIFY_COMPLETE=0
AI_POLICY_MODULE_POLICY_EVAL_COMPLETE=0

# `|| :` only keeps a failed source from tripping `set -e` in a sourcing hook.
# The exit status is deliberately not the completion test; the sentinels are.
# shellcheck source=command-normalize.sh
. "$AI_POLICY_MODULE_DIR/command-normalize.sh" || :

# shellcheck source=command-paths.sh
. "$AI_POLICY_MODULE_DIR/command-paths.sh" || :

# shellcheck source=git-classify.sh
. "$AI_POLICY_MODULE_DIR/git-classify.sh" || :

# shellcheck source=policy-eval.sh
. "$AI_POLICY_MODULE_DIR/policy-eval.sh" || :

if [ "$AI_POLICY_MODULE_COMMAND_NORMALIZE_COMPLETE" -eq 1 ] \
  && [ "$AI_POLICY_MODULE_COMMAND_PATHS_COMPLETE" -eq 1 ] \
  && [ "$AI_POLICY_MODULE_GIT_CLASSIFY_COMPLETE" -eq 1 ] \
  && [ "$AI_POLICY_MODULE_POLICY_EVAL_COMPLETE" -eq 1 ]; then
  AI_POLICY_MODULES_LOADED=1
fi

unset AI_POLICY_MODULE_DIR \
  AI_POLICY_MODULE_COMMAND_NORMALIZE_COMPLETE \
  AI_POLICY_MODULE_COMMAND_PATHS_COMPLETE \
  AI_POLICY_MODULE_GIT_CLASSIFY_COMPLETE \
  AI_POLICY_MODULE_POLICY_EVAL_COMPLETE

# porting-knob: wrapped-bun-scripts -- retarget the package scripts handled by hook wrappers
# Hand-maintained slice only: generator-contributed scripts render into
# AI_GENERATED_WRAPPED_BUN_SCRIPTS (appended below) and must not be re-added here.
AI_WRAPPED_BUN_SCRIPTS='
adr:check
audit:deps
audit:licenses
backlog:lint
build
check:eslint-react-peer-exception
check:fast-uri-override
code:intel
db:migration-safety
docs:local-eslint-rule-starter:check
docs:lint-coverage-map:audit
docs:lint-coverage-map:check
docs:lint-coverage-map:suggest
drift:ai
drift:triage
drift:e2e
e2e
eval:lint-messages
format
format:changed
format:changed:check
format:check
harness:audit
harness:check
harness:registration:check
lint
lint:agent:local-rules
lint:agent:local-rules:changed
lint:changed
lint:config-sensors
lint:fix
lint:import-cycles
lint:max-lines-exceptions
lint:max-lines-exceptions:install-merge-driver
lint:max-lines-exceptions:merge-driver:check
lint:probe-rule
lint:ratchet
lint:ratchet:check-baseline
lint:ratchet:check-debt-accounting
lint:ratchet:check-registry
lint:ratchet:debt-log
lint:ratchet:install-merge-driver
lint:ratchet:merge-driver:check
lint:ratchet:report
lint:ratchet:summary
lint:ratchet:trend
lint:shell
lint:suppressions
lint:suppressions:changed
lint:suppressions:ledger
lint:suppressions:ledger:changed
logs:audit
module:index:check
sensor:blob-size
sensor:knip
sensor:knip-unused-exports
sensor:knip-unused-exports:install-merge-driver
sensor:knip-unused-exports:merge-driver:check
sensor:near-duplicates
sensor:near-duplicates:install-merge-driver
sensor:near-duplicates:merge-driver:check
sensor:near-duplicates:benchmark
test
test:changed
test:client
test:client:isolated
test:client:split
test:coverage
test:eslint-rules
test:scripts
test:scripts:changed
test:scripts:file
test:server
test:shared
test:slow
typecheck
verify
verify:async:status
verify:async:stop
verify:async:tail
verify:changed
verify:history
verify:logs
verify:parallel
verify:slow
'

AI_WRAPPED_BUN_SCRIPTS="${AI_WRAPPED_BUN_SCRIPTS}
${AI_GENERATED_WRAPPED_BUN_SCRIPTS}"

ai_wrapped_bun_script_regex() {
  local script sep=""

  while IFS= read -r script; do
    [ -n "$script" ] || continue
    printf '%s%s' "$sep" "$script"
    sep='|'
  done <<EOF
$AI_WRAPPED_BUN_SCRIPTS
EOF
}

AI_WRAPPED_BUN_RE="^bun run ($(ai_wrapped_bun_script_regex))( --| [A-Za-z0-9._:/=-]+| --[A-Za-z0-9._=-]+)*$"
AI_POLICY_CMD_START='(^[[:space:]]*|[;&|][[:space:]]*|(^|[;&|])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=)?[$][(][[:space:]]*|(^|[;&|])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=)?`[[:space:]]*|(^|[;&|])[[:space:]]*(then|do|else|elif)[[:space:]]+|(^|[;&|])[[:space:]]*([{]|!)[[:space:]]+)'
AI_POLICY_CMD_END="($|[[:space:];|&'\"\`)])"
# The assignment list is OPTIONAL: `env git commit` runs git just as surely as
# `env FOO=1 git commit` does. Requiring at least one assignment meant a bare
# `env` prefix hid every guarded verb from these scanners, so `env git -C <main>
# commit` was never recognized as a commit and slipped past the protected-branch
# guard. ai_target_dir_from_cmd already models bare `env` the same way.
AI_POLICY_ENV_PREFIX='env[[:space:]]+([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*'
AI_POLICY_SHELL_PREFIX="(bash|sh)[[:space:]]+-[^[:space:]]*c[^[:space:]]*[[:space:]]+['\"]?"
AI_POLICY_TIMEOUT_PREFIX='timeout[[:space:]]+(((-s|--signal|-k|--kill-after)(=|[[:space:]]+)[^[:space:];&|]+|--(foreground|preserve-status|verbose)|-[v])[[:space:]]+)*[0-9]+([.][0-9]+)?[smhd]?[[:space:]]+'
AI_POLICY_COMMAND_PREFIX='command[[:space:]]+'
AI_POLICY_NICE_PREFIX='nice([[:space:]]+(-n[[:space:]]+|-)[0-9]+)?[[:space:]]+'
AI_POLICY_RUNNER_PREFIX="($AI_POLICY_TIMEOUT_PREFIX|$AI_POLICY_COMMAND_PREFIX|$AI_POLICY_NICE_PREFIX)+"
# Global git options that may legitimately sit between `git` and the verb: a
# value-taking option with its argument (`-c key=val`, `-C path`, `--git-dir
# path`, …) or any other single dash-led flag. Restricting pre-verb tokens to
# these keeps read-only subcommands that merely *name* a guarded verb from being
# mistaken for the verb itself; subcommands are bare words, never dash-led.
# Option arguments are a run of quoted spans, escaped characters, and bare
# characters, so whitespace carried by any quoting style ('a b', "a b", a\ b,
# or concatenations) cannot hide the verb from the matcher.
AI_POLICY_GIT_OPT_ARG="('[^']*'|\"[^\"]*\"|\\\\.|[^\\\\[:space:];&|])+"
AI_POLICY_GIT_GLOBAL_OPTS="((-[cC]|--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix))[[:space:]]+${AI_POLICY_GIT_OPT_ARG}[[:space:]]+|--[A-Za-z][A-Za-z0-9-]*=${AI_POLICY_GIT_OPT_ARG}[[:space:]]+|--[A-Za-z][^[:space:];&|]*[[:space:]]+|-[A-Za-z][^[:space:];&|]*[[:space:]]+)*"
AI_POLICY_GIT_PRECOMMIT_OPTS="$AI_POLICY_GIT_GLOBAL_OPTS"
# shellcheck disable=SC2034 # shared pattern vocabulary, read by the sourced modules
AI_POLICY_GIT_CMD="git[[:space:]]+${AI_POLICY_GIT_GLOBAL_OPTS}"

ai_policy_command_re() {
  local command_re="$1"
  local cmd_start="${2:-$AI_POLICY_CMD_START}"

  printf '%s(%s)?%s|%s%s(%s)?%s|%s%s(%s)?(%s)?%s' \
    "$cmd_start" "$AI_POLICY_RUNNER_PREFIX" "$command_re" \
    "$cmd_start" "$AI_POLICY_ENV_PREFIX" "$AI_POLICY_RUNNER_PREFIX" "$command_re" \
    "$cmd_start" "$AI_POLICY_SHELL_PREFIX" "$AI_POLICY_ENV_PREFIX" "$AI_POLICY_RUNNER_PREFIX" "$command_re"
}

ai_policy_has_command() {
  local cmd="$1"
  local command_re="$2"
  local cmd_start="${3:-$AI_POLICY_CMD_START}"

  grep -qE -- "$(ai_policy_command_re "$command_re" "$cmd_start")" <<< "$cmd"
}

ai_policy_has_husky_zero_prefix() {
  local cmd="$1"
  local env_assignment
  local env_option
  local env_option_value
  local git_commit_re
  local husky_prefix
  local split_string_husky_prefix

  env_assignment='[A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|]+'
  env_option_value='[^[:space:];&|]+'
  env_option="(-i|--ignore-environment|--null|--debug|--list-signal-handling|(-u|--unset|-C|--chdir|--argv0|-S|--split-string)[[:space:]]+${env_option_value}|--(unset|chdir|argv0|split-string)=${env_option_value}|--(block-signal|default-signal|ignore-signal)(=${env_option_value})?)"
  git_commit_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit$AI_POLICY_CMD_END"
  husky_prefix="((${env_assignment}[[:space:]]+)*HUSKY=0[[:space:]]+|env[[:space:]]+(${env_option}[[:space:]]+|${env_assignment}[[:space:]]+)*HUSKY=0[[:space:]]+)"
  split_string_husky_prefix="env[[:space:]]+(${env_option}[[:space:]]+)*(-S|--split-string)(=|[[:space:]]+)['\"]?HUSKY=0[[:space:]]+"
  ai_policy_has_command "$cmd" "(${husky_prefix}|${split_string_husky_prefix})[^;&|]*${git_commit_re}" && return 0
  ai_policy_has_command "$cmd" "export([^;&|]*[[:space:]])?HUSKY=0($|[[:space:];&|])" \
    && ai_policy_has_command "$cmd" "$git_commit_re"
}

ai_policy_has_git_commit_hook_bypass_flag() {
  local cmd="$1"
  local git_commit_re

  git_commit_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit"
  ai_policy_has_command "$cmd" "${git_commit_re}[^;&|]*[[:space:]]--no-verify$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "${git_commit_re}[^;&|]*[[:space:]]-[A-Za-z]*n[A-Za-z]*$AI_POLICY_CMD_END" && return 0
  return 1
}

ai_policy_has_git_push_hook_bypass_flag() {
  local cmd="$1"
  local git_push_re

  git_push_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}push"
  ai_policy_has_command "$cmd" "${git_push_re}[^;&|]*[[:space:]]--no-verify$AI_POLICY_CMD_END"
}

ai_policy_touches_allow_protected_edits_marker() {
  local cmd="$1"
  local marker_re='[^;&|]*\.allow-protected-edits'

  ai_policy_has_command "$cmd" "touch${marker_re}$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(:|true|printf|echo|cat)${marker_re}(>|>>)[^;&|]*$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(:|true|printf|echo|cat)[^;&|]*(>|>>)[^;&|]*\.allow-protected-edits$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "tee([[:space:]]+-[A-Za-z]+)*${marker_re}$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(install|cp|mv)${marker_re}$AI_POLICY_CMD_END" && return 0
  return 1
}

ai_policy_load_protected_files() {
  local policy_dir

  declare -F ai_protected_file_deny_entry >/dev/null && return 0

  policy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$policy_dir/protected-files.sh" ] || return 1
  # shellcheck source=/dev/null
  . "$policy_dir/protected-files.sh"
}

ai_policy_bash_protected_file_write_context() {
  local cmd="$1"
  local abs entry deny marker

  ai_policy_load_protected_files || return 1

  while IFS= read -r abs; do
    [ -n "$abs" ] || continue
    if entry=$(ai_protected_file_deny_entry "$abs"); then
      deny="${entry#*$'\t'}"
      marker=$(ai_protected_files_allow_marker_path)
      if ai_protected_files_allow_marker_enabled; then
        printf 'protected-files: Repo-wide protected edit override marker is active: %s. Without that marker, this Bash write would have been denied for %s. Remove the marker after this deliberate maintenance. %s' "$marker" "$abs" "$deny"
      else
        printf 'protected-files: %s' "$deny"
      fi
      return 0
    fi
  done < <(ai_policy_bash_write_candidate_paths "$cmd")

  return 1
}

ai_policy_bash_protected_file_violation_reason() {
  local cmd="$1"
  local __ai_policy_boundary_message_name="${3:-}"
  local context

  ai_policy_load_protected_files || return 1
  context=$(ai_policy_bash_protected_file_write_context "$cmd") || return 1
  ai_protected_files_allow_marker_enabled && return 1
  if [ -n "$__ai_policy_boundary_message_name" ]; then
    local -n __ai_policy_boundary_message_ref="$__ai_policy_boundary_message_name"
    __ai_policy_boundary_message_ref="$context"
  else
    printf '%s' "$context"
  fi
}

ai_policy_bash_protected_file_advisory() {
  local cmd="$1"
  local context

  ai_policy_load_protected_files || return 1
  ai_protected_files_allow_marker_enabled || return 1
  context=$(ai_policy_bash_protected_file_write_context "$cmd") || return 1
  printf '%s' "$context"
}

ai_policy_advisory_context() {
  local cmd="$1"
  local advisory stripped

  # Advisory scanners are policy guards too: ignore well-formed heredoc data,
  # but keep matching raw text if a terminator is missing.
  if stripped=$(ai_strip_noncommand_text "$cmd"); then
    cmd="$stripped"
  fi

  if ai_policy_touches_allow_protected_edits_marker "$cmd"; then
    printf '%s' "$AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY"
    return 0
  fi

  if advisory=$(ai_policy_bash_protected_file_advisory "$cmd"); then
    printf '%s' "$advisory"
    return 0
  fi

  return 1
}

ai_policy_has_gh_api_explicit_get() {
  ai_policy_has_command "$1" "gh[[:space:]]+api[^;&|]*[[:space:]]((--method(=|[[:space:]]+)|-X[[:space:]]*)[Gg][Ee][Tt])$AI_POLICY_CMD_END"
}

ai_policy_has_gh_api_visible_graphql_query() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "gh[[:space:]]+api[[:space:]]+graphql" || return 1
  grep -qE -- '(^|[[:space:]])(-f|-F|--field|--raw-field)[[:space:]]+query=['"'"'"]?(query|\{)' <<< "$cmd" || return 1
  ! grep -qiE -- 'mutation[[:space:]]*(\{|[[:alpha:]_])' <<< "$cmd"
}

ai_policy_has_gh_api_mutation() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]]((--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Oo][Ss][Tt]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Uu][Tt]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Aa][Tt][Cc][Hh]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Dd][Ee][Ll][Ee][Tt][Ee])$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]]--input($|[[:space:]=])" && return 0
  if ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]](-f|-F|--field|--raw-field)([[:space:]=]|$)"; then
    ai_policy_has_gh_api_explicit_get "$cmd" && return 1
    ai_policy_has_gh_api_visible_graphql_query "$cmd" && return 1
    return 0
  fi

  return 1
}

# Self-block guard for *executing* hooks. PreToolUse Bash hooks that run the
# command themselves (`bash -c "$CMD"`) must never run a policy-violating command:
# the executing hook's side effect lands regardless of what no-direct-db.sh or the
# harness deny globs decide in parallel (G1 — the amend rewrote HEAD even though
# the agent saw a "blocked" message). Call this *before* the lock/exec so a
# forbidden command is denied before any mutation.
# Requires ai_emit_block from common.sh (executing hooks already source it).
ai_preflight_or_block() {
  local cmd="$1"
  local work_root="${2:-}"
  local -A decision=()

  ai_policy_decision decision "$cmd" "$work_root"
  case "${decision[verdict]-}" in
    block) ai_emit_block "${decision[message]-}" ;;
    advise|allow) ;;
    *) ai_emit_block "$AI_POLICY_RULE_DATA_ERROR" ;;
  esac
  return 0
}

ai_has_force_verify_prefix() {
  [[ "$1" =~ ^FORCE_VERIFY=1[[:space:]]+ ]]
}

ai_strip_force_verify_prefix() {
  local cmd="$1"
  if ai_has_force_verify_prefix "$cmd"; then
    printf '%s' "${cmd#FORCE_VERIFY=1 }"
  else
    printf '%s' "$cmd"
  fi
}

ai_is_wrapped_bun_cmd() {
  [[ "$1" =~ $AI_WRAPPED_BUN_RE ]]
}

ai_bun_script_from_cmd() {
  printf '%s' "$1" | awk '{print $3}'
}

ai_bun_script_bypasses_cache() {
  case "$1" in
    code:intel|verify:logs|verify:async:status|verify:async:tail|verify:async:stop)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_bun_cmd_bypasses_cache() {
  ai_is_wrapped_bun_cmd "$1" || return 1
  ai_bun_script_bypasses_cache "$(ai_bun_script_from_cmd "$1")"
}

ai_bun_cmd_bypasses_lock() {
  ai_bun_cmd_bypasses_cache "$1"
}

ai_safe_script_name() {
  local script="$1"
  printf '%s' "${script//:/_}"
}

# Fingerprint of the argv tail after `bun run <script>`, used to scope the cache
# marker to the EXACT command (H1/H2). Without this the marker keys only on the
# script name, so `bun run test -- a` and `bun run test -- a b` share a marker
# and a broader (or corrected) command replays a narrower run's cached pass/fail
# on an unchanged worktree.
#
# Normalization rules (correctness over dedup cleverness — see backlog H1):
#   - Whitespace runs collapse to single spaces (tabs/newlines too).
#   - Options keep their exact order; option order is semantically meaningful
#     (`--bail --reporter=x` != `--reporter=x --bail`), so we never sort them.
#   - ONLY the file operands AFTER a `--` separator are sorted, because a `--`
#     tail is a safely-parsed file list where order does not change which tests
#     run. The `--` separator itself is preserved so a tail differs from a
#     same-token option run.
# The wrapped-bun whitelist restricts argv to `[A-Za-z0-9._:/=-]` tokens and
# `--`, so plain whitespace word-splitting here is safe (no quotes/globs).
ai_bun_argv_fingerprint() {
  local cmd="$1"
  local -a tokens=()
  local -a pre=()
  local -a post=()
  local tail seen_sep=0 tok normalized

  # Drop `bun run <script>`; keep the rest as the argv tail.
  read -r -a tokens <<< "$cmd"
  tail="${tokens[*]:3}"

  seen_sep=0
  for tok in $tail; do
    if [ "$seen_sep" -eq 0 ] && [ "$tok" = "--" ]; then
      seen_sep=1
      continue
    fi
    if [ "$seen_sep" -eq 1 ]; then
      post+=("$tok")
    else
      pre+=("$tok")
    fi
  done

  normalized="${pre[*]}"
  if [ "$seen_sep" -eq 1 ]; then
    # Sort only the post-`--` file operands; re-attach behind the separator.
    local sorted
    sorted=$(printf '%s\n' "${post[@]}" | LC_ALL=C sort | tr '\n' ' ')
    sorted="${sorted% }"
    normalized="${normalized:+$normalized }-- $sorted"
  fi

  printf '%s' "$normalized" | sha256sum | cut -c1-16
}

# Marker filename for a wrapped bun command: `last.<script_safe>.<argv_fp>`.
# Baking the argv fingerprint into the filename (rather than an in-marker field)
# keeps the schema simple and avoids cross-argv collisions. All three call sites
# — Claude bun-run-quiet.sh and the Codex pre/post hooks — derive the marker
# through this helper so they stay in lockstep.
ai_bun_marker_name() {
  local cmd="$1"
  local script script_safe argv_fp
  script=$(ai_bun_script_from_cmd "$cmd")
  script_safe=$(ai_safe_script_name "$script")
  argv_fp=$(ai_bun_argv_fingerprint "$cmd")
  printf 'last.%s.%s' "$script_safe" "$argv_fp"
}

ai_append_flaky_note() {
  local script="$1"
  local summary="$2"

  case "$script" in
    *test*|*e2e*)
      printf '%s\n\n%s' "$summary" "$AI_FLAKY_NOTE"
      ;;
    *)
      printf '%s' "$summary"
      ;;
  esac
}

# Fail-closed module guard, last in the file so it overrides the evaluator entry
# point instead of being overridden by it. See the module-source block above for
# why a partial module set must deny rather than degrade.
if [ "$AI_POLICY_MODULES_LOADED" -ne 1 ]; then
  # shellcheck disable=SC2034 # the nameref writes a caller-owned record consumed after return
  ai_policy_decision() {
    local __ai_policy_boundary_record_name="$1"
    local -n __ai_policy_boundary_record_ref="$__ai_policy_boundary_record_name"

    __ai_policy_boundary_record_ref=(
      [verdict]="block"
      [ruleId]="policy-module-data-error"
      [message]="$AI_POLICY_MODULE_DATA_ERROR"
    )
    return 0
  }

  ai_policy_violation_reason() {
    printf '%s' "$AI_POLICY_MODULE_DATA_ERROR"
    return 0
  }
fi

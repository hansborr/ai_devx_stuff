#!/bin/bash

# The command policy rule loop and its decision record.
#
# ai_policy_decision is the central boundary every command-policy consumer goes
# through. It fills a caller-owned associative array with exactly three fields:
# verdict (block|advise|allow), ruleId, and message. It walks the generated rule
# rows in manifest order, while ai_policy_rule_matches dispatches each row's
# matchers. Hard matches take precedence over earlier soft matches; otherwise
# the first soft match supplies advice. The boundary fails closed on damaged
# rule data, and policy.sh reasserts a block record at the foot of the facade
# when a module of this set will not load at all. ai_policy_violation_reason
# remains a compatibility projection for callers that still need its
# status/stdout API.
#
# Sourced by policy.sh, which supplies the rule maps, the pattern constants,
# and the predicates the matchers name.

ai_policy_rule_matches() {
  local rule_id="$1"
  local cmd="$2"
  local work_root="$3"
  local __ai_policy_boundary_message_name="${4:-}"
  local haystack="$cmd"
  local transform="${AI_POLICY_RULE_HAYSTACK_TRANSFORM[$rule_id]-}"
  local scope="${AI_POLICY_RULE_SCOPE[$rule_id]-}"
  local matchers="${AI_POLICY_RULE_MATCHERS[$rule_id]-}"
  local matcher_kind matcher_value matcher_extra pattern

  case "$scope" in
    command|checkout) ;;
    *)
      printf 'Malformed command policy scope for rule %s.\n' "$rule_id" >&2
      return 2
      ;;
  esac
  if [ -z "$matchers" ]; then
    printf 'Missing command policy matchers for rule %s.\n' "$rule_id" >&2
    return 2
  fi

  if [ -n "$transform" ]; then
    if ! declare -F "$transform" >/dev/null; then
      printf 'Command policy haystack transform %s for rule %s is unknown.\n' \
        "$transform" "$rule_id" >&2
      return 2
    fi
    if ! haystack=$("$transform" "$cmd"); then
      printf 'Command policy haystack transform %s for rule %s failed.\n' \
        "$transform" "$rule_id" >&2
      return 2
    fi
  fi

  while IFS=$'\t' read -r matcher_kind matcher_value matcher_extra; do
    if [ -n "$matcher_extra" ] || [ -z "$matcher_value" ]; then
      printf 'Malformed command policy matcher record for rule %s.\n' "$rule_id" >&2
      return 2
    fi
    case "$matcher_kind" in
      pattern)
        pattern="$matcher_value"
        case "$pattern" in
          '${AI_POLICY_GIT_CMD}'*)
            pattern="$AI_POLICY_GIT_CMD${pattern#'${AI_POLICY_GIT_CMD}'}"
            ;;
        esac
        case "$pattern" in
          *'$AI_POLICY_CMD_END')
            pattern="${pattern%'$AI_POLICY_CMD_END'}$AI_POLICY_CMD_END"
            ;;
        esac
        if ai_policy_has_command "$haystack" "$pattern"; then
          return 0
        fi
        ;;
      literal)
        if grep -qF -- "$matcher_value" <<< "$haystack"; then
          return 0
        fi
        ;;
      predicate)
        if ! declare -F "$matcher_value" >/dev/null; then
          printf 'Unknown command policy predicate %s for rule %s.\n' \
            "$matcher_value" "$rule_id" >&2
          return 2
        fi
        # Predicates receive an optional final message-out variable after their
        # scope arguments. Most predicates ignore it; predicate-owned-message
        # rows populate it so the hot-path rule call stays in this shell.
        if [ "$scope" = "checkout" ]; then
          if "$matcher_value" \
            "$haystack" "$work_root" "$__ai_policy_boundary_message_name"; then
            return 0
          fi
        elif "$matcher_value" "$haystack" "$__ai_policy_boundary_message_name"; then
          return 0
        fi
        ;;
      *)
        printf 'Unsupported command policy matcher kind %s for rule %s.\n' \
          "$matcher_kind" "$rule_id" >&2
        return 2
        ;;
    esac
  done <<< "$matchers"

  return 1
}

# shellcheck disable=SC2034 # the nameref writes a caller-owned record consumed after return
ai_policy_decision() {
  local __ai_policy_boundary_record_name="$1"
  local __ai_policy_boundary_cmd="$2"
  local __ai_policy_boundary_work_root="${3:-}"
  local __ai_policy_boundary_stripped __ai_policy_boundary_rule_id
  local __ai_policy_boundary_rule_class __ai_policy_boundary_rule_verdict
  local __ai_policy_boundary_matcher_message __ai_policy_boundary_generated_message
  local __ai_policy_boundary_matcher_status
  local -n __ai_policy_boundary_record_ref="$__ai_policy_boundary_record_name"

  __ai_policy_boundary_record_ref=([verdict]="allow" [ruleId]="" [message]="")

  if [ "$AI_POLICY_RULES_LOADED" -ne 1 ]; then
    __ai_policy_boundary_record_ref=(
      [verdict]="block"
      [ruleId]="policy-rule-data-error"
      [message]="$AI_POLICY_RULE_DATA_ERROR"
    )
    return 0
  fi

  # Central boundary for every hard policy scanner, including direct callers
  # such as bash-pre-tool-use.sh and no-direct-db.sh. A missing terminator keeps
  # CMD raw so malformed heredocs cannot hide a forbidden executable command.
  if __ai_policy_boundary_stripped=$(ai_strip_noncommand_text "$__ai_policy_boundary_cmd"); then
    __ai_policy_boundary_cmd="$__ai_policy_boundary_stripped"
  fi

  # Boundary semantics are deliberately hard-precedence: the first matching
  # soft row is retained as provisional advice, scanning continues, and the
  # first matching hard row blocks. This preserves the pre-record deny behavior
  # so an advisory row can never shadow a later safety rule. A predicate may own
  # its message; every other row is answered from the generated message map.
  for __ai_policy_boundary_rule_id in "${AI_POLICY_RULE_IDS[@]}"; do
    __ai_policy_boundary_rule_class="${AI_POLICY_RULE_CLASS[$__ai_policy_boundary_rule_id]-}"
    case "$__ai_policy_boundary_rule_class" in
      hard) __ai_policy_boundary_rule_verdict="block" ;;
      soft) __ai_policy_boundary_rule_verdict="advise" ;;
      *)
        __ai_policy_boundary_record_ref=(
          [verdict]="block"
          [ruleId]="policy-rule-data-error"
          [message]="$AI_POLICY_RULE_DATA_ERROR"
        )
        return 0
        ;;
    esac
    __ai_policy_boundary_matcher_message=""
    if ai_policy_rule_matches \
      "$__ai_policy_boundary_rule_id" \
      "$__ai_policy_boundary_cmd" \
      "$__ai_policy_boundary_work_root" \
      __ai_policy_boundary_matcher_message; then
      __ai_policy_boundary_generated_message="${AI_POLICY_RULE_MESSAGE[$__ai_policy_boundary_rule_id]-}"
      if [ "$__ai_policy_boundary_rule_verdict" = "block" ]; then
        __ai_policy_boundary_record_ref=(
          [verdict]="block"
          [ruleId]="$__ai_policy_boundary_rule_id"
          [message]="$__ai_policy_boundary_matcher_message$__ai_policy_boundary_generated_message"
        )
        return 0
      fi
      if [ "${__ai_policy_boundary_record_ref[verdict]-}" = "allow" ]; then
        __ai_policy_boundary_record_ref=(
          [verdict]="advise"
          [ruleId]="$__ai_policy_boundary_rule_id"
          [message]="$__ai_policy_boundary_matcher_message$__ai_policy_boundary_generated_message"
        )
      fi
    else
      __ai_policy_boundary_matcher_status=$?
      if [ "$__ai_policy_boundary_matcher_status" -ne 1 ]; then
        __ai_policy_boundary_record_ref=(
          [verdict]="block"
          [ruleId]="policy-rule-data-error"
          [message]="$AI_POLICY_RULE_DATA_ERROR"
        )
        return 0
      fi
    fi
  done

  return 0
}

ai_policy_violation_reason() {
  local cmd="$1"
  local work_root="${2:-}"
  local -A decision=()

  ai_policy_decision decision "$cmd" "$work_root"
  case "${decision[verdict]-}" in
    block|advise)
      printf '%s' "${decision[message]}"
      return 0
      ;;
    allow) return 1 ;;
    *)
      printf '%s' "$AI_POLICY_RULE_DATA_ERROR"
      return 0
      ;;
  esac
}

# Completion sentinel: policy.sh resets this before sourcing and fails closed
# unless this module reaches its final statement. An empty or truncated module
# still sources cleanly, so this is what proves the definitions above ran.
# shellcheck disable=SC2034 # read by policy.sh's module guard, which sources this file
declare -g AI_POLICY_MODULE_POLICY_EVAL_COMPLETE=1

# shellcheck shell=bash
# shellcheck disable=SC2034
# Static resolvers for manifest-backed verify slots.
#
# Contract:
#   musi_resolve_slot_cmd <consumer> <slot>
#
# On success, populates MUSI_RESOLVED_SLOT_CMD as a shell array and returns 0.
# If a dynamic resolver decides the slot should not run, it returns
# MUSI_VERIFY_SLOT_SKIP_RC. Consumers must source steps.generated.sh first so
# the base *_CMD arrays and metadata maps exist. This library never returns raw
# command strings and does not use eval.

MUSI_VERIFY_SLOT_SKIP_RC=100
MUSI_RESOLVED_SLOT_CMD=()

if ! declare -p MUSI_VERIFY_CONSUMERS >/dev/null 2>&1; then
  printf 'verify steps: generated consumer list is missing; source steps.generated.sh before steps-lib.sh\n' >&2
  return 2 2>/dev/null || exit 2
fi

musi_verify_has_pre_commit_consumer=0
for musi_verify_consumer in "${MUSI_VERIFY_CONSUMERS[@]}"; do
  if [ "$musi_verify_consumer" = "pre_commit" ]; then
    musi_verify_has_pre_commit_consumer=1
    break
  fi
done
if [ "$musi_verify_has_pre_commit_consumer" -ne 1 ]; then
  printf 'verify steps: generated consumer list must include pre_commit for hook-only dynamic resolvers\n' >&2
  return 2 2>/dev/null || exit 2
fi
unset musi_verify_consumer musi_verify_has_pre_commit_consumer

musi_resolve_base_slot_cmd() {
  local consumer="$1" slot="$2" key cmd_var

  key="$consumer:$slot"
  cmd_var="${MUSI_VERIFY_SLOT_CMD_VAR[$key]:-}"
  if [ -z "$cmd_var" ]; then
    printf 'verify steps: unknown slot %s for consumer %s\n' "$slot" "$consumer" >&2
    return 2
  fi
  if ! declare -p "$cmd_var" >/dev/null 2>&1; then
    printf 'verify steps: generated command array is missing: %s\n' "$cmd_var" >&2
    return 2
  fi

  local -n base_cmd="$cmd_var"
  MUSI_RESOLVED_SLOT_CMD=("${base_cmd[@]}")
}

musi_resolve_precommit_test_timing_cmd() {
  local consumer="$1" slot="$2"

  musi_resolve_base_slot_cmd "$consumer" "$slot" || return $?
  if [ "$consumer" = "pre_commit" ] && [ "${MUSI_CAPTURE_TEST_TIMINGS:-}" = "1" ]; then
    MUSI_RESOLVED_SLOT_CMD+=(
      "--reporter=json"
      "--outputFile.json=${TIMINGS_FILE:?scripts/verify/steps-lib.sh requires TIMINGS_FILE}"
    )
  fi
}

musi_resolve_staged_script_cmd() {
  local consumer="$1" slot="$2" classifier_rc=0

  if ! declare -F musi_classify_staged_script_input >/dev/null 2>&1; then
    printf 'verify steps: musi_classify_staged_script_input is not defined\n' >&2
    return 2
  fi

  musi_classify_staged_script_input || classifier_rc=$?
  # rc 2 means "classifier could not decide". The manual changed gate still
  # runs the base smoke because it can fall back to git diff, while pre-commit
  # skips this optional scripts slot to avoid blocking a commit on classifier
  # uncertainty.
  case "$classifier_rc" in
    0)
      musi_resolve_base_slot_cmd "$consumer" "$slot" || return $?
      MUSI_RESOLVED_SLOT_CMD=(
        env
        "MUSI_SCRIPTS_CHANGED_FILES=$MUSI_STAGED_SCRIPT_ALL"
        "MUSI_SCRIPTS_DELETED_FILES=$MUSI_STAGED_SCRIPT_DELETED"
        "${MUSI_RESOLVED_SLOT_CMD[@]}"
      )
      ;;
    1)
      musi_resolve_base_slot_cmd "$consumer" "$slot"
      ;;
    2)
      if [ "$consumer" = "pre_commit" ]; then
        MUSI_RESOLVED_SLOT_CMD=()
        return "$MUSI_VERIFY_SLOT_SKIP_RC"
      fi
      musi_resolve_base_slot_cmd "$consumer" "$slot"
      ;;
    *)
      printf 'verify steps: staged script classifier returned unexpected rc %s\n' \
        "$classifier_rc" >&2
      MUSI_RESOLVED_SLOT_CMD=()
      return 2
      ;;
  esac
}

musi_resolve_slot_cmd() {
  if [ "$#" -ne 2 ]; then
    printf 'usage: musi_resolve_slot_cmd <consumer> <slot>\n' >&2
    return 2
  fi

  local consumer="$1" slot="$2" key dynamic

  key="$consumer:$slot"
  dynamic="${MUSI_VERIFY_SLOT_DYNAMIC[$key]:-}"
  case "$dynamic" in
    "")
      musi_resolve_base_slot_cmd "$consumer" "$slot"
      ;;
    precommit-test-timings)
      musi_resolve_precommit_test_timing_cmd "$consumer" "$slot"
      ;;
    staged-script-classifier)
      musi_resolve_staged_script_cmd "$consumer" "$slot"
      ;;
    *)
      printf 'verify steps: unknown dynamic resolver %s for %s\n' "$dynamic" "$key" >&2
      return 2
      ;;
  esac
}

# shellcheck shell=bash
# Shared, host-aware memory reservations for gate slots and full direct tools.
#
# Measured peaks come from lint deep-dive note 73 (GB converted to decimal MB):
# ratchet 2.21, typecheck 1.83, scripts 2.47. Leaf 76 measured lint at 3,545,060
# KiB = 3,630.14 decimal MB, rounded up to a 3,700 MB reservation. Leaf 77
# measured the capped test slot at 3,115,396 KiB = 3,190.17 decimal MB, rounded
# up to a 3,200 MB reservation. The full-test wrapper translates validated CLI
# --maxWorkers into VITEST_MAX_WORKERS when native env is unset, producing an
# effective VITEST_MAX_WORKERS > CLI > NON_SERVER_TEST_MAX_WORKERS order even
# for non-server workspace projects. Root config consumes the synthetic native
# value before server resolution, preserving server 6. test:changed translates
# its ordinary/fallback phase, while its changed-client fast-lane cap is
# parent-visible and charged independently.
# When any effective value exceeds the measured default of 6 or is malformed,
# test admission charges the pre-cap 5,580 MB bound so an override cannot ride
# the smaller reservation. Every supported channel accepts at most the measured
# cap-8 candidate; higher CLI and fast-lane values are rejected before dispatch,
# while higher config env values are charged until config parsing rejects them.
# lint:changed classifies selected files through those same four sequential
# partitions, so a multi-package changed set cannot recreate the old monolith.
# Update these entries after a comparable cold process-tree RSS measurement.
# Slots not measured in that pass use a 256 MB accounting floor; the separate
# 1024 MB safety margin covers aggregate estimation error and non-gate activity.
#
# Reservations live outside a worktree and are serialized with flock, so gates
# in parallel worktrees cannot each assume the host's full available memory.
# Every admission uses the smaller of Linux MemAvailable and cgroup headroom.
# A reservation is charged only for the part of its expected peak not already
# reflected in live RSS: available + live-reserved-RSS - reserved peaks. This
# closes the simultaneous-launch race without double-counting a running slot.
# Gate launchers export the owning reservation path as
# MUSI_VERIFY_MEMORY_ADMISSION_TOKEN. Direct tool wrappers skip a second
# reservation only while that token still names the same live owner process.
# Scheduler cleanup is deliberately more conservative than nested skipping:
# a live legacy reservation without start identity, or one whose /proc identity
# is unreadable, stays charged; only a dead PID or readable identity mismatch
# is positive evidence that the reservation is stale.
# This is a cooperative point-in-time check, not a retained lease: a detached
# descendant that starts a nested tool in the narrow interval immediately
# before its owner releases can outlive the reservation. That teardown race is
# accepted to keep gate launch/release single-owner; normal nested tools remain
# children of the reserved command and cannot enter that interval. Set
# MUSI_TOOL_MEMORY_ADMISSION_BYPASS=1 only when intentionally bypassing direct
# tool-entry admission; it never changes verify/pre-commit gate admission.
# MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1 is a separate, explicit emergency
# opt-in that permits a zero-reservation launch below measured headroom.

MUSI_VERIFY_MEMORY_BUDGET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/test-worker-count.sh
. "$MUSI_VERIFY_MEMORY_BUDGET_DIR/../lib/test-worker-count.sh"

declare -gA MUSI_VERIFY_SLOT_EXPECTED_PEAK_MB=(
  [lint]=3700
  [suppressions]=256
  [ratchet]=2210
  [zero-baseline]=256
  [debt-accounting]=256
  [local-rule-starter]=256
  [adr]=256
  [knip-unused-exports]=256
  # C3 report-only fallback, 2026-07-20: retained fuzzy slot max 1,410,324 KiB
  # process-tree RSS at 25 ms; 1.20x decimal-MB headroom rounded to 50 MB.
  [near-duplicates]=1750
  [max-lines-exceptions]=256
  [coverage-map]=256
  [format-check]=256
  [typecheck]=1830
  [test]=3200
  [scripts]=2470
)

MUSI_VERIFY_MEMORY_DEFAULT_PEAK_MB=256
MUSI_VERIFY_MEMORY_DEFAULT_SAFETY_MB=1024
MUSI_VERIFY_TEST_UNCAPPED_PEAK_MB=5580
MUSI_VERIFY_MEMORY_RESERVATION_TOKEN=""
MUSI_VERIFY_MEMORY_SOLO_FALLBACK=0
# shellcheck disable=SC2034 # Read by gate and direct-tool launcher scripts.
MUSI_VERIFY_MEMORY_ADMITTED_COMMAND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/admitted-command.sh"

musi_verify_test_expected_peak_mb() {
  local effective_max_workers fast_lane_max_workers
  if [ -n "${VITEST_MAX_WORKERS+x}" ]; then
    effective_max_workers="$VITEST_MAX_WORKERS"
  elif [ -n "${MUSI_TEST_CLI_MAX_WORKERS+x}" ]; then
    effective_max_workers="$MUSI_TEST_CLI_MAX_WORKERS"
  elif [ -n "${NON_SERVER_TEST_MAX_WORKERS+x}" ]; then
    effective_max_workers="$NON_SERVER_TEST_MAX_WORKERS"
  else
    effective_max_workers="$MUSI_TEST_DEFAULT_MAX_WORKERS"
  fi
  if ! musi_test_positive_integer_lte \
    "$effective_max_workers" "$MUSI_TEST_DEFAULT_MAX_WORKERS"; then
    printf '%s\n' "$MUSI_VERIFY_TEST_UNCAPPED_PEAK_MB"
    return 0
  fi

  # test:changed converts this parent-visible value to VITEST_MAX_WORKERS for
  # its client phase. Native env precedence makes that conversion outrank CLI,
  # so admission must always reserve it independently.
  fast_lane_max_workers="${MUSI_CLIENT_FAST_LANE_MAX_WORKERS-$MUSI_TEST_CHANGED_CLIENT_DEFAULT_MAX_WORKERS}"
  if ! musi_test_positive_integer_lte \
    "$fast_lane_max_workers" "$MUSI_TEST_DEFAULT_MAX_WORKERS"; then
    printf '%s\n' "$MUSI_VERIFY_TEST_UNCAPPED_PEAK_MB"
    return 0
  fi
  printf '%s\n' "${MUSI_VERIFY_SLOT_EXPECTED_PEAK_MB[test]}"
}

musi_verify_slot_expected_peak_mb() {
  local slot="$1"
  if [ "$slot" = test ]; then
    musi_verify_test_expected_peak_mb
  else
    printf '%s\n' \
      "${MUSI_VERIFY_SLOT_EXPECTED_PEAK_MB[$slot]:-$MUSI_VERIFY_MEMORY_DEFAULT_PEAK_MB}"
  fi
}

musi_memory_cgroup_available_mb() {
  local max_file current_file max_bytes current_bytes cgroup_path
  local -a max_files=()
  if [ -n "${MUSI_VERIFY_CGROUP_MAX_FILE:-}" ]; then
    max_files+=("$MUSI_VERIFY_CGROUP_MAX_FILE")
  else
    cgroup_path="$(awk -F: '$1 == "0" { print $3; exit }' /proc/self/cgroup 2>/dev/null)"
    [ -z "$cgroup_path" ] \
      || max_files+=("/sys/fs/cgroup/${cgroup_path#/}/memory.max")
    max_files+=(/sys/fs/cgroup/memory.max)
    cgroup_path="$(awk -F: '$2 ~ /(^|,)memory(,|$)/ { print $3; exit }' /proc/self/cgroup 2>/dev/null)"
    [ -z "$cgroup_path" ] \
      || max_files+=("/sys/fs/cgroup/memory/${cgroup_path#/}/memory.limit_in_bytes")
    max_files+=(/sys/fs/cgroup/memory/memory.limit_in_bytes)
  fi

  for max_file in "${max_files[@]}"; do
    [ -r "$max_file" ] || continue
    if [ -n "${MUSI_VERIFY_CGROUP_CURRENT_FILE:-}" ]; then
      current_file="$MUSI_VERIFY_CGROUP_CURRENT_FILE"
    else
      case "$max_file" in
        */memory.max) current_file="${max_file%/*}/memory.current" ;;
        *) current_file="${max_file%/*}/memory.usage_in_bytes" ;;
      esac
    fi
    [ -r "$current_file" ] || continue
    read -r max_bytes < "$max_file" || continue
    read -r current_bytes < "$current_file" || continue
    case "$max_bytes:$current_bytes" in
      max:* | *[!0-9:]* | :*) continue ;;
    esac
    # Some cgroup-v1 hosts expose an effectively-unlimited sentinel. Ignore it
    # in favor of MemAvailable rather than returning a meaningless huge value.
    [ "$max_bytes" -lt 9000000000000000000 ] || continue
    if [ "$max_bytes" -le "$current_bytes" ]; then
      printf '0\n'
    else
      printf '%s\n' "$(( (max_bytes - current_bytes) / 1000000 ))"
    fi
    return 0
  done
  return 1
}

musi_memory_host_available_mb() {
  local available_kb
  available_kb="$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo 2>/dev/null)"
  case "$available_kb" in
    '' | *[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$((available_kb * 1024 / 1000000))"
}

musi_memory_available_mb() {
  local result_var="${1:-}" host_mb="" cgroup_mb="" available_mb measured=1
  if [ -n "${MUSI_VERIFY_MEMORY_AVAILABLE_MB:-}" ]; then
    available_mb="$MUSI_VERIFY_MEMORY_AVAILABLE_MB"
  else
    if [ "${MUSI_VERIFY_MEMORY_FORCE_UNSUPPORTED:-0}" != 1 ]; then
      host_mb="$(musi_memory_host_available_mb 2>/dev/null || true)"
      cgroup_mb="$(musi_memory_cgroup_available_mb 2>/dev/null || true)"
    fi
    if [ -n "$host_mb" ] && { [ -z "$cgroup_mb" ] || [ "$host_mb" -le "$cgroup_mb" ]; }; then
      available_mb="$host_mb"
    elif [ -n "$cgroup_mb" ]; then
      available_mb="$cgroup_mb"
    else
      # Fail closed on unsupported hosts with a synthetic accounting floor.
      available_mb="$((MUSI_VERIFY_MEMORY_DEFAULT_PEAK_MB + MUSI_VERIFY_MEMORY_DEFAULT_SAFETY_MB))"
      measured=0
    fi
  fi
  MUSI_VERIFY_MEMORY_AVAILABLE_IS_MEASURED="$measured"
  if [ -n "$result_var" ]; then
    printf -v "$result_var" '%s' "$available_mb"
  else
    printf '%s\n' "$available_mb"
  fi
}

musi_memory_budget_state_root() {
  printf '%s\n' \
    "${MUSI_VERIFY_MEMORY_STATE_ROOT:-${TMPDIR:-/tmp}/musi-verify-memory-budget-${UID:-user}}"
}

musi_memory_budget_release() {
  local token="${1:-}"
  [ -n "$token" ] || return 0
  rm -f -- "$token"
}

musi_memory_process_start_time() {
  local pid="$1" stat_line remainder start_time
  local stat_file="${MUSI_VERIFY_PROC_ROOT:-/proc}/$pid/stat"
  local -a stat_fields=()

  case "$pid" in
    '' | *[!0-9]*) return 1 ;;
  esac
  IFS= read -r stat_line < "$stat_file" 2>/dev/null || return 1
  remainder="${stat_line##*) }"
  [ "$remainder" != "$stat_line" ] || return 1
  read -r -a stat_fields <<< "$remainder"
  [ "${#stat_fields[@]}" -ge 20 ] || return 1
  start_time="${stat_fields[19]}"
  case "$start_time" in
    '' | *[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$start_time"
}

musi_memory_budget_reservation_is_live() {
  local token="${1:-}" owner_pid recorded_start_time live_start_time
  [ -n "$token" ] && [ -f "$token" ] || return 1
  owner_pid="$(sed -n 's/^pid=//p' "$token" 2>/dev/null | head -n 1)"
  recorded_start_time="$(sed -n 's/^pid_start_time=//p' "$token" 2>/dev/null | head -n 1)"
  case "$owner_pid:$recorded_start_time" in
    *[!0-9:]* | :* | *:) return 1 ;;
  esac
  live_start_time="$(musi_memory_process_start_time "$owner_pid")" || return 1
  [ "$live_start_time" = "$recorded_start_time" ] \
    && kill -0 "$owner_pid" 2>/dev/null
}

# Positive oom_score_adj values make admitted tools preferable kernel-OOM
# victims over the container supervisor. The adjustment is inherited by child
# processes. Linux may reject the write (or /proc may not exist), so this is
# deliberately best-effort and silent. The file override is for smoke tests.
musi_memory_raise_oom_score() {
  local target="${MUSI_VERIFY_OOM_SCORE_ADJ:-500}"
  local score_file="${MUSI_VERIFY_OOM_SCORE_ADJ_FILE:-/proc/self/oom_score_adj}"
  local current

  case "$target" in
    '' | *[!0-9]*) return 0 ;;
  esac
  [ "$target" -le 1000 ] || return 0
  [ -r "$score_file" ] && [ -w "$score_file" ] || return 0
  read -r current < "$score_file" 2>/dev/null || return 0
  case "${current#-}" in
    '' | *[!0-9]*) return 0 ;;
  esac
  [ "$current" -lt "$target" ] || return 0
  printf '%s\n' "$target" > "$score_file" 2>/dev/null || true
}

musi_memory_process_tree_rss_mb() {
  local root_pid="$1"
  ps -eo pid=,ppid=,rss= 2>/dev/null | awk -v root="$root_pid" '
    { parent[$1] = $2; rss[$1] = $3 }
    END {
      selected[root] = 1
      changed = 1
      while (changed) {
        changed = 0
        for (pid in parent) {
          if (!selected[pid] && selected[parent[pid]]) {
            selected[pid] = 1
            changed = 1
          }
        }
      }
      total = 0
      for (pid in selected) total += rss[pid]
      printf "%d\n", total * 1024 / 1000000
    }
  '
}

musi_memory_budget_attach_pid() {
  local token="$1" step_pid="$2" state_root lock_fd
  [ -n "$token" ] && [ -e "$token" ] || return 0
  case "$step_pid" in
    '' | *[!0-9]*) return 2 ;;
  esac
  state_root="${token%/*}"
  exec {lock_fd}>"$state_root/lock" || return 2
  flock "$lock_fd" || { exec {lock_fd}>&-; return 2; }
  if [ -e "$token" ]; then
    printf 'step_pid=%s\n' "$step_pid" >> "$token"
  fi
  flock -u "$lock_fd"
  exec {lock_fd}>&-
}

musi_memory_budget_try_reserve() {
  local slot="$1" state_root lock_fd reservation pid pid_start_time live_start_time
  local step_pid mb rss_mb owner_pid owner_start_time
  local reserved=0 live_reserved_rss=0 reservation_count=0
  local available safety expected token headroom availability_measured
  MUSI_VERIFY_MEMORY_RESERVATION_TOKEN=""
  MUSI_VERIFY_MEMORY_SOLO_FALLBACK=0
  MUSI_VERIFY_MEMORY_DECISION_AVAILABLE_MB=""
  MUSI_VERIFY_MEMORY_DECISION_AVAILABILITY_MEASURED=""
  MUSI_VERIFY_MEMORY_DECISION_SAFETY_MB=""
  MUSI_VERIFY_MEMORY_DECISION_HEADROOM_MB=""
  owner_pid="$BASHPID"
  owner_start_time="$(musi_memory_process_start_time "$owner_pid")" || return 2
  state_root="$(musi_memory_budget_state_root)"
  mkdir -p "$state_root" || return 2
  exec {lock_fd}>"$state_root/lock" || return 2
  flock "$lock_fd" || {
    exec {lock_fd}>&-
    return 2
  }

  for reservation in "$state_root"/reservation.*; do
    [ -e "$reservation" ] || continue
    pid="$(sed -n 's/^pid=//p' "$reservation" 2>/dev/null | head -n 1)"
    pid_start_time="$(sed -n 's/^pid_start_time=//p' "$reservation" 2>/dev/null | head -n 1)"
    mb="$(sed -n 's/^mb=//p' "$reservation" 2>/dev/null | head -n 1)"
    case "$pid:$mb" in
      *[!0-9:]* | :* | *:) rm -f -- "$reservation"; continue ;;
    esac
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f -- "$reservation"
      continue
    fi
    case "$pid_start_time" in
      '' | *[!0-9]*) ;;
      *)
        live_start_time="$(musi_memory_process_start_time "$pid" 2>/dev/null || true)"
        if [ -n "$live_start_time" ] && [ "$live_start_time" != "$pid_start_time" ]; then
          rm -f -- "$reservation"
          continue
        fi
        ;;
    esac
    reservation_count=$((reservation_count + 1))
    reserved=$((reserved + mb))
    if [ -z "${MUSI_VERIFY_MEMORY_LIVE_RESERVED_RSS_MB:-}" ]; then
      step_pid="$(sed -n 's/^step_pid=//p' "$reservation" 2>/dev/null | tail -n 1)"
      case "$step_pid" in
        '' | *[!0-9]*) rss_mb=0 ;;
        *) rss_mb="$(musi_memory_process_tree_rss_mb "$step_pid")" ;;
      esac
      [ "$rss_mb" -le "$mb" ] || rss_mb="$mb"
      live_reserved_rss=$((live_reserved_rss + rss_mb))
    fi
  done

  if [ -n "${MUSI_VERIFY_MEMORY_LIVE_RESERVED_RSS_MB:-}" ]; then
    live_reserved_rss="$MUSI_VERIFY_MEMORY_LIVE_RESERVED_RSS_MB"
  fi

  musi_memory_available_mb available
  availability_measured="${MUSI_VERIFY_MEMORY_AVAILABLE_IS_MEASURED:-0}"
  safety="${MUSI_VERIFY_MEMORY_SAFETY_MB:-$MUSI_VERIFY_MEMORY_DEFAULT_SAFETY_MB}"
  expected="$(musi_verify_slot_expected_peak_mb "$slot")"
  case "$available:$safety:$expected:$live_reserved_rss" in
    *[!0-9:]* | :* | *::* | *:) flock -u "$lock_fd"; exec {lock_fd}>&-; return 2 ;;
  esac
  case "$availability_measured" in
    0 | 1) ;;
    *) flock -u "$lock_fd"; exec {lock_fd}>&-; return 2 ;;
  esac
  headroom=$((available + live_reserved_rss - safety - reserved))
  MUSI_VERIFY_MEMORY_DECISION_AVAILABLE_MB="$available"
  MUSI_VERIFY_MEMORY_DECISION_AVAILABILITY_MEASURED="$availability_measured"
  MUSI_VERIFY_MEMORY_DECISION_SAFETY_MB="$safety"
  MUSI_VERIFY_MEMORY_DECISION_HEADROOM_MB="$headroom"
  if [ "$expected" -gt "$headroom" ]; then
    if [ "$reservation_count" -eq 0 ] \
      && [ "${MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK:-0}" = 1 ]; then
      MUSI_VERIFY_MEMORY_SOLO_FALLBACK=1
    else
      flock -u "$lock_fd"
      exec {lock_fd}>&-
      MUSI_VERIFY_MEMORY_RESERVATION_TOKEN=""
      return 1
    fi
  fi

  token="$(mktemp "$state_root/reservation.${owner_pid}.${slot}.XXXXXX")" || {
    flock -u "$lock_fd"
    exec {lock_fd}>&-
    return 2
  }
  {
    printf 'pid=%s\n' "$owner_pid"
    printf 'pid_start_time=%s\n' "$owner_start_time"
    printf 'mb=%s\n' "$expected"
    printf 'slot=%s\n' "$slot"
  } > "$token"
  # shellcheck disable=SC2034 # Read by the shared parallel/sequential launchers.
  MUSI_VERIFY_MEMORY_RESERVATION_TOKEN="$token"
  flock -u "$lock_fd"
  exec {lock_fd}>&-
}

musi_memory_budget_report_solo_fallback() {
  local label="$1" slot="$2"
  [ "${MUSI_VERIFY_MEMORY_SOLO_FALLBACK:-0}" = 1 ] || return 0
  printf '%s: memory budget cannot fit %s at its %s MB expected peak with zero live reservations; admitting it alone (available=%s MB safety=%s MB)\n' \
    "$label" "$slot" "$(musi_verify_slot_expected_peak_mb "$slot")" \
    "${MUSI_VERIFY_MEMORY_DECISION_AVAILABLE_MB:-unknown}" \
    "${MUSI_VERIFY_MEMORY_DECISION_SAFETY_MB:-unknown}" >&2
}

musi_memory_budget_poll_seconds() {
  local requested="${MUSI_VERIFY_MEMORY_POLL_SECONDS:-1}"
  case "$requested" in
    0.[0-9]*) printf '%s\n' "$requested" ;;
    '' | *[!0-9]*) printf '1\n' ;;
    *)
      if [ "$requested" -gt 1 ]; then
        printf '1\n'
      else
        printf '%s\n' "$requested"
      fi
      ;;
  esac
}

musi_memory_budget_wait_and_reserve() {
  local slot="$1" label="$2" announced=0 reserve_rc start now timeout
  start="$SECONDS"
  timeout="${MUSI_VERIFY_MEMORY_WAIT_TIMEOUT:-120}"
  case "$timeout" in
    '' | *[!0-9]*)
      printf '%s: invalid MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=%s; expected whole seconds\n' \
        "$label" "$timeout" >&2
      return 2
      ;;
  esac
  while true; do
    reserve_rc=0
    musi_memory_budget_try_reserve "$slot" || reserve_rc=$?
    if [ "$reserve_rc" -eq 0 ]; then
      musi_memory_budget_report_solo_fallback "$label" "$slot"
      return 0
    fi
    [ "$reserve_rc" -eq 1 ] || return "$reserve_rc"
    if [ "$announced" -eq 0 ]; then
      printf '%s: deferring %s until memory budget is available (expected peak %s MB)\n' \
        "$label" "$slot" "$(musi_verify_slot_expected_peak_mb "$slot")" >&2
      announced=1
    fi
    now="$SECONDS"
    if [ "$((now - start))" -ge "$timeout" ]; then
      if [ "${MUSI_VERIFY_MEMORY_DECISION_AVAILABILITY_MEASURED:-0}" = 1 ]; then
        printf '%s: memory wait timed out after %ss for %s: needs %s MB, but measured available memory is %s MB (safety reserve %s MB; admission headroom %s MB); no slot was launched; free memory and retry\n' \
          "$label" "$timeout" "$slot" "$(musi_verify_slot_expected_peak_mb "$slot")" \
          "${MUSI_VERIFY_MEMORY_DECISION_AVAILABLE_MB:-unknown}" \
          "${MUSI_VERIFY_MEMORY_DECISION_SAFETY_MB:-unknown}" \
          "${MUSI_VERIFY_MEMORY_DECISION_HEADROOM_MB:-unknown}" >&2
      else
        printf '%s: memory wait timed out after %ss for %s: needs %s MB, but memory availability discovery is unsupported; no slot was launched; provide readable Linux MemAvailable or cgroup memory accounting, or set MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1 to explicitly allow a zero-reservation solo launch\n' \
          "$label" "$timeout" "$slot" "$(musi_verify_slot_expected_peak_mb "$slot")" >&2
      fi
      return 3
    fi
    sleep "$(musi_memory_budget_poll_seconds)"
  done
}

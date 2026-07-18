#!/usr/bin/env bash
# Bounded wait helper for agent-run.sh dispatches: one foreground call that
# watches a run's log (and answer file) until the run is decided, then exits
# with a semantic code and a status-only report. Callers stop hand-rolling
# the completion-trailer grep — whose bare-`^agent-run:` anchoring is a known
# footgun (the dispatch header matches it at launch) — and never tail the
# delegate's log into their own context: on success this prints only the
# `agent-run:` summary trailers, never log body.
#
# Usage: agent-wait.sh <log-file> [--answer <path>] [--finalized-only] [--timeout <sec>] [--interval <sec>]
#
#   <log-file>   the log the dispatch redirected into (`> log 2>&1`)
#   --answer     answer file (-o) to watch; defaults to the path recorded in
#                the log's `agent-run: dispatched: ... answer <path>` header
#   --finalized-only
#                ignore the answer file; exit 0 only on completion trailers.
#                Use for `work` runs when you will act on the worktree next:
#                answer-landed means the backend finished, but the wrapper may
#                still be running its drift check / lock release for a moment.
#   --timeout    max seconds to wait before reporting still-running
#                (default 570 — one call fits Claude Code's 10-minute
#                foreground Bash cap; codex callers run this through an
#                exec_command session and poll it with empty write_stdin).
#                `--timeout 0` is a one-shot probe: check once, report, exit —
#                the cheapest way to classify a suspected dead run.
#   --interval   seconds between checks (default 15)
#
# Exit codes:
#   0   run decided — completion trailers present (`agent-run: worktree:` /
#       `backend-exit:`), or the answer file is non-empty ("answer-landed":
#       trailers may lag by a moment; see --finalized-only). Prints an
#       `agent-wait:` status line, then the summary trailers.
#   10  still running when --timeout elapsed. Re-invoke to keep waiting.
#   20  dead run — dispatch header present, wrapper pid dead, no completion
#       trailers, backend gone too. Recover per SKILL.md "Dead-run signature".
#   21  dead run whose backend pid is still alive: an orphan that may still
#       be writing (a work orphan also still holds the worktree lock) — kill
#       its process group before taking the worktree over.
#   2   usage error.

set -euo pipefail

usage() {
  printf 'Usage: agent-wait.sh <log-file> [--answer <path>] [--finalized-only] [--timeout <sec>] [--interval <sec>]\n' >&2
  exit 2
}

LOG=''
ANSWER=''
FINALIZED_ONLY=0
TIMEOUT=570
INTERVAL=15

while [ $# -gt 0 ]; do
  case "$1" in
    --answer)
      [ $# -ge 2 ] || usage
      ANSWER="$2"
      shift 2
      ;;
    --finalized-only)
      FINALIZED_ONLY=1
      shift
      ;;
    --timeout)
      [ $# -ge 2 ] || usage
      TIMEOUT="$2"
      shift 2
      ;;
    --interval)
      [ $# -ge 2 ] || usage
      INTERVAL="$2"
      shift 2
      ;;
    -*)
      usage
      ;;
    *)
      [ -z "$LOG" ] || usage
      LOG="$1"
      shift
      ;;
  esac
done

[ -n "$LOG" ] || usage
[ -r "$LOG" ] || { printf 'agent-wait: log not readable: %s\n' "$LOG" >&2; exit 2; }
case "$TIMEOUT" in '' | *[!0-9]*) usage ;; esac
case "$INTERVAL" in '' | *[!0-9]* | 0) usage ;; esac

# The decided/summary greps mirror the waiter contract documented in SKILL.md:
# completion is `worktree:`/`backend-exit:`, never the bare header.
print_summary() {
  grep -E '^agent-run: (branch|backend-pid|backend-exit|session-id|answer|head|worktree):' "$LOG" || true
}

log_field() { # <sed-pattern> — first match wins
  sed -n "s/$1/\\1/p" "$LOG" | head -n 1
}

# Prints the decided status + summary and returns 0 when the run is decided
# (completion trailers, or a landed answer unless --finalized-only); else 1.
decided() {
  if grep -qE '^agent-run: (worktree|backend-exit):' "$LOG"; then
    printf 'agent-wait: finalized\n'
    print_summary
    return 0
  fi

  if [ "$FINALIZED_ONLY" -eq 0 ]; then
    if [ -z "$ANSWER" ]; then
      ANSWER="$(log_field '^agent-run: dispatched: .* answer \(.*\)$')"
    fi
    if [ -n "$ANSWER" ] && [ -s "$ANSWER" ]; then
      printf 'agent-wait: answer-landed answer=%s\n' "$ANSWER"
      print_summary
      return 0
    fi
  fi

  return 1
}

SECONDS=0
while :; do
  if decided; then exit 0; fi

  WRAPPER_PID="$(log_field '^agent-run: dispatched: .* wrapper-pid \([0-9][0-9]*\).*$')"
  if [ -n "$WRAPPER_PID" ] && ! kill -0 "$WRAPPER_PID" 2>/dev/null; then
    # The wrapper may have finalized and exited between the decided check and
    # the liveness probe; a dead wrapper's log is final, so re-checking once
    # here settles it before we report a death that would trigger recovery.
    if decided; then exit 0; fi
    BACKEND_PID="$(log_field '^agent-run: backend-pid: \([0-9][0-9]*\).*$')"
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      printf 'agent-wait: dead-run wrapper-pid=%s backend-pid=%s backend=alive (orphan may still write and, for work, holds the worktree lock; kill -- -%s before takeover)\n' \
        "$WRAPPER_PID" "$BACKEND_PID" "$BACKEND_PID"
      exit 21
    fi
    printf 'agent-wait: dead-run wrapper-pid=%s backend-pid=%s backend=dead (un-finalized; see SKILL.md "Dead-run signature")\n' \
      "$WRAPPER_PID" "${BACKEND_PID:-unknown}"
    exit 20
  fi

  if [ "$SECONDS" -ge "$TIMEOUT" ]; then
    printf 'agent-wait: running elapsed=%ss wrapper-pid=%s\n' "$SECONDS" "${WRAPPER_PID:-unknown}"
    exit 10
  fi
  sleep "$INTERVAL"
done

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
#                ignore the answer file and pre-finalization backend-exit
#                trailers; exit 0 only on the post-finalization worktree
#                trailer.
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
#   0   run decided — a post-finalization `agent-run: worktree:` trailer is
#       present; without --finalized-only, a `backend-exit:` trailer or nonempty
#       answer also decides the run ("answer-landed": final trailers may lag by
#       a moment). Prints an `agent-wait:` status line, then the summary trailers.
#   10  still running when --timeout elapsed. Re-invoke to keep waiting.
#   20  dead run — starting/attempt/dispatch breadcrumb present, wrapper pid
#       dead, no qualifying finalization trailer, backend gone too. This also
#       covers a finalized no-answer record after dispatch: inspect the
#       worktree before deciding whether the mission itself may be retried.
#       Recover per SKILL.md "Dead-run signature".
#   21  dead run whose backend pid is still alive: an orphan that may still
#       be writing (a work orphan also still holds the worktree lock) — kill
#       its process group before taking the worktree over.
#   22  dead wrapper whose durable attempt record is finalized no-answer and
#       whose log has no dispatch/backend-launch evidence; the pre-dispatch
#       attempt is therefore retryable.
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

# The decided/summary greps mirror the waiter contract documented in SKILL.md.
# `worktree:` follows attempt publication/finalization on every settled path;
# `backend-exit:` can precede it and is only an early decided signal when the
# caller did not request --finalized-only.
print_summary() {
  grep -E '^agent-run: (starting|attempt|transcript|branch|backend-pid|backend-exit|session-id|answer|head|worktree):' "$LOG" || true
}

log_field() { # <sed-pattern> — first match wins
  sed -n "s/$1/\\1/p" "$LOG" | head -n 1
}

# Reads the wrapper's private attempt record. The version gate is load-bearing:
# a record shape this waiter does not know is not a record it may classify, so
# an unrecognized version falls through to the ordinary dead-run signature
# rather than silently misreporting retryability.
finalized_no_answer_attempt() {
  local record="$1"
  [ -r "$record" ] \
    && grep -qFx 'version=2' "$record" \
    && grep -qFx 'state=finalized' "$record" \
    && grep -qFx 'answer-outcome=no-answer' "$record" \
    && grep -qFx 'finalization-count=1' "$record"
}

# Prints the decided status + summary and returns 0 when the run is decided
# (completion trailers, or a landed answer unless --finalized-only); else 1.
decided() {
  # One pass for the completion anchors. Both anchors report the same decided
  # status, so they only need separating by which ones count: --finalized-only
  # drops `backend-exit:` from the set rather than testing it separately. A
  # codex log carries the backend's full streamed transcript, so the
  # not-yet-decided case must not scan it twice per poll.
  local anchors='^agent-run: (worktree|backend-exit):'
  if [ "$FINALIZED_ONLY" -eq 1 ]; then anchors='^agent-run: worktree:'; fi
  if grep -qE "$anchors" "$LOG"; then
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

# The wrapper pid is the same $$ in all three breadcrumbs and never changes
# once one of them is in the log, so resolve it at most once. Re-deriving it
# every tick re-scans the whole log three times, and a codex log carries the
# backend's full streamed transcript.
WRAPPER_PID=''
resolve_wrapper_pid() {
  [ -z "$WRAPPER_PID" ] || return 0
  WRAPPER_PID="$(log_field '^agent-run: dispatched: .* wrapper-pid \([0-9][0-9]*\).*$')"
  if [ -z "$WRAPPER_PID" ]; then
    WRAPPER_PID="$(log_field '^agent-run: attempt: .* wrapper-pid \([0-9][0-9]*\)$')"
  fi
  if [ -z "$WRAPPER_PID" ]; then
    WRAPPER_PID="$(log_field '^agent-run: starting: wrapper-pid \([0-9][0-9]*\)$')"
  fi
}

SECONDS=0
while :; do
  if decided; then exit 0; fi

  resolve_wrapper_pid
  if [ -n "$WRAPPER_PID" ] && ! kill -0 "$WRAPPER_PID" 2>/dev/null; then
    # The wrapper may have finalized and exited between the decided check and
    # the liveness probe; a dead wrapper's log is final, so re-checking once
    # here settles it before we report a death that would trigger recovery.
    if decided; then exit 0; fi
    ATTEMPT_RECORD="$(log_field '^agent-run: attempt: .* record \(.*\) wrapper-pid [0-9][0-9]*$')"
    # Both facts are re-tested by the post-dispatch branch below, and the
    # wrapper is already dead so neither can change: derive each once. The
    # record check is four greps and the log check scans a possibly huge codex
    # transcript.
    NO_ANSWER_ATTEMPT=0
    if [ -n "$ATTEMPT_RECORD" ] && finalized_no_answer_attempt "$ATTEMPT_RECORD"; then
      NO_ANSWER_ATTEMPT=1
    fi
    LAUNCH_EVIDENCE=0
    if grep -qE '^agent-run: (dispatched|backend-pid):' "$LOG"; then LAUNCH_EVIDENCE=1; fi
    if [ "$NO_ANSWER_ATTEMPT" -eq 1 ] && [ "$LAUNCH_EVIDENCE" -eq 0 ]; then
      printf 'agent-wait: pre-dispatch-abort wrapper-pid=%s attempt=finalized-no-answer retryable=yes\n' \
        "$WRAPPER_PID"
      exit 22
    fi
    BACKEND_PID="$(log_field '^agent-run: backend-pid: \([0-9][0-9]*\).*$')"
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      printf 'agent-wait: dead-run wrapper-pid=%s backend-pid=%s backend=alive (orphan may still write and, for work, holds the worktree lock; kill -- -%s before takeover)\n' \
        "$WRAPPER_PID" "$BACKEND_PID" "$BACKEND_PID"
      exit 21
    fi
    if [ "$NO_ANSWER_ATTEMPT" -eq 1 ] && [ "$LAUNCH_EVIDENCE" -eq 1 ]; then
      printf 'agent-wait: post-dispatch-incomplete wrapper-pid=%s backend-pid=%s attempt=finalized-no-answer (launch began but no completion trailer landed; inspect the worktree before any mission retry)\n' \
        "$WRAPPER_PID" "${BACKEND_PID:-unknown}"
      exit 20
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

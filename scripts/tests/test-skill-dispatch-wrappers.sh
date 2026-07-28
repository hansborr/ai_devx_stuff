#!/usr/bin/env bash
# smoke-order: 460
# BEGIN GENERATED SKILL SMOKE SUBJECTS (bun run harness:skills:refresh)
# smoke-subjects: .claude/skills/agent-cli/SKILL.md
# smoke-subjects: .claude/skills/agent-cli/references/claude-workflows.md
# smoke-subjects: .claude/skills/agent-cli/references/claude.md
# smoke-subjects: .claude/skills/agent-cli/references/codex.md
# smoke-subjects: .claude/skills/agent-cli/references/copilot.md
# smoke-subjects: .claude/skills/agent-cli/references/cursor.md
# smoke-subjects: .claude/skills/agent-cli/references/portability.md
# smoke-subjects: .claude/skills/agent-cli/references/trailer-contract.md
# smoke-subjects: .claude/skills/agent-cli/scripts/agent-run.sh
# smoke-subjects: .claude/skills/agent-cli/scripts/agent-wait.sh
# smoke-subjects: .codex/skills/agent-cli/SKILL.md
# smoke-subjects: .codex/skills/agent-cli/agents/openai.yaml
# smoke-subjects: .codex/skills/agent-cli/references/claude-workflows.md
# smoke-subjects: .codex/skills/agent-cli/references/claude.md
# smoke-subjects: .codex/skills/agent-cli/references/codex.md
# smoke-subjects: .codex/skills/agent-cli/references/copilot.md
# smoke-subjects: .codex/skills/agent-cli/references/cursor.md
# smoke-subjects: .codex/skills/agent-cli/references/portability.md
# smoke-subjects: .codex/skills/agent-cli/references/trailer-contract.md
# END GENERATED SKILL SMOKE SUBJECTS
# smoke-subjects: scripts/tests/test-skill-dispatch-wrappers.sh
# Pure-shell tests for the unified agent dispatch wrapper behind the agent-cli
# skill (agent-run.sh), plus harness-specific guidance and metadata behavior.
#
# The wrapper runs its CLI binary as a child, so the tests run it against fake
# `claude`/`codex`/`copilot`/`agent` (cursor) executables on PATH that print
# their argv and the permission-relevant environment, inside a throwaway git
# repo so the per-worktree lock path and the consult drift check resolve
# somewhere disposable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER="${AGENT_RUN_WRAPPER_UNDER_TEST:-$REPO_ROOT/.claude/skills/agent-cli/scripts/agent-run.sh}"
WAITER="${AGENT_WAIT_WRAPPER_UNDER_TEST:-$REPO_ROOT/.claude/skills/agent-cli/scripts/agent-wait.sh}"
CONTRACT_DOC="$REPO_ROOT/.claude/skills/agent-cli/references/trailer-contract.md"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
# The wrapper auto-generates -o under $TMPDIR when omitted; point it into the
# throwaway root so every generated answer file is cleaned up with the tests.
export TMPDIR="$TMP_ROOT"
export AGENT_RUN_TEST_HOOKS=1

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"

# Fake claude: echoes argv, optionally dirties the worktree, then prints the
# --output-format json result envelope the wrapper parses.
cat >"$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
if [ -n "${AGENT_FAKE_PID_FILE-}" ]; then printf '%s\n' "$$" >"$AGENT_FAKE_PID_FILE"; fi
for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done
if [ "${AGENT_FAKE_PRINT_GIT_OPTIONAL_LOCKS-}" = "1" ]; then
  printf 'BACKEND_GIT_OPTIONAL_LOCKS=%s\n' "${GIT_OPTIONAL_LOCKS-__unset__}"
fi
if [ "${AGENT_FAKE_READ_STDIN-}" = "1" ]; then printf 'STDIN:[%s]\n' "$(cat)"; fi
# Background a long-lived child that outlives this backend and then exit 0 —
# the delegate-backgrounded-`land.sh &` shape. The child inherits this backend's
# process group (the wrapper exec's it under setsid), so it is what
# detect_orphaned_children probes for.
if [ "${AGENT_FAKE_ORPHAN_CHILD-}" = "1" ]; then sleep 30 & fi
if [ -n "${AGENT_FAKE_ESCAPED_PID_FILE-}" ]; then
  setsid bash -c 'printf "%s\n" "$$" >"$1"; exec sleep 30' \
    _ "$AGENT_FAKE_ESCAPED_PID_FILE" </dev/null >/dev/null 2>&1 &
fi
if [ -n "${AGENT_FAKE_SLEEP-}" ]; then sleep "$AGENT_FAKE_SLEEP"; fi
if [ "${AGENT_FAKE_TOUCH-}" = "1" ]; then touch drift-artifact.txt; fi
if [ "${AGENT_FAKE_APPEND-}" = "1" ]; then printf 'drift\n' >>tracked.txt; fi
if [ "${AGENT_FAKE_COMMIT-}" = "1" ]; then
  touch committed-drift.txt
  git add committed-drift.txt >/dev/null 2>&1
  git commit -qm 'drift commit' >/dev/null 2>&1
fi
if [ "${AGENT_FAKE_WRITE_GIT_HOOK-}" = "1" ]; then
  hook_dir="$(git rev-parse --git-path hooks)"
  mkdir -p "$hook_dir"
  printf '#!/usr/bin/env bash\nprintf hook\n' >"$hook_dir/pre-commit"
  chmod +x "$hook_dir/pre-commit"
fi
if [ "${AGENT_FAKE_WRITE_GIT_CONFIG-}" = "1" ]; then
  git config alias.agent-run-test '!echo hijacked'
fi
if [ "${AGENT_FAKE_NO_ENVELOPE-}" != "1" ]; then
  result='fake claude answer'
  session_id="${AGENT_FAKE_SESSION_ID-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}"
  if [ "${AGENT_FAKE_EMPTY_RESULT-}" = "1" ]; then result=''; fi
  if [ "${AGENT_FAKE_WHITESPACE_RESULT-}" = "1" ]; then result='   '; fi
  err=false
  if [ "${AGENT_FAKE_IS_ERROR-}" = "1" ]; then err=true; fi
  printf '{"type":"result","subtype":"success","is_error":%s,"result":"%s","session_id":"%s","total_cost_usd":0.0123,"num_turns":2,"permission_denials":[]}\n' "$err" "$result" "$session_id"
fi
if [ -n "${AGENT_FAKE_EXIT_READY-}" ]; then
  : >"$AGENT_FAKE_EXIT_READY"
  while [ ! -e "${AGENT_FAKE_EXIT_RELEASE-}" ]; do sleep 0.02; done
fi
exit "${AGENT_FAKE_EXIT-0}"
EOF

# Fake codex: prints a session header like `codex exec`, echoes argv, honours
# a `-o <file>` last-message flag (unless AGENT_FAKE_SKIP_OUTPUT=1, simulating a
# run that exits without writing one), and optionally reads stdin / dirties the
# worktree.
cat >"$FAKE_BIN/codex" <<'EOF'
#!/usr/bin/env bash
print_args() {
  for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done
}
if [ "${AGENT_FAKE_CODEX_HEADER_AFTER_ARGS-}" = "1" ]; then
  print_args "$@"
  printf 'session id: 12345678-1234-1234-1234-123456789abc\n'
else
  printf 'session id: 12345678-1234-1234-1234-123456789abc\n'
  print_args "$@"
fi
if [ "${AGENT_FAKE_READ_STDIN-}" = "1" ]; then printf 'STDIN:[%s]\n' "$(cat)"; fi
if [ -n "${AGENT_FAKE_ESCAPED_PID_FILE-}" ]; then
  setsid bash -c 'printf "%s\n" "$$" >"$1"; exec sleep 30' \
    _ "$AGENT_FAKE_ESCAPED_PID_FILE" </dev/null &
fi
if [ "${AGENT_FAKE_CREATE_INDEX_LOCK-}" = "1" ]; then
  git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
  if [ -n "$git_dir" ]; then exec 9>"$git_dir/index.lock"; fi
fi
if [ "${AGENT_FAKE_STUBBORN_CHILD-}" = "1" ]; then bash -c 'trap "" TERM; sleep 30' & fi
if [ -n "${AGENT_FAKE_SLEEP-}" ]; then sleep "$AGENT_FAKE_SLEEP"; fi
if [ "${AGENT_FAKE_TOUCH-}" = "1" ]; then touch drift-artifact.txt; fi
if [ "${AGENT_FAKE_APPEND_UNTRACKED-}" = "1" ]; then printf 'drift\n' >>untracked-drift.txt; fi
if [ -n "${AGENT_FAKE_APPEND_PATH-}" ]; then printf 'drift\n' >>"$AGENT_FAKE_APPEND_PATH"; fi
if [ -n "${AGENT_FAKE_REPLACE_PATH-}" ]; then
  printf '%s\n' "${AGENT_FAKE_REPLACE_CONTENT-next}" >"$AGENT_FAKE_REPLACE_PATH"
fi
if [ -n "${AGENT_FAKE_REPLACE_PRESERVE_MTIME_PATH-}" ]; then
  printf 'next\n' >"$AGENT_FAKE_REPLACE_PRESERVE_MTIME_PATH"
  touch -d '2020-01-01T00:00:00Z' "$AGENT_FAKE_REPLACE_PRESERVE_MTIME_PATH"
fi
if [ -n "${AGENT_FAKE_RETARGET_SYMLINK_PATH-}" ]; then
  ln -sfn -- "$AGENT_FAKE_RETARGET_SYMLINK_TARGET" "$AGENT_FAKE_RETARGET_SYMLINK_PATH"
fi
if [ -n "${AGENT_FAKE_REPLACE_SYMLINK_WITH_FILE_PATH-}" ]; then
  rm -f -- "$AGENT_FAKE_REPLACE_SYMLINK_WITH_FILE_PATH"
  printf '%s\n' "${AGENT_FAKE_REPLACEMENT_FILE_CONTENT-}" \
    >"$AGENT_FAKE_REPLACE_SYMLINK_WITH_FILE_PATH"
fi
if [ "${AGENT_FAKE_APPEND_IGNORED-}" = "1" ]; then printf 'drift\n' >>ignored-drift.txt; fi
if [ "${AGENT_FAKE_MOVE_OTHER_REF-}" = "1" ]; then
  git update-ref refs/heads/agent-run-other-ref HEAD
fi
if [ -n "${AGENT_FAKE_PARTIAL_ANSWER_READY-}" ]; then
  prev=''
  for arg in "$@"; do
    if [ "$prev" = "-o" ]; then
      printf 'partial codex answer' >"$arg"
      : >"$AGENT_FAKE_PARTIAL_ANSWER_READY"
      while [ ! -e "${AGENT_FAKE_PARTIAL_ANSWER_RELEASE-}" ]; do sleep 0.02; done
      printf ' completed\n' >>"$arg"
    fi
    prev="$arg"
  done
elif [ "${AGENT_FAKE_SKIP_OUTPUT-}" != "1" ]; then
  prev=''
  for arg in "$@"; do
    if [ "$prev" = "-o" ]; then printf 'fake codex last message\n' >"$arg"; fi
    prev="$arg"
  done
fi
if [ -n "${AGENT_FAKE_ANSWER_READY-}" ]; then
  : >"$AGENT_FAKE_ANSWER_READY"
  while [ ! -e "${AGENT_FAKE_ANSWER_RELEASE-}" ]; do sleep 0.02; done
fi
exit "${AGENT_FAKE_EXIT-0}"
EOF

# Fake copilot: reports COPILOT_ALLOW_ALL and argv on stderr, emits the JSONL
# session events that the wrapper normalizes into -o, and writes a share
# transcript whose header carries the session id and whose body quotes a decoy
# --resume id — like real transcripts, which quote prompt content.
cat >"$FAKE_BIN/copilot" <<'EOF'
#!/usr/bin/env bash
if [ -n "${AGENT_FAKE_PID_FILE-}" ]; then printf '%s\n' "$$" >"$AGENT_FAKE_PID_FILE"; fi
share=''
if [ "${AGENT_FAKE_STRICT-}" = "1" ]; then
  expect_value=0
  for arg in "$@"; do
    if [ "$expect_value" = "1" ]; then
      expect_value=0
      continue
    fi
    case "$arg" in
      --no-color | --no-auto-update | -s | --allow-all)
        ;;
      --deny-tool | --model | --effort | --output-format | -p | -C)
        expect_value=1
        ;;
      --resume=* | --share=*)
        ;;
      *)
        printf 'UNKNOWN:%s\n' "$arg" >&2
        exit 64
        ;;
    esac
  done
  if [ "$expect_value" = "1" ]; then
    printf 'UNKNOWN:missing-value\n' >&2
    exit 64
  fi
fi
printf 'COPILOT_ALLOW_ALL=%s\n' "${COPILOT_ALLOW_ALL-__unset__}" >&2
for arg in "$@"; do
  printf 'ARG:%s\n' "$arg" >&2
  case "$arg" in
    --share=*) share="${arg#--share=}" ;;
  esac
done
if [ -n "${AGENT_FAKE_ESCAPED_PID_FILE-}" ]; then
  setsid bash -c 'printf "%s\n" "$$" >"$1"; exec sleep 30' \
    _ "$AGENT_FAKE_ESCAPED_PID_FILE" </dev/null >/dev/null 2>&1 &
fi
if [ -n "${AGENT_FAKE_SLEEP-}" ]; then sleep "$AGENT_FAKE_SLEEP"; fi
if [ -n "$share" ] && [ "${AGENT_FAKE_SKIP_SHARE-}" != "1" ]; then
  if [ -n "${AGENT_FAKE_SHARE_OPEN_READY-}" ]; then
    exec 8>"$share"
    : >"$AGENT_FAKE_SHARE_OPEN_READY"
    while [ ! -e "${AGENT_FAKE_SHARE_OPEN_RELEASE-}" ]; do sleep 0.02; done
    {
      printf '# Copilot CLI Session\n> - **Session ID:** `99999999-8888-7777-6666-555555555555`\n'
      printf 'body quoting --resume=11111111-1111-1111-1111-111111111111 must not win\n'
    } >&8
    exec 8>&-
  else
    {
      printf '# Copilot CLI Session\n> - **Session ID:** `99999999-8888-7777-6666-555555555555`\n'
      printf 'body quoting --resume=11111111-1111-1111-1111-111111111111 must not win\n'
    } >"$share"
  fi
fi
if [ "${AGENT_FAKE_TOUCH-}" = "1" ]; then touch drift-artifact.txt; fi
if [ "${AGENT_FAKE_EXIT-0}" != "0" ]; then exit "${AGENT_FAKE_EXIT-0}"; fi
if [ "${AGENT_FAKE_EMPTY_ANSWER-}" = "1" ]; then exit 0; fi
if [ "${AGENT_FAKE_COPILOT_INTENT_ONLY-}" = "1" ]; then
  printf '%s\n' '{"type":"session.start","data":{"sessionId":"99999999-8888-7777-6666-555555555555"}}'
  printf '%s\n' '{"type":"assistant.message","data":{"content":"I will inspect the requested diff now.","toolRequests":[{"toolCallId":"call-fake","name":"bash","arguments":{"command":"git diff main...feature"}}]}}'
  printf '%s\n' '{"type":"tool.execution_complete","data":{"toolCallId":"call-fake","success":true}}'
  exit 0
fi
printf '%s\n' '{"type":"session.start","data":{"sessionId":"99999999-8888-7777-6666-555555555555"}}'
printf '%s\n' '{"type":"assistant.message","data":{"content":"fake copilot answer","toolRequests":[]}}'
printf '%s\n' '{"type":"assistant.message","agentId":"fake-subagent","data":{"content":"fake subagent tail","toolRequests":[]}}'
exit 0
EOF
# Fake cursor CLI (the binary is named `agent`): echoes argv, optionally
# dirties the worktree or reads stdin, then prints the --output-format
# stream-json events the wrapper parses. The stream carries incremental
# assistant commentary and a final assistant message, plus a result envelope
# whose `result` field concatenates the commentary before the final summary
# (the real bug); the wrapper must land only the final assistant message in -o.
# Unlike claude's envelope it carries usage-token fields and no cost/turn data.
cat >"$FAKE_BIN/agent" <<'EOF'
#!/usr/bin/env bash
if [ -n "${AGENT_FAKE_PID_FILE-}" ]; then printf '%s\n' "$$" >"$AGENT_FAKE_PID_FILE"; fi
for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done
if [ "${AGENT_FAKE_READ_STDIN-}" = "1" ]; then printf 'STDIN:[%s]\n' "$(cat)"; fi
if [ -n "${AGENT_FAKE_SLEEP-}" ]; then sleep "$AGENT_FAKE_SLEEP"; fi
if [ "${AGENT_FAKE_TOUCH-}" = "1" ]; then touch drift-artifact.txt; fi
if [ "${AGENT_FAKE_NO_ENVELOPE-}" != "1" ]; then
  err=false
  if [ "${AGENT_FAKE_IS_ERROR-}" = "1" ]; then err=true; fi
  printf '{"type":"system","subtype":"init","session_id":"cafe0001-2222-3333-4444-555555555555"}\n'
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":"incremental commentary one"}]}}\n'
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":"incremental commentary two"}]}}\n'
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":"fake cursor answer"}]}}\n'
  printf '{"type":"result","subtype":"success","is_error":%s,"result":"incremental commentary one\\nincremental commentary two\\nfake cursor answer","session_id":"cafe0001-2222-3333-4444-555555555555","request_id":"beef0002-6666-7777-8888-999999999999","usage":{"inputTokens":10,"outputTokens":5,"cacheReadTokens":0,"cacheWriteTokens":0}}\n' "$err"
fi
exit "${AGENT_FAKE_EXIT-0}"
EOF
chmod +x "$FAKE_BIN/claude" "$FAKE_BIN/codex" "$FAKE_BIN/copilot" "$FAKE_BIN/agent"

WORKTREE="$TMP_ROOT/repo"
git init -q "$WORKTREE"
# The drift regression tests commit inside the throwaway repo; pin identity,
# signing, and hooks so the host git config cannot interfere.
git -C "$WORKTREE" config user.email agent-test@example.invalid
git -C "$WORKTREE" config user.name "agent test"
git -C "$WORKTREE" config commit.gpgsign false
git -C "$WORKTREE" config core.hooksPath "$WORKTREE/.git/hooks"
printf 'base\n' >"$WORKTREE/tracked.txt"
printf 'ignored-drift.txt\n' >"$WORKTREE/.gitignore"
git -C "$WORKTREE" add tracked.txt .gitignore
git -C "$WORKTREE" commit -qm 'base commit for drift checks'

reset_worktree() { rm -f "$WORKTREE/drift-artifact.txt"; }

# run_wrapper [args...] — fake CLIs first on PATH, cwd inside the throwaway
# repo; captures OUT and CODE.
run_wrapper() { run_wrapper_env -- "$@"; }

# run_wrapper_env VAR=VAL... -- [args...] — run_wrapper with extra environment.
# Keeps the set +e / cd / PATH / capture handshake in one place so a test that
# only needs one test hook does not re-type it.
run_wrapper_env() {
  local -a vars=()
  while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
    vars+=("$1")
    shift
  done
  if [ "${1-}" = -- ]; then shift; fi
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" env "${vars[@]}" bash "$WRAPPER" "$@" 2>&1)"
  CODE=$?
  set -e
}

# seed_no_answer_predecessor <out> <label> — leave a finalized no-answer attempt
# at <out> for a retry/recovery test to build on.
seed_no_answer_predecessor() {
  run_wrapper_env AGENT_FAKE_EMPTY_RESULT=1 -- consult claude -p hi -o "$1"
  expect_code 1 "$2"
}

# await_ready <ready-path> <pid> <message> <log> [ticks] — poll until a wrapper
# parks at its test-release boundary. The liveness clause matters: without it a
# wrapper that dies early burns the whole bound before failing. One definition
# keeps the poll bound tunable from a single place, and every failure dumps the
# wrapper log.
await_ready() {
  local ready="$1" pid="$2" message="$3" log="$4" ticks="${5:-100}" n=0
  until [ -e "$ready" ] || ! kill -0 "$pid" 2>/dev/null || [ "$n" -ge "$ticks" ]; do
    sleep 0.05
    n=$((n + 1))
  done
  [ -e "$ready" ] || fail "$message ($(cat "$log"))"
}

# wait_wrapper <pid> <log> — collect a backgrounded wrapper's exit status and
# log into the same OUT/CODE pair run_wrapper leaves for a foreground run, so a
# race test's assertions read exactly like an ordinary test's. This is the
# background half of the run_wrapper_env handshake.
wait_wrapper() {
  set +e
  wait "$1"
  CODE=$?
  set -e
  OUT="$(cat "$2")"
}

expect_code() { [ "$CODE" -eq "$1" ] || fail "$2: expected exit $1, got $CODE ($OUT)"; }
expect_out() { grep -qF -- "$1" <<<"$OUT" || fail "$2: missing '$1' in output ($OUT)"; }
expect_not_out() { grep -qF -- "$1" <<<"$OUT" && fail "$2: unexpected '$1' in output ($OUT)"; return 0; }

first_line_matching() {
  local pattern="$1" text="$2"
  awk -v pattern="$pattern" '$0 ~ pattern { print NR; exit }' <<<"$text"
}

assert_finalized_contract() {
  local label="$1" text="$2" dispatched backend_pid completion
  dispatched="$(first_line_matching '^agent-run: dispatched:' "$text")"
  backend_pid="$(first_line_matching '^agent-run: backend-pid:' "$text")"
  completion="$(first_line_matching '^agent-run: (worktree|backend-exit):' "$text")"
  [ -n "$dispatched" ] || fail "$label: missing dispatched launch header ($text)"
  [ -n "$backend_pid" ] || fail "$label: missing backend-pid launch header ($text)"
  [ -n "$completion" ] || fail "$label: missing worktree/backend-exit completion anchor ($text)"
  [ "$dispatched" -lt "$completion" ] \
    || fail "$label: dispatched header appears after completion anchor ($text)"
  [ "$backend_pid" -lt "$completion" ] \
    || fail "$label: backend-pid header appears after completion anchor ($text)"
}

assert_prelaunch_reject_contract() {
  local label="$1" text="$2"
  if grep -Eq '^agent-run: (dispatched|backend-pid|worktree|backend-exit):' <<<"$text"; then
    fail "$label: pre-launch rejection emitted launch/completion trailers ($text)"
  fi
}

assert_dead_run_contract() {
  local label="$1" text="$2" dispatched backend_pid
  dispatched="$(first_line_matching '^agent-run: dispatched:' "$text")"
  backend_pid="$(first_line_matching '^agent-run: backend-pid:' "$text")"
  [ -n "$dispatched" ] || fail "$label: missing dispatched launch header ($text)"
  [ -n "$backend_pid" ] || fail "$label: missing backend-pid launch header ($text)"
  if grep -Eq '^agent-run: (worktree|backend-exit):' <<<"$text"; then
    fail "$label: dead run emitted a false completion anchor ($text)"
  fi
}

expect_contract_optional_record() {
  local record="$1"
  grep -Eq "^\\| \`agent-run: $record:\` \\| Optional" "$CONTRACT_DOC" \
    || fail "contract doc: agent-run: $record: is not documented as optional"
}

# Required rows carry a per-record qualifier, so match the anchored record and
# requirement cells instead of re-typing the whole table row: a reworded cell
# should read as a prose edit, not as a contract regression.
expect_contract_required_record() {
  local record="$1" qualifier="$2"
  grep -Eq "^\\| \`agent-run: $record:\` \\| Required for $qualifier \\|" "$CONTRACT_DOC" \
    || fail "contract doc: agent-run: $record: is not documented as required for $qualifier"
}

# contract_requires <literal> <what-is-missing> — assert one load-bearing
# phrase of the contract doc, keeping the message beside the text it guards.
contract_requires() {
  grep -qF "$1" "$CONTRACT_DOC" || fail "contract doc: $2"
}

attempt_current_id() {
  cat -- "$1.agent-run/current"
}

attempt_record_path() {
  local out="$1" attempt_id
  attempt_id="$(attempt_current_id "$out")"
  printf '%s.agent-run/%s/record\n' "$out" "$attempt_id"
}

write_test_attempt_record() {
  local out="$1" attempt_id="$2" state="$3" backend="$4" outcome="$5" finalization_count="$6"
  local attempt_dir="$out.agent-run/$attempt_id"
  mkdir -p "$attempt_dir"
  printf '%s\n' "$attempt_id" >"$out.agent-run/current"
  # Must stay the shape write_attempt_record emits, version line included: the
  # waiter keys its retryability verdict on that version, so a fixture that
  # drifts from the wrapper's own writer would silently stop exercising it.
  {
    printf 'version=2\n'
    printf 'attempt-id=%s\n' "$attempt_id"
    printf 'attempt-sequence=1\n'
    printf 'previous-attempt=none\n'
    printf 'state=%s\n' "$state"
    printf 'owner-pid=999999\n'
    printf 'mode=consult\n'
    printf 'agent=claude\n'
    printf 'transcript-owner=none\n'
    printf 'backend-disposition=%s\n' "$backend"
    printf 'answer-outcome=%s\n' "$outcome"
    printf 'session-id=none\n'
    printf 'finalization-count=%s\n' "$finalization_count"
  } >"$attempt_dir/record"
}

# run_sourced_phase <snippet> — source agent-run.sh, reset globals, then run a
# direct phase-function snippet inside the throwaway repo. Captures OUT and CODE.
run_sourced_phase() {
  local snippet="$1"
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" WRAPPER="$WRAPPER" TMP_ROOT="$TMP_ROOT" WORKTREE="$WORKTREE" bash -c '
    source "$WRAPPER"
    agent_run_reset_state
    cmd_lines() { printf "<%s>\n" "${cmd[@]}"; }
    eval "$1"
  ' _ "$snippet" 2>&1)"
  CODE=$?
  set -e
}

# --- sourced phase-function units -----------------------------------------------

run_sourced_phase 'declare -F main parse_and_validate_args build_backend_command finalize_run on_fatal_signal >/dev/null'
expect_code 0 "source guard"
expect_not_out "Usage:" "source guard"
ok "source guard: sourcing exposes phase functions without executing main"

run_sourced_phase 'parse_and_validate_args consult codex -p hi -- --base main; printf "%s|%s|%s|%s\n" "$MODE" "$AGENT" "$PROMPT" "${PASSTHRU[*]}"'
expect_code 0 "sourced args success"
expect_out "consult|codex|hi|--base main" "sourced args success"
ok "phase args: parse_and_validate_args populates mode, agent, prompt, and passthrough"

run_sourced_phase 'parse_and_validate_args consult codex -p one -p two'
expect_code 2 "sourced args duplicate prompt"
expect_out "duplicate -p" "sourced args duplicate prompt"
assert_prelaunch_reject_contract "sourced usage reject contract" "$OUT"
ok "phase args: duplicate prompts reject before launch trailers"

run_sourced_phase 'enter_signal_deferral attempt-claim; report_claims() { printf "deferral:[%s]\n" "$SIGNAL_DEFERRAL"; }; trap report_claims EXIT; reject "unit reject"'
expect_code 2 "sourced reject claim resets"
expect_out "deferral:[]" "sourced reject claim resets"
ok "phase rejection: reject closes an open signal deferral before exit"

run_sourced_phase 'parse_and_validate_args work codex -p build -m gpt-5.5 -e high -r 12345678-1234-1234-1234-123456789abc -o "$TMP_ROOT/unit-codex.msg" -- --color never; run_passthrough_guards; assemble_prompt; STDIN_SRC=/dev/null; build_codex_command; cmd_lines'
expect_code 0 "sourced codex command"
expect_out "<codex>" "sourced codex command"
expect_out "<-c>" "sourced codex command"
expect_out "<model_reasoning_effort=high>" "sourced codex command"
expect_out "<resume>" "sourced codex command"
expect_out "<12345678-1234-1234-1234-123456789abc>" "sourced codex command"
expect_out "<$TMP_ROOT/unit-codex.msg>" "sourced codex command"
ok "phase command: codex argv assembly is directly testable"

run_sourced_phase 'parse_and_validate_args consult claude -p review -m fable -e low -- --allowedTools "Bash(git diff:*)"; run_passthrough_guards; assemble_prompt; STDIN_SRC=/dev/null; build_claude_command; cmd_lines; printf "%s\n" "$FULL_PROMPT"'
expect_code 0 "sourced claude command"
expect_out "<claude>" "sourced claude command"
expect_out "<--disallowedTools>" "sourced claude command"
expect_out "<--model>" "sourced claude command"
expect_out "<fable>" "sourced claude command"
expect_out "Exception: the caller explicitly granted" "sourced claude command"
ok "phase command: claude argv assembly preserves consult grants and preamble"

run_sourced_phase 'parse_and_validate_args consult copilot -m gemini-3.6-flash -p review -o "$TMP_ROOT/unit-copilot.msg"; assemble_prompt; STDIN_SRC=/dev/null; SIDECAR="$TMP_ROOT/unit-copilot.msg.transcript.md"; build_copilot_command; cmd_lines'
expect_code 0 "sourced copilot command"
expect_out "<copilot>" "sourced copilot command"
expect_out "<--deny-tool>" "sourced copilot command"
expect_out "<write>" "sourced copilot command"
expect_out "<--share=$TMP_ROOT/unit-copilot.msg.transcript.md>" "sourced copilot command"
ok "phase command: copilot argv assembly is directly testable"

run_sourced_phase 'command() { return 1; }; parse_and_validate_args consult copilot -m gemini-3.6-flash -p review'
expect_code 2 "copilot missing python3"
expect_out "needs python3" "copilot missing python3"
ok "copilot: missing python3 is rejected before launch (structured answer parsing depends on it)"

run_sourced_phase 'parse_and_validate_args consult cursor -p review; run_passthrough_guards; assemble_prompt; STDIN_SRC=/dev/null; build_cursor_command; cmd_lines'
expect_code 0 "sourced cursor command"
expect_out "<agent>" "sourced cursor command"
expect_out "<--output-format>" "sourced cursor command"
expect_out "<stream-json>" "sourced cursor command"
expect_out "<--mode>" "sourced cursor command"
expect_out "<ask>" "sourced cursor command"
expect_out "<--trust>" "sourced cursor command"
expect_out "<grok-4.5-xhigh>" "sourced cursor command"
ok "phase command: cursor argv assembly defaults the model, composes ask mode, and streams json"

run_sourced_phase 'printf() { [ "$DISPATCH_HEADER_EMITTED" = 0 ] || exit 12; builtin printf "$@"; }; MODE=consult; AGENT=codex; OUT="$TMP_ROOT/unit-header.msg"; OUT_ABS="$OUT"; emit_dispatch_header; [ "$DISPATCH_HEADER_EMITTED" = 1 ]'
expect_code 0 "sourced dispatch header"
grep -qE "^agent-run: dispatched: consult codex wrapper-pid [0-9]+ answer $TMP_ROOT/unit-header.msg$" <<<"$OUT" \
  || fail "sourced dispatch header: malformed header ($OUT)"
ok "phase trailers: emit_dispatch_header marks the header only after writing mode, agent, pid, and answer"

run_sourced_phase 'parse_and_validate_args work claude -p hi --branch feat/unit-branch-flag; load_git_context; git() { if [ "$1" = switch ]; then [ "$BRANCH_CREATED_BY_WRAPPER" = 1 ] || exit 12; return 1; fi; command git "$@"; }; create_requested_branch'
expect_code 2 "sourced conservative branch flag"
expect_out "could not create" "sourced conservative branch flag"
ok "phase branch: wrapper ownership is conservative before git creates the branch"

run_sourced_phase 'load_git_context; BRANCH_NAME=feat/unit-absent-branch; BRANCH_PRE_HEAD="$(git_read rev-parse HEAD)"; BRANCH_PRE_REF="$(git_read symbolic-ref --quiet --short HEAD)"; BRANCH_CREATED_BY_WRAPPER=1; BACKEND_PHASE=pre; rollback_pre_dispatch_branch; [ "$BRANCH_CREATED_BY_WRAPPER" = 0 ]'
expect_code 0 "sourced absent branch rollback"
expect_not_out "cannot safely roll back" "sourced absent branch rollback"
ok "phase branch: conservative ownership is a clean no-op when branch creation had no effect"

run_sourced_phase 'SIDECAR="$TMP_ROOT/unit-replaced-share.md"; : >"$SIDECAR"; CALLER_TRANSCRIPT_CLAIM_IDENTITY="$(path_identity "$SIDECAR")"; mv "$SIDECAR" "$SIDECAR.original"; : >"$SIDECAR"; CALLER_TRANSCRIPT_CLAIMED=1; BACKEND_PHASE=pre; ATTEMPT_FINALIZED=0; cleanup; [ -e "$SIDECAR" ]'
expect_code 0 "sourced caller transcript cleanup identity"
ok "phase cleanup: a replaced empty caller transcript survives cleanup"

if command -v flock >/dev/null 2>&1; then
  run_sourced_phase 'parse_and_validate_args work codex -p hi; load_git_context; acquire_worktree_lock; [ "$LOCK_ACQUIRED" = 1 ] || exit 10; [ ! -e "$LOCK_PATH.identity" ] || exit 12; flock -n "$LOCK_PATH" -c true && exit 11; release_worktree_lock; flock -n "$LOCK_PATH" -c true; rm -f -- "$LOCK_PATH"'
  expect_code 0 "sourced lock acquire release"
  ok "phase lock: acquire_worktree_lock holds and releases without a persistent inode pin"
else
  ok "skipped sourced lock phase check (flock unavailable)"
fi

run_sourced_phase 'MODE=consult; AGENT=codex; BACKEND_PHASE=pre; on_fatal_signal TERM'
expect_code 1 "sourced signal no backend"
assert_prelaunch_reject_contract "sourced signal no backend" "$OUT"
ok "phase signals: on_fatal_signal emits no completion anchor before a launch header"

UNIT_SIGNAL_FOREIGN_OUT="$TMP_ROOT/unit-signal-foreign.msg"
printf 'foreign answer\n' >"$UNIT_SIGNAL_FOREIGN_OUT"
run_sourced_phase 'MODE=consult; AGENT=codex; OUT="$TMP_ROOT/unit-signal-foreign.msg"; BACKEND_PHASE=pre; on_fatal_signal TERM'
expect_code 1 "sourced signal foreign answer"
expect_not_out "agent-run: answer:" "sourced signal foreign answer"
ok "phase signals: fatal finalization never advertises unowned public content"

UNIT_FINAL_OUT="$TMP_ROOT/unit-finalize.msg"
printf 'unit answer\n' >"$UNIT_FINAL_OUT"
run_sourced_phase 'MODE=work; AGENT=codex; OUT="$TMP_ROOT/unit-finalize.msg"; OUT_ABS="$OUT"; ANSWER_PUBLISHED=1; SESSION_ID=12345678-1234-1234-1234-123456789abc; code=0; DRIFT_CHECKED_MODE=0; finalize_run'
expect_code 0 "sourced finalize success"
expect_out "agent-run: answer: $UNIT_FINAL_OUT" "sourced finalize success"
expect_out "agent-run: session-id: 12345678-1234-1234-1234-123456789abc" "sourced finalize success"
expect_out "agent-run: worktree: unchecked (not a git repository)" "sourced finalize success"
ok "phase finalization: finalize_run emits answer, session, and work outcome trailers"

run_sourced_phase 'trap "rm -f unit-drift.txt" EXIT; parse_and_validate_args consult claude -p hi; load_git_context; LOCK_NEEDED=0; prepare_lock_probe; prepare_consult_drift_check; touch unit-drift.txt; code=0; finalize_consult_drift_check; exit "$code"'
expect_code 4 "sourced consult drift"
expect_out "agent-run: worktree: DIRTY (consult modified:" "sourced consult drift"
expect_out "agent-run: drift-status:" "sourced consult drift"
ok "phase drift: consult drift check can be driven directly"

# --- backend adapters ---------------------------------------------------------

# Every backend defines the required adapter verbs, dispatched by constructed
# name from run_passthrough_guards / build_backend_command / run_backend.
run_sourced_phase 'for a in codex claude copilot cursor; do declare -F "guard_$a" "build_${a}_command" "launch_$a" >/dev/null || { printf "missing verbs for %s\n" "$a"; exit 7; }; done'
expect_code 0 "adapter required verbs"
ok "adapter: every backend defines guard/build/launch verbs"

# run_adapter_hook fires <verb>_<backend> for the active backend and no-ops when
# a backend omits an optional hook (the pattern that keeps per-backend behavior
# out of the shared lifecycle).
run_sourced_phase 'AGENT=copilot; FIRED=0; probe_copilot() { FIRED=1; }; run_adapter_hook probe; [ "$FIRED" = 1 ] || exit 7; AGENT=codex; run_adapter_hook probe; [ "$FIRED" = 1 ] || exit 8'
expect_code 0 "adapter hook dispatch"
ok "adapter: run_adapter_hook fires the active backend's hook and no-ops when absent"

run_sourced_phase 'exec 8>"$TMP_ROOT/unit-probe.lock"; CAN_PROBE=1; close_backend_path_locks; { : >&8; } 2>/dev/null && exit 7; exec 8>"$TMP_ROOT/unit-non-probe.lock"; CAN_PROBE=0; close_backend_path_locks; : >&8; exec 8>&-'
expect_code 0 "backend lock descriptor close"
ok "phase launch: backend children close fd 8 only when it is the read-only lock probe"

# The lock is work-only on every backend: a codex consult acquires nothing, so
# consults parallelize and run beside a work dispatch; drift attribution falls
# to the lock probe instead.
run_sourced_phase 'parse_and_validate_args consult codex -p hi; load_git_context; acquire_worktree_lock; [ "$LOCK_NEEDED" = 0 ] || exit 7; [ "$LOCK_ACQUIRED" = 0 ] || exit 8'
expect_code 0 "consult acquires no lock"
ok "lock: consult leaves the worktree lock untaken on every backend (work-only)"

# --opt=value normalization splits a leading wrapper option in two and leaves
# native args after -- untouched.
run_sourced_phase 'normalize_wrapper_optargs -p=hi --model=fable --branch=feat/x -- --raw=keep -C=/tmp; printf "[%s]" "${NORMALIZED_ARGS[@]}"'
expect_code 0 "normalize optargs"
expect_out "[-p][hi][--model][fable][--branch][feat/x][--][--raw=keep][-C=/tmp]" "normalize optargs"
ok "parser: normalize_wrapper_optargs splits --opt=value and stops at --"

# --- usage rejections ---------------------------------------------------------

run_wrapper
expect_code 2 "no args"
expect_out "Usage:" "no args"
ok "argument-less call exits 2 with usage"
assert_prelaunch_reject_contract "usage error contract" "$OUT"
ok "contract: usage errors exit 2 before dispatch"

run_wrapper bogus claude -p hi
expect_code 2 "bogus mode"
ok "unknown mode exits 2"

run_wrapper consult gemini -p hi
expect_code 2 "bogus agent"
ok "unknown agent exits 2"

run_wrapper review claude -p hi
expect_code 2 "review claude"
expect_out "codex" "review claude"
ok "review mode is codex-only"

run_wrapper consult claude
expect_code 2 "missing prompt"
expect_out "prompt" "missing prompt"
ok "consult without a prompt exits 2"

ATTACHMENT_ONLY="$TMP_ROOT/attachment-only.md"
printf 'supporting evidence\n' > "$ATTACHMENT_ONLY"
run_wrapper consult claude -f "$ATTACHMENT_ONLY"
expect_code 2 "attachment-only mission"
expect_out "non-empty mission" "attachment-only mission"
expect_out "supporting material" "attachment-only mission"
assert_prelaunch_reject_contract "attachment-only mission contract" "$OUT"
ok "mission: attachment-only invocation is rejected before dispatch"

for backend in claude codex copilot cursor; do
  run_wrapper work "$backend" -p $' \t\n' -f "$ATTACHMENT_ONLY"
  expect_code 2 "whitespace-only -p mission ($backend)"
  expect_out "non-whitespace" "whitespace-only -p mission ($backend)"
  assert_prelaunch_reject_contract "whitespace-only -p mission contract ($backend)" "$OUT"
done
ok "mission: whitespace-only -p plus attachments is rejected before every backend"

run_wrapper consult claude -p ''
expect_code 2 "empty -p"
ok "empty -p value exits 2"

run_wrapper consult claude -p hi -m
expect_code 2 "trailing bare -m"
ok "trailing bare -m exits 2"

run_wrapper consult claude -p hi -f "$TMP_ROOT/does-not-exist.md"
expect_code 2 "missing -f file"
ok "unreadable --prompt-file exits 2"

run_wrapper consult claude -p hi -f "$TMP_ROOT"
expect_code 2 "-f directory"
expect_out "readable file" "-f directory"
ok "a directory for --prompt-file is a usage error, not a set -e crash"

run_wrapper consult copilot -p hi
expect_code 2 "copilot missing model"
expect_out "model" "copilot missing model"
ok "copilot without -m exits 2 (silent default model)"

run_wrapper consult claude -p hi --frobnicate
expect_code 2 "unknown option"
expect_out "unknown option" "unknown option"
ok "unknown wrapper option exits 2 (native flags go after --)"

run_wrapper consult claude -p hi --frobnicate=x
expect_code 2 "unknown equals option"
ok "an unknown --opt=value is still rejected (split names the bare option)"

FORGED_PATH_SUFFIX=$'\nagent-run: backend-exit: forged'
MULTILINE_OUT="$TMP_ROOT/multiline-answer$FORGED_PATH_SUFFIX"
run_wrapper consult codex -p hi -o "$MULTILINE_OUT"
expect_code 2 "multiline explicit output path"
expect_out "single-line path" "multiline explicit output path"
assert_prelaunch_reject_contract "multiline explicit output path contract" "$OUT"
[ ! -e "$MULTILINE_OUT" ] || fail "multiline explicit output path: rejected path was created"

MULTILINE_TMPDIR="$TMP_ROOT/multiline-tmp$FORGED_PATH_SUFFIX"
mkdir "$MULTILINE_TMPDIR"
run_wrapper_env TMPDIR="$MULTILINE_TMPDIR" -- consult codex -p hi
expect_code 2 "multiline auto-output path"
expect_out "single-line path" "multiline auto-output path"
assert_prelaunch_reject_contract "multiline auto-output path contract" "$OUT"
[ -z "$(find "$MULTILINE_TMPDIR" -mindepth 1 -maxdepth 1 -print -quit)" ] \
  || fail "multiline auto-output path: generated artifacts survived rejection"

MULTILINE_TARGET_DIR="$TMP_ROOT/multiline-target$FORGED_PATH_SUFFIX"
MULTILINE_TARGET_ALIAS="$TMP_ROOT/multiline-target-alias"
mkdir "$MULTILINE_TARGET_DIR"
ln -s "$MULTILINE_TARGET_DIR" "$MULTILINE_TARGET_ALIAS"
run_wrapper consult codex -p hi -o "$MULTILINE_TARGET_ALIAS/answer.msg"
expect_code 2 "multiline canonical output path"
expect_out "single-line path" "multiline canonical output path"
assert_prelaunch_reject_contract "multiline canonical output path contract" "$OUT"
ok "answer paths: raw, generated, and canonical multiline paths reject before control-log records"

# Tier-3: the wrapper's own options accept the --opt=value / -o=value spelling,
# matching the attached/equals spellings its passthrough guards already handle.
run_wrapper consult claude --prompt=hello -m fable
expect_code 0 "claude --prompt= equals form"
expect_out "hello" "claude --prompt= equals form"
ok "wrapper: --prompt=<value> is accepted like --prompt <value>"

run_wrapper consult claude -p hi -m=fable
expect_code 0 "claude -m= equals form"
expect_out "ARG:--model" "claude -m= equals form"
expect_out "ARG:fable" "claude -m= equals form"
ok "wrapper: -m=<value> short equals form is accepted like -m <value>"

run_wrapper consult claude -p one -p two
expect_code 2 "duplicate -p"
expect_out "duplicate" "duplicate -p"
ok "duplicate -p is rejected instead of silently dropping the first mission"

DUP_MATERIAL="$TMP_ROOT/dup-material.md"
printf 'dup\n' >"$DUP_MATERIAL"
run_wrapper consult claude -p hi -f "$DUP_MATERIAL" -f "$DUP_MATERIAL"
expect_code 2 "duplicate -f"
expect_out "duplicate" "duplicate -f"
ok "repeating -f with the same file is rejected instead of attaching it twice"

run_wrapper review codex -p hi -f "$DUP_MATERIAL"
expect_code 2 "review -f"
expect_out "custom-instruction" "review -f"
ok "review rejects -f material (it takes only a short custom-instruction -p)"

run_wrapper consult claude -p hi --dirty-ok
expect_code 2 "--dirty-ok outside work"
expect_out "only applies to work" "--dirty-ok outside work"
ok "--dirty-ok outside work mode is a usage error"

run_wrapper review codex -p hi -o "$TMP_ROOT/rev.msg"
expect_code 2 "review -o"
ok "review rejects -o (codex review has no last-message file)"

run_wrapper review codex -p hi -r some-session
expect_code 2 "review -r"
ok "review rejects -r (native review has no resume)"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  env -u AGENT_RUN_TEST_HOOKS AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL=1 \
  bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "ungated inherited test hook"
expect_not_out "cannot allocate an attempt record" "ungated inherited test hook"
ok "test hooks: inherited AGENT_RUN_TEST_* variables are inert without the master switch"

SOURCE_HOOK_OUT="$TMP_ROOT/ungated-source-hook.msg"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" WRAPPER="$WRAPPER" \
  SOURCE_HOOK_OUT="$SOURCE_HOOK_OUT" env -u AGENT_RUN_TEST_HOOKS bash -c '
    AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL=1
    source "$WRAPPER"
    main consult claude -p hi -o "$SOURCE_HOOK_OUT"
  ' 2>&1)"
CODE=$?
set -e
expect_code 0 "ungated unexported sourced test hook"
expect_not_out "cannot allocate an attempt record" "ungated unexported sourced test hook"
ok "test hooks: unexported source-caller variables are inert without the master switch"

# --- claude mapping -------------------------------------------------------------

run_wrapper consult claude -p 'hello world' -m fable -e low
expect_code 0 "claude consult happy path"
for expected in ARG:-p ARG:--output-format ARG:json ARG:--disallowedTools 'ARG:Write,Edit,NotebookEdit,Task' ARG:--model ARG:fable ARG:--effort ARG:low; do
  expect_out "$expected" "claude consult args"
done
expect_out "Do not modify files" "claude consult preamble"
expect_out "git diff is fine" "claude consult keeps the shared shell-capable preamble"
expect_not_out "granted you specific extra commands" "claude consult preamble without grants"
expect_out "hello world" "claude consult prompt"
expect_not_out "ARG:--dangerously-skip-permissions" "claude consult args"
expect_out "agent-run: session-id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" "claude consult trailer"
expect_out "permission-denials: 0" "claude consult trailer"
expect_out "fake claude answer" "claude consult answer in log"
ok "claude: consult composes read-only flags, preamble, and result trailer"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" env AGENT_FAKE_SESSION_ID='' bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "claude empty session id"
expect_not_out "agent-run: session-id:" "claude empty session id"
ok "claude: an empty backend session id omits the session trailer"

run_wrapper work claude -p 'do the thing'
expect_code 0 "claude work happy path"
expect_out "ARG:--dangerously-skip-permissions" "claude work args"
expect_not_out "ARG:--disallowedTools" "claude work args"
expect_not_out "Do not modify files" "claude work has no consult preamble"
ok "claude: work composes --dangerously-skip-permissions without the preamble"

run_wrapper work claude -p 'follow up' -r aaaa-session
expect_code 0 "claude resume"
expect_out "ARG:--resume" "claude resume args"
expect_out "ARG:aaaa-session" "claude resume args"
ok "claude: -r maps to --resume <id>"

ANSWER_FILE="$TMP_ROOT/claude-answer.txt"
run_wrapper consult claude -p hi -o "$ANSWER_FILE"
expect_code 0 "claude -o"
[ "$(cat "$ANSWER_FILE")" = "fake claude answer" ] || fail "claude -o: unexpected answer file content ($(cat "$ANSWER_FILE"))"
expect_out "agent-run: answer: $ANSWER_FILE" "claude -o trailer"
grep -qFx 'session-id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' "$(attempt_record_path "$ANSWER_FILE")" \
  || fail "claude -o: finalized attempt record did not persist the envelope session id"
ok "claude: -o extracts the result field into the answer file"

RELATIVE_ANSWER="../relative-answer.txt"
RELATIVE_ANSWER_ABS="$TMP_ROOT/relative-answer.txt"
run_wrapper consult claude -p hi -o "$RELATIVE_ANSWER"
expect_code 0 "relative claude -o"
expect_out "answer $RELATIVE_ANSWER_ABS" "relative claude dispatched header"
expect_out "agent-run: answer: $RELATIVE_ANSWER_ABS" "relative claude answer trailer"
expect_not_out "answer $RELATIVE_ANSWER" "relative claude raw answer path"
rm -f "$RELATIVE_ANSWER_ABS"
ok "trailers: relative -o paths are reported as canonical absolute paths"

# --- codex mapping ----------------------------------------------------------------

run_wrapper consult codex -p 'review this'
expect_code 0 "codex consult happy path"
for expected in ARG:-c ARG:sandbox_mode=danger-full-access ARG:-a ARG:never ARG:exec; do
  expect_out "$expected" "codex consult args"
done
expect_out "Do not modify files" "codex consult preamble"
expect_out "agent-run: session-id: 12345678-1234-1234-1234-123456789abc" "codex consult trailer"
ok "codex: consult composes sandbox flags, preamble, and session trailer"

run_wrapper work codex -p 'build it' -m gpt-5.5 -e high
expect_code 0 "codex work happy path"
expect_out "ARG:-m" "codex work args"
expect_out "ARG:gpt-5.5" "codex work args"
expect_out "ARG:model_reasoning_effort=high" "codex work args"
expect_not_out "Do not modify files" "codex work has no consult preamble"
ok "codex: work maps -m and -e onto codex config flags"

CODEX_OUT="$TMP_ROOT/codex-last.msg"
run_wrapper work codex -p 'build it' -o "$CODEX_OUT"
expect_code 0 "codex -o"
expect_out "ARG:-o" "codex -o args"
[ "$(cat "$CODEX_OUT")" = "fake codex last message" ] || fail "codex -o: last-message file not written"
expect_out "agent-run: answer: $CODEX_OUT" "codex -o trailer"
ok "codex: -o passes through to the native last-message flag"

run_wrapper work codex -p 'verify failed: retry' -r 12345678-1234-1234-1234-123456789abc
expect_code 0 "codex resume"
expect_out "ARG:resume" "codex resume args"
expect_out "ARG:12345678-1234-1234-1234-123456789abc" "codex resume args"
ok "codex: -r maps to exec resume <id>"

run_wrapper work codex -p 'must not retarget' -r --last
expect_code 2 "codex option-like resume id"
expect_out "valid Codex session id" "codex option-like resume id"
expect_not_out "ARG:" "codex option-like resume id"
run_wrapper work codex -p 'must not retarget' -r sess-123
expect_code 2 "codex malformed resume id"
expect_out "valid Codex session id" "codex malformed resume id"
expect_not_out "ARG:" "codex malformed resume id"
ok "codex: -r accepts only an explicit UUID session id, so native resume options cannot be injected"

AUTO_RETIRED_PRE="$(find "$TMP_ROOT" -maxdepth 1 -type f -name '.agent-run-retired.*' | wc -l)"
run_wrapper consult codex -p 'where does the answer land'
expect_code 0 "auto answer file"
AUTO_ANSWER="$(grep -o 'agent-run: answer: .*' <<<"$OUT" | head -n1 | cut -d' ' -f3-)"
[ -n "$AUTO_ANSWER" ] || fail "auto answer file: no answer trailer ($OUT)"
case "$AUTO_ANSWER" in
  "$TMP_ROOT"/*) ;;
  *) fail "auto answer file: expected a \$TMPDIR path, got $AUTO_ANSWER" ;;
esac
[ "$(cat "$AUTO_ANSWER")" = "fake codex last message" ] || fail "auto answer file: answer content missing"
for artifact in \
  "$AUTO_ANSWER.agent-run" \
  "$AUTO_ANSWER.agent-run.lock" \
  "$AUTO_ANSWER.agent-run.lock.identity"; do
  [ ! -e "$artifact" ] || fail "auto answer file: ancillary artifact leaked at $artifact"
done
AUTO_RETIRED_POST="$(find "$TMP_ROOT" -maxdepth 1 -type f -name '.agent-run-retired.*' | wc -l)"
[ "$AUTO_RETIRED_PRE" = "$AUTO_RETIRED_POST" ] \
  || fail "auto answer file: retired predecessor leaked ($AUTO_RETIRED_PRE -> $AUTO_RETIRED_POST)"
rm -f "$AUTO_ANSWER"
ok "answer: an auto-generated answer survives while its private retry artifacts are reaped"

AUTO_PRE="$(find "$TMP_ROOT" -maxdepth 1 -type f -name 'agent-answer.??????' | wc -l)"
AUTO_RETIRED_PRE="$(find "$TMP_ROOT" -maxdepth 1 -type f -name '.agent-run-retired.*' | wc -l)"
run_wrapper work claude -p hi -- --model sonnet
expect_code 2 "auto answer cleanup on guard rejection"
run_wrapper_env AGENT_FAKE_NO_ENVELOPE=1 -- work claude -p hi
expect_code 1 "auto answer cleanup on backend failure"
FAILED_AUTO_ANSWER="$(sed -n 's/^agent-run: dispatched: .* answer //p' <<<"$OUT" | head -n1)"
[ -n "$FAILED_AUTO_ANSWER" ] || fail "auto answer cleanup: failed dispatch did not name its answer path ($OUT)"
for artifact in \
  "$FAILED_AUTO_ANSWER.agent-run" \
  "$FAILED_AUTO_ANSWER.agent-run.lock" \
  "$FAILED_AUTO_ANSWER.agent-run.lock.identity"; do
  [ ! -e "$artifact" ] || fail "auto answer cleanup: ancillary artifact leaked at $artifact"
done
AUTO_POST="$(find "$TMP_ROOT" -maxdepth 1 -type f -name 'agent-answer.??????' | wc -l)"
[ "$AUTO_PRE" = "$AUTO_POST" ] || fail "auto answer cleanup: files leaked ($AUTO_PRE -> $AUTO_POST)"
AUTO_RETIRED_POST="$(find "$TMP_ROOT" -maxdepth 1 -type f -name '.agent-run-retired.*' | wc -l)"
[ "$AUTO_RETIRED_PRE" = "$AUTO_RETIRED_POST" ] \
  || fail "auto answer cleanup: retired predecessors leaked ($AUTO_RETIRED_PRE -> $AUTO_RETIRED_POST)"
ok "answer: a finalized failed auto-output run removes its answer and private retry artifacts"

AUTO_CLEANUP_READY="$TMP_ROOT/auto-cleanup.ready"
AUTO_CLEANUP_RELEASE="$TMP_ROOT/auto-cleanup.release"
AUTO_CLEANUP_LOG="$TMP_ROOT/auto-cleanup.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_AUTO_CLEANUP_READY="$AUTO_CLEANUP_READY" \
  AGENT_RUN_TEST_AUTO_CLEANUP_RELEASE="$AUTO_CLEANUP_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi) >"$AUTO_CLEANUP_LOG" 2>&1 &
AUTO_CLEANUP_WRAPPER=$!
await_ready "$AUTO_CLEANUP_READY" "$AUTO_CLEANUP_WRAPPER" "auto cleanup identity: wrapper never reached the cleanup boundary" "$AUTO_CLEANUP_LOG"
AUTO_CLEANUP_OUT="$(sed -n 's/^agent-run: dispatched: .* answer //p' "$AUTO_CLEANUP_LOG" | head -n1)"
[ -n "$AUTO_CLEANUP_OUT" ] \
  || fail "auto cleanup identity: dispatched header did not name an answer ($(cat "$AUTO_CLEANUP_LOG"))"
mv "$AUTO_CLEANUP_OUT.agent-run" "$AUTO_CLEANUP_OUT.agent-run.original"
mkdir "$AUTO_CLEANUP_OUT.agent-run"
printf 'replacement bundle\n' >"$AUTO_CLEANUP_OUT.agent-run/replacement"
: >"$AUTO_CLEANUP_RELEASE"
wait "$AUTO_CLEANUP_WRAPPER"
[ "$(cat "$AUTO_CLEANUP_OUT.agent-run/replacement")" = "replacement bundle" ] \
  || fail "auto cleanup identity: a replacement attempt root was deleted"
rm -rf -- "$AUTO_CLEANUP_OUT.agent-run" "$AUTO_CLEANUP_OUT.agent-run.original"
rm -f -- "$AUTO_CLEANUP_OUT"
ok "answer: auto cleanup revalidates the attempt-root inode before recursive removal"

AUTO_CONTENT_READY="$TMP_ROOT/auto-content-retired.ready"
AUTO_CONTENT_RELEASE="$TMP_ROOT/auto-content-retired.release"
AUTO_CONTENT_LOG="$TMP_ROOT/auto-content-retired.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_AUTO_CLEANUP_READY="$AUTO_CONTENT_READY" \
  AGENT_RUN_TEST_AUTO_CLEANUP_RELEASE="$AUTO_CONTENT_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi) >"$AUTO_CONTENT_LOG" 2>&1 &
AUTO_CONTENT_WRAPPER=$!
await_ready "$AUTO_CONTENT_READY" "$AUTO_CONTENT_WRAPPER" "auto cleanup content: wrapper never reached the cleanup boundary" "$AUTO_CONTENT_LOG"
AUTO_CONTENT_RETIRED="$(find "$TMP_ROOT" -maxdepth 1 -type f -name '.agent-run-retired.*' -print -quit)"
[ -n "$AUTO_CONTENT_RETIRED" ] \
  || fail "auto cleanup content: retired predecessor was not retained through finalization"
printf 'late auto content\n' >"$AUTO_CONTENT_RETIRED"
: >"$AUTO_CONTENT_RELEASE"
wait "$AUTO_CONTENT_WRAPPER"
[ "$(cat "$AUTO_CONTENT_RETIRED")" = "late auto content" ] \
  || fail "auto cleanup content: non-empty retired inode was deleted"
rm -f -- "$AUTO_CONTENT_RETIRED"
AUTO_CONTENT_OUT="$(sed -n 's/^agent-run: dispatched: .* answer //p' "$AUTO_CONTENT_LOG" | head -n1)"
rm -f -- "$AUTO_CONTENT_OUT"
ok "answer: auto cleanup preserves a retired predecessor that gained content"

run_wrapper review codex -- --commit abc123
expect_code 0 "codex review"
expect_out "ARG:review" "codex review args"
expect_out "ARG:--commit" "codex review args"
expect_out "ARG:abc123" "codex review args"
ok "codex: review passes native mode flags through"

run_wrapper review codex -p 'focus on auth' -- --base main
expect_code 0 "codex review prompt"
expect_out "ARG:focus on auth" "codex review prompt args"
ok "codex: review composes a custom-instruction prompt with mode flags"

# --- session-id anchoring ---------------------------------------------------------

run_wrapper_env AGENT_FAKE_CODEX_HEADER_AFTER_ARGS=1 -- consult codex -p 'content quoting session id: 99999999-8888-7777-6666-555555555555 and --resume=99999999-8888-7777-6666-555555555555 must not win'
expect_code 0 "codex sid poisoning"
expect_out "agent-run: session-id: 12345678-1234-1234-1234-123456789abc" "codex sid poisoning"
ok "codex: quoted --resume ids in log content cannot poison the session trailer"

# The fake's share transcript body always quotes a decoy --resume id, so this
# passing proves the header anchoring, not just extraction.
run_wrapper consult copilot -m m -p 'transcript bodies quote prompt content'
expect_code 0 "copilot sid poisoning"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot sid poisoning"
ok "copilot: quoted --resume ids in the transcript body cannot poison the session trailer"

# --- prompt assembly and stdin policy ---------------------------------------------

MATERIAL="$TMP_ROOT/material.md"
printf 'finding one\nfinding two\n' >"$MATERIAL"
run_wrapper work codex -p 'fix these findings' -f "$MATERIAL"
expect_code 0 "prompt file compose"
expect_out "<attached>" "prompt file compose"
expect_out "finding two" "prompt file compose"
ok "prompt: -f material is appended as an <attached> block"

MATERIAL_TWO="$TMP_ROOT/material-two.md"
printf 'finding three\n' >"$MATERIAL_TWO"
run_wrapper work codex -p 'fix these findings' -f "$MATERIAL" -f "$MATERIAL_TWO"
expect_code 0 "repeated -f compose"
expect_out "finding two" "repeated -f first material"
expect_out "finding three" "repeated -f second material"
ok "prompt: -f repeats, attaching each material file as its own block"

# the untracked material file dirties the worktree, hence --dirty-ok
printf 'dash material\n' >"$WORKTREE/-material.md"
run_wrapper work codex -p 'fix this' --dirty-ok -f -material.md
expect_code 0 "leading dash prompt file"
expect_out "dash material" "leading dash prompt file"
rm -f -- "$WORKTREE/-material.md"
ok "prompt: leading-dash -f paths are read as file operands, not cat options"

run_wrapper work codex -p '-m is broken, fix it'
expect_code 0 "codex leading-dash prompt"
expect_out "ARG:--" "codex leading-dash prompt separator"
expect_out "ARG:-m is broken, fix it" "codex leading-dash prompt"
run_wrapper work claude -p '-m is broken, fix it'
expect_code 0 "claude leading-dash prompt"
expect_out "ARG:--" "claude leading-dash prompt separator"
expect_out "ARG:-m is broken, fix it" "claude leading-dash prompt"
ok "prompt: leading-dash work prompts are separated from backend flags"

run_wrapper review codex -p '-m review this' -- --commit abc123
expect_code 0 "codex review leading-dash prompt"
expect_out "ARG:--" "codex review leading-dash prompt separator"
expect_out "ARG:-m review this" "codex review leading-dash prompt"
ok "prompt: leading-dash codex review instructions are separated from backend flags"

set +e
OUT="$(cd "$WORKTREE" && printf 'pipe material' | PATH="$FAKE_BIN:$PATH" AGENT_FAKE_READ_STDIN=1 bash "$WRAPPER" work codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "pipe stdin closed"
expect_out "STDIN:[]" "pipe stdin closed"
ok "stdin: an inherited pipe is closed before dispatch (codex would hang)"

run_wrapper_env AGENT_FAKE_READ_STDIN=1 -- work codex -p hi <"$MATERIAL"
expect_code 0 "file stdin closed"
expect_out "STDIN:[]" "file stdin closed"
ok "stdin: redirected files are also closed — material goes through -f"

BIG_FILE="$TMP_ROOT/big-material.txt"
{ head -c 120000 /dev/zero | tr '\0' 'x'; printf '\nENDMARKER\n'; } >"$BIG_FILE"

run_wrapper_env AGENT_FAKE_READ_STDIN=1 -- work codex -p 'apply this' -f "$BIG_FILE"
expect_code 0 "codex oversize prompt"
expect_out "ENDMARKER" "codex oversize prompt"
expect_not_out "ARG:apply this" "codex oversize prompt"
ok "prompt: oversize material falls back to stdin delivery for codex"

run_wrapper_env AGENT_FAKE_READ_STDIN=1 -- work claude -p 'apply this' -f "$BIG_FILE"
expect_code 0 "claude oversize prompt"
expect_out "ENDMARKER" "claude oversize prompt"
expect_not_out "ARG:apply this" "claude oversize prompt"
ok "prompt: oversize material falls back to stdin delivery for claude"

run_wrapper work copilot -m m -p 'apply this' -f "$BIG_FILE"
expect_code 2 "copilot oversize prompt"
expect_out "too large" "copilot oversize prompt"
ok "prompt: oversize material is rejected for copilot (no stdin support)"

run_wrapper work codex -p 'apply this' -f "$BIG_FILE" -r 12345678-1234-1234-1234-123456789abc
expect_code 2 "codex resume oversize prompt"
expect_out "too large" "codex resume oversize prompt"
ok "prompt: oversize material is rejected for codex resume (stdin ignored)"

run_wrapper review codex -p "$(cat "$BIG_FILE")"
expect_code 2 "review oversize prompt"
expect_out "too large" "review oversize prompt"
ok "prompt: oversize review instructions are rejected before argv blows up"

# --- mission file (-P/--mission-file) -----------------------------------------------

MISSION_FILE_PATH="$TMP_ROOT/mission.prompt"
printf 'mission from file\nline two\n' >"$MISSION_FILE_PATH"
run_wrapper work codex --mission-file "$MISSION_FILE_PATH"
expect_code 0 "mission-file work codex"
expect_out "mission from file" "mission-file content"
expect_out "line two" "mission-file content"
expect_not_out "<attached>" "mission-file is the mission, not attached material"
ok "mission: --mission-file reads the mission text from a file"

run_wrapper work codex -P "$MISSION_FILE_PATH"
expect_code 0 "mission-file -P alias"
expect_out "mission from file" "mission-file -P alias"
ok "mission: -P is an alias for --mission-file"

EQ_MISSION="$TMP_ROOT/mission-eq.prompt"
printf 'identical mission text\n' >"$EQ_MISSION"
run_wrapper work claude -p 'identical mission text'
expect_code 0 "mission equivalence -p"
P_ARGS="$(grep '^ARG:' <<<"$OUT")"
run_wrapper work claude --mission-file "$EQ_MISSION"
expect_code 0 "mission equivalence --mission-file"
FILE_ARGS="$(grep '^ARG:' <<<"$OUT")"
[ "$P_ARGS" = "$FILE_ARGS" ] || fail "mission equivalence: -p and --mission-file assemble different backend argv"
ok "mission: --mission-file assembles the same backend argv as -p with identical text"

run_wrapper consult claude --mission-file "$EQ_MISSION"
expect_code 0 "mission-file consult"
expect_out "Do not modify files" "mission-file consult preamble"
expect_out "identical mission text" "mission-file consult mission"
ok "mission: consult composes the read-only preamble ahead of a mission-file mission"

run_wrapper work codex --mission-file "$MISSION_FILE_PATH" -f "$MATERIAL"
expect_code 0 "mission-file with -f"
expect_out "mission from file" "mission-file with -f mission"
expect_out "<attached>" "mission-file with -f attachment block"
expect_out "finding two" "mission-file with -f material"
ok "mission: -f material still attaches after a mission-file mission"

# -P is repeatable; a single -p composes with the -P files in caller order,
# separated by a blank line, and reaches the backend once as a single mission
# prompt (the resume-composition one-command path: original mission file +
# recovery note).
ORDER_A="$TMP_ROOT/mission-order-a.prompt"
ORDER_B="$TMP_ROOT/mission-order-b.prompt"
printf 'ALPHA mission component\n' >"$ORDER_A"
printf 'BETA mission component\n' >"$ORDER_B"
run_wrapper work codex -P "$ORDER_A" -P "$ORDER_B"
expect_code 0 "two mission files compose"
expect_out "ALPHA mission component" "two mission files compose first component"
expect_out "BETA mission component" "two mission files compose second component"
A_LINE="$(first_line_matching 'ARG:ALPHA mission component' "$OUT")"
B_LINE="$(first_line_matching 'BETA mission component' "$OUT")"
{ [ -n "$A_LINE" ] && [ -n "$B_LINE" ] && [ "$B_LINE" -gt "$A_LINE" ]; } \
  || fail "two mission files compose: components not in caller order ($OUT)"
# the two components share one prompt argument, joined by the documented blank
# line: the line after the first component is empty and the next is the second
[ -z "$(sed -n "$((A_LINE + 1))p" <<<"$OUT")" ] \
  || fail "two mission files compose: no blank-line separator between components ($OUT)"
ok "mission: repeatable -P composes components once, in caller order, blank-line separated"

run_wrapper work codex -p 'INLINE component' -P "$ORDER_B"
expect_code 0 "-p composes with -P"
PI_LINE="$(first_line_matching 'ARG:INLINE component' "$OUT")"
PB_LINE="$(first_line_matching 'BETA mission component' "$OUT")"
{ [ -n "$PI_LINE" ] && [ -n "$PB_LINE" ] && [ "$PB_LINE" -gt "$PI_LINE" ]; } \
  || fail "-p composes with -P: components not in caller order ($OUT)"
run_wrapper work codex -P "$ORDER_B" -p 'INLINE tail'
expect_code 0 "-P composes with -p"
TB_LINE="$(first_line_matching 'ARG:BETA mission component' "$OUT")"
TI_LINE="$(first_line_matching 'INLINE tail' "$OUT")"
{ [ -n "$TB_LINE" ] && [ -n "$TI_LINE" ] && [ "$TI_LINE" -gt "$TB_LINE" ]; } \
  || fail "-P composes with -p: components not in caller order ($OUT)"
ok "mission: -p and -P interleave in caller order in either arrangement"

run_wrapper work codex --mission-file "$TMP_ROOT/no-such-mission.prompt"
expect_code 2 "missing mission file"
expect_out "no-such-mission.prompt" "missing mission file names the path"
run_wrapper work codex --mission-file "$TMP_ROOT"
expect_code 2 "mission-file directory"
expect_out "directory" "mission-file directory"
EMPTY_MISSION="$TMP_ROOT/mission-empty.prompt"
: >"$EMPTY_MISSION"
run_wrapper work codex --mission-file "$EMPTY_MISSION"
expect_code 2 "empty mission file"
expect_out "empty" "empty mission file"
WHITESPACE_MISSION="$TMP_ROOT/mission-whitespace.prompt"
printf ' \t\n' >"$WHITESPACE_MISSION"
for backend in claude codex copilot cursor; do
  run_wrapper work "$backend" --mission-file "$WHITESPACE_MISSION" -f "$MATERIAL"
  expect_code 2 "whitespace-only mission file ($backend)"
  expect_out "non-whitespace" "whitespace-only mission file ($backend)"
  assert_prelaunch_reject_contract "whitespace-only mission-file contract ($backend)" "$OUT"
done
run_wrapper work codex --mission-file
expect_code 2 "bare --mission-file"
ok "mission: missing, directory, empty, whitespace-only, and valueless mission files are usage errors"

# A composed mission that reduces to only whitespace is still rejected, naming
# the offending component.
run_wrapper work codex -P "$MISSION_FILE_PATH" -P "$WHITESPACE_MISSION"
expect_code 2 "composed mission with a whitespace component"
expect_out "non-whitespace" "composed mission with a whitespace component"
ok "mission: a whitespace-only component in a composed mission is rejected by name"

# A whitespace-only -p component must be rejected on its own merits even when it
# composes with a non-whitespace -P file that would otherwise carry the aggregate
# past the non-whitespace check.
run_wrapper work codex -p '   ' -P "$MISSION_FILE_PATH"
expect_code 2 "whitespace-only -p composed with a valid -P"
expect_out "non-whitespace" "whitespace-only -p composed with a valid -P"
assert_prelaunch_reject_contract "whitespace-only -p composed contract" "$OUT"
ok "mission: a whitespace-only -p component is rejected even when a -P file follows"

UNREADABLE_MISSION="$TMP_ROOT/mission-unreadable.prompt"
printf 'hidden\n' >"$UNREADABLE_MISSION"
chmod a-r "$UNREADABLE_MISSION"
if [ -r "$UNREADABLE_MISSION" ]; then
  ok "skipped unreadable mission-file check (privileged user reads anything)"
else
  run_wrapper work codex --mission-file "$UNREADABLE_MISSION"
  expect_code 2 "unreadable mission file"
  expect_out "readable" "unreadable mission file"
  ok "mission: an unreadable mission file is a usage error"
fi
chmod u+r "$UNREADABLE_MISSION"

# Mission files are caller input, not wrapper output, so the -o in-tree write
# guard must not apply to them.
printf 'in-tree mission\n' >"$WORKTREE/mission-in-tree.prompt"
run_wrapper consult claude --mission-file mission-in-tree.prompt
expect_code 0 "in-tree mission file"
expect_out "in-tree mission" "in-tree mission file"
expect_out "agent-run: worktree: best-effort-clean" "in-tree mission file drift"
rm -f "$WORKTREE/mission-in-tree.prompt"
ok "mission: a mission file inside the worktree is accepted (caller input, not an in-tree write)"

# --- failure normalization ---------------------------------------------------------

run_wrapper_env AGENT_FAKE_EXIT=7 -- work codex -p hi
expect_code 1 "backend exit remap"
expect_out "agent-run: backend-exit: 7" "backend exit remap"
ok "failure: backend exit codes normalize to 1 with a backend-exit trailer"
assert_finalized_contract "backend failure contract" "$OUT"
ok "contract: backend failures exit 1 with launch header before completion anchors"

run_wrapper_env AGENT_FAKE_EXIT=3 -- work copilot -m m -p hi -o "$TMP_ROOT/copilot-failed.txt"
expect_code 1 "copilot -o failure"
expect_out "agent-run: backend-exit: 3" "copilot -o failure"
expect_not_out "agent-run: answer:" "copilot -o failure"
COPILOT_FAILED_ATTEMPT="$(attempt_current_id "$TMP_ROOT/copilot-failed.txt")"
COPILOT_FAILED_RECORD="$(attempt_record_path "$TMP_ROOT/copilot-failed.txt")"
[ ! -e "$TMP_ROOT/copilot-failed.txt.agent-run/$COPILOT_FAILED_ATTEMPT/answer.tmp" ] \
  || fail "copilot -o failure: private answer candidate survived settled failure"
grep -qFx 'state=finalized' "$COPILOT_FAILED_RECORD" \
  || fail "copilot -o failure: failed attempt was not finalized"
grep -qFx 'answer-outcome=no-answer' "$COPILOT_FAILED_RECORD" \
  || fail "copilot -o failure: failed attempt did not record no-answer"
ok "failure: a failed run never masquerades as lock-busy or advertises an empty answer"

STALE_COPILOT_OUT="$TMP_ROOT/copilot-stale.txt"
printf '# Copilot CLI Session\n> - **Session ID:** `11111111-1111-1111-1111-111111111111`\n' >"$STALE_COPILOT_OUT.transcript.md"
run_wrapper work copilot -m m -p hi -o "$STALE_COPILOT_OUT"
expect_code 0 "copilot legacy fixed sidecar"
expect_not_out "11111111-1111-1111-1111-111111111111" "copilot stale sidecar"
[ "$(head -n1 "$STALE_COPILOT_OUT.transcript.md")" = "# Copilot CLI Session" ] \
  || fail "copilot legacy fixed sidecar: prior transcript was changed"
rm -f "$STALE_COPILOT_OUT" "$STALE_COPILOT_OUT.transcript.md"
ok "copilot: a legacy fixed sidecar is preserved and cannot poison a new attempt"

run_wrapper_env AGENT_FAKE_NO_ENVELOPE=1 -- work claude -p hi
expect_code 1 "claude envelope missing"
expect_out "envelope" "claude envelope missing"
ok "failure: a missing claude result envelope fails the run instead of a silent 0"

run_wrapper_env AGENT_FAKE_EMPTY_ANSWER=1 -- work copilot -m m -p hi -o "$TMP_ROOT/copilot-empty.txt"
expect_code 1 "empty -o answer"
expect_out "no answer landed" "empty -o answer"
ok "failure: success with an empty -o answer file is flagged as a failure"

run_wrapper_env AGENT_FAKE_EMPTY_RESULT=1 -- work claude -p hi -o "$TMP_ROOT/claude-empty.txt"
expect_code 1 "claude empty result"
expect_out "no answer landed" "claude empty result"
ok "failure: an empty claude result with -o is a broken answer contract, not a blank success"

WHITESPACE_CLAUDE_OUT="$TMP_ROOT/claude-whitespace.txt"
run_wrapper_env AGENT_FAKE_WHITESPACE_RESULT=1 -- work claude -p hi -o "$WHITESPACE_CLAUDE_OUT"
expect_code 1 "claude whitespace result"
expect_out "no answer landed" "claude whitespace result"
if [ -s "$WHITESPACE_CLAUDE_OUT" ]; then fail "claude whitespace result: whitespace-only answer survived"; fi
ok "failure: a whitespace-only claude result with -o is a no-answer failure"

run_wrapper_env AGENT_FAKE_IS_ERROR=1 -- work claude -p hi
expect_code 1 "claude is_error envelope"
expect_out "error result" "claude is_error envelope"
ok "failure: an is_error claude envelope fails the run even on backend exit 0"

FAILED_ANSWER_OUT="$TMP_ROOT/claude-error-answer.txt"
run_wrapper_env AGENT_FAKE_IS_ERROR=1 -- work claude -p hi -o "$FAILED_ANSWER_OUT"
expect_code 1 "claude is_error answer publication"
expect_out "error result" "claude is_error answer publication"
expect_out "agent-run: answer: $FAILED_ANSWER_OUT" "claude is_error answer publication"
[ "$(cat "$FAILED_ANSWER_OUT")" = "fake claude answer" ] \
  || fail "claude is_error answer publication: complete answer was not published"
FAILED_ANSWER_RECORD="$(attempt_record_path "$FAILED_ANSWER_OUT")"
grep -qFx 'state=finalized' "$FAILED_ANSWER_RECORD" \
  || fail "claude is_error answer publication: attempt was not finalized"
grep -qFx 'backend-disposition=error-envelope' "$FAILED_ANSWER_RECORD" \
  || fail "claude is_error answer publication: technical failure disposition was lost"
grep -qFx 'answer-outcome=answer' "$FAILED_ANSWER_RECORD" \
  || fail "claude is_error answer publication: published answer was recorded as no-answer"
ok "failure: a complete answer is published even when the backend disposition fails"

run_wrapper_env AGENT_FAKE_EMPTY_RESULT=1 -- work claude -p hi
expect_code 1 "claude empty result no -o"
expect_out "no answer landed" "claude empty result no -o"
ok "failure: an empty claude result with no -o still fails the auto answer-file contract"

STALE_OUT="$TMP_ROOT/codex-stale.msg"
printf 'STALE ANSWER FROM A PRIOR RUN\n' >"$STALE_OUT"
run_wrapper work codex -p hi -o "$STALE_OUT"
expect_code 2 "codex reused -o"
expect_out "already holds" "codex reused -o"
[ "$(cat "$STALE_OUT")" = "STALE ANSWER FROM A PRIOR RUN" ] || fail "codex reused -o: the prior answer was clobbered by the rejection"
rm -f "$STALE_OUT"
ok "usage: a reused non-empty -o path is rejected with the prior answer left intact"

run_wrapper_env AGENT_FAKE_SKIP_OUTPUT=1 -- work codex -p hi -o "$TMP_ROOT/codex-nowrite.msg"
expect_code 1 "codex no-write -o"
expect_out "no answer landed" "codex no-write -o"
ok "failure: a backend that writes no -o still fails the answer contract on a fresh path"

EMPTY_REUSE_OUT="$TMP_ROOT/codex-empty-reuse.msg"
: >"$EMPTY_REUSE_OUT"
run_wrapper work codex -p hi -o "$EMPTY_REUSE_OUT"
expect_code 2 "unattributed empty -o reuse"
expect_out "no finalized no-answer attempt" "unattributed empty -o reuse"
rm -f "$EMPTY_REUSE_OUT"
ok "attempts: an arbitrary empty -o without a finalized no-answer record is not retryable"

run_wrapper work codex -p hi -o "$TMP_ROOT/no-such-dir/answer.msg"
expect_code 2 "codex unwritable -o"
expect_out "cannot write" "codex unwritable -o"
ok "usage: an -o path whose directory is missing fails fast before the run"

BROKEN_SYMLINK_TARGET="$TMP_ROOT/broken-symlink-target.msg"
BROKEN_SYMLINK_OUT="$TMP_ROOT/broken-symlink-out.msg"
ln -s "$BROKEN_SYMLINK_TARGET" "$BROKEN_SYMLINK_OUT"
run_wrapper consult claude -p hi -o "$BROKEN_SYMLINK_OUT"
expect_code 2 "broken symlink -o"
expect_out "already exists as a symbolic link" "broken symlink -o"
expect_not_out "agent-run: dispatched:" "broken symlink -o"
[ -L "$BROKEN_SYMLINK_OUT" ] \
  || fail "broken symlink -o: wrapper replaced the caller's symlink"
[ ! -e "$BROKEN_SYMLINK_TARGET" ] \
  || fail "broken symlink -o: wrapper created content at the missing target"
[ ! -e "$BROKEN_SYMLINK_TARGET.agent-run" ] \
  || fail "broken symlink -o: wrapper claimed a bundle at the missing target"
ok "usage: a broken -o symlink is occupied and cannot redirect answer ownership"

# --- per-answer attempt ownership -------------------------------------------------

NO_ANSWER_RETRY_OUT="$TMP_ROOT/no-answer-retry.msg"
seed_no_answer_predecessor "$NO_ANSWER_RETRY_OUT" "finalized no-answer predecessor"
NO_ANSWER_RECORD="$(attempt_record_path "$NO_ANSWER_RETRY_OUT")"
grep -qFx 'state=finalized' "$NO_ANSWER_RECORD" \
  || fail "finalized no-answer predecessor: record is not finalized ($(cat "$NO_ANSWER_RECORD"))"
grep -qFx 'answer-outcome=no-answer' "$NO_ANSWER_RECORD" \
  || fail "finalized no-answer predecessor: record outcome is not no-answer ($(cat "$NO_ANSWER_RECORD"))"
[ ! -e "$NO_ANSWER_RETRY_OUT.agent-run/bundle.key" ] \
  || fail "finalized no-answer predecessor: new bundle retained the obsolete authentication key"
if grep -q '^record-seal=' "$NO_ANSWER_RECORD"; then
  fail "finalized no-answer predecessor: new record retained the obsolete seal"
fi
FIRST_NO_ANSWER_ATTEMPT="$(attempt_current_id "$NO_ANSWER_RETRY_OUT")"
# Pre-removal bundles carry both artifacts. Preserve them as ignored legacy
# metadata so a user can retry a conclusively finalized no-answer attempt
# without an unexpected mid-branch recovery failure.
printf '%064d\n' 0 >"$NO_ANSWER_RETRY_OUT.agent-run/bundle.key"
chmod 600 "$NO_ANSWER_RETRY_OUT.agent-run/bundle.key"
printf 'record-seal=%064d\n' 0 >>"$NO_ANSWER_RECORD"
run_wrapper consult claude -p hi -o "$NO_ANSWER_RETRY_OUT"
expect_code 0 "retry after finalized no-answer predecessor"
SECOND_NO_ANSWER_ATTEMPT="$(attempt_current_id "$NO_ANSWER_RETRY_OUT")"
[ "$FIRST_NO_ANSWER_ATTEMPT" != "$SECOND_NO_ANSWER_ATTEMPT" ] \
  || fail "retry after finalized no-answer predecessor: attempt identity was reused"
if grep -q '^record-seal=' "$(attempt_record_path "$NO_ANSWER_RETRY_OUT")"; then
  fail "retry after legacy finalized no-answer predecessor: new record retained the obsolete seal"
fi
ok "attempts: legacy sealed records remain retryable but new attempts omit seal machinery"

RESERVED_BUNDLE_OWNER_OUT="$TMP_ROOT/reserved-bundle-owner.msg"
seed_no_answer_predecessor "$RESERVED_BUNDLE_OWNER_OUT" "reserved bundle owner predecessor"
RESERVED_NESTED_OUT="$RESERVED_BUNDLE_OWNER_OUT.agent-run/current"
run_wrapper consult codex -p hi -o "$RESERVED_NESTED_OUT"
expect_code 2 "output inside reserved attempt bundle"
expect_out "inside reserved attempt bundle" "output inside reserved attempt bundle"
expect_not_out "agent-run: dispatched:" "output inside reserved attempt bundle"
[ ! -e "$RESERVED_NESTED_OUT.agent-run.lock" ] \
  || fail "reserved bundle output: derived lock polluted another output's attempt bundle"
[ ! -e "$RESERVED_NESTED_OUT.agent-run.lock.identity" ] \
  || fail "reserved bundle output: derived lock identity polluted another output's attempt bundle"
run_wrapper consult claude -p hi -o "$RESERVED_BUNDLE_OWNER_OUT"
expect_code 0 "owner retry after reserved bundle output rejection"
ok "attempts: nested output rejection cannot pollute another output's reserved bundle"

RESERVED_SHARE_OWNER_OUT="$TMP_ROOT/reserved-share-owner.msg"
run_wrapper_env AGENT_FAKE_COPILOT_INTENT_ONLY=1 -- consult copilot -m m -p hi -o "$RESERVED_SHARE_OWNER_OUT"
expect_code 1 "reserved share bundle owner predecessor"
RESERVED_NESTED_SHARE="$RESERVED_SHARE_OWNER_OUT.agent-run/$(attempt_current_id "$RESERVED_SHARE_OWNER_OUT")/copilot-transcript.md"
RESERVED_SHARE_CONTENDER_OUT="$TMP_ROOT/reserved-share-contender.msg"
run_wrapper consult copilot -m m -p hi -o "$RESERVED_SHARE_CONTENDER_OUT" \
  -- "--share=$RESERVED_NESTED_SHARE"
expect_code 2 "caller share inside reserved attempt bundle"
expect_out "inside reserved attempt bundle" "caller share inside reserved attempt bundle"
expect_not_out "agent-run: dispatched:" "caller share inside reserved attempt bundle"
[ ! -e "$RESERVED_NESTED_SHARE.agent-run.lock" ] \
  || fail "reserved bundle share: derived lock polluted another output's attempt bundle"
[ ! -e "$RESERVED_NESTED_SHARE.agent-run.lock.identity" ] \
  || fail "reserved bundle share: derived lock identity polluted another output's attempt bundle"
run_wrapper consult copilot -m m -p hi -o "$RESERVED_SHARE_OWNER_OUT"
expect_code 0 "owner retry after reserved bundle share rejection"
ok "attempts: nested caller-share rejection cannot pollute another output's reserved bundle"

FRESH_ALLOC_FAIL_OUT="$TMP_ROOT/fresh-attempt-allocation-failure.msg"
run_wrapper_env AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL=1 -- consult claude -p hi -o "$FRESH_ALLOC_FAIL_OUT"
expect_code 2 "fresh attempt allocation failure"
expect_out "cannot allocate an attempt record" "fresh attempt allocation failure"
[ ! -e "$FRESH_ALLOC_FAIL_OUT.agent-run" ] \
  || fail "fresh attempt allocation failure: record-less bundle survived without a current pointer"
run_wrapper consult claude -p hi -o "$FRESH_ALLOC_FAIL_OUT"
expect_code 0 "retry after fresh attempt allocation failure"
ok "attempts: first-attempt allocation failure leaves the untouched output retryable"

PARTIAL_BUNDLE_BIN="$TMP_ROOT/partial-bundle-bin"
PARTIAL_BUNDLE_OUT="$TMP_ROOT/partial-bundle-initialization-failure.msg"
REAL_CHMOD="$(command -v chmod)"
mkdir "$PARTIAL_BUNDLE_BIN"
cat >"$PARTIAL_BUNDLE_BIN/chmod" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = 700 ] && [[ "${!#}" = *.agent-run ]]; then
  exit 1
fi
exec "$AGENT_REAL_CHMOD" "$@"
EOF
chmod +x "$PARTIAL_BUNDLE_BIN/chmod"
set +e
OUT="$(cd "$WORKTREE" && PATH="$PARTIAL_BUNDLE_BIN:$FAKE_BIN:$PATH" \
  AGENT_REAL_CHMOD="$REAL_CHMOD" \
  bash "$WRAPPER" consult claude -p hi -o "$PARTIAL_BUNDLE_OUT" 2>&1)"
CODE=$?
set -e
expect_code 2 "partial attempt bundle initialization failure"
expect_out "cannot secure attempt bundle" "partial attempt bundle initialization failure"
[ ! -e "$PARTIAL_BUNDLE_OUT.agent-run" ] \
  || fail "partial attempt bundle initialization failure: incomplete bundle survived cleanup"
run_wrapper consult claude -p hi -o "$PARTIAL_BUNDLE_OUT"
expect_code 0 "retry after partial attempt bundle initialization failure"
ok "attempts: partial bundle initialization failure leaves the untouched output retryable"

ALLOC_FAIL_OUT="$TMP_ROOT/attempt-allocation-failure.msg"
seed_no_answer_predecessor "$ALLOC_FAIL_OUT" "attempt allocation failure predecessor"
run_wrapper_env AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL=1 -- consult claude -p hi -o "$ALLOC_FAIL_OUT"
expect_code 2 "attempt allocation failure"
expect_out "cannot allocate an attempt record" "attempt allocation failure"
run_wrapper consult claude -p hi -o "$ALLOC_FAIL_OUT"
expect_code 0 "retry after attempt allocation failure"
ok "attempts: allocation failure does not advance the durable sequence"

CLAIM_SIGNAL_OUT="$TMP_ROOT/attempt-claim-signal.msg"
CLAIM_SIGNAL_READY="$TMP_ROOT/attempt-claim-signal.ready"
CLAIM_SIGNAL_RELEASE="$TMP_ROOT/attempt-claim-signal.release"
CLAIM_SIGNAL_LOG="$TMP_ROOT/attempt-claim-signal.log"
seed_no_answer_predecessor "$CLAIM_SIGNAL_OUT" "attempt claim signal predecessor"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_ATTEMPT_CLAIM_READY="$CLAIM_SIGNAL_READY" \
  AGENT_RUN_TEST_ATTEMPT_CLAIM_RELEASE="$CLAIM_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$CLAIM_SIGNAL_OUT") >"$CLAIM_SIGNAL_LOG" 2>&1 &
CLAIM_SIGNAL_WRAPPER=$!
await_ready "$CLAIM_SIGNAL_READY" "$CLAIM_SIGNAL_WRAPPER" "attempt claim signal: wrapper never reached the allocated-before-sequence boundary" "$CLAIM_SIGNAL_LOG"
kill -TERM "$CLAIM_SIGNAL_WRAPPER"
: >"$CLAIM_SIGNAL_RELEASE"
wait_wrapper "$CLAIM_SIGNAL_WRAPPER" "$CLAIM_SIGNAL_LOG"
expect_code 1 "attempt claim signal"
grep -qFx 'state=finalized' "$(attempt_record_path "$CLAIM_SIGNAL_OUT")" \
  || fail "attempt claim signal: deferred signal did not finalize the claimed attempt"
run_wrapper consult claude -p hi -o "$CLAIM_SIGNAL_OUT"
expect_code 0 "retry after attempt claim signal"
ok "attempts: TERM during claim cannot strand the durable sequence"

# The same deferred TERM with an auto-generated -o. Auto-output cleanup reaps an
# ordinary finalized run, but a signal-finalized attempt is crash evidence: its
# record is what the already-printed `attempt:` trailer names, its bundle holds
# the only copy of a copilot session id, and agent-wait.sh can only classify the
# abort as retryable (22) while that record survives.
AUTO_SIGNAL_READY="$TMP_ROOT/auto-attempt-claim-signal.ready"
AUTO_SIGNAL_RELEASE="$TMP_ROOT/auto-attempt-claim-signal.release"
AUTO_SIGNAL_LOG="$TMP_ROOT/auto-attempt-claim-signal.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_ATTEMPT_CLAIM_READY="$AUTO_SIGNAL_READY" \
  AGENT_RUN_TEST_ATTEMPT_CLAIM_RELEASE="$AUTO_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi) >"$AUTO_SIGNAL_LOG" 2>&1 &
AUTO_SIGNAL_WRAPPER=$!
await_ready "$AUTO_SIGNAL_READY" "$AUTO_SIGNAL_WRAPPER" "auto-output claim signal: wrapper never reached the claim boundary" "$AUTO_SIGNAL_LOG"
kill -TERM "$AUTO_SIGNAL_WRAPPER"
: >"$AUTO_SIGNAL_RELEASE"
wait_wrapper "$AUTO_SIGNAL_WRAPPER" "$AUTO_SIGNAL_LOG"
expect_code 1 "auto-output claim signal"
assert_prelaunch_reject_contract "auto-output claim signal" "$OUT"
AUTO_SIGNAL_RECORD="$(sed -n 's/^agent-run: attempt: .* record \(.*\) wrapper-pid [0-9][0-9]*$/\1/p' \
  "$AUTO_SIGNAL_LOG" | head -n1)"
[ -n "$AUTO_SIGNAL_RECORD" ] \
  || fail "auto-output claim signal: attempt trailer did not name a record ($OUT)"
[ -f "$AUTO_SIGNAL_RECORD" ] \
  || fail "auto-output claim signal: cleanup reaped the record the attempt trailer names ($AUTO_SIGNAL_RECORD)"
AUTO_SIGNAL_ROOT="${AUTO_SIGNAL_RECORD%/*/record}"
[ -d "$AUTO_SIGNAL_ROOT" ] \
  || fail "auto-output claim signal: cleanup reaped the auto-generated attempt bundle ($AUTO_SIGNAL_ROOT)"
grep -qFx 'state=finalized' "$AUTO_SIGNAL_RECORD" \
  || fail "auto-output claim signal: deferred signal did not finalize the claimed attempt"
grep -qFx 'answer-outcome=no-answer' "$AUTO_SIGNAL_RECORD" \
  || fail "auto-output claim signal: finalized attempt was not recorded as no-answer"
set +e
OUT="$(bash "$WAITER" "$AUTO_SIGNAL_LOG" --timeout 0 2>&1)"
CODE=$?
set -e
expect_code 22 "auto-output claim signal waiter classification"
expect_out "attempt=finalized-no-answer retryable=yes" "auto-output claim signal waiter classification"
AUTO_SIGNAL_BASE="${AUTO_SIGNAL_ROOT%.agent-run}"
rm -rf -- "$AUTO_SIGNAL_ROOT" "$AUTO_SIGNAL_BASE" \
  "$AUTO_SIGNAL_BASE.agent-run.lock" "$AUTO_SIGNAL_BASE.agent-run.lock.identity"
ok "attempts: a signal-finalized auto-generated attempt keeps its recovery bundle for waiter exit 22"

EARLY_CLAIM_SIGNAL_OUT="$TMP_ROOT/early-attempt-claim-signal.msg"
EARLY_CLAIM_SIGNAL_READY="$TMP_ROOT/early-attempt-claim-signal.ready"
EARLY_CLAIM_SIGNAL_RELEASE="$TMP_ROOT/early-attempt-claim-signal.release"
EARLY_CLAIM_SIGNAL_LOG="$TMP_ROOT/early-attempt-claim-signal.log"
seed_no_answer_predecessor "$EARLY_CLAIM_SIGNAL_OUT" "early attempt claim signal predecessor"
EARLY_CLAIM_SIGNAL_PRE="$(attempt_current_id "$EARLY_CLAIM_SIGNAL_OUT")"
: >"$EARLY_CLAIM_SIGNAL_OUT"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_OUT_REMOVE_READY="$EARLY_CLAIM_SIGNAL_READY" \
  AGENT_RUN_TEST_OUT_REMOVE_RELEASE="$EARLY_CLAIM_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$EARLY_CLAIM_SIGNAL_OUT") \
  >"$EARLY_CLAIM_SIGNAL_LOG" 2>&1 &
EARLY_CLAIM_SIGNAL_WRAPPER=$!
await_ready "$EARLY_CLAIM_SIGNAL_READY" "$EARLY_CLAIM_SIGNAL_WRAPPER" "early attempt claim signal: wrapper never reached predecessor retirement" "$EARLY_CLAIM_SIGNAL_LOG"
kill -TERM "$EARLY_CLAIM_SIGNAL_WRAPPER"
: >"$EARLY_CLAIM_SIGNAL_RELEASE"
wait_wrapper "$EARLY_CLAIM_SIGNAL_WRAPPER" "$EARLY_CLAIM_SIGNAL_LOG"
expect_code 1 "early attempt claim signal"
EARLY_CLAIM_SIGNAL_POST="$(attempt_current_id "$EARLY_CLAIM_SIGNAL_OUT")"
[ "$EARLY_CLAIM_SIGNAL_POST" != "$EARLY_CLAIM_SIGNAL_PRE" ] \
  || fail "early attempt claim signal: TERM fired before the replacement attempt became durable"
grep -qFx 'state=finalized' "$(attempt_record_path "$EARLY_CLAIM_SIGNAL_OUT")" \
  || fail "early attempt claim signal: deferred signal did not finalize the replacement attempt"
run_wrapper consult claude -p hi -o "$EARLY_CLAIM_SIGNAL_OUT"
expect_code 0 "retry after early attempt claim signal"
ok "attempts: TERM during predecessor retirement defers until the full claim is durable"

ACTIVE_PREDECESSOR_OUT="$TMP_ROOT/active-predecessor.msg"
write_test_attempt_record "$ACTIVE_PREDECESSOR_OUT" attempt.manual-active active pending pending 0
run_wrapper consult claude -p hi -o "$ACTIVE_PREDECESSOR_OUT"
expect_code 2 "active predecessor"
expect_out "provenance" "active predecessor"
expect_not_out "ARG:" "active predecessor"
ok "attempts: a manufactured active predecessor fails provenance before backend launch"

FINALIZING_PREDECESSOR_OUT="$TMP_ROOT/finalizing-predecessor.msg"
write_test_attempt_record "$FINALIZING_PREDECESSOR_OUT" attempt.manual-finalizing finalizing success pending 0
run_wrapper consult claude -p hi -o "$FINALIZING_PREDECESSOR_OUT"
expect_code 2 "finalizing predecessor"
expect_out "provenance" "finalizing predecessor"
expect_not_out "ARG:" "finalizing predecessor"
ok "attempts: a manufactured finalizing predecessor fails provenance before backend launch"

MALFORMED_PREDECESSOR_OUT="$TMP_ROOT/malformed-predecessor.msg"
mkdir -p "$MALFORMED_PREDECESSOR_OUT.agent-run/attempt.manual-malformed"
printf 'attempt.manual-malformed\n' >"$MALFORMED_PREDECESSOR_OUT.agent-run/current"
printf 'not an attempt record\n' >"$MALFORMED_PREDECESSOR_OUT.agent-run/attempt.manual-malformed/record"
run_wrapper consult claude -p hi -o "$MALFORMED_PREDECESSOR_OUT"
expect_code 2 "malformed predecessor"
expect_out "malformed attempt" "malformed predecessor"
expect_out "dispatch again with a fresh -o path" "malformed predecessor rejection offers the fresh-path escape"
expect_out "Explicit Attempt Recovery" "malformed predecessor rejection names the recovery procedure"
expect_not_out "ARG:" "malformed predecessor"
ok "attempts: a malformed predecessor fails closed without changing its artifacts"

UNBOUND_PREDECESSOR_OUT="$TMP_ROOT/unbound-predecessor.msg"
write_test_attempt_record "$UNBOUND_PREDECESSOR_OUT" attempt.manual-unbound finalized success no-answer 1
run_wrapper consult claude -p hi -o "$UNBOUND_PREDECESSOR_OUT"
expect_code 2 "unbound finalized predecessor"
expect_out "provenance" "unbound finalized predecessor"
expect_not_out "ARG:" "unbound finalized predecessor"
ok "attempts: a manufactured record without bundle lock binding is not retryable"

ORPHANED_CLAIM_OUT="$TMP_ROOT/orphaned-claim.msg"
seed_no_answer_predecessor "$ORPHANED_CLAIM_OUT" "orphaned claim finalized predecessor setup"
ORPHANED_CLAIM_FIRST="$(attempt_current_id "$ORPHANED_CLAIM_OUT")"
run_wrapper_env AGENT_RUN_TEST_CRASH_AFTER_ATTEMPT_RECORD=1 -- consult claude -p hi -o "$ORPHANED_CLAIM_OUT"
expect_code 137 "crash after durable attempt record"
[ "$(attempt_current_id "$ORPHANED_CLAIM_OUT")" = "$ORPHANED_CLAIM_FIRST" ] \
  || fail "crash after durable attempt record: current unexpectedly moved"
[ "$(find "$ORPHANED_CLAIM_OUT.agent-run" -mindepth 1 -maxdepth 1 -type d -name 'attempt.*' | wc -l)" -eq 2 ] \
  || fail "crash after durable attempt record: orphan attempt directory is missing"
run_wrapper consult claude -p hi -o "$ORPHANED_CLAIM_OUT"
expect_code 2 "retry after orphaned claim"
expect_out "unfinalized attempt" "retry after orphaned claim"
expect_not_out "ARG:" "retry after orphaned claim"
ok "attempts: an active attempt orphaned before current moves is discovered and blocks retry"

ORPHANED_CLAIM_DIR=''
for candidate in "$ORPHANED_CLAIM_OUT.agent-run"/attempt.*; do
  if [ "$(basename -- "$candidate")" != "$ORPHANED_CLAIM_FIRST" ]; then
    ORPHANED_CLAIM_DIR="$candidate"
    break
  fi
done
[ -n "$ORPHANED_CLAIM_DIR" ] \
  || fail "deleted orphan lineage: could not locate the orphaned second attempt"
rm -rf -- "$ORPHANED_CLAIM_DIR"
run_wrapper consult claude -p hi -o "$ORPHANED_CLAIM_OUT"
expect_code 2 "retry after orphan cleanup"
expect_out "missing claimed sequence" "retry after orphan cleanup"
expect_not_out "ARG:" "retry after orphan cleanup"
ok "attempts: deleting a newer orphan cannot make an older current lineage retryable"

UNRECORDED_SETUP_OUT="$TMP_ROOT/unrecorded-setup.msg"
run_wrapper_env AGENT_RUN_TEST_ATTEMPT_SETUP_FAIL=1 -- consult claude -p hi -o "$UNRECORDED_SETUP_OUT"
expect_code 2 "unrecorded attempt setup failure"
expect_out "cannot complete attempt setup" "unrecorded attempt setup failure"
[ ! -e "$UNRECORDED_SETUP_OUT.agent-run" ] \
  || fail "unrecorded attempt setup failure: fresh bundle without a current record survived"
run_wrapper consult claude -p hi -o "$UNRECORDED_SETUP_OUT"
expect_code 0 "retry after unrecorded attempt setup failure"
ok "attempts: setup failure before the active record removes its orphan allocation for retry"

if command -v flock >/dev/null 2>&1; then
  FIFO_ANSWER_LOCK_OUT="$TMP_ROOT/fifo-answer-lock.msg"
  mkfifo "$FIFO_ANSWER_LOCK_OUT.agent-run.lock"
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    timeout -k 1 3 bash "$WRAPPER" consult claude -p hi \
      -o "$FIFO_ANSWER_LOCK_OUT" 2>&1)"
  CODE=$?
  set -e
  expect_code 3 "FIFO answer-path lock"
  expect_out "answer-path lock" "FIFO answer-path lock"
  expect_not_out "agent-run: dispatched:" "FIFO answer-path lock"
  rm -f -- "$FIFO_ANSWER_LOCK_OUT.agent-run.lock"

  FIFO_SHARE_LOCK_OUT="$TMP_ROOT/fifo-share-lock-answer.msg"
  FIFO_SHARE_PATH="$TMP_ROOT/fifo-share-lock.md"
  FIFO_SHARE_TARGET="$TMP_ROOT/fifo-share-lock-target"
  mkfifo "$FIFO_SHARE_TARGET"
  ln -s "$FIFO_SHARE_TARGET" "$FIFO_SHARE_PATH.agent-run.lock"
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    timeout -k 1 3 bash "$WRAPPER" consult copilot -m m -p hi \
      -o "$FIFO_SHARE_LOCK_OUT" -- "--share=$FIFO_SHARE_PATH" 2>&1)"
  CODE=$?
  set -e
  expect_code 3 "symlinked FIFO caller-share lock"
  expect_out "caller transcript-path lock" "symlinked FIFO caller-share lock"
  expect_not_out "agent-run: dispatched:" "symlinked FIFO caller-share lock"
  rm -f -- "$FIFO_SHARE_PATH.agent-run.lock" "$FIFO_SHARE_TARGET"
  ok "attempts: FIFO-shaped derived locks reject without blocking dispatch"

  SWAPPED_LOCK_OUT="$TMP_ROOT/swapped-answer-lock.msg"
  SWAPPED_LOCK_READY="$TMP_ROOT/swapped-answer-lock.ready"
  SWAPPED_LOCK_RELEASE="$TMP_ROOT/swapped-answer-lock.release"
  SWAPPED_LOCK_LOG="$TMP_ROOT/swapped-answer-lock.log"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    AGENT_RUN_TEST_LOCK_OPEN_READY="$SWAPPED_LOCK_READY" \
    AGENT_RUN_TEST_LOCK_OPEN_RELEASE="$SWAPPED_LOCK_RELEASE" \
    exec bash "$WRAPPER" consult claude -p hi -o "$SWAPPED_LOCK_OUT") >"$SWAPPED_LOCK_LOG" 2>&1 &
  SWAPPED_LOCK_WRAPPER=$!
  await_ready "$SWAPPED_LOCK_READY" "$SWAPPED_LOCK_WRAPPER" \
    "answer lock identity: wrapper never reached the open-lock test boundary" "$SWAPPED_LOCK_LOG"
  rm -f "$SWAPPED_LOCK_OUT.agent-run.lock"
  : >"$TMP_ROOT/replacement-answer-lock"
  ln -s "$TMP_ROOT/replacement-answer-lock" "$SWAPPED_LOCK_OUT.agent-run.lock"
  : >"$SWAPPED_LOCK_RELEASE"
  wait_wrapper "$SWAPPED_LOCK_WRAPPER" "$SWAPPED_LOCK_LOG"
  expect_code 3 "answer lock path identity changed after open"
  expect_out "changed identity" "answer lock path identity changed after open"
  expect_not_out "ARG:" "answer lock path identity changed after open"
  ok "attempts: answer lock ownership verifies the opened inode instead of trusting a path precheck"

  OUT_CLAIM_RACE="$TMP_ROOT/out-claim-race.msg"
  seed_no_answer_predecessor "$OUT_CLAIM_RACE" "out claim race finalized predecessor setup"
  : >"$OUT_CLAIM_RACE"
  OUT_CLAIM_READY="$TMP_ROOT/out-claim-race.ready"
  OUT_CLAIM_RELEASE="$TMP_ROOT/out-claim-race.release"
  OUT_CLAIM_LOG="$TMP_ROOT/out-claim-race.log"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    AGENT_RUN_TEST_OUT_REMOVE_READY="$OUT_CLAIM_READY" \
    AGENT_RUN_TEST_OUT_REMOVE_RELEASE="$OUT_CLAIM_RELEASE" \
    exec bash "$WRAPPER" consult claude -p hi -o "$OUT_CLAIM_RACE") >"$OUT_CLAIM_LOG" 2>&1 &
  OUT_CLAIM_WRAPPER=$!
  await_ready "$OUT_CLAIM_READY" "$OUT_CLAIM_WRAPPER" \
    "out claim race: wrapper never moved the empty predecessor aside" "$OUT_CLAIM_LOG"
  # The public pathname is absent while the exact predecessor inode is checked
  # under its private name. Content created now must survive; the eventual
  # no-clobber publication should collide with it instead of deleting it.
  printf 'late caller answer\n' >"$OUT_CLAIM_RACE"
  : >"$OUT_CLAIM_RELEASE"
  wait_wrapper "$OUT_CLAIM_WRAPPER" "$OUT_CLAIM_LOG"
  expect_code 1 "out claim race"
  expect_out "refusing to clobber content" "out claim race"
  [ "$(cat "$OUT_CLAIM_RACE")" = "late caller answer" ] \
    || fail "out claim race: content written after the predecessor rename was destroyed"
  ok "attempts: atomic predecessor retirement cannot unlink late caller content"

  OPEN_FD_RETIRE_DIR="$TMP_ROOT/open-fd-retirement"
  OPEN_FD_RETIRE_OUT="$OPEN_FD_RETIRE_DIR/answer.msg"
  OPEN_FD_RETIRE_READY="$OPEN_FD_RETIRE_DIR/retire.ready"
  OPEN_FD_RETIRE_RELEASE="$OPEN_FD_RETIRE_DIR/retire.release"
  OPEN_FD_RETIRE_LOG="$OPEN_FD_RETIRE_DIR/wrapper.log"
  mkdir -p "$OPEN_FD_RETIRE_DIR"
  seed_no_answer_predecessor "$OPEN_FD_RETIRE_OUT" "open descriptor retirement finalized predecessor setup"
  exec 8>"$OPEN_FD_RETIRE_OUT"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    AGENT_RUN_TEST_OUT_REMOVE_READY="$OPEN_FD_RETIRE_READY" \
    AGENT_RUN_TEST_OUT_REMOVE_RELEASE="$OPEN_FD_RETIRE_RELEASE" \
    exec bash "$WRAPPER" consult claude -p hi -o "$OPEN_FD_RETIRE_OUT") >"$OPEN_FD_RETIRE_LOG" 2>&1 &
  OPEN_FD_RETIRE_WRAPPER=$!
  await_ready "$OPEN_FD_RETIRE_READY" "$OPEN_FD_RETIRE_WRAPPER" \
    "open descriptor retirement: wrapper never reached the post-check boundary" "$OPEN_FD_RETIRE_LOG"
  printf 'late descriptor answer\n' >&8
  : >"$OPEN_FD_RETIRE_RELEASE"
  set +e
  wait "$OPEN_FD_RETIRE_WRAPPER"
  CODE=$?
  set -e
  exec 8>&-
  OUT="$(cat "$OPEN_FD_RETIRE_LOG")"
  expect_code 0 "open descriptor retirement"
  RETIRED_OPEN_FD_PATHS=()
  while IFS= read -r retired_path; do
    RETIRED_OPEN_FD_PATHS+=("$retired_path")
  done < <(find "$OPEN_FD_RETIRE_DIR" -maxdepth 1 -type f -name '.agent-run-retired.*' -print)
  [ "${#RETIRED_OPEN_FD_PATHS[@]}" -eq 1 ] \
    || fail "open descriptor retirement: expected one durable retired inode, found ${#RETIRED_OPEN_FD_PATHS[@]}"
  [ "$(cat "${RETIRED_OPEN_FD_PATHS[0]}")" = "late descriptor answer" ] \
    || fail "open descriptor retirement: late descriptor content was not retained"
  ok "attempts: a writer opened before retirement cannot lose data after the empty check"

  SAME_OUT="$TMP_ROOT/simultaneous-answer.msg"
  SAME_LOG="$TMP_ROOT/simultaneous-first.log"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
    exec bash "$WRAPPER" consult claude -p hi -o "$SAME_OUT") >"$SAME_LOG" 2>&1 &
  SAME_WRAPPER=$!
  n=0
  until grep -q '^agent-run: backend-pid:' "$SAME_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
    sleep 0.05
    n=$((n + 1))
  done
  grep -q '^agent-run: backend-pid:' "$SAME_LOG" \
    || fail "simultaneous same--o: first run never reached the backend ($(cat "$SAME_LOG"))"
  run_wrapper consult claude -p hi -o "$SAME_OUT"
  expect_code 3 "simultaneous same--o"
  expect_out "answer path" "simultaneous same--o"
  expect_not_out "ARG:" "simultaneous same--o"
  kill -TERM "$SAME_WRAPPER" 2>/dev/null || true
  set +e
  wait "$SAME_WRAPPER"
  set -e
  ok "attempts: simultaneous lock-free consults with the same -o cannot both launch"

  ESCAPED_ATTEMPT_OUT="$TMP_ROOT/escaped-attempt-lock.msg"
  ESCAPED_ATTEMPT_PID_FILE="$TMP_ROOT/escaped-attempt-lock.pid"
  run_wrapper_env AGENT_FAKE_EXIT=1 AGENT_FAKE_EMPTY_RESULT=1 \
    AGENT_FAKE_ESCAPED_PID_FILE="$ESCAPED_ATTEMPT_PID_FILE" \
    -- consult claude -p hi -o "$ESCAPED_ATTEMPT_OUT"
  expect_code 1 "escaped attempt-lock predecessor"
  [ -s "$ESCAPED_ATTEMPT_PID_FILE" ] \
    || fail "escaped attempt lock: backend descendant did not start"
  ESCAPED_ATTEMPT_PID="$(cat "$ESCAPED_ATTEMPT_PID_FILE")"
  run_wrapper consult claude -p hi -o "$ESCAPED_ATTEMPT_OUT"
  ESCAPED_RETRY_CODE=$CODE
  ESCAPED_RETRY_OUT=$OUT
  kill "$ESCAPED_ATTEMPT_PID" 2>/dev/null || true
  CODE=$ESCAPED_RETRY_CODE
  OUT=$ESCAPED_RETRY_OUT
  expect_code 0 "retry while escaped backend descendant lives"
  ok "attempts: escaped backend descendants do not inherit the answer-path lock"

  CODEX_TEE_OUT="$TMP_ROOT/codex-tee-lock.msg"
  CODEX_TEE_PID_FILE="$TMP_ROOT/codex-tee-lock.pid"
  CODEX_TEE_LOG="$TMP_ROOT/codex-tee-lock.log"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EXIT=1 AGENT_FAKE_SKIP_OUTPUT=1 \
    AGENT_FAKE_ESCAPED_PID_FILE="$CODEX_TEE_PID_FILE" \
    exec bash "$WRAPPER" consult codex -p hi -o "$CODEX_TEE_OUT") >"$CODEX_TEE_LOG" 2>&1 &
  CODEX_TEE_WRAPPER=$!
  n=0
  until [ -s "$CODEX_TEE_PID_FILE" ] || ! kill -0 "$CODEX_TEE_WRAPPER" 2>/dev/null \
    || [ "$n" -ge 100 ]; do
    sleep 0.05
    n=$((n + 1))
  done
  [ -s "$CODEX_TEE_PID_FILE" ] \
    || fail "codex tee lock: escaped backend descendant did not start ($(cat "$CODEX_TEE_LOG"))"
  CODEX_TEE_ESCAPED_PID="$(cat "$CODEX_TEE_PID_FILE")"
  kill -KILL "$CODEX_TEE_WRAPPER"
  set +e
  wait "$CODEX_TEE_WRAPPER"
  CODE=$?
  set -e
  expect_code 137 "codex tee lock: wrapper SIGKILL"
  run_wrapper consult claude -p hi -o "$CODEX_TEE_OUT"
  CODEX_TEE_RETRY_CODE=$CODE
  CODEX_TEE_RETRY_OUT=$OUT
  kill "$CODEX_TEE_ESCAPED_PID" 2>/dev/null || true
  CODE=$CODEX_TEE_RETRY_CODE
  OUT=$CODEX_TEE_RETRY_OUT
  expect_code 2 "retry after SIGKILL while escaped codex descendant keeps tee alive"
  expect_out "unfinalized attempt" "retry after SIGKILL while escaped codex descendant keeps tee alive"
  expect_not_out "lock busy" "retry after SIGKILL while escaped codex descendant keeps tee alive"
  ok "codex: the tee pipeline sibling does not inherit the answer-path lock"

  ESCAPED_SHARE_FIRST_OUT="$TMP_ROOT/escaped-share-lock-first.msg"
  ESCAPED_SHARE_SECOND_OUT="$TMP_ROOT/escaped-share-lock-second.msg"
  ESCAPED_SHARE="$TMP_ROOT/escaped-share-lock.md"
  ESCAPED_SHARE_PID_FILE="$TMP_ROOT/escaped-share-lock.pid"
  run_wrapper_env AGENT_FAKE_EXIT=1 \
    AGENT_FAKE_ESCAPED_PID_FILE="$ESCAPED_SHARE_PID_FILE" \
    -- consult copilot -m m -p hi -o "$ESCAPED_SHARE_FIRST_OUT" \
    -- "--share=$ESCAPED_SHARE"
  expect_code 1 "escaped caller-share-lock predecessor"
  [ -s "$ESCAPED_SHARE_PID_FILE" ] \
    || fail "escaped caller-share lock: backend descendant did not start"
  ESCAPED_SHARE_PID="$(cat "$ESCAPED_SHARE_PID_FILE")"
  rm -f "$ESCAPED_SHARE"
  run_wrapper consult copilot -m m -p hi -o "$ESCAPED_SHARE_SECOND_OUT" \
    -- "--share=$ESCAPED_SHARE"
  ESCAPED_SHARE_RETRY_CODE=$CODE
  ESCAPED_SHARE_RETRY_OUT=$OUT
  kill "$ESCAPED_SHARE_PID" 2>/dev/null || true
  CODE=$ESCAPED_SHARE_RETRY_CODE
  OUT=$ESCAPED_SHARE_RETRY_OUT
  expect_code 0 "caller-share retry while escaped backend descendant lives"
  ok "copilot: escaped backend descendants do not inherit the caller-share lock"
else
  ok "skipped simultaneous same--o ownership check (flock unavailable)"
fi

# The backend writes only its private candidate. The public answer remains
# absent until the backend has exited and the wrapper publishes the complete
# candidate with a no-clobber atomic link.
ATOMIC_OUT="$TMP_ROOT/atomic-answer.msg"
ATOMIC_READY="$TMP_ROOT/atomic-answer.ready"
ATOMIC_RELEASE="$TMP_ROOT/atomic-answer.release"
ATOMIC_LOG="$TMP_ROOT/atomic-answer.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_ANSWER_READY="$ATOMIC_READY" \
  AGENT_FAKE_ANSWER_RELEASE="$ATOMIC_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$ATOMIC_OUT") >"$ATOMIC_LOG" 2>&1 &
ATOMIC_WRAPPER=$!
await_ready "$ATOMIC_READY" "$ATOMIC_WRAPPER" \
  "atomic answer: backend never wrote its candidate" "$ATOMIC_LOG"
[ ! -e "$ATOMIC_OUT" ] \
  || fail "atomic answer: public -o became visible before finalization ($(cat "$ATOMIC_OUT"))"
ATOMIC_ATTEMPT="$(attempt_current_id "$ATOMIC_OUT")"
ATOMIC_CANDIDATE="$ATOMIC_OUT.agent-run/$ATOMIC_ATTEMPT/answer.tmp"
[ "$(cat "$ATOMIC_CANDIDATE")" = "fake codex last message" ] \
  || fail "atomic answer: attempt-private candidate is missing or incomplete"
: >"$ATOMIC_RELEASE"
wait_wrapper "$ATOMIC_WRAPPER" "$ATOMIC_LOG"
expect_code 0 "atomic answer publication"
[ "$(cat "$ATOMIC_OUT")" = "fake codex last message" ] \
  || fail "atomic answer publication: public answer missing after finalization"
[ ! -e "$ATOMIC_CANDIDATE" ] \
  || fail "atomic answer publication: private candidate survived a settled success"
ATOMIC_RECORD="$(attempt_record_path "$ATOMIC_OUT")"
[ "$(grep -c '^state=finalized$' "$ATOMIC_RECORD")" = 1 ] \
  || fail "atomic answer publication: record was not finalized exactly once"
grep -qFx 'finalization-count=1' "$ATOMIC_RECORD" \
  || fail "atomic answer publication: finalization count is not one"
grep -qFx 'answer-outcome=answer' "$ATOMIC_RECORD" \
  || fail "atomic answer publication: answer outcome was not recorded"
ok "attempts: successful answers publish atomically from a private candidate and finalize exactly once"

# Answer publication must not export the caller's ambient umask through the
# candidate inode. The hard link at -o inherits that inode's mode exactly, so
# secure it explicitly before the no-clobber link becomes public.
PERMISSIVE_UMASK_OUT="$TMP_ROOT/permissive-umask-answer.msg"
set +e
OUT="$(cd "$WORKTREE" && umask 000 && PATH="$FAKE_BIN:$PATH" \
  bash "$WRAPPER" consult codex -p hi -o "$PERMISSIVE_UMASK_OUT" 2>&1)"
CODE=$?
set -e
expect_code 0 "permissive umask answer publication"
[ "$(stat -c '%a' "$PERMISSIVE_UMASK_OUT")" = 600 ] \
  || fail "permissive umask answer publication: public mode is $(stat -c '%a' "$PERMISSIVE_UMASK_OUT"), expected 600"
ok "attempts: published answers have mode 0600 regardless of the caller umask"

# A successful no-clobber link is not enough: OUT can be atomically replaced
# before the wrapper drops its private link. Detect that identity change and
# preserve both the completed candidate and the replacement for recovery.
REPLACED_PUBLIC_OUT="$TMP_ROOT/replaced-after-publish-link.msg"
REPLACED_PUBLIC_READY="$TMP_ROOT/replaced-after-publish-link.ready"
REPLACED_PUBLIC_RELEASE="$TMP_ROOT/replaced-after-publish-link.release"
REPLACED_PUBLIC_LOG="$TMP_ROOT/replaced-after-publish-link.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_PUBLISH_LINK_READY="$REPLACED_PUBLIC_READY" \
  AGENT_RUN_TEST_PUBLISH_LINK_RELEASE="$REPLACED_PUBLIC_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$REPLACED_PUBLIC_OUT") >"$REPLACED_PUBLIC_LOG" 2>&1 &
REPLACED_PUBLIC_WRAPPER=$!
await_ready "$REPLACED_PUBLIC_READY" "$REPLACED_PUBLIC_WRAPPER" "replaced publication: wrapper never linked its candidate" "$REPLACED_PUBLIC_LOG"
REPLACED_PUBLIC_ATTEMPT="$(attempt_current_id "$REPLACED_PUBLIC_OUT")"
REPLACED_PUBLIC_CANDIDATE="$REPLACED_PUBLIC_OUT.agent-run/$REPLACED_PUBLIC_ATTEMPT/answer.tmp"
[ "$REPLACED_PUBLIC_OUT" -ef "$REPLACED_PUBLIC_CANDIDATE" ] \
  || fail "replaced publication: test boundary did not expose the published candidate inode"
printf 'replacement writer answer\n' >"$TMP_ROOT/replaced-after-publish-link.new"
mv -fT -- "$TMP_ROOT/replaced-after-publish-link.new" "$REPLACED_PUBLIC_OUT"
: >"$REPLACED_PUBLIC_RELEASE"
wait_wrapper "$REPLACED_PUBLIC_WRAPPER" "$REPLACED_PUBLIC_LOG"
expect_code 1 "replaced publication exit code"
expect_out "changed identity" "replaced publication identity check"
expect_not_out "agent-run: answer:" "replaced publication answer trailer"
[ "$(cat "$REPLACED_PUBLIC_OUT")" = "replacement writer answer" ] \
  || fail "replaced publication: replacement writer content was changed"
[ "$(cat "$REPLACED_PUBLIC_CANDIDATE")" = "fake codex last message" ] \
  || fail "replaced publication: wrapper candidate was not preserved"
grep -qFx 'state=finalizing' "$(attempt_record_path "$REPLACED_PUBLIC_OUT")" \
  || fail "replaced publication: ambiguous attempt did not remain finalizing"
ok "attempts: replacing OUT after its publish link preserves both answers and fails closed"

# Publication recovery must never copy through a pathname that can be replaced
# with a symlink after the private candidate name is released.
RECOVERY_RACE_OUT="$TMP_ROOT/publication-recovery-race.msg"
RECOVERY_RACE_READY="$TMP_ROOT/publication-recovery-race.ready"
RECOVERY_RACE_RELEASE="$TMP_ROOT/publication-recovery-race.release"
RECOVERY_RACE_LOG="$TMP_ROOT/publication-recovery-race.log"
RECOVERY_RACE_TARGET="$TMP_ROOT/publication-recovery-target"
printf 'protected target\n' >"$RECOVERY_RACE_TARGET"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_PUBLISH_UNLINK_READY="$RECOVERY_RACE_READY" \
  AGENT_RUN_TEST_PUBLISH_UNLINK_RELEASE="$RECOVERY_RACE_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$RECOVERY_RACE_OUT") >"$RECOVERY_RACE_LOG" 2>&1 &
RECOVERY_RACE_WRAPPER=$!
await_ready "$RECOVERY_RACE_READY" "$RECOVERY_RACE_WRAPPER" "publication recovery race: wrapper never released the private candidate" "$RECOVERY_RACE_LOG"
RECOVERY_RACE_ATTEMPT="$(attempt_current_id "$RECOVERY_RACE_OUT")"
RECOVERY_RACE_CANDIDATE="$RECOVERY_RACE_OUT.agent-run/$RECOVERY_RACE_ATTEMPT/answer.tmp"
printf 'replacement public answer\n' >"$TMP_ROOT/publication-recovery-public.new"
mv -fT -- "$TMP_ROOT/publication-recovery-public.new" "$RECOVERY_RACE_OUT"
ln -s "$RECOVERY_RACE_TARGET" "$RECOVERY_RACE_CANDIDATE"
: >"$RECOVERY_RACE_RELEASE"
wait_wrapper "$RECOVERY_RACE_WRAPPER" "$RECOVERY_RACE_LOG"
expect_code 1 "publication recovery race exit code"
expect_out "changed identity" "publication recovery race identity check"
[ "$(cat "$RECOVERY_RACE_TARGET")" = "protected target" ] \
  || fail "publication recovery race: recovery followed and overwrote an injected symlink"
[ "$(cat "$RECOVERY_RACE_CANDIDATE")" = "fake codex last message" ] \
  || fail "publication recovery race: completed candidate was not atomically restored"
ok "attempts: publication-collision recovery cannot follow a raced candidate symlink"

# An unexpected public writer wins without being clobbered. The wrapper removes
# its private candidate but leaves the attempt in finalizing state, so a later
# invocation cannot guess whether takeover is safe.
COLLISION_OUT="$TMP_ROOT/atomic-collision.msg"
COLLISION_READY="$TMP_ROOT/atomic-collision.ready"
COLLISION_RELEASE="$TMP_ROOT/atomic-collision.release"
COLLISION_LOG="$TMP_ROOT/atomic-collision.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_ANSWER_READY="$COLLISION_READY" \
  AGENT_FAKE_ANSWER_RELEASE="$COLLISION_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$COLLISION_OUT") >"$COLLISION_LOG" 2>&1 &
COLLISION_WRAPPER=$!
await_ready "$COLLISION_READY" "$COLLISION_WRAPPER" \
  "atomic collision: backend never wrote its candidate" "$COLLISION_LOG"
COLLISION_ATTEMPT="$(attempt_current_id "$COLLISION_OUT")"
COLLISION_CANDIDATE="$COLLISION_OUT.agent-run/$COLLISION_ATTEMPT/answer.tmp"
printf 'caller-owned surprise\n' >"$COLLISION_OUT"
: >"$COLLISION_RELEASE"
wait_wrapper "$COLLISION_WRAPPER" "$COLLISION_LOG"
expect_code 1 "atomic publication collision"
expect_out "refusing to clobber" "atomic publication collision"
expect_not_out "agent-run: answer:" "atomic publication collision"
[ "$(cat "$COLLISION_OUT")" = "caller-owned surprise" ] \
  || fail "atomic publication collision: existing public content was clobbered"
[ "$(cat "$COLLISION_CANDIDATE")" = "fake codex last message" ] \
  || fail "atomic publication collision: completed private candidate was not preserved for recovery"
COLLISION_RECORD="$(attempt_record_path "$COLLISION_OUT")"
grep -qFx 'state=finalizing' "$COLLISION_RECORD" \
  || fail "atomic publication collision: ambiguous attempt did not remain finalizing"
run_wrapper consult codex -p hi -o "$COLLISION_OUT"
expect_code 2 "retry after atomic publication collision"
expect_out "unfinalized attempt" "retry after atomic publication collision"
ok "attempts: publication collisions preserve both answers for recovery and stay non-retryable"

# A directory that appears at the public path is also a publication collision,
# never a directory operand for ln that receives the private answer basename.
DIRECTORY_COLLISION_OUT="$TMP_ROOT/atomic-directory-collision.msg"
DIRECTORY_COLLISION_READY="$TMP_ROOT/atomic-directory-collision.ready"
DIRECTORY_COLLISION_RELEASE="$TMP_ROOT/atomic-directory-collision.release"
DIRECTORY_COLLISION_LOG="$TMP_ROOT/atomic-directory-collision.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_ANSWER_READY="$DIRECTORY_COLLISION_READY" \
  AGENT_FAKE_ANSWER_RELEASE="$DIRECTORY_COLLISION_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$DIRECTORY_COLLISION_OUT") >"$DIRECTORY_COLLISION_LOG" 2>&1 &
DIRECTORY_COLLISION_WRAPPER=$!
await_ready "$DIRECTORY_COLLISION_READY" "$DIRECTORY_COLLISION_WRAPPER" \
  "atomic directory collision: backend never wrote its candidate" "$DIRECTORY_COLLISION_LOG"
mkdir "$DIRECTORY_COLLISION_OUT"
: >"$DIRECTORY_COLLISION_RELEASE"
wait_wrapper "$DIRECTORY_COLLISION_WRAPPER" "$DIRECTORY_COLLISION_LOG"
expect_code 1 "atomic directory publication collision"
expect_out "refusing to clobber" "atomic directory publication collision"
[ -d "$DIRECTORY_COLLISION_OUT" ] \
  || fail "atomic directory collision: public directory was replaced"
[ -z "$(find "$DIRECTORY_COLLISION_OUT" -mindepth 1 -print -quit)" ] \
  || fail "atomic directory collision: wrapper published an answer inside the public directory"
ok "attempts: atomic answer publication rejects a late directory without writing inside it"

FINAL_SYNC_OUT="$TMP_ROOT/final-sync-failure.msg"
run_wrapper_env AGENT_RUN_TEST_FINAL_SYNC_FAIL=1 -- consult claude -p hi -o "$FINAL_SYNC_OUT"
expect_code 1 "post-launch attempt sync failure"
expect_out "agent-run: dispatched:" "post-launch attempt sync failure"
expect_out "agent-run: backend-exit: wrapper-failure (attempt artifact sync failed" "post-launch attempt sync failure"
assert_finalized_contract "post-launch attempt sync failure" "$OUT"
ok "contract: a post-launch per-file sync failure emits a decided completion anchor"

FINAL_IDENTITY_OUT="$TMP_ROOT/final-identity-failure.msg"
FINAL_IDENTITY_READY="$TMP_ROOT/final-identity-failure.ready"
FINAL_IDENTITY_RELEASE="$TMP_ROOT/final-identity-failure.release"
FINAL_IDENTITY_LOG="$TMP_ROOT/final-identity-failure.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_FINALIZE_READY="$FINAL_IDENTITY_READY" \
  AGENT_RUN_TEST_FINALIZE_RELEASE="$FINAL_IDENTITY_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$FINAL_IDENTITY_OUT") >"$FINAL_IDENTITY_LOG" 2>&1 &
FINAL_IDENTITY_WRAPPER=$!
await_ready "$FINAL_IDENTITY_READY" "$FINAL_IDENTITY_WRAPPER" "post-launch identity failure: wrapper never reached finalization" "$FINAL_IDENTITY_LOG"
rm -f -- "$FINAL_IDENTITY_OUT.agent-run.lock.identity"
: >"$FINAL_IDENTITY_RELEASE"
wait_wrapper "$FINAL_IDENTITY_WRAPPER" "$FINAL_IDENTITY_LOG"
expect_code 1 "post-launch lock identity failure"
expect_out "agent-run: backend-exit: wrapper-failure (lock identity changed" "post-launch lock identity failure"
assert_finalized_contract "post-launch lock identity failure" "$OUT"
ok "contract: a post-launch lock-identity failure emits a decided completion anchor"

# --- copilot mapping --------------------------------------------------------------

export COPILOT_ALLOW_ALL=1
run_wrapper consult copilot -m gemini-3.6-flash -p 'second opinion' -e low
unset COPILOT_ALLOW_ALL
expect_code 0 "copilot consult happy path"
expect_out "COPILOT_ALLOW_ALL=__unset__" "copilot consult env strip"
for expected in ARG:--no-color ARG:--no-auto-update ARG:--deny-tool ARG:write ARG:--model ARG:gemini-3.6-flash ARG:--effort ARG:low ARG:--output-format ARG:json ARG:-p; do
  expect_out "$expected" "copilot consult args"
done
expect_out "Do not modify files" "copilot consult preamble"
expect_not_out "ARG:--allow-all" "copilot consult args"
expect_not_out '"type":"session.start"' "copilot consult raw JSONL"
expect_not_out '"type":"assistant.message"' "copilot consult raw JSONL"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot consult trailer"
ok "copilot: consult composes read-only flags without replaying raw JSONL"

run_wrapper_env AGENT_FAKE_COPILOT_INTENT_ONLY=1 -- consult copilot -m gemini-3.6-flash -p 'review this branch'
expect_code 1 "copilot intent-only response"
expect_out "no final answer" "copilot intent-only response"
expect_not_out "agent-run: answer:" "copilot intent-only response"
ok "copilot: pre-tool intent without a final assistant response fails the run"

COPILOT_RETRY_OUT="$TMP_ROOT/copilot-intent-retry.msg"
run_wrapper_env AGENT_FAKE_COPILOT_INTENT_ONLY=1 -- consult copilot -m gemini-3.6-flash -p 'review this branch' -o "$COPILOT_RETRY_OUT"
expect_code 1 "copilot intent-only retry predecessor"
FIRST_COPILOT_ATTEMPT="$(attempt_current_id "$COPILOT_RETRY_OUT")"
FIRST_COPILOT_RECORD="$(attempt_record_path "$COPILOT_RETRY_OUT")"
FIRST_COPILOT_TRANSCRIPT="$(cat "$COPILOT_RETRY_OUT.agent-run/$FIRST_COPILOT_ATTEMPT/transcript-path")"
[ -s "$FIRST_COPILOT_TRANSCRIPT" ] \
  || fail "copilot intent-only retry predecessor: first transcript missing"
grep -qF '99999999-8888-7777-6666-555555555555' "$FIRST_COPILOT_TRANSCRIPT" \
  || fail "copilot intent-only retry predecessor: first session id missing from transcript"
grep -qFx 'session-id=99999999-8888-7777-6666-555555555555' "$FIRST_COPILOT_RECORD" \
  || fail "copilot intent-only retry predecessor: first session id missing from final record"
FIRST_COPILOT_HASH="$(cksum <"$FIRST_COPILOT_TRANSCRIPT")"
run_wrapper consult copilot -m gemini-3.6-flash -p 'review this branch again' -o "$COPILOT_RETRY_OUT"
expect_code 0 "copilot retry after intent-only no-final"
SECOND_COPILOT_ATTEMPT="$(attempt_current_id "$COPILOT_RETRY_OUT")"
SECOND_COPILOT_TRANSCRIPT="$(cat "$COPILOT_RETRY_OUT.agent-run/$SECOND_COPILOT_ATTEMPT/transcript-path")"
[ "$FIRST_COPILOT_ATTEMPT" != "$SECOND_COPILOT_ATTEMPT" ] \
  || fail "copilot retry after intent-only no-final: attempt identity was reused"
[ "$FIRST_COPILOT_TRANSCRIPT" != "$SECOND_COPILOT_TRANSCRIPT" ] \
  || fail "copilot retry after intent-only no-final: transcript path was reused"
[ "$(cksum <"$FIRST_COPILOT_TRANSCRIPT")" = "$FIRST_COPILOT_HASH" ] \
  || fail "copilot retry after intent-only no-final: first transcript changed"
[ -s "$SECOND_COPILOT_TRANSCRIPT" ] \
  || fail "copilot retry after intent-only no-final: second transcript missing"
ok "copilot: an intent-only no-final attempt retries with a distinct transcript while preserving the first session"

COPILOT_EARLY_OUT="$TMP_ROOT/copilot-early-record.msg"
COPILOT_EARLY_LOG="$TMP_ROOT/copilot-early-record.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$COPILOT_EARLY_OUT") >"$COPILOT_EARLY_LOG" 2>&1 &
COPILOT_EARLY_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$COPILOT_EARLY_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
grep -q '^agent-run: backend-pid:' "$COPILOT_EARLY_LOG" \
  || fail "copilot early record: backend never launched ($(cat "$COPILOT_EARLY_LOG"))"
COPILOT_EARLY_ATTEMPT="$(attempt_current_id "$COPILOT_EARLY_OUT")"
COPILOT_EARLY_RECORD="$(attempt_record_path "$COPILOT_EARLY_OUT")"
COPILOT_EARLY_TRANSCRIPT="$(cat "$COPILOT_EARLY_OUT.agent-run/$COPILOT_EARLY_ATTEMPT/transcript-path")"
grep -qFx 'state=active' "$COPILOT_EARLY_RECORD" \
  || fail "copilot early record: attempt was not durably active before backend completion"
[ -f "$COPILOT_EARLY_TRANSCRIPT" ] \
  || fail "copilot early record: allocated transcript path does not exist"
COPILOT_EARLY_TEXT="$(cat "$COPILOT_EARLY_LOG")"
COPILOT_ATTEMPT_LINE="$(first_line_matching '^agent-run: attempt:' "$COPILOT_EARLY_TEXT")"
COPILOT_TRANSCRIPT_LINE="$(first_line_matching '^agent-run: transcript:' "$COPILOT_EARLY_TEXT")"
COPILOT_BACKEND_LINE="$(first_line_matching '^agent-run: backend-pid:' "$COPILOT_EARLY_TEXT")"
{ [ -n "$COPILOT_ATTEMPT_LINE" ] && [ -n "$COPILOT_TRANSCRIPT_LINE" ] \
  && [ "$COPILOT_ATTEMPT_LINE" -lt "$COPILOT_BACKEND_LINE" ] \
  && [ "$COPILOT_TRANSCRIPT_LINE" -lt "$COPILOT_BACKEND_LINE" ]; } \
  || fail "copilot early record: attempt/transcript trailers did not precede backend launch ($COPILOT_EARLY_TEXT)"
kill -TERM "$COPILOT_EARLY_WRAPPER" 2>/dev/null || true
set +e
wait "$COPILOT_EARLY_WRAPPER"
set -e
ok "copilot: attempt identity and collision-safe transcript path are durable before backend completion"

COPILOT_ACTIVE_OUT="$TMP_ROOT/copilot-active-caller-share.msg"
COPILOT_ACTIVE_SHARE="$TMP_ROOT/copilot-active-caller-share.md"
COPILOT_ACTIVE_LOG="$TMP_ROOT/copilot-active-caller-share.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$COPILOT_ACTIVE_OUT" \
    -- "--share=$COPILOT_ACTIVE_SHARE") >"$COPILOT_ACTIVE_LOG" 2>&1 &
COPILOT_ACTIVE_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$COPILOT_ACTIVE_LOG" 2>/dev/null \
  || ! kill -0 "$COPILOT_ACTIVE_WRAPPER" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
grep -q '^agent-run: backend-pid:' "$COPILOT_ACTIVE_LOG" \
  || fail "copilot active caller share: backend never launched ($(cat "$COPILOT_ACTIVE_LOG"))"
COPILOT_ACTIVE_ATTEMPT="$(attempt_current_id "$COPILOT_ACTIVE_OUT")"
COPILOT_ACTIVE_RECORD="$(attempt_record_path "$COPILOT_ACTIVE_OUT")"
grep -qFx 'state=active' "$COPILOT_ACTIVE_RECORD" \
  || fail "copilot active caller share: attempt was not active before the crash"
[ ! -e "$COPILOT_ACTIVE_OUT.agent-run/$COPILOT_ACTIVE_ATTEMPT/transcript-identity" ] \
  || fail "copilot active caller share: transcript identity existed before finalization"
COPILOT_ACTIVE_BACKEND="$(sed -n 's/^agent-run: backend-pid: //p' "$COPILOT_ACTIVE_LOG" | head -n1)"
kill -KILL "$COPILOT_ACTIVE_WRAPPER"
set +e
wait "$COPILOT_ACTIVE_WRAPPER"
CODE=$?
set -e
expect_code 137 "copilot active caller share: wrapper SIGKILL"
kill -KILL -- "-$COPILOT_ACTIVE_BACKEND" 2>/dev/null \
  || kill -KILL "$COPILOT_ACTIVE_BACKEND" 2>/dev/null || true
run_wrapper consult claude -p hi -o "$COPILOT_ACTIVE_OUT"
expect_code 2 "retry after active caller-share crash"
expect_out "unfinalized attempt" "retry after active caller-share crash"
expect_not_out "transcript identity missing" "retry after active caller-share crash"
expect_not_out "malformed attempt" "retry after active caller-share crash"
ok "copilot: a crashed active caller-share attempt is unfinalized, not malformed"

REPLACED_ACTIVE_OUT="$TMP_ROOT/replaced-active-caller-share.msg"
REPLACED_ACTIVE_SHARE="$TMP_ROOT/replaced-active-caller-share.md"
REPLACED_ACTIVE_ORIGINAL="$TMP_ROOT/replaced-active-caller-share.original.md"
REPLACED_ACTIVE_READY="$TMP_ROOT/replaced-active-caller-share.ready"
REPLACED_ACTIVE_RELEASE="$TMP_ROOT/replaced-active-caller-share.release"
REPLACED_ACTIVE_LOG="$TMP_ROOT/replaced-active-caller-share.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_FAKE_SHARE_OPEN_READY="$REPLACED_ACTIVE_READY" \
  AGENT_FAKE_SHARE_OPEN_RELEASE="$REPLACED_ACTIVE_RELEASE" \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$REPLACED_ACTIVE_OUT" \
    -- "--share=$REPLACED_ACTIVE_SHARE") >"$REPLACED_ACTIVE_LOG" 2>&1 &
REPLACED_ACTIVE_WRAPPER=$!
await_ready "$REPLACED_ACTIVE_READY" "$REPLACED_ACTIVE_WRAPPER" "replaced active caller share: backend never opened the claimed transcript" "$REPLACED_ACTIVE_LOG"
mv -- "$REPLACED_ACTIVE_SHARE" "$REPLACED_ACTIVE_ORIGINAL"
printf 'unrelated replacement transcript\n' >"$REPLACED_ACTIVE_SHARE"
: >"$REPLACED_ACTIVE_RELEASE"
wait_wrapper "$REPLACED_ACTIVE_WRAPPER" "$REPLACED_ACTIVE_LOG"
expect_code 1 "replaced active caller share"
expect_out "changed identity before finalization" "replaced active caller share"
expect_not_out "agent-run: answer:" "replaced active caller share"
grep -qF 'Session ID' "$REPLACED_ACTIVE_ORIGINAL" \
  || fail "replaced active caller share: backend did not finish the original open transcript"
[ "$(cat "$REPLACED_ACTIVE_SHARE")" = "unrelated replacement transcript" ] \
  || fail "replaced active caller share: unrelated replacement content changed"
grep -qFx 'backend-disposition=caller-transcript-identity-failure' \
  "$(attempt_record_path "$REPLACED_ACTIVE_OUT")" \
  || fail "replaced active caller share: finalizing record lost the identity-failure disposition"
ok "copilot: replacing an active caller-owned transcript fails closed at finalization"

run_wrapper work copilot -m gemini-3.6-flash -p 'implement it' -r bbbb-session
expect_code 0 "copilot work happy path"
expect_out "ARG:--allow-all" "copilot work args"
expect_out "ARG:--resume=bbbb-session" "copilot work args"
ok "copilot: work composes --allow-all and --resume=<id>"

run_wrapper_env AGENT_FAKE_STRICT=1 -- consult copilot -m m -p hi -- "--share=$TMP_ROOT/strict-share.md"
expect_code 0 "copilot strict fake benign passthrough"
expect_out "ARG:--share=$TMP_ROOT/strict-share.md" "copilot strict fake benign passthrough"
run_wrapper_env AGENT_FAKE_STRICT=1 -- consult copilot -m m -p hi -- --strict-fake-unknown
expect_code 1 "copilot strict fake unknown passthrough"
expect_out "UNKNOWN:--strict-fake-unknown" "copilot strict fake unknown passthrough"
ok "copilot: strict fake mode accepts known passthroughs and rejects unknown flags"

COPILOT_OUT="$TMP_ROOT/copilot-answer.txt"
run_wrapper consult copilot -m gemini-3.6-flash -p hi -o "$COPILOT_OUT"
expect_code 0 "copilot -o"
[ "$(cat "$COPILOT_OUT")" = "fake copilot answer" ] || fail "copilot -o: unexpected answer file content"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot -o trailer (share sidecar)"
COPILOT_ATTEMPT_ID="$(attempt_current_id "$COPILOT_OUT")"
COPILOT_TRANSCRIPT="$(cat "$COPILOT_OUT.agent-run/$COPILOT_ATTEMPT_ID/transcript-path")"
[ -f "$COPILOT_TRANSCRIPT" ] || fail "copilot -o: attempt transcript missing"
expect_out "agent-run: transcript: $COPILOT_TRANSCRIPT (wrapper-owned)" "copilot -o transcript trailer"
ok "copilot: -o receives only the root final answer and its attempt transcript supplies the session id"

COPILOT_SUCCESS_HASH="$(cksum <"$COPILOT_TRANSCRIPT")"
COPILOT_SUCCESS_ATTEMPT_COUNT="$(find "$COPILOT_OUT.agent-run" -mindepth 1 -maxdepth 1 -type d -name 'attempt.*' | wc -l)"
run_wrapper consult copilot -m gemini-3.6-flash -p 'must not launch' -o "$COPILOT_OUT"
expect_code 2 "copilot successful answer reuse"
expect_out "finalized successful attempt" "copilot successful answer reuse"
expect_not_out "ARG:" "copilot successful answer reuse"
[ "$(attempt_current_id "$COPILOT_OUT")" = "$COPILOT_ATTEMPT_ID" ] \
  || fail "copilot successful answer reuse: current attempt identity changed"
[ "$(cksum <"$COPILOT_TRANSCRIPT")" = "$COPILOT_SUCCESS_HASH" ] \
  || fail "copilot successful answer reuse: transcript changed"
[ "$(find "$COPILOT_OUT.agent-run" -mindepth 1 -maxdepth 1 -type d -name 'attempt.*' | wc -l)" = "$COPILOT_SUCCESS_ATTEMPT_COUNT" ] \
  || fail "copilot successful answer reuse: rejection allocated another attempt"
ok "copilot: a successful answer path cannot be reused and all attempt artifacts stay unchanged"

# cwd outside any git repo: a relative leading-dash -o inside the worktree is
# now in-tree-rejected, and the operand handling under test needs the run to
# reach the answer-file plumbing.
set +e
OUT="$(cd "$TMP_ROOT" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" work copilot -m m -p hi -o -x 2>&1)"
CODE=$?
set -e
expect_code 0 "copilot leading dash -o"
expect_out "fake copilot answer" "copilot leading dash -o"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot leading dash -o"
LEADING_DASH_ATTEMPT="$(attempt_current_id "$TMP_ROOT/-x")"
LEADING_DASH_TRANSCRIPT="$(cat "$TMP_ROOT/-x.agent-run/$LEADING_DASH_ATTEMPT/transcript-path")"
[ -s "$LEADING_DASH_TRANSCRIPT" ] || fail "copilot leading dash -o: attempt transcript missing"
rm -f -- "$TMP_ROOT/-x"
ok "copilot: leading-dash -o and transcript paths are treated as file operands"

# --- cursor mapping ---------------------------------------------------------------

run_wrapper consult cursor -p 'review this'
expect_code 0 "cursor consult happy path"
for expected in ARG:-p ARG:--output-format ARG:stream-json ARG:--trust ARG:--mode ARG:ask ARG:--model ARG:grok-4.5-xhigh; do
  expect_out "$expected" "cursor consult args"
done
expect_out "Do not modify files" "cursor consult preamble"
expect_out "git diff is fine" "cursor consult uses the shared shell-capable preamble (.cursor/cli.json re-permits read-only git in ask mode)"
expect_not_out "Shell commands are denied" "cursor consult no longer claims shell is denied outright"
expect_not_out "ARG:--force" "cursor consult args"
expect_out "agent-run: session-id: cafe0001-2222-3333-4444-555555555555" "cursor consult trailer"
expect_not_out "agent-run: cost-usd:" "cursor consult has no claude cost metadata"
expect_out "fake cursor answer" "cursor consult answer in log"
ok "cursor: consult composes ask mode, the default model, preamble, and result trailer"

# The stream's incremental commentary must stay in the diagnostic log but never
# reach the -o answer file: -o carries the final assistant message only.
CURSOR_FINAL_OUT="$TMP_ROOT/cursor-final-only.txt"
run_wrapper consult cursor -p 'summarize the diff' -o "$CURSOR_FINAL_OUT"
expect_code 0 "cursor final-message normalization"
[ "$(cat "$CURSOR_FINAL_OUT")" = "fake cursor answer" ] \
  || fail "cursor final-message normalization: -o is not the final assistant message only ($(cat "$CURSOR_FINAL_OUT"))"
grep -qF 'incremental commentary' "$CURSOR_FINAL_OUT" \
  && fail "cursor final-message normalization: incremental commentary leaked into -o ($(cat "$CURSOR_FINAL_OUT"))"
expect_out "incremental commentary one" "cursor incremental commentary stays in the diagnostic log"
rm -f "$CURSOR_FINAL_OUT"
ok "cursor: -o carries only the final assistant message; incremental commentary stays in the log"

run_wrapper work cursor -p 'implement it' -m composer-2.5 -r cccc-session
expect_code 0 "cursor work happy path"
expect_out "ARG:--force" "cursor work args"
expect_out "ARG:composer-2.5" "cursor work args"
expect_not_out "ARG:grok-4.5-xhigh" "cursor work -m overrides the default model"
expect_not_out "ARG:ask" "cursor work args (no consult ask mode)"
expect_out "ARG:--resume" "cursor work resume args"
expect_out "ARG:cccc-session" "cursor work resume args"
expect_not_out "Do not modify files" "cursor work has no consult preamble"
ok "cursor: work composes --force and -m/-r overrides without the preamble"

CURSOR_OUT="$TMP_ROOT/cursor-answer.txt"
run_wrapper consult cursor -p hi -o "$CURSOR_OUT"
expect_code 0 "cursor -o"
[ "$(cat "$CURSOR_OUT")" = "fake cursor answer" ] || fail "cursor -o: unexpected answer file content ($(cat "$CURSOR_OUT"))"
expect_out "agent-run: answer: $CURSOR_OUT" "cursor -o trailer"
grep -qFx 'session-id=cafe0001-2222-3333-4444-555555555555' "$(attempt_record_path "$CURSOR_OUT")" \
  || fail "cursor -o: finalized attempt record did not persist the envelope session id"
ok "cursor: -o extracts the result field into the answer file"

run_wrapper consult cursor -p hi -e high
expect_code 2 "cursor -e"
expect_out "no effort flag" "cursor -e"
ok "cursor: -e is rejected (effort is encoded in the model id)"

run_wrapper work cursor -p update
expect_code 2 "cursor subcommand-word mission"
expect_out "would dispatch the cursor subcommand" "cursor subcommand-word mission"
run_wrapper consult cursor -p update
expect_code 0 "cursor consult subcommand-word prompt (preamble prefixes it)"
ok "cursor: a one-word work mission matching a subcommand is rejected; consults are immune"

# load_mission_file reads via command substitution, which strips trailing
# newlines — so a normally-edited one-word mission file still hits the guard.
printf 'update\n' >"$TMP_ROOT/cursor-mission.txt"
run_wrapper work cursor -P "$TMP_ROOT/cursor-mission.txt"
expect_code 2 "cursor subcommand-word mission file"
expect_out "would dispatch the cursor subcommand" "cursor subcommand-word mission file"
ok "cursor: a one-word -P mission file matching a subcommand is rejected despite its trailing newline"

run_wrapper_env AGENT_FAKE_NO_ENVELOPE=1 -- consult cursor -p hi
expect_code 1 "cursor missing envelope"
expect_out "could not parse the cursor result envelope" "cursor missing envelope"
ok "cursor: a missing result envelope fails the run instead of a silent 0"

run_wrapper_env AGENT_FAKE_IS_ERROR=1 -- consult cursor -p hi
expect_code 1 "cursor is_error envelope"
expect_out "cursor reported an error result envelope" "cursor is_error envelope"
ok "cursor: an is_error envelope fails the run even on backend exit 0"

run_wrapper_env AGENT_FAKE_READ_STDIN=1 -- work cursor -p 'apply this' -f "$BIG_FILE"
expect_code 0 "cursor oversize prompt"
expect_out "ENDMARKER" "cursor oversize prompt"
expect_not_out "ARG:apply this" "cursor oversize prompt"
ok "prompt: oversize material falls back to stdin delivery for cursor"

# Unlike codex, cursor resume reads stdin, so oversize prompts compose with -r.
run_wrapper_env AGENT_FAKE_READ_STDIN=1 -- work cursor -p 'apply this' -f "$BIG_FILE" -r dddd-resume
expect_code 0 "cursor oversize prompt with resume"
expect_out "ENDMARKER" "cursor oversize prompt with resume"
expect_out "ARG:--resume" "cursor oversize prompt with resume"
expect_out "ARG:dddd-resume" "cursor oversize prompt with resume"
expect_not_out "ARG:apply this" "cursor oversize prompt with resume"
ok "prompt: oversize stdin delivery composes with -r for cursor (codex rejects this)"

# With stdin delivery the `--`+prompt operand is omitted; a surviving benign
# passthrough flag must ride along without becoming a positional mission.
run_wrapper_env AGENT_FAKE_READ_STDIN=1 -- work cursor -p 'apply this' -f "$BIG_FILE" -- --approve-mcps
expect_code 0 "cursor oversize prompt with passthrough"
expect_out "ENDMARKER" "cursor oversize prompt with passthrough"
expect_out "ARG:--approve-mcps" "cursor oversize prompt with passthrough"
expect_not_out "ARG:apply this" "cursor oversize prompt with passthrough"
ok "prompt: oversize stdin delivery keeps benign passthrough flags on argv for cursor"

run_wrapper_env AGENT_FAKE_TOUCH=1 -- consult cursor -p hi
expect_code 4 "cursor consult drift"
expect_out "agent-run: worktree: DIRTY (consult modified:" "cursor consult drift"
reset_worktree
ok "cursor: a consult that mutates the worktree exits 4 like the other lock-free consults"

# --- passthrough guards -------------------------------------------------------------

run_wrapper work codex -p hi -- -C /elsewhere
expect_code 2 "codex -C"
expect_out "lock" "codex -C"
ok "codex: -C is rejected (lock would guard the wrong worktree)"

run_wrapper consult codex -p hi -- --cd=/elsewhere
expect_code 2 "codex --cd="
ok "codex: --cd= is rejected"

run_wrapper work codex -p hi -- -a untrusted
expect_code 2 "codex -a"
expect_out "approval" "codex -a"
ok "codex: passthrough approval overrides are rejected"

run_wrapper consult codex -p hi -- -c sandbox_mode=read-only
expect_code 2 "codex sandbox override"
ok "codex: passthrough sandbox_mode overrides are rejected"

run_wrapper consult codex -p hi -- --config=sandbox_mode=read-only
expect_code 2 "codex sandbox override equals form"
ok "codex: the --config= equals form cannot bypass the sandbox_mode veto"

run_wrapper work codex -p hi -- -c approval_policy=untrusted
expect_code 2 "codex approval_policy via -c"
expect_out "approval" "codex approval_policy via -c"
ok "codex: approval_policy config overrides are rejected like -a"

run_wrapper work codex -p hi -- --full-auto
expect_code 2 "codex --full-auto"
ok "codex: --full-auto is rejected (flips the sandbox to a broken mode)"

run_wrapper work codex -p hi -- --dangerously-bypass-hook-trust
expect_code 2 "codex --dangerously-bypass-hook-trust"
ok "codex: hook-trust bypass is rejected with other sandbox overrides"

run_wrapper work codex -p hi -- --profile alt
expect_code 2 "codex --profile"
expect_out "profile" "codex --profile"
ok "codex: --profile is rejected (profiles can flip sandbox/approval config)"

run_wrapper work codex -p hi -- -c profile=loose
expect_code 2 "codex config profile"
expect_out "profile" "codex config profile"
run_wrapper consult codex -p hi -- --config=profile=loose
expect_code 2 "codex config profile equals"
ok "codex: config profile cannot bypass the profile guard"

run_wrapper work codex -p hi -- -m gpt-5.5
expect_code 2 "codex passthrough -m"
ok "codex: passthrough model flags are rejected (wrapper owns -m)"

run_wrapper work codex -p hi -- -C/elsewhere
expect_code 2 "codex attached -C"
run_wrapper consult codex -p hi -- -C=/elsewhere
expect_code 2 "codex -C= form"
ok "codex: attached/equals -C spellings are rejected like the space form"

run_wrapper consult codex -p hi -- -csandbox_mode=read-only
expect_code 2 "codex attached -c sandbox"
run_wrapper work codex -p hi -- -c=approval_policy=untrusted
expect_code 2 "codex -c= approval"
ok "codex: attached -c config values still hit the sandbox/approval veto"

run_wrapper work codex -p hi -- -anever
expect_code 2 "codex attached -a"
run_wrapper work codex -p hi -- -sdanger-full-access
expect_code 2 "codex attached -s"
run_wrapper work codex -p hi -- -mgpt-5.5
expect_code 2 "codex attached -m"
run_wrapper work codex -p hi -- -palt
expect_code 2 "codex attached -p profile"
ok "codex: attached short approval/sandbox/model/profile values are rejected"

run_wrapper work codex -p hi -- -c foo=bar -c sandbox_mode=read-only
expect_code 2 "codex repeated -c"
ok "codex: every -c occurrence is scanned, not just the first"

run_wrapper work codex -p hi -- -c model=gpt-5.5
expect_code 2 "codex config model"
expect_out "model" "codex config model"
run_wrapper work codex -p hi -- -c model_provider=rogue
expect_code 2 "codex config model provider"
expect_out "provider" "codex config model provider"
run_wrapper work codex -p hi -- --config=model_providers.rogue.base_url=https://example.invalid
expect_code 2 "codex config model providers map"
expect_out "provider" "codex config model providers map"
run_wrapper work codex -p hi -- '--config=model_providers={rogue={base_url="https://example.invalid"}}'
expect_code 2 "codex config inline model providers map"
expect_out "provider" "codex config inline model providers map"
run_wrapper work codex -p hi -- --config=model_reasoning_effort=high
expect_code 2 "codex config effort"
expect_out "model_reasoning_effort" "codex config effort"
ok "codex: config keys and inline maps for model providers cannot override wrapper options"

for SPACED_CONFIG in \
  'sandbox_mode = "read-only"' \
  "approval_policy = 'untrusted'" \
  'profile = "unsafe"' \
  'model = "gpt-5.5"' \
  'model_provider = "rogue"' \
  'model_providers . rogue . base_url = "https://example.invalid"' \
  'model_reasoning_effort = "high"'
do
  run_wrapper work codex -p hi -- -c "$SPACED_CONFIG"
  expect_code 2 "codex spaced config key: $SPACED_CONFIG"
done
run_wrapper work codex -p hi -- -c '"model_provider" = "rogue"'
expect_code 2 "codex quoted config key"
ok "codex: whitespace and TOML quoting cannot bypass any wrapper-owned config key"

run_wrapper work codex -p hi -- -o /tmp/hijack.msg
expect_code 2 "codex passthrough -o"
expect_out "wrapper-owned" "codex passthrough -o"
run_wrapper work codex -p hi -- --output-last-message /tmp/hijack.msg
expect_code 2 "codex passthrough --output-last-message"
ok "codex: passthrough -o/--output-last-message is rejected (answer contract)"

run_wrapper work codex -p hi -- resume --last
expect_code 2 "codex smuggled resume"
expect_out "session" "codex smuggled resume"
run_wrapper consult codex -p hi -- --last
expect_code 2 "codex smuggled --last"
ok "codex: smuggled resume/--last session control is rejected (subcommand, not flag)"

for flag in --dangerously-skip-permissions --allow-dangerously-skip-permissions --permission-mode; do
  run_wrapper consult claude -p hi -- "$flag"
  expect_code 2 "claude consult $flag"
  expect_out "read-only" "claude consult $flag"
done
ok "claude: consult rejects permission-widening passthrough flags"

run_wrapper work claude -p hi -- --permission-mode plan
expect_code 2 "claude work permission-mode"
expect_out "stall" "claude work permission-mode"
ok "claude: work also rejects --permission-mode (it can downgrade the full-permission profile and stall)"

run_wrapper consult claude -p hi -- --permission-prompt-tool auto-approve
expect_code 2 "claude consult permission-prompt-tool"
expect_out "read-only" "claude consult permission-prompt-tool"
run_wrapper consult claude -p hi -- --permission-prompt-tool=auto-approve
expect_code 2 "claude consult permission-prompt-tool equals"
ok "claude: consult rejects permission prompt tools that can auto-approve denied tools"

run_wrapper consult claude -p hi -- --allowedTools Bash
expect_code 2 "claude blanket allowedTools"
expect_out "blanket" "claude blanket allowedTools"
ok "claude: consult rejects a blanket --allowedTools grant"

run_wrapper consult claude -p hi -- --allowedTools Edit
expect_code 2 "claude blanket Edit"
expect_out "blanket" "claude blanket Edit"
ok "claude: consult rejects a bare Edit grant (a live mutating tool)"

# MultiEdit is gone from claude 2.x; the wrapper no longer carries a dead
# defense for it, so a MultiEdit grant is now inert rather than rejected.
run_wrapper consult claude -p hi -- --allowedTools MultiEdit
expect_code 0 "claude MultiEdit no longer defended"
expect_out "ARG:MultiEdit" "claude MultiEdit no longer defended"
ok "claude: the dead MultiEdit guard entry is gone (grant passes through inert)"

run_wrapper consult claude -p hi -- --allowedTools 'Bash(*)'
expect_code 2 "claude Bash(*) blanket"
expect_out "blanket" "claude Bash(*) blanket"
ok "claude: consult rejects the effectively-blanket Bash(*) shape"

run_wrapper consult claude -p hi -- --allowedTools 'Bash(:*)'
expect_code 2 "claude Bash(:*) blanket"
ok "claude: consult rejects the empty-prefix Bash(:*) blanket shape"

for tool in 'Task(*)' 'Task(:*)' 'Write(*)' 'Edit(:*)' 'NotebookEdit(*:*)'; do
  run_wrapper consult claude -p hi -- --allowedTools "$tool"
  expect_code 2 "claude scoped blanket $tool"
  expect_out "blanket" "claude scoped blanket $tool"
done
ok "claude: consult rejects scoped blanket grants for mutating and nested-agent tools"

run_wrapper consult claude -p hi -- --allowedTools 'Bash(git diff:*)'
expect_code 0 "claude narrow allowedTools"
expect_out "ARG:Bash(git diff:*)" "claude narrow allowedTools"
expect_out "granted you specific extra commands" "claude narrow grant carve-out"
ok "claude: a narrow --allowedTools grant passes through and is carved out of the preamble"

run_wrapper work claude -p hi -- --model sonnet
expect_code 2 "claude passthrough model"
ok "claude: passthrough --model is rejected (wrapper owns -m)"

run_wrapper consult claude -p hi -- --settings extra.json
expect_code 2 "claude consult --settings"
expect_out "read-only" "claude consult --settings"
ok "claude: consult rejects --settings (can widen permissions)"

run_wrapper consult claude -p hi -- --disallowedTools OtherTool
expect_code 2 "claude consult --disallowedTools"
ok "claude: consult rejects --disallowedTools overrides (last-wins risk)"

run_wrapper work claude -p hi -- --settings extra.json
expect_code 0 "claude work --settings"
expect_out "ARG:--settings" "claude work --settings"
ok "claude: work mode still passes --settings through"

run_wrapper work claude -p hi -- --resume other-session
expect_code 2 "claude passthrough resume"
expect_out "-r" "claude passthrough resume"
ok "claude: passthrough --resume is rejected (wrapper owns sessions via -r)"

run_wrapper work claude -p hi -- --from-pr 123
expect_code 2 "claude passthrough from-pr"
expect_out "-r" "claude passthrough from-pr"
run_wrapper consult claude -p hi -- --from-pr=123
expect_code 2 "claude passthrough from-pr equals"
ok "claude: --from-pr session resumes are rejected like other native session controls"

run_wrapper work claude -p hi -- -rdeadbeef
expect_code 2 "claude attached -r"
run_wrapper consult claude -p hi -- --session-id 12345678-1234-1234-1234-123456789abc
expect_code 2 "claude --session-id"
ok "claude: attached -r<id> and --session-id are wrapper-owned session handling"

run_wrapper work claude -p hi -- -w
expect_code 2 "claude -w"
expect_out "worktree" "claude -w"
run_wrapper consult claude -p hi -- --worktree=fix-branch
expect_code 2 "claude --worktree="
ok "claude: worktree-creating flags are rejected (lock and drift cover this worktree only)"

run_wrapper consult claude -p hi -- --dangerously-skip-permissions=true
expect_code 2 "claude skip-permissions= form"
ok "claude: boolean-assignment permission spellings are rejected too"

run_wrapper work claude -p hi -- --output-format text
expect_code 2 "claude passthrough output-format"
ok "claude: passthrough --output-format is rejected (wrapper owns the envelope)"

run_wrapper consult copilot -m m -p hi -- --allow-all
expect_code 2 "copilot consult --allow-all"
expect_out "read-only" "copilot consult --allow-all"
ok "copilot: consult rejects blanket permission flags"

run_wrapper consult copilot -m m -p hi -- --allow-url --allow-all
expect_code 2 "copilot optional value before blanket"
expect_out "read-only" "copilot optional value before blanket"
run_wrapper consult copilot -m m -p hi -- --allow-url=https://example.invalid --allow-all
expect_code 2 "copilot optional equals value before blanket"
expect_out "read-only" "copilot optional equals value before blanket"
ok "copilot: optional-value flags cannot hide blanket permission grants"

run_wrapper consult copilot -m m -p hi -- --allow-tool shell
expect_code 2 "copilot blanket shell grant"
expect_out "blanket" "copilot blanket shell grant"
ok "copilot: consult rejects a variadic blanket shell grant"

run_wrapper consult copilot -m m -p hi -- '--allow-tool=shell(git diff:*),shell'
expect_code 2 "copilot blanket grant in comma list"
ok "copilot: consult rejects a blanket grant inside a comma list"

run_wrapper consult copilot -m m -p hi -- --allow-tool shell,write
expect_code 2 "copilot blanket in variadic comma list"
ok "copilot: consult splits variadic comma lists like the equals form"

run_wrapper consult copilot -m m -p hi -- --allow-tool 'shell(*)'
expect_code 2 "copilot shell(*) blanket"
expect_out "blanket" "copilot shell(*) blanket"
ok "copilot: consult rejects the effectively-blanket shell(*) shape"

run_wrapper consult copilot -m m -p hi -- --allow-tool 'shell(:*)'
expect_code 2 "copilot shell(:*) blanket"
ok "copilot: consult rejects the empty-prefix shell(:*) blanket shape"

run_wrapper consult copilot -m m -p hi -- --allow-tool 'write(*:*)'
expect_code 2 "copilot write(*:*) blanket"
run_wrapper consult copilot -m m -p hi -- --allow-tool 'write(:*)'
expect_code 2 "copilot write(:*) blanket"
ok "copilot: consult rejects blanket write grants with empty command scopes"

# copilot's grammar is kind(argument) with the argument optional, and an
# omitted shell command allows every shell command — so the empty-parenthesis
# spelling is the bare `shell` blanket by another name.
run_wrapper consult copilot -m m -p hi -- --allow-tool 'shell()'
expect_code 2 "copilot shell() blanket"
expect_out "blanket" "copilot shell() blanket"
run_wrapper consult copilot -m m -p hi -- --allow-tool 'write()'
expect_code 2 "copilot write() blanket"
run_wrapper consult copilot -m m -p hi -- '--allow-tool=shell(git diff:*),shell()'
expect_code 2 "copilot shell() blanket in comma list"
ok "copilot: consult rejects the empty-argument shell()/write() blanket spellings"

run_wrapper consult copilot -m m -p hi -- --allow-tool 'shell(git diff:*)'
expect_code 0 "copilot narrow grant"
expect_out "ARG:shell(git diff:*)" "copilot narrow grant"
expect_out "granted you specific extra commands" "copilot narrow grant carve-out"
ok "copilot: a narrow shell grant passes through and is carved out of the preamble"

for flag in -r --session-id --connect; do
  run_wrapper consult copilot -m m -p hi -- "$flag"
  expect_code 2 "copilot session flag $flag"
  expect_out "wrapper-owned" "copilot session flag $flag"
done
ok "copilot: -r/--session-id/--connect session aliases are wrapper-owned"

run_wrapper consult copilot -m m -p hi -- -rdeadbeef
expect_code 2 "copilot attached -r"
run_wrapper consult copilot -m m -p hi -- -pinjected
expect_code 2 "copilot attached -p"
ok "copilot: attached -r/-p spellings are wrapper-owned like the space forms"

run_wrapper consult copilot -m m -p hi -- --output-format json
expect_code 2 "copilot --output-format"
expect_out "wrapper-owned" "copilot --output-format"
ok "copilot: --output-format is rejected (the wrapper owns structured answer parsing)"

run_wrapper consult copilot -m m -p hi -- -s
expect_code 2 "copilot passthrough -s"
expect_out "wrapper-owned" "copilot passthrough -s"
run_wrapper work copilot -m m -p hi -- --silent
expect_code 2 "copilot passthrough --silent"
ok "copilot: passthrough -s/--silent is rejected (the wrapper owns output selection)"

run_wrapper consult copilot -m m -p hi -- -i
expect_code 2 "copilot -i"
expect_out "interactive" "copilot -i"
run_wrapper consult copilot -m m -p hi -- -ihello
expect_code 2 "copilot attached -i"
run_wrapper consult copilot -m m -p hi -- --interactive=hello
expect_code 2 "copilot --interactive= form"
ok "copilot: interactive passthrough flags and attached values are rejected"

run_wrapper consult copilot -m m -p hi -- --acp
expect_code 2 "copilot --acp"
run_wrapper consult copilot -m m -p hi -- --autopilot
expect_code 2 "copilot --autopilot"
run_wrapper consult copilot -m m -p hi -- --mode
expect_code 2 "copilot --mode"
run_wrapper consult copilot -m m -p hi -- --mode=plan
expect_code 2 "copilot --mode= form"
ok "copilot: server and mode-selecting passthrough flags are rejected"

run_wrapper consult copilot -m m -p hi -- --share
expect_code 2 "copilot bare --share"
run_wrapper consult copilot -m m -p hi -- --share-gist
expect_code 2 "copilot --share-gist"
run_wrapper consult copilot -m m -p hi -- --share-gist=private
expect_code 2 "copilot --share-gist= form"
ok "copilot: --share and all --share-gist spellings are rejected (default or remote transcript exposure)"

MULTILINE_SHARE="$TMP_ROOT/multiline-share$FORGED_PATH_SUFFIX"
run_wrapper consult copilot -m m -p hi -o "$TMP_ROOT/multiline-share-answer.msg" \
  -- "--share=$MULTILINE_SHARE"
expect_code 2 "multiline caller transcript path"
expect_out "single-line path" "multiline caller transcript path"
assert_prelaunch_reject_contract "multiline caller transcript path contract" "$OUT"
[ ! -e "$MULTILINE_SHARE" ] || fail "multiline caller transcript path: rejected path was created"

run_wrapper consult copilot -m m -p hi -o "$TMP_ROOT/multiline-canonical-share-answer.msg" \
  -- "--share=$MULTILINE_TARGET_ALIAS/transcript.md"
expect_code 2 "multiline canonical caller transcript path"
expect_out "single-line path" "multiline canonical caller transcript path"
assert_prelaunch_reject_contract "multiline canonical caller transcript path contract" "$OUT"
ok "copilot: raw and canonical multiline transcript paths reject before control-log records"

run_wrapper consult copilot -m m -p hi -- --share=review.md
expect_code 2 "copilot consult in-tree --share="
expect_out "outside the repo" "copilot consult in-tree --share="
run_wrapper consult copilot -m m -p hi -- "--share=$TMP_ROOT/out-share.md"
expect_code 0 "copilot consult outside --share="
run_wrapper work copilot -m m -p hi -- --share=in-tree.md
expect_code 2 "copilot work in-tree --share="
expect_out "outside the repo" "copilot work in-tree --share="
[ ! -e "$WORKTREE/in-tree.md" ] || fail "copilot work in-tree --share=: rejected path was still written"
run_wrapper work copilot -m m -p hi -- "--share=$TMP_ROOT/work-out-share.md"
expect_code 0 "copilot work outside --share="
ok "copilot: --share= must resolve outside the worktree in every mode"

CALLER_SHARE_ANSWER="$TMP_ROOT/caller-share-answer.msg"
run_wrapper consult copilot -m m -p hi -o "$CALLER_SHARE_ANSWER" -- "--share=$TMP_ROOT/caller-share.md"
expect_code 0 "copilot caller --share with -o"
[ ! -e "$CALLER_SHARE_ANSWER.transcript.md" ] || fail "copilot caller --share with -o: wrapper still wrote its own sidecar"
CALLER_SHARE_ATTEMPT="$(attempt_current_id "$CALLER_SHARE_ANSWER")"
[ "$(cat "$CALLER_SHARE_ANSWER.agent-run/$CALLER_SHARE_ATTEMPT/transcript-path")" = "$TMP_ROOT/caller-share.md" ] \
  || fail "copilot caller --share with -o: attempt metadata lost the caller path"
[ ! -e "$CALLER_SHARE_ANSWER.agent-run/$CALLER_SHARE_ATTEMPT/copilot-transcript.md" ] \
  || fail "copilot caller --share with -o: wrapper created a competing transcript"
expect_out "agent-run: transcript: $TMP_ROOT/caller-share.md (caller-owned)" "copilot caller --share trailer"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot caller --share session id"
rm -f "$CALLER_SHARE_ANSWER" "$TMP_ROOT/caller-share.md"
ok "copilot: a caller --share= replaces the wrapper sidecar instead of racing it for the transcript"

SYMLINK_SHARE_A="$TMP_ROOT/symlink-share-a"
SYMLINK_SHARE_B="$TMP_ROOT/symlink-share-b"
SYMLINK_SHARE_ALIAS="$TMP_ROOT/symlink-share-alias"
SYMLINK_SHARE_OUT="$TMP_ROOT/symlink-share-answer.msg"
SYMLINK_SHARE_READY="$TMP_ROOT/symlink-share.ready"
SYMLINK_SHARE_RELEASE="$TMP_ROOT/symlink-share.release"
SYMLINK_SHARE_LOG="$TMP_ROOT/symlink-share.log"
mkdir "$SYMLINK_SHARE_A" "$SYMLINK_SHARE_B"
ln -s "$SYMLINK_SHARE_A" "$SYMLINK_SHARE_ALIAS"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_SHARE_LOCK_READY="$SYMLINK_SHARE_READY" \
  AGENT_RUN_TEST_SHARE_LOCK_RELEASE="$SYMLINK_SHARE_RELEASE" \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$SYMLINK_SHARE_OUT" \
    -- "--share=$SYMLINK_SHARE_ALIAS/transcript.md") >"$SYMLINK_SHARE_LOG" 2>&1 &
SYMLINK_SHARE_WRAPPER=$!
await_ready "$SYMLINK_SHARE_READY" "$SYMLINK_SHARE_WRAPPER" "symlink caller-share: wrapper never acquired the canonical lock" "$SYMLINK_SHARE_LOG"
ln -sfn "$SYMLINK_SHARE_B" "$SYMLINK_SHARE_ALIAS"
: >"$SYMLINK_SHARE_RELEASE"
wait_wrapper "$SYMLINK_SHARE_WRAPPER" "$SYMLINK_SHARE_LOG"
expect_code 0 "symlink caller-share repoint"
[ -s "$SYMLINK_SHARE_A/transcript.md" ] \
  || fail "symlink caller-share repoint: canonical transcript was not written"
[ ! -e "$SYMLINK_SHARE_B/transcript.md" ] \
  || fail "symlink caller-share repoint: repointed raw path received the transcript"
SYMLINK_SHARE_ATTEMPT="$(attempt_current_id "$SYMLINK_SHARE_OUT")"
[ "$(cat "$SYMLINK_SHARE_OUT.agent-run/$SYMLINK_SHARE_ATTEMPT/transcript-path")" = "$SYMLINK_SHARE_A/transcript.md" ] \
  || fail "symlink caller-share repoint: attempt metadata did not retain the locked canonical path"
expect_out "ARG:--share=$SYMLINK_SHARE_A/transcript.md" "symlink caller-share repoint"
ok "copilot: caller-share I/O and arguments stay bound to the canonical locked path"

RELATIVE_SHARE_CWD="$TMP_ROOT/relative-share-cwd"
RELATIVE_SHARE_OUT="$TMP_ROOT/relative-share-answer.msg"
mkdir "$RELATIVE_SHARE_CWD"
set +e
OUT="$(cd "$RELATIVE_SHARE_CWD" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_COPILOT_INTENT_ONLY=1 \
  bash "$WRAPPER" consult copilot -m m -p hi -o "$RELATIVE_SHARE_OUT" \
    -- --share=first-transcript.md 2>&1)"
CODE=$?
set -e
expect_code 1 "relative caller-share retry predecessor"
RELATIVE_SHARE_FIRST_ATTEMPT="$(attempt_current_id "$RELATIVE_SHARE_OUT")"
[ "$(cat "$RELATIVE_SHARE_OUT.agent-run/$RELATIVE_SHARE_FIRST_ATTEMPT/transcript-path")" = "$RELATIVE_SHARE_CWD/first-transcript.md" ] \
  || fail "relative caller-share retry: persisted transcript path was not canonical"
run_wrapper consult copilot -m m -p hi -o "$RELATIVE_SHARE_OUT" \
  -- "--share=$RELATIVE_SHARE_CWD/second-transcript.md"
expect_code 0 "relative caller-share cross-cwd retry"
ok "copilot: retry validation reopens a persisted absolute caller-share path across cwd changes"

DELETED_SHARE_OUT="$TMP_ROOT/deleted-share-answer.msg"
DELETED_SHARE_OLD="$TMP_ROOT/deleted-share-old.md"
DELETED_SHARE_FRESH="$TMP_ROOT/deleted-share-fresh.md"
run_wrapper_env AGENT_FAKE_COPILOT_INTENT_ONLY=1 \
  -- consult copilot -m m -p hi -o "$DELETED_SHARE_OUT" \
  -- "--share=$DELETED_SHARE_OLD"
expect_code 1 "deleted caller-share predecessor"
rm -f -- "$DELETED_SHARE_OLD"
run_wrapper consult copilot -m m -p hi -o "$DELETED_SHARE_OUT" \
  -- "--share=$DELETED_SHARE_FRESH"
expect_code 0 "retry after deleting historical caller-share"
expect_out "fake copilot answer" "retry after deleting historical caller-share"
ok "copilot: deleting a historical caller-owned transcript does not block answer retries"

RECREATED_SHARE_OUT="$TMP_ROOT/recreated-share-answer.msg"
RECREATED_SHARE_OLD="$TMP_ROOT/recreated-share-old.md"
RECREATED_SHARE_PIN="$TMP_ROOT/recreated-share-original-inode.md"
RECREATED_SHARE_FRESH="$TMP_ROOT/recreated-share-fresh.md"
run_wrapper_env AGENT_FAKE_COPILOT_INTENT_ONLY=1 \
  -- consult copilot -m m -p hi -o "$RECREATED_SHARE_OUT" \
  -- "--share=$RECREATED_SHARE_OLD"
expect_code 1 "recreated caller-share predecessor"
ln -- "$RECREATED_SHARE_OLD" "$RECREATED_SHARE_PIN"
rm -f -- "$RECREATED_SHARE_OLD"
printf 'unrelated replacement transcript\n' >"$RECREATED_SHARE_OLD"
run_wrapper consult copilot -m m -p hi -o "$RECREATED_SHARE_OUT" \
  -- "--share=$RECREATED_SHARE_FRESH"
expect_code 0 "recreated historical caller-share"
expect_out "fake copilot answer" "recreated historical caller-share"
ok "copilot: rotating a historical caller-owned transcript does not block answer retries"

if command -v flock >/dev/null 2>&1; then
  SHARED_CALLER_PATH="$TMP_ROOT/concurrent-caller-share.md"
  SHARED_CALLER_FIRST_OUT="$TMP_ROOT/concurrent-caller-share-first.msg"
  SHARED_CALLER_SECOND_OUT="$TMP_ROOT/concurrent-caller-share-second.msg"
  SHARED_CALLER_FIRST_LOG="$TMP_ROOT/concurrent-caller-share-first.log"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
    exec bash "$WRAPPER" consult copilot -m m -p hi -o "$SHARED_CALLER_FIRST_OUT" \
      -- "--share=$SHARED_CALLER_PATH") >"$SHARED_CALLER_FIRST_LOG" 2>&1 &
  SHARED_CALLER_FIRST_WRAPPER=$!
  n=0
  until grep -q '^agent-run: backend-pid:' "$SHARED_CALLER_FIRST_LOG" 2>/dev/null \
    || ! kill -0 "$SHARED_CALLER_FIRST_WRAPPER" 2>/dev/null || [ "$n" -ge 100 ]; do
    sleep 0.05
    n=$((n + 1))
  done
  grep -q '^agent-run: backend-pid:' "$SHARED_CALLER_FIRST_LOG" \
    || fail "concurrent caller share: first run never reached the backend ($(cat "$SHARED_CALLER_FIRST_LOG"))"
  run_wrapper consult copilot -m m -p hi -o "$SHARED_CALLER_SECOND_OUT" \
    -- "--share=$SHARED_CALLER_PATH"
  SHARED_CALLER_SECOND_CODE=$CODE
  SHARED_CALLER_SECOND_TEXT=$OUT
  kill -TERM "$SHARED_CALLER_FIRST_WRAPPER" 2>/dev/null || true
  set +e
  wait "$SHARED_CALLER_FIRST_WRAPPER"
  set -e
  CODE=$SHARED_CALLER_SECOND_CODE
  OUT=$SHARED_CALLER_SECOND_TEXT
  expect_code 3 "concurrent caller share"
  expect_out "transcript path" "concurrent caller share"
  expect_not_out "ARG:" "concurrent caller share"
  ok "copilot: different outputs cannot concurrently claim the same caller-owned --share path"

  REPLACED_SHARE_PATH="$TMP_ROOT/replaced-share-lock.md"
  REPLACED_SHARE_FIRST_OUT="$TMP_ROOT/replaced-share-lock-first.msg"
  REPLACED_SHARE_SECOND_OUT="$TMP_ROOT/replaced-share-lock-second.msg"
  REPLACED_SHARE_READY="$TMP_ROOT/replaced-share-lock.ready"
  REPLACED_SHARE_RELEASE="$TMP_ROOT/replaced-share-lock.release"
  REPLACED_SHARE_LOG="$TMP_ROOT/replaced-share-lock.log"
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    AGENT_RUN_TEST_SHARE_LOCK_READY="$REPLACED_SHARE_READY" \
    AGENT_RUN_TEST_SHARE_LOCK_RELEASE="$REPLACED_SHARE_RELEASE" \
    exec bash "$WRAPPER" consult copilot -m m -p hi -o "$REPLACED_SHARE_FIRST_OUT" \
      -- "--share=$REPLACED_SHARE_PATH") >"$REPLACED_SHARE_LOG" 2>&1 &
  REPLACED_SHARE_WRAPPER=$!
  await_ready "$REPLACED_SHARE_READY" "$REPLACED_SHARE_WRAPPER" \
    "replaced caller-share lock: first wrapper never pinned its lock inode" "$REPLACED_SHARE_LOG"
  rm -f "$REPLACED_SHARE_PATH.agent-run.lock"
  : >"$REPLACED_SHARE_PATH.agent-run.lock"
  run_wrapper consult copilot -m m -p hi -o "$REPLACED_SHARE_SECOND_OUT" \
    -- "--share=$REPLACED_SHARE_PATH"
  REPLACED_SHARE_SECOND_CODE=$CODE
  REPLACED_SHARE_SECOND_TEXT=$OUT
  : >"$REPLACED_SHARE_RELEASE"
  set +e
  wait "$REPLACED_SHARE_WRAPPER"
  REPLACED_SHARE_FIRST_CODE=$?
  set -e
  [ "$REPLACED_SHARE_FIRST_CODE" -eq 0 ] \
    || fail "replaced caller-share lock: original owner failed ($(cat "$REPLACED_SHARE_LOG"))"
  CODE=$REPLACED_SHARE_SECOND_CODE
  OUT=$REPLACED_SHARE_SECOND_TEXT
  expect_code 3 "replaced caller-share lock"
  expect_out "lock identity" "replaced caller-share lock"
  expect_not_out "ARG:" "replaced caller-share lock"
  ok "copilot: a persistent inode pin rejects a replacement caller-share lock owner"
else
  ok "skipped concurrent caller-owned --share ownership check (flock unavailable)"
fi

SHARE_SYNC_BIN="$TMP_ROOT/share-sync-bin"
SHARE_SYNC_LOG="$TMP_ROOT/share-sync.log"
SHARE_SYNC_OUT_DIR="$TMP_ROOT/share-sync-output"
SHARE_SYNC_DIR="$TMP_ROOT/share-sync-transcript"
SHARE_SYNC_OUT="$SHARE_SYNC_OUT_DIR/answer.msg"
SHARE_SYNC_PATH="$SHARE_SYNC_DIR/transcript.md"
mkdir -p "$SHARE_SYNC_BIN" "$SHARE_SYNC_OUT_DIR" "$SHARE_SYNC_DIR"
cat >"$SHARE_SYNC_BIN/sync" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${!#}" >>"$AGENT_FAKE_SYNC_LOG"
exec "$AGENT_REAL_SYNC" "$@"
EOF
chmod +x "$SHARE_SYNC_BIN/sync"
REAL_SYNC_BIN="$(command -v sync)"
set +e
OUT="$(cd "$WORKTREE" && PATH="$SHARE_SYNC_BIN:$FAKE_BIN:$PATH" \
  AGENT_FAKE_SYNC_LOG="$SHARE_SYNC_LOG" AGENT_REAL_SYNC="$REAL_SYNC_BIN" \
  bash "$WRAPPER" consult copilot -m m -p hi -o "$SHARE_SYNC_OUT" \
    -- "--share=$SHARE_SYNC_PATH" 2>&1)"
CODE=$?
set -e
expect_code 0 "caller-share directory sync"
grep -qFx "$SHARE_SYNC_PATH" "$SHARE_SYNC_LOG" \
  || fail "caller-share directory sync: transcript inode was not synced ($(cat "$SHARE_SYNC_LOG"))"
grep -qFx "$SHARE_SYNC_DIR" "$SHARE_SYNC_LOG" \
  || fail "caller-share directory sync: containing directory was not synced ($(cat "$SHARE_SYNC_LOG"))"
[ "$SHARE_SYNC_DIR" != "$SHARE_SYNC_OUT_DIR" ] \
  || fail "caller-share directory sync: fixture did not separate transcript and output parents"
ok "copilot: caller-owned share claim syncs its containing directory"

printf 'prior transcript\n' >"$TMP_ROOT/stale-caller-share.md"
run_wrapper consult copilot -m m -p hi -- "--share=$TMP_ROOT/stale-caller-share.md"
expect_code 2 "copilot stale caller --share"
expect_out "must be absent" "copilot stale caller --share"
rm -f "$TMP_ROOT/stale-caller-share.md"
ok "copilot: an existing nonempty caller-owned --share is rejected before launch"

EMPTY_CALLER_SHARE_OUT="$TMP_ROOT/empty-caller-share-answer.msg"
EMPTY_CALLER_SHARE="$TMP_ROOT/empty-caller-share.md"
: >"$EMPTY_CALLER_SHARE"
run_wrapper consult copilot -m m -p hi -o "$EMPTY_CALLER_SHARE_OUT" -- "--share=$EMPTY_CALLER_SHARE"
expect_code 2 "copilot empty caller --share"
expect_out "must be absent" "copilot empty caller --share"
expect_not_out "ARG:" "copilot empty caller --share"
ok "copilot: an existing empty caller-owned --share is rejected before launch"

REUSED_EMPTY_SHARE_OUT="$TMP_ROOT/reused-empty-share-answer.msg"
REUSED_EMPTY_SHARE="$TMP_ROOT/reused-empty-share.md"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_FAKE_COPILOT_INTENT_ONLY=1 AGENT_FAKE_SKIP_SHARE=1 \
  bash "$WRAPPER" consult copilot -m m -p hi -o "$REUSED_EMPTY_SHARE_OUT" \
    -- "--share=$REUSED_EMPTY_SHARE" 2>&1)"
CODE=$?
set -e
expect_code 1 "copilot empty caller-share retry predecessor"
[ -f "$REUSED_EMPTY_SHARE" ] && [ ! -s "$REUSED_EMPTY_SHARE" ] \
  || fail "copilot empty caller-share retry predecessor: fake did not leave an empty transcript"
run_wrapper consult copilot -m m -p hi -o "$REUSED_EMPTY_SHARE_OUT" \
  -- "--share=$REUSED_EMPTY_SHARE"
expect_code 2 "copilot retry reusing empty caller-share"
expect_out "must be absent" "copilot retry reusing empty caller-share"
expect_not_out "ARG:" "copilot retry reusing empty caller-share"
ok "copilot: retrying with the same empty caller share is rejected before launch"

REJECTED_CALLER_SHARE_OUT="$TMP_ROOT/rejected-caller-share-answer.msg"
REJECTED_CALLER_SHARE="$TMP_ROOT/rejected-caller-share.md"
run_wrapper_env AGENT_FAKE_COPILOT_INTENT_ONLY=1 -- consult copilot -m m -p hi -o "$REJECTED_CALLER_SHARE_OUT"
expect_code 1 "rejected caller-share predecessor"
run_wrapper_env AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL=1 \
  -- consult copilot -m m -p hi -o "$REJECTED_CALLER_SHARE_OUT" \
  -- "--share=$REJECTED_CALLER_SHARE"
expect_code 2 "attempt rejection after caller-share claim"
expect_out "cannot allocate an attempt record" "attempt rejection after caller-share claim"
[ ! -e "$REJECTED_CALLER_SHARE" ] \
  || fail "attempt rejection after caller-share claim: unused empty transcript survived cleanup"
run_wrapper consult copilot -m m -p hi -o "$REJECTED_CALLER_SHARE_OUT" \
  -- "--share=$REJECTED_CALLER_SHARE"
expect_code 0 "same caller-share retry after attempt rejection"
ok "copilot: a later attempt rejection removes the unused caller share for retry"

SHARE_CLAIM_RACE_OUT="$TMP_ROOT/share-claim-race-answer.msg"
SHARE_CLAIM_RACE="$TMP_ROOT/share-claim-race.md"
SHARE_CLAIM_READY="$TMP_ROOT/share-claim-race.ready"
SHARE_CLAIM_RELEASE="$TMP_ROOT/share-claim-race.release"
SHARE_CLAIM_LOG="$TMP_ROOT/share-claim-race.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_SHARE_CLAIM_READY="$SHARE_CLAIM_READY" \
  AGENT_RUN_TEST_SHARE_CLAIM_RELEASE="$SHARE_CLAIM_RELEASE" \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$SHARE_CLAIM_RACE_OUT" \
    -- "--share=$SHARE_CLAIM_RACE") >"$SHARE_CLAIM_LOG" 2>&1 &
SHARE_CLAIM_WRAPPER=$!
await_ready "$SHARE_CLAIM_READY" "$SHARE_CLAIM_WRAPPER" "caller-share claim race: wrapper never reached the exclusive claim" "$SHARE_CLAIM_LOG"
printf 'late caller transcript\n' >"$SHARE_CLAIM_RACE"
: >"$SHARE_CLAIM_RELEASE"
wait_wrapper "$SHARE_CLAIM_WRAPPER" "$SHARE_CLAIM_LOG"
expect_code 2 "caller-share claim race"
expect_out "appeared before claim" "caller-share claim race"
expect_not_out "ARG:" "caller-share claim race"
[ "$(cat "$SHARE_CLAIM_RACE")" = "late caller transcript" ] \
  || fail "caller-share claim race: late transcript content was clobbered"
rm -f -- "$SHARE_CLAIM_RACE"
SHARE_CLAIM_RETRY="$TMP_ROOT/share-claim-race-retry.md"
run_wrapper consult copilot -m m -p hi -o "$SHARE_CLAIM_RACE_OUT" \
  -- "--share=$SHARE_CLAIM_RETRY"
expect_code 0 "retry after caller-share claim race"
[ "$(cat "$SHARE_CLAIM_RACE_OUT")" = "fake copilot answer" ] \
  || fail "retry after caller-share claim race: answer was not published"
ok "copilot: caller-share claim rejection preserves the late file without bricking the answer path"

SHARE_LINK_SIGNAL_OUT="$TMP_ROOT/share-link-signal-answer.msg"
SHARE_LINK_SIGNAL="$TMP_ROOT/share-link-signal.md"
SHARE_LINK_SIGNAL_READY="$TMP_ROOT/share-link-signal.ready"
SHARE_LINK_SIGNAL_RELEASE="$TMP_ROOT/share-link-signal.release"
SHARE_LINK_SIGNAL_LOG="$TMP_ROOT/share-link-signal.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_SHARE_LINK_READY="$SHARE_LINK_SIGNAL_READY" \
  AGENT_RUN_TEST_SHARE_LINK_RELEASE="$SHARE_LINK_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$SHARE_LINK_SIGNAL_OUT" \
    -- "--share=$SHARE_LINK_SIGNAL") >"$SHARE_LINK_SIGNAL_LOG" 2>&1 &
SHARE_LINK_SIGNAL_WRAPPER=$!
await_ready "$SHARE_LINK_SIGNAL_READY" "$SHARE_LINK_SIGNAL_WRAPPER" "caller-share link signal: wrapper never reached the post-link ownership window" "$SHARE_LINK_SIGNAL_LOG"
[ -f "$SHARE_LINK_SIGNAL" ] && [ ! -s "$SHARE_LINK_SIGNAL" ] \
  || fail "caller-share link signal: exclusive claim did not create the expected empty share"
kill -TERM "$SHARE_LINK_SIGNAL_WRAPPER"
: >"$SHARE_LINK_SIGNAL_RELEASE"
wait_wrapper "$SHARE_LINK_SIGNAL_WRAPPER" "$SHARE_LINK_SIGNAL_LOG"
expect_code 1 "caller-share link signal"
assert_prelaunch_reject_contract "caller-share link signal" "$OUT"
[ ! -e "$SHARE_LINK_SIGNAL" ] \
  || fail "caller-share link signal: unused caller transcript was stranded after TERM"
run_wrapper consult copilot -m m -p hi -o "$SHARE_LINK_SIGNAL_OUT" \
  -- "--share=$SHARE_LINK_SIGNAL"
expect_code 0 "retry after caller-share link signal"
ok "copilot: TERM after exclusive caller-share creation defers until cleanup ownership is published"

SHARE_BRANCH_RACE_OUT="$TMP_ROOT/share-branch-race-answer.msg"
SHARE_BRANCH_RACE="$TMP_ROOT/share-branch-race.md"
SHARE_BRANCH_READY="$TMP_ROOT/share-branch-race.ready"
SHARE_BRANCH_RELEASE="$TMP_ROOT/share-branch-race.release"
SHARE_BRANCH_LOG="$TMP_ROOT/share-branch-race.log"
SHARE_BRANCH_NAME="feat/share-claim-race"
SHARE_BRANCH_PRE="$(git -C "$WORKTREE" branch --show-current)"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_SHARE_CLAIM_READY="$SHARE_BRANCH_READY" \
  AGENT_RUN_TEST_SHARE_CLAIM_RELEASE="$SHARE_BRANCH_RELEASE" \
  exec bash "$WRAPPER" work copilot -m m -p hi -o "$SHARE_BRANCH_RACE_OUT" \
    --branch "$SHARE_BRANCH_NAME" -- "--share=$SHARE_BRANCH_RACE") >"$SHARE_BRANCH_LOG" 2>&1 &
SHARE_BRANCH_WRAPPER=$!
await_ready "$SHARE_BRANCH_READY" "$SHARE_BRANCH_WRAPPER" "caller-share branch race: wrapper never reached the exclusive claim" "$SHARE_BRANCH_LOG"
printf 'late branch transcript\n' >"$SHARE_BRANCH_RACE"
: >"$SHARE_BRANCH_RELEASE"
wait_wrapper "$SHARE_BRANCH_WRAPPER" "$SHARE_BRANCH_LOG"
expect_code 2 "caller-share branch race"
expect_out "appeared before claim" "caller-share branch race"
git -C "$WORKTREE" show-ref --verify --quiet "refs/heads/$SHARE_BRANCH_NAME" \
  && fail "caller-share branch race: rejected claim stranded branch $SHARE_BRANCH_NAME"
[ "$(git -C "$WORKTREE" branch --show-current)" = "$SHARE_BRANCH_PRE" ] \
  || fail "caller-share branch race: rejected claim moved the worktree off $SHARE_BRANCH_PRE"
ok "branch create: a rejected caller-share claim does not create or switch --branch"

SHARE_DIRECTORY_RACE_OUT="$TMP_ROOT/share-directory-race-answer.msg"
SHARE_DIRECTORY_RACE="$TMP_ROOT/share-directory-race.md"
SHARE_DIRECTORY_READY="$TMP_ROOT/share-directory-race.ready"
SHARE_DIRECTORY_RELEASE="$TMP_ROOT/share-directory-race.release"
SHARE_DIRECTORY_LOG="$TMP_ROOT/share-directory-race.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SKIP_SHARE=1 \
  AGENT_RUN_TEST_SHARE_CLAIM_READY="$SHARE_DIRECTORY_READY" \
  AGENT_RUN_TEST_SHARE_CLAIM_RELEASE="$SHARE_DIRECTORY_RELEASE" \
  exec bash "$WRAPPER" consult copilot -m m -p hi -o "$SHARE_DIRECTORY_RACE_OUT" \
    -- "--share=$SHARE_DIRECTORY_RACE") >"$SHARE_DIRECTORY_LOG" 2>&1 &
SHARE_DIRECTORY_WRAPPER=$!
await_ready "$SHARE_DIRECTORY_READY" "$SHARE_DIRECTORY_WRAPPER" "caller-share directory race: wrapper never reached the exclusive claim" "$SHARE_DIRECTORY_LOG"
mkdir "$SHARE_DIRECTORY_RACE"
: >"$SHARE_DIRECTORY_RELEASE"
wait_wrapper "$SHARE_DIRECTORY_WRAPPER" "$SHARE_DIRECTORY_LOG"
expect_code 2 "caller-share directory race"
expect_out "appeared before claim" "caller-share directory race"
expect_not_out "ARG:" "caller-share directory race"
[ -d "$SHARE_DIRECTORY_RACE" ] \
  || fail "caller-share directory race: late directory was replaced or removed"
[ -z "$(find "$SHARE_DIRECTORY_RACE" -mindepth 1 -print -quit)" ] \
  || fail "caller-share directory race: wrapper created a file inside the late directory"
ok "copilot: caller-share claim rejects a late directory without writing inside it"

SHARE_FIFO_RACE_OUT="$TMP_ROOT/share-fifo-race-answer.msg"
SHARE_FIFO_RACE="$TMP_ROOT/share-fifo-race.md"
SHARE_FIFO_READY="$TMP_ROOT/share-fifo-race.ready"
SHARE_FIFO_RELEASE="$TMP_ROOT/share-fifo-race.release"
SHARE_FIFO_LOG="$TMP_ROOT/share-fifo-race.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SKIP_SHARE=1 \
  AGENT_RUN_TEST_SHARE_CLAIM_READY="$SHARE_FIFO_READY" \
  AGENT_RUN_TEST_SHARE_CLAIM_RELEASE="$SHARE_FIFO_RELEASE" \
  exec timeout -k 1 3 bash "$WRAPPER" consult copilot -m m -p hi -o "$SHARE_FIFO_RACE_OUT" \
    -- "--share=$SHARE_FIFO_RACE") >"$SHARE_FIFO_LOG" 2>&1 &
SHARE_FIFO_WRAPPER=$!
await_ready "$SHARE_FIFO_READY" "$SHARE_FIFO_WRAPPER" "caller-share FIFO race: wrapper never reached the exclusive claim" "$SHARE_FIFO_LOG"
mkfifo "$SHARE_FIFO_RACE"
: >"$SHARE_FIFO_RELEASE"
wait_wrapper "$SHARE_FIFO_WRAPPER" "$SHARE_FIFO_LOG"
expect_code 2 "caller-share FIFO race"
expect_out "appeared before claim" "caller-share FIFO race"
expect_not_out "ARG:" "caller-share FIFO race"
[ -p "$SHARE_FIFO_RACE" ] \
  || fail "caller-share FIFO race: late FIFO was replaced or removed"
ok "copilot: caller-share claim rejects a late FIFO without opening it"

run_wrapper consult copilot -m m -p hi -o "$TMP_ROOT/collide.msg" -- "--share=$TMP_ROOT/collide.msg"
expect_code 2 "copilot --share colliding with -o"
expect_out "same file" "copilot --share colliding with -o"
rm -f "$TMP_ROOT/collide.msg"
ok "copilot: a --share= that resolves to the -o file is rejected (transcript would overwrite the answer)"

run_wrapper consult copilot -m m -p hi -- "--share=$TMP_ROOT/share-a.md" "--share=$TMP_ROOT/share-b.md"
expect_code 2 "copilot duplicate --share"
expect_out "duplicate --share" "copilot duplicate --share"
ok "copilot: duplicate --share= flags are rejected (one transcript per run)"

EMPTY_SHARE_VALUE_OUT="$TMP_ROOT/empty-share-value.msg"
run_wrapper consult copilot -m m -p hi -o "$EMPTY_SHARE_VALUE_OUT" -- --share=
expect_code 2 "copilot empty --share= value"
expect_out "requires a non-empty transcript path" "copilot empty --share= value"
expect_not_out "ARG:" "copilot empty --share= value"
[ ! -e "$EMPTY_SHARE_VALUE_OUT" ] \
  || fail "copilot empty --share= value: rejected run still created the public answer"
ok "copilot: an empty --share= value rejects before transcript ownership is selected"

run_wrapper_env TMPDIR="$WORKTREE" -- consult codex -p hi
expect_code 0 "auto answer with in-tree TMPDIR"
expect_out "agent-run: worktree: best-effort-clean" "auto answer with in-tree TMPDIR"
IN_TREE_AUTO="$(grep -o 'agent-run: answer: .*' <<<"$OUT" | head -n1 | cut -d' ' -f3-)"
case "$IN_TREE_AUTO" in
  /tmp/agent-answer.*) ;;
  *) fail "auto answer with in-tree TMPDIR: expected a /tmp fallback path, got '$IN_TREE_AUTO'" ;;
esac
rm -f "$IN_TREE_AUTO"
ok "answer: a \$TMPDIR inside the worktree falls back to /tmp instead of self-dirtying the repo"

run_wrapper work copilot -m m -p hi -- -C /elsewhere
expect_code 2 "copilot work -C"
expect_out "lock" "copilot work -C"
run_wrapper work copilot -m m -p hi -- -C/elsewhere
expect_code 2 "copilot work attached -C"
ok "copilot: work rejects -C in both spellings (lock would guard the wrong worktree)"

run_wrapper work copilot -m m -p hi -- --name -Cvalue
expect_code 0 "copilot work option value starting -C"
expect_out "ARG:--name" "copilot work option value starting -C"
expect_out "ARG:-Cvalue" "copilot work option value starting -C"
run_wrapper consult copilot -m m -p hi -- --name -Cvalue
expect_code 0 "copilot consult option value starting -C"
expect_out "agent-run: worktree: best-effort-clean" "copilot consult option value starting -C"
expect_not_out "agent-run: worktree: unchecked" "copilot consult option value starting -C"
ok "copilot: cwd scans ignore -C-looking values consumed by native options"

run_wrapper consult copilot -m m -p hi -- -C /elsewhere
expect_code 0 "copilot consult -C"
expect_out "ARG:-C" "copilot consult -C"
expect_out "agent-run: worktree: unchecked" "copilot consult -C drift"
expect_out "-C moved the run" "copilot consult -C drift reason"
expect_not_out "agent-run: worktree: best-effort-clean" "copilot consult -C drift"
run_wrapper consult copilot -m m -p hi -- -C/elsewhere
expect_code 0 "copilot consult attached -C"
expect_out "agent-run: worktree: unchecked" "copilot consult attached -C drift"
ok "copilot: consult passes -C through but reports drift unchecked (snapshot covers only the dispatch worktree)"

run_wrapper_env AGENT_FAKE_TOUCH=1 -- consult copilot -m m -p hi -- -C .
expect_code 4 "copilot consult in-tree -C drift"
expect_out "DIRTY" "copilot consult in-tree -C drift"
expect_not_out "agent-run: worktree: unchecked" "copilot consult in-tree -C drift"
reset_worktree
ok "copilot: consult -C inside this worktree remains drift checked"

run_wrapper consult copilot -m m -p hi -- --model other
expect_code 2 "copilot passthrough model"
ok "copilot: passthrough --model is rejected (wrapper owns -m)"

for flag in -p --print --output-format --stream-partial-output; do
  run_wrapper consult cursor -p hi -- "$flag"
  expect_code 2 "cursor passthrough $flag"
  expect_out "wrapper-owned" "cursor passthrough $flag"
done
ok "cursor: print-mode and output-format passthroughs are rejected (wrapper owns the envelope)"

for flag in --model --model=other --list-models; do
  run_wrapper consult cursor -p hi -- "$flag"
  expect_code 2 "cursor passthrough $flag"
  expect_out "use the wrapper's -m option" "cursor passthrough $flag"
done
ok "cursor: passthrough model flags are rejected (wrapper owns -m)"

for flag in --resume --resume=abc --continue; do
  run_wrapper consult cursor -p hi -- "$flag"
  expect_code 2 "cursor passthrough $flag"
  expect_out "wrapper session handling" "cursor passthrough $flag"
done
ok "cursor: native session controls are rejected (wrapper owns sessions via -r)"

for flag in -f --force --yolo --auto-review; do
  run_wrapper consult cursor -p hi -- "$flag"
  expect_code 2 "cursor consult $flag"
  expect_out "read-only guarantee" "cursor consult $flag"
done
run_wrapper work cursor -p hi -- --force
expect_code 2 "cursor work --force"
expect_out "work already runs with --force" "cursor work --force"
ok "cursor: permission escalations are rejected in consult and redundant in work"

for flag in --mode --mode=agent --plan; do
  run_wrapper consult cursor -p hi -- "$flag"
  expect_code 2 "cursor consult $flag"
  expect_out "consult already runs read-only --mode ask" "cursor consult $flag"
done
run_wrapper work cursor -p hi -- --mode plan
expect_code 2 "cursor work --mode"
expect_out "downgrade work to a read-only mode" "cursor work --mode"
ok "cursor: mode overrides are rejected in both directions"

for flag in --sandbox --sandbox=disabled --trust; do
  run_wrapper consult cursor -p hi -- "$flag"
  expect_code 2 "cursor passthrough $flag"
  expect_out "wrapper-owned" "cursor passthrough $flag"
done
ok "cursor: sandbox and trust passthroughs are wrapper-owned"

run_wrapper consult cursor -p hi -- --approve-mcps
expect_code 2 "cursor consult --approve-mcps"
expect_out "read-only surface" "cursor consult --approve-mcps"
run_wrapper work cursor -p hi -- --approve-mcps
expect_code 0 "cursor work --approve-mcps"
expect_out "ARG:--approve-mcps" "cursor work --approve-mcps"
ok "cursor: --approve-mcps is consult-rejected but passes through for work"

for flag in --workspace --workspace=/elsewhere -w --worktree --worktree=lane --worktree-base --skip-worktree-setup; do
  run_wrapper work cursor -p hi -- "$flag"
  expect_code 2 "cursor passthrough $flag"
  expect_out "worktree" "cursor passthrough $flag"
done
ok "cursor: workspace- and worktree-moving passthroughs are rejected (lock and drift cover this worktree only)"

for word in models update login worker create-chat; do
  run_wrapper consult cursor -p hi -- "$word"
  expect_code 2 "cursor bare subcommand $word"
  expect_out "would dispatch the cursor subcommand" "cursor bare subcommand $word"
done
ok "cursor: bare subcommand words in the passthrough are rejected (they dispatch even after --)"

# Session-resuming and listing subcommands are the dangerous end of the list:
# a bare `resume` under work mode would resume cursor's latest unrelated chat
# with mutation permissions instead of running the mission.
for word in resume ls plugin agent help; do
  run_wrapper work cursor -p hi -- "$word"
  expect_code 2 "cursor bare subcommand $word"
  expect_out "would dispatch the cursor subcommand" "cursor bare subcommand $word"
done
ok "cursor: session-resuming and remaining bare subcommand words are rejected too"

run_wrapper work cursor -p resume
expect_code 2 "cursor resume one-word mission"
expect_out "would dispatch the cursor subcommand" "cursor resume one-word mission"
ok "cursor: a one-word 'resume' mission is rejected like the other subcommand words"

SYNC_FAIL_BIN="$TMP_ROOT/sync-fail-bin"
SYNC_FAIL_DIR="$TMP_ROOT/sync-fail-output"
SYNC_FAIL_OUT="$SYNC_FAIL_DIR/answer.msg"
mkdir -p "$SYNC_FAIL_BIN" "$SYNC_FAIL_DIR"
cat >"$SYNC_FAIL_BIN/sync" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$SYNC_FAIL_BIN/sync"
# Establish a legitimate finalized no-answer predecessor, then recreate its
# empty public spelling. This is the retry path that used to retire the caller
# inode before discovering the unusable sync binary.
run_wrapper_env AGENT_FAKE_EXIT=1 AGENT_FAKE_EMPTY_RESULT=1 -- consult claude -p hi -o "$SYNC_FAIL_OUT"
expect_code 1 "file-operand sync preflight fixture"
: >"$SYNC_FAIL_OUT"
SYNC_FAIL_CURRENT_BEFORE="$(attempt_current_id "$SYNC_FAIL_OUT")"
SYNC_FAIL_SEQUENCE_BEFORE="$(cat "$SYNC_FAIL_OUT.agent-run/last-sequence")"
SYNC_FAIL_ATTEMPTS_BEFORE="$(find "$SYNC_FAIL_OUT.agent-run" -maxdepth 1 -type d -name 'attempt.*' | wc -l)"
set +e
OUT="$(cd "$WORKTREE" && PATH="$SYNC_FAIL_BIN:$FAKE_BIN:$PATH" \
  bash "$WRAPPER" consult claude -p hi -o "$SYNC_FAIL_OUT" 2>&1)"
CODE=$?
set -e
expect_code 3 "file-operand sync preflight"
expect_out "file-operand sync is required" "file-operand sync preflight"
assert_prelaunch_reject_contract "file-operand sync preflight" "$OUT"
[ -f "$SYNC_FAIL_OUT" ] && [ ! -s "$SYNC_FAIL_OUT" ] \
  || fail "file-operand sync preflight: caller output was changed"
[ "$(attempt_current_id "$SYNC_FAIL_OUT")" = "$SYNC_FAIL_CURRENT_BEFORE" ] \
  && [ "$(cat "$SYNC_FAIL_OUT.agent-run/last-sequence")" = "$SYNC_FAIL_SEQUENCE_BEFORE" ] \
  && [ "$(find "$SYNC_FAIL_OUT.agent-run" -maxdepth 1 -type d -name 'attempt.*' | wc -l)" = "$SYNC_FAIL_ATTEMPTS_BEFORE" ] \
  || fail "file-operand sync preflight: attempt lineage changed"
if compgen -G "$SYNC_FAIL_DIR/.agent-run-retired.*" >/dev/null; then
  fail "file-operand sync preflight: caller output was retired before the environment check"
fi
ok "durability: file-operand sync failures exit 3 before answer-path state changes"

NO_SEAL_TOOLS_BIN="$TMP_ROOT/no-seal-tools-bin"
NO_SEAL_TOOLS_OUT="$TMP_ROOT/no-seal-tools-answer.msg"
mkdir -p "$NO_SEAL_TOOLS_BIN"
for tool in od sha256sum; do
  printf '#!/usr/bin/env bash\nexit 77\n' >"$NO_SEAL_TOOLS_BIN/$tool"
  chmod +x "$NO_SEAL_TOOLS_BIN/$tool"
done
set +e
OUT="$(cd "$WORKTREE" && PATH="$NO_SEAL_TOOLS_BIN:$FAKE_BIN:$PATH" \
  bash "$WRAPPER" consult claude -p hi -o "$NO_SEAL_TOOLS_OUT" 2>&1)"
CODE=$?
set -e
expect_code 0 "dispatch without seal tools"
if grep -Eq 'sha256sum|/dev/urandom|command -v od' "$WRAPPER"; then
  fail "seal dependencies: wrapper still references sha256sum, od capability probing, or /dev/urandom"
fi
ok "portability: answer attempts no longer require sha256sum, od, or /dev/urandom"

# --- per-worktree lock ----------------------------------------------------------------

if command -v flock >/dev/null 2>&1; then
  exec 9>"$WORKTREE/.git/agent-run.lock"
  flock -n 9 || fail "lock setup: could not take the test lock"

  run_wrapper work claude -p hi
  expect_code 3 "work claude lock busy"
  assert_prelaunch_reject_contract "lock busy contract" "$OUT"
  ok "contract: lock-busy exits 3 before dispatch"
  run_wrapper work copilot -m m -p hi
  expect_code 3 "work copilot lock busy"
  run_wrapper work codex -p hi
  expect_code 3 "work codex lock busy"
  ok "lock: work runs exit 3 on every backend while the lock is held"

  run_wrapper consult claude -p hi
  expect_code 0 "consult claude lock free"
  expect_out "agent-run: worktree: unchecked" "consult claude under held lock"
  run_wrapper consult copilot -m m -p hi
  expect_code 0 "consult copilot lock free"
  run_wrapper consult cursor -p hi
  expect_code 0 "consult cursor lock free"
  expect_out "agent-run: worktree: unchecked" "consult cursor under held lock"
  run_wrapper consult codex -p hi
  expect_code 0 "consult codex lock free"
  expect_out "agent-run: worktree: unchecked" "consult codex under held lock"
  run_wrapper review codex -- --commit abc
  expect_code 0 "review codex lock free"
  expect_out "agent-run: worktree: unchecked" "review codex under held lock"
  ok "lock: consults and codex review stay lock-free (read-only by contract)"

  run_wrapper_env AGENT_FAKE_TOUCH=1 -- consult claude -p hi
  expect_code 0 "consult touch under held lock"
  expect_out "agent-run: worktree: unchecked" "consult touch under held lock"
  reset_worktree
  ok "lock: drift reads unchecked (not DIRTY) while another run holds the lock"

  exec 9>&-
  run_wrapper work claude -p hi
  expect_code 0 "lock released"
  ok "lock: work proceeds after the lock is released"

  # Older wrappers left a persistent worktree-lock identity hardlink behind.
  # If the public lock path is later removed, pinning a replacement inode to
  # that stale link wedges every future work run. The worktree lock now relies
  # only on its post-flock pathname/fd revalidation and ignores this legacy pin.
  rm -f "$WORKTREE/.git/agent-run.lock.identity"
  ln "$WORKTREE/.git/agent-run.lock" "$WORKTREE/.git/agent-run.lock.identity"
  rm -f "$WORKTREE/.git/agent-run.lock"
  run_wrapper work claude -p hi
  expect_code 0 "stale worktree lock identity"
  ok "lock: a stale legacy worktree identity cannot wedge later dispatches"

  rm -f "$WORKTREE/.git/agent-run.lock" "$WORKTREE/.git/agent-run.lock.identity"
  WORKTREE_LOCK_TARGET="$TMP_ROOT/worktree-lock-target"
  printf 'protected worktree lock target\n' >"$WORKTREE_LOCK_TARGET"
  ln -s "$WORKTREE_LOCK_TARGET" "$WORKTREE/.git/agent-run.lock"
  run_wrapper work claude -p hi
  expect_code 3 "symlinked worktree lock"
  expect_out "worktree lock" "symlinked worktree lock"
  [ "$(cat "$WORKTREE_LOCK_TARGET")" = "protected worktree lock target" ] \
    || fail "symlinked worktree lock: opening the lock truncated its target"
  rm -f -- "$WORKTREE/.git/agent-run.lock" "$WORKTREE_LOCK_TARGET"

  mkfifo "$WORKTREE/.git/agent-run.lock"
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    timeout -k 1 3 bash "$WRAPPER" work claude -p hi 2>&1)"
  CODE=$?
  set -e
  expect_code 3 "FIFO worktree lock"
  expect_out "worktree lock" "FIFO worktree lock"
  expect_not_out "agent-run: dispatched:" "FIFO worktree lock"
  rm -f -- "$WORKTREE/.git/agent-run.lock"

  mkfifo "$WORKTREE/.git/agent-run.lock"
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    timeout -k 1 3 bash "$WRAPPER" consult claude -p hi 2>&1)"
  CODE=$?
  set -e
  expect_code 0 "FIFO worktree lock probe"
  expect_out "agent-run: worktree: unchecked" "FIFO worktree lock probe"
  rm -f -- "$WORKTREE/.git/agent-run.lock"
  ok "lock: worktree owners and probes reject hostile lock types without blocking or truncating targets"

  chmod a-w "$WORKTREE/.git"
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" work claude -p hi 2>&1)"
  CODE=$?
  set -e
  chmod u+w "$WORKTREE/.git"
  if [ "$CODE" -eq 3 ]; then
    expect_out "cannot open worktree lock" "non-writable lock path"
  elif [ "$CODE" -ne 0 ]; then
    fail "non-writable lock path: expected exit 3 or privileged success, got $CODE ($OUT)"
  fi
  ok "lock: an unwritable lock path is handled instead of crashing"

  NO_FLOCK_BIN="$TMP_ROOT/no-flock-bin"
  mkdir -p "$NO_FLOCK_BIN"
  for tool in bash git mktemp rm wc tee tail grep cut sort cksum realpath python3; do
    ln -sf "$(command -v "$tool")" "$NO_FLOCK_BIN/$tool"
  done
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$NO_FLOCK_BIN:$FAKE_BIN" bash "$WRAPPER" work copilot -m m -p hi 2>&1)"
  CODE=$?
  set -e
  expect_code 3 "missing flock for lock-required run"
  expect_out "flock is required" "missing flock for lock-required run"
  ok "lock: lock-required runs fail clearly when flock is unavailable"
else
  ok "skipped lock checks (flock unavailable)"
  ok "skipped lock-free consult checks (flock unavailable)"
  ok "skipped lock-probe drift check (flock unavailable)"
  ok "skipped lock-release check (flock unavailable)"
  ok "skipped unwritable lock-path check (flock unavailable)"
  ok "skipped missing-flock lock-required check (flock unavailable)"
fi

# --- work clean-start guard ---------------------------------------------------------

printf 'wip\n' >"$WORKTREE/uncommitted-wip.txt"
run_wrapper work claude -p hi
expect_code 2 "dirty work start"
expect_out "--dirty-ok" "dirty work start"
expect_out "inspect with git diff or git show HEAD:<path>" "dirty work start"
expect_out "copy files aside, or ask the user" "dirty work start"
expect_not_out "stash" "dirty work start"
run_wrapper work claude -p hi --dirty-ok
expect_code 0 "dirty work start with --dirty-ok"
run_wrapper consult claude -p hi
expect_code 0 "consult on a dirty tree"
expect_out "agent-run: worktree: best-effort-clean" "consult on a dirty tree"
rm -f "$WORKTREE/uncommitted-wip.txt"
ok "work: a dirty start is rejected without --dirty-ok; consults stay dirty-safe"

# --- work feature-branch enforcement -------------------------------------------------

run_wrapper consult claude -p hi --require-feature-branch
expect_code 2 "consult --require-feature-branch"
expect_out "only applies to work" "consult --require-feature-branch"
run_wrapper review codex --require-feature-branch -- --commit abc123
expect_code 2 "review --require-feature-branch"
ok "branch guard: consult and review reject --require-feature-branch (they never commit)"

for protected in main master trunk; do
  git -C "$WORKTREE" branch -M "$protected"
  run_wrapper work claude -p hi --require-feature-branch
  expect_code 2 "work on $protected with branch guard"
  expect_out "protected branch" "work on $protected with branch guard"
  expect_not_out "ARG:" "work on $protected reached the backend anyway"
done
ok "branch guard: work on main/master/trunk exits 2 before the backend launches"

run_wrapper work claude -p hi
expect_code 0 "work on a protected branch without the flag"
ok "branch guard: without the flag, work on a protected branch is unchanged"

git -C "$WORKTREE" switch -q -c agent/branch-guard-test
run_wrapper work claude -p hi --require-feature-branch
expect_code 0 "work on a feature branch with branch guard"
expect_out "ARG:--dangerously-skip-permissions" "work on a feature branch reaches the backend"
ok "branch guard: work on a feature branch proceeds normally"

BRANCH_RACE_READY="$TMP_ROOT/branch-guard-race.ready"
BRANCH_RACE_RELEASE="$TMP_ROOT/branch-guard-race.release"
BRANCH_RACE_LOG="$TMP_ROOT/branch-guard-race.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_PRELOCK_BRANCH_READY="$BRANCH_RACE_READY" \
  AGENT_RUN_TEST_PRELOCK_BRANCH_RELEASE="$BRANCH_RACE_RELEASE" \
  exec bash "$WRAPPER" work claude -p hi --require-feature-branch) >"$BRANCH_RACE_LOG" 2>&1 &
BRANCH_RACE_WRAPPER=$!
await_ready "$BRANCH_RACE_READY" "$BRANCH_RACE_WRAPPER" "feature-branch race: wrapper never reached the precheck boundary" "$BRANCH_RACE_LOG"
git -C "$WORKTREE" switch -q trunk
: >"$BRANCH_RACE_RELEASE"
wait_wrapper "$BRANCH_RACE_WRAPPER" "$BRANCH_RACE_LOG"
expect_code 2 "feature branch changed to protected before lock"
expect_out "protected branch" "feature branch changed to protected before lock"
expect_not_out "ARG:" "feature branch changed to protected before lock"
git -C "$WORKTREE" switch -q agent/branch-guard-test
ok "branch guard: HEAD is revalidated after the worktree lock is acquired"

git -C "$WORKTREE" switch -q --detach
run_wrapper work claude -p hi --require-feature-branch
expect_code 2 "detached HEAD with branch guard"
expect_out "detached" "detached HEAD with branch guard"
git -C "$WORKTREE" switch -q trunk
git -C "$WORKTREE" branch -M main
git -C "$WORKTREE" branch -q -D agent/branch-guard-test
ok "branch guard: detached HEAD is rejected (no branch to protect)"

set +e
OUT="$(cd "$TMP_ROOT" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" work claude -p hi --require-feature-branch 2>&1)"
CODE=$?
set -e
expect_code 2 "branch guard outside git"
expect_out "git worktree" "branch guard outside git"
ok "branch guard: outside a git repository the flag is rejected instead of silently skipped"

# --- work --branch (structural fresh-branch missions) --------------------------------

run_wrapper consult claude -p hi --branch feat/consult-branch
expect_code 2 "consult --branch"
expect_out "only applies to work" "consult --branch"
run_wrapper review codex --branch feat/review-branch -- --commit abc123
expect_code 2 "review --branch"
ok "branch create: consult and review reject --branch (they never commit)"

run_wrapper work claude -p hi --branch main
expect_code 2 "--branch protected name"
expect_out "protected branch" "--branch protected name"
run_wrapper work claude -p hi --branch 'bad..name'
expect_code 2 "--branch invalid name"
expect_out "not a valid branch name" "--branch invalid name"
git -C "$WORKTREE" branch -q feat/branch-exists
run_wrapper work claude -p hi --branch feat/branch-exists
expect_code 2 "--branch existing name"
expect_out "already exists" "--branch existing name"

EXISTING_BRANCH_SHARE="$TMP_ROOT/existing-branch-share.md"
EXISTING_BRANCH_OUT="$TMP_ROOT/existing-branch-share.msg"
run_wrapper work copilot -m m -p hi --branch feat/branch-exists \
  -o "$EXISTING_BRANCH_OUT" -- "--share=$EXISTING_BRANCH_SHARE"
expect_code 2 "--branch existing name with caller share"
expect_out "already exists" "--branch existing name with caller share"
[ ! -e "$EXISTING_BRANCH_SHARE" ] \
  || fail "--branch existing name: caller transcript was claimed before branch rejection"
run_wrapper work copilot -m m -p hi --branch feat/branch-retry \
  -o "$EXISTING_BRANCH_OUT" -- "--share=$EXISTING_BRANCH_SHARE"
expect_code 0 "--branch retry after existing-name rejection"
git -C "$WORKTREE" switch -q main
git -C "$WORKTREE" branch -q -D feat/branch-retry
git -C "$WORKTREE" branch -q -D feat/branch-exists
ok "branch create: existing-name rejection leaves caller share paths retryable"
ok "branch create: protected, invalid, and existing names are rejected before the backend"

# The composable shape from the ma-toki handoff: worktree parked on main,
# --branch creates the mission branch at dispatch, and the feature-branch
# guard is satisfied by the created branch instead of rejecting the run.
run_wrapper work claude -p hi --branch feat/branch-mission --require-feature-branch
expect_code 0 "work --branch from main"
expect_out "agent-run: branch: feat/branch-mission (created)" "work --branch trailer"
expect_out "ARG:--dangerously-skip-permissions" "work --branch reaches the backend"
[ "$(git -C "$WORKTREE" symbolic-ref --quiet --short HEAD)" = "feat/branch-mission" ] \
  || fail "work --branch: HEAD is not on the created branch"
git -C "$WORKTREE" switch -q main
git -C "$WORKTREE" branch -q -D feat/branch-mission
ok "branch create: --branch creates and switches at dispatch and satisfies --require-feature-branch from main"

set +e
OUT="$(cd "$TMP_ROOT" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" work claude -p hi --branch feat/nonrepo 2>&1)"
CODE=$?
set -e
expect_code 2 "--branch outside git"
expect_out "needs a git worktree" "--branch outside git"
ok "branch create: outside a git repository --branch is rejected instead of silently skipped"

# Branch creation is the last usage-reject point before launch: a reject that
# fires after it (here, a stale -o) would strand the worktree on a fresh
# branch and make the retry fail on "already exists".
STALE_BRANCH_OUT="$TMP_ROOT/stale-branch-answer.msg"
printf 'stale answer\n' >"$STALE_BRANCH_OUT"
run_wrapper work claude -p hi --branch feat/stale-out-guard -o "$STALE_BRANCH_OUT"
expect_code 2 "--branch with stale -o"
expect_out "already holds an answer" "--branch with stale -o"
git -C "$WORKTREE" show-ref --verify --quiet refs/heads/feat/stale-out-guard \
  && fail "--branch with stale -o: the branch was created before the -o freshness reject"
[ "$(git -C "$WORKTREE" symbolic-ref --quiet --short HEAD)" = "main" ] \
  || fail "--branch with stale -o: HEAD moved off the dispatch branch"
rm -f "$STALE_BRANCH_OUT"
ok "branch create: a late usage reject (stale -o) leaves no stray branch behind"

# Attempt claiming has reject paths after all ordinary preflight checks. Those
# must run before --branch mutates HEAD so a transient claim failure can retry
# with the same branch name instead of finding a stranded branch.
CLAIM_REJECT_BRANCH_OUT="$TMP_ROOT/claim-reject-branch-answer.msg"
CLAIM_REJECT_BRANCH_NAME="feat/claim-reject-retry"
CLAIM_REJECT_BRANCH_PRE="$(git -C "$WORKTREE" branch --show-current)"
run_wrapper_env AGENT_FAKE_EMPTY_RESULT=1 -- work claude -p hi -o "$CLAIM_REJECT_BRANCH_OUT"
expect_code 1 "--branch attempt-claim rejection predecessor"
run_wrapper_env AGENT_RUN_TEST_ATTEMPT_ALLOC_FAIL=1 \
  -- work claude -p hi --branch "$CLAIM_REJECT_BRANCH_NAME" \
  -o "$CLAIM_REJECT_BRANCH_OUT"
expect_code 2 "--branch with attempt-claim rejection"
expect_out "cannot allocate an attempt record" "--branch with attempt-claim rejection"
git -C "$WORKTREE" show-ref --verify --quiet "refs/heads/$CLAIM_REJECT_BRANCH_NAME" \
  && fail "--branch with attempt-claim rejection: rejected claim stranded branch $CLAIM_REJECT_BRANCH_NAME"
[ "$(git -C "$WORKTREE" branch --show-current)" = "$CLAIM_REJECT_BRANCH_PRE" ] \
  || fail "--branch with attempt-claim rejection: HEAD moved off $CLAIM_REJECT_BRANCH_PRE"
run_wrapper work claude -p hi --branch "$CLAIM_REJECT_BRANCH_NAME" \
  -o "$CLAIM_REJECT_BRANCH_OUT"
expect_code 0 "retry after --branch attempt-claim rejection"
git -C "$WORKTREE" switch -q "$CLAIM_REJECT_BRANCH_PRE"
git -C "$WORKTREE" branch -q -D "$CLAIM_REJECT_BRANCH_NAME"
ok "branch create: attempt-claim rejection leaves HEAD and the requested branch retryable"

# A git failure after the answer attempt is durably claimed must settle that
# attempt as no-answer. Otherwise a transient index.lock contention permanently
# turns the explicit -o into an unfinalized recovery case.
POST_CLAIM_BRANCH_OUT="$TMP_ROOT/post-claim-branch-answer.msg"
POST_CLAIM_BRANCH_NAME="feat/post-claim-branch-retry"
run_wrapper_env AGENT_RUN_TEST_BRANCH_CREATE_FAIL=1 \
  -- work claude -p hi --branch "$POST_CLAIM_BRANCH_NAME" \
  -o "$POST_CLAIM_BRANCH_OUT"
expect_code 2 "post-claim --branch creation failure"
expect_out "could not create" "post-claim --branch creation failure"
POST_CLAIM_BRANCH_RECORD="$(attempt_record_path "$POST_CLAIM_BRANCH_OUT")"
grep -qFx 'state=finalized' "$POST_CLAIM_BRANCH_RECORD" \
  || fail "post-claim --branch creation failure: attempt was not finalized"
grep -qFx 'backend-disposition=branch-creation-failure' "$POST_CLAIM_BRANCH_RECORD" \
  || fail "post-claim --branch creation failure: disposition was not recorded"
grep -qFx 'answer-outcome=no-answer' "$POST_CLAIM_BRANCH_RECORD" \
  || fail "post-claim --branch creation failure: output was not made retryable"
run_wrapper work claude -p hi --branch "$POST_CLAIM_BRANCH_NAME" \
  -o "$POST_CLAIM_BRANCH_OUT"
expect_code 0 "retry after post-claim --branch creation failure"
git -C "$WORKTREE" switch -q main
git -C "$WORKTREE" branch -q -D "$POST_CLAIM_BRANCH_NAME"
ok "branch create: a post-claim git failure finalizes the answer attempt for retry"

# A handled fatal signal after `git switch -c` but before the dispatch header
# must unwind the wrapper-owned branch mutation. Otherwise both HEAD and the
# new ref are stranded even though no backend ever received the mission.
BRANCH_SIGNAL_OUT="$TMP_ROOT/pre-dispatch-branch-signal.msg"
BRANCH_SIGNAL_NAME="feat/pre-dispatch-signal-retry"
BRANCH_SIGNAL_PRE="$(git -C "$WORKTREE" branch --show-current)"
BRANCH_SIGNAL_READY="$TMP_ROOT/pre-dispatch-branch-signal.ready"
BRANCH_SIGNAL_RELEASE="$TMP_ROOT/pre-dispatch-branch-signal.release"
BRANCH_SIGNAL_LOG="$TMP_ROOT/pre-dispatch-branch-signal.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_BRANCH_CREATED_READY="$BRANCH_SIGNAL_READY" \
  AGENT_RUN_TEST_BRANCH_CREATED_RELEASE="$BRANCH_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" work claude -p hi --branch "$BRANCH_SIGNAL_NAME" \
    -o "$BRANCH_SIGNAL_OUT") >"$BRANCH_SIGNAL_LOG" 2>&1 &
BRANCH_SIGNAL_WRAPPER=$!
await_ready "$BRANCH_SIGNAL_READY" "$BRANCH_SIGNAL_WRAPPER" "pre-dispatch branch signal: wrapper never created the requested branch" "$BRANCH_SIGNAL_LOG"
kill -TERM "$BRANCH_SIGNAL_WRAPPER"
: >"$BRANCH_SIGNAL_RELEASE"
wait_wrapper "$BRANCH_SIGNAL_WRAPPER" "$BRANCH_SIGNAL_LOG"
expect_code 1 "pre-dispatch branch signal"
assert_prelaunch_reject_contract "pre-dispatch branch signal" "$OUT"
git -C "$WORKTREE" show-ref --verify --quiet "refs/heads/$BRANCH_SIGNAL_NAME" \
  && fail "pre-dispatch branch signal: wrapper-owned branch survived the signal"
[ "$(git -C "$WORKTREE" branch --show-current)" = "$BRANCH_SIGNAL_PRE" ] \
  || fail "pre-dispatch branch signal: HEAD did not return to $BRANCH_SIGNAL_PRE"
set +e
OUT="$(bash "$WAITER" "$BRANCH_SIGNAL_LOG" --timeout 0 2>&1)"
CODE=$?
set -e
expect_code 22 "pre-dispatch branch signal waiter classification"
expect_out "attempt=finalized-no-answer retryable=yes" "pre-dispatch branch signal waiter classification"
run_wrapper work claude -p hi --branch "$BRANCH_SIGNAL_NAME" -o "$BRANCH_SIGNAL_OUT"
expect_code 0 "retry after pre-dispatch branch signal"
git -C "$WORKTREE" switch -q "$BRANCH_SIGNAL_PRE"
git -C "$WORKTREE" branch -q -D "$BRANCH_SIGNAL_NAME"
ok "branch create: a pre-dispatch fatal signal leaves the requested branch retryable"

# --- git optional locks ------------------------------------------------------------

GIT_PROBE_BIN="$TMP_ROOT/git-probe-bin"
GIT_PROBE_LOG="$TMP_ROOT/git-probe.log"
mkdir -p "$GIT_PROBE_BIN"
cat >"$GIT_PROBE_BIN/git" <<'EOF'
#!/usr/bin/env bash
printf '%s\t%s\n' "${GIT_OPTIONAL_LOCKS-__unset__}" "$*" >>"$AGENT_FAKE_GIT_LOG"
exec "$AGENT_REAL_GIT" "$@"
EOF
chmod +x "$GIT_PROBE_BIN/git"
REAL_GIT_BIN="$(command -v git)"

: >"$GIT_PROBE_LOG"
set +e
OUT="$(cd "$WORKTREE" && PATH="$GIT_PROBE_BIN:$FAKE_BIN:$PATH" AGENT_FAKE_GIT_LOG="$GIT_PROBE_LOG" AGENT_REAL_GIT="$REAL_GIT_BIN" AGENT_FAKE_PRINT_GIT_OPTIONAL_LOCKS=1 env -u GIT_OPTIONAL_LOCKS bash "$WRAPPER" work claude -p hi --branch feat/git-optional-locks-probe 2>&1)"
CODE=$?
set -e
expect_code 0 "git optional locks branch probe"
grep -qF $'0\trev-parse --git-dir' "$GIT_PROBE_LOG" \
  || fail "git optional locks branch probe: rev-parse did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'0\tstatus --porcelain -uall' "$GIT_PROBE_LOG" \
  || fail "git optional locks branch probe: status did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'0\tshow-ref --verify --quiet refs/heads/feat/git-optional-locks-probe' "$GIT_PROBE_LOG" \
  || fail "git optional locks branch probe: show-ref did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'__unset__\tswitch -q -c feat/git-optional-locks-probe' "$GIT_PROBE_LOG" \
  || fail "git optional locks branch probe: mutating switch inherited optional-lock disabling ($(cat "$GIT_PROBE_LOG"))"
expect_out "BACKEND_GIT_OPTIONAL_LOCKS=__unset__" "git optional locks branch probe backend env"
git -C "$WORKTREE" switch -q main
git -C "$WORKTREE" branch -q -D feat/git-optional-locks-probe

: >"$GIT_PROBE_LOG"
set +e
OUT="$(cd "$WORKTREE" && PATH="$GIT_PROBE_BIN:$FAKE_BIN:$PATH" AGENT_FAKE_GIT_LOG="$GIT_PROBE_LOG" AGENT_REAL_GIT="$REAL_GIT_BIN" AGENT_FAKE_TOUCH=1 env -u GIT_OPTIONAL_LOCKS bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "git optional locks consult drift probe"
grep -qF $'0\t-c core.trustctime=true diff --no-textconv --no-ext-diff' "$GIT_PROBE_LOG" \
  || fail "git optional locks consult probe: unstaged diff did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'0\t-c core.trustctime=true diff --cached --no-textconv --no-ext-diff' "$GIT_PROBE_LOG" \
  || fail "git optional locks consult probe: staged diff did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'0\tstatus --porcelain' "$GIT_PROBE_LOG" \
  || fail "git optional locks consult probe: drift-report status did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
reset_worktree
ok "git: read-only wrapper probes disable optional locks without reaching writes or backend env"

# --- consult drift check -----------------------------------------------------------

reset_worktree
run_wrapper_env AGENT_FAKE_TOUCH=1 -- consult claude -p hi
expect_code 4 "consult drift"
expect_out "DIRTY" "consult drift"
reset_worktree
ok "consult: a run that mutates the worktree exits 4 with a DIRTY trailer"
assert_finalized_contract "consult drift contract" "$OUT"
ok "contract: consult drift exits 4 with launch header before completion anchors"

run_wrapper_env AGENT_FAKE_TOUCH=1 -- work claude -p hi
expect_code 0 "work mutation allowed"
expect_out "agent-run: worktree: dirty (1 file)" "work dirty finish trailer"
expect_not_out "DIRTY" "work mutation is not consult drift"
reset_worktree
ok "work: worktree mutations are the mission — no drift check, a dirty-finish trailer instead"

# --- work outcome trailers ----------------------------------------------------------

run_wrapper work claude -p hi
expect_code 0 "work no-op trailers"
expect_out "(unchanged)" "work no-op head trailer"
expect_out "agent-run: worktree: clean" "work no-op worktree trailer"
ok "work: a run that commits nothing reports head unchanged and a clean worktree"
assert_finalized_contract "success contract" "$OUT"
ok "contract: success exits 0 with launch header before completion anchors"

WORK_BASE_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
run_wrapper_env AGENT_FAKE_COMMIT=1 -- work claude -p hi
expect_code 0 "work commit trailers"
expect_out "(+1 commit)" "work commit head trailer"
expect_out "agent-run: head: $(git -C "$WORKTREE" rev-parse --short=12 "$WORK_BASE_SHA")" "work commit head range"
expect_out "agent-run: worktree: clean" "work commit worktree trailer"
git -C "$WORKTREE" reset -q --hard "$WORK_BASE_SHA"
ok "work: a run that commits reports the head range and new-commit count"

run_wrapper consult claude -p hi
expect_code 0 "consult clean"
expect_out "agent-run: worktree: best-effort-clean" "consult clean"
ok "consult: unchanged snapshots report an explicitly best-effort worktree trailer"

# codex consults take the lock-holding drift path (no probe), which the
# claude/copilot cases above never exercise.
run_wrapper_env AGENT_FAKE_TOUCH=1 -- consult codex -p hi
expect_code 4 "codex consult drift"
expect_out "DIRTY" "codex consult drift"
reset_worktree
ok "consult: codex drift on the lock-holding path is caught like the lock-free path"

# review is read-only by intent and holds the lock like any codex run, so it
# takes the same drift check even though it never gets the consult preamble.
run_wrapper_env AGENT_FAKE_TOUCH=1 -- review codex -- --commit abc123
expect_code 4 "review drift"
expect_out "DIRTY" "review drift"
reset_worktree
ok "review: a codex review that mutates the worktree exits 4 like a consult"

run_wrapper review codex -- --commit abc123
expect_code 0 "review clean"
expect_out "agent-run: worktree: best-effort-clean" "review clean"
expect_not_out "Do not modify files" "review clean has no consult preamble"
ok "review: unchanged snapshots report best-effort-clean without the consult preamble"

printf 'pre-existing\n' >"$WORKTREE/untracked-drift.txt"
run_wrapper_env AGENT_FAKE_APPEND_UNTRACKED=1 -- consult codex -p hi
expect_code 4 "codex consult drift in untracked file"
expect_out "DIRTY" "codex consult drift in untracked file"
rm -f "$WORKTREE/untracked-drift.txt"
ok "consult: codex drift inside a pre-existing untracked file is caught"

# An untracked symlink's worktree identity is its target spelling. Git status
# names only the symlink path, so retargeting between equal-content referents
# must be caught by the raw untracked-path snapshot.
printf 'identical untracked target\n' >"$WORKTREE/untracked-target-a"
printf 'identical untracked target\n' >"$WORKTREE/untracked-target-b"
ln -s untracked-target-a "$WORKTREE/untracked-link"
UNTRACKED_SYMLINK_STATUS="$(git -C "$WORKTREE" status --porcelain -uall)"
run_wrapper_env AGENT_FAKE_RETARGET_SYMLINK_PATH=untracked-link AGENT_FAKE_RETARGET_SYMLINK_TARGET=untracked-target-b -- consult codex -p hi
expect_code 4 "consult untracked symlink retarget drift"
expect_out "DIRTY (consult modified: file-content)" "consult untracked symlink retarget drift"
[ "$(git -C "$WORKTREE" status --porcelain -uall)" = "$UNTRACKED_SYMLINK_STATUS" ] \
  || fail "untracked symlink fixture unexpectedly changed git status"
[ "$(cat "$WORKTREE/untracked-link")" = "$(cat "$WORKTREE/untracked-target-a")" ] \
  || fail "untracked symlink fixture targets did not have identical content"
rm -f "$WORKTREE/untracked-link" "$WORKTREE/untracked-target-a" "$WORKTREE/untracked-target-b"
ok "consult: untracked symlink hashing catches equal-content retargets"

# Snapshot records must distinguish filesystem object types. `readlink` emits
# the target plus a newline, so without a type tag `payload -> abc` has the same
# path/status/checksum lines as a regular payload containing `abc\n`.
ln -s abc "$WORKTREE/untracked-type-swap"
TYPE_SWAP_STATUS="$(git -C "$WORKTREE" status --porcelain -uall)"
run_wrapper_env AGENT_FAKE_REPLACE_SYMLINK_WITH_FILE_PATH=untracked-type-swap AGENT_FAKE_REPLACEMENT_FILE_CONTENT=abc -- consult codex -p hi
expect_code 4 "consult untracked symlink-to-file drift"
expect_out "DIRTY (consult modified: file-content)" "consult untracked symlink-to-file drift"
[ -f "$WORKTREE/untracked-type-swap" ] && [ ! -L "$WORKTREE/untracked-type-swap" ] \
  || fail "untracked type-swap fixture did not replace the symlink with a regular file"
[ "$(git -C "$WORKTREE" status --porcelain -uall)" = "$TYPE_SWAP_STATUS" ] \
  || fail "untracked type-swap fixture unexpectedly changed git status text"
rm -f "$WORKTREE/untracked-type-swap"
ok "consult: untracked snapshots distinguish symlinks from equal-checksum regular files"

mkdir -p "$WORKTREE/nested-dispatch"
printf 'pre-existing\n' >"$WORKTREE/outside-subdirectory.txt"
set +e
OUT="$(cd "$WORKTREE/nested-dispatch" && PATH="$FAKE_BIN:$PATH" \
  AGENT_FAKE_APPEND_PATH="$WORKTREE/outside-subdirectory.txt" \
  bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "codex consult drift outside dispatch subdirectory"
expect_out "DIRTY (consult modified: file-content)" "codex consult drift outside dispatch subdirectory"
rm -f "$WORKTREE/outside-subdirectory.txt"
rmdir "$WORKTREE/nested-dispatch"
ok "consult: subdirectory dispatch catches drift in a pre-existing untracked file outside that subtree"

printf 'pre-existing\n' >"$WORKTREE/ignored-drift.txt"
run_wrapper_env AGENT_FAKE_APPEND_IGNORED=1 -- consult codex -p hi
expect_code 0 "codex consult drift in ignored file"
expect_out "agent-run: worktree: best-effort-clean" "codex consult drift in ignored file"
expect_not_out "DIRTY" "codex consult drift in ignored file"
rm -f "$WORKTREE/ignored-drift.txt"
ok "consult: ignored file churn is outside the drift snapshot"

run_wrapper_env AGENT_FAKE_TOUCH=1 AGENT_FAKE_EXIT=7 -- consult codex -p hi
expect_code 4 "consult dirty and failed"
expect_out "DIRTY" "consult dirty and failed"
expect_out "agent-run: backend-exit: 7" "consult dirty and failed"
reset_worktree
ok "consult: a run that both fails and mutates exits 4 (drift outranks the failure the trailer still records)"

REL_INSIDE_OUT="$WORKTREE/inside-answer.msg"
ABS_INSIDE_OUT="$WORKTREE/inside-answer-absolute.msg"
run_wrapper consult claude -p hi -o inside-answer.msg
expect_code 2 "consult -o inside worktree"
expect_out "drift" "consult -o inside worktree"
[ ! -e "$REL_INSIDE_OUT" ] || fail "consult -o inside worktree: relative rejected path was still written"
run_wrapper consult claude -p hi -o "$ABS_INSIDE_OUT"
expect_code 2 "consult -o inside worktree absolute"
[ ! -e "$ABS_INSIDE_OUT" ] || fail "consult -o inside worktree: absolute rejected path was still written"
run_wrapper work claude -p hi -o "$WORKTREE/work-answer.msg"
expect_code 2 "work -o inside worktree"
expect_out "outside the repo" "work -o inside worktree"
[ ! -e "$WORKTREE/work-answer.msg" ] || fail "work -o inside worktree: rejected path was still written"
run_wrapper work claude -p hi -o "$TMP_ROOT/work-outside-answer.msg"
expect_code 0 "work -o outside worktree"
rm -f "$TMP_ROOT/work-outside-answer.msg"
ok "-o must resolve outside the worktree in every mode (its write would pollute the worktree trailer)"

REALPATH_FAIL_BIN="$TMP_ROOT/realpath-fail-bin"
mkdir -p "$REALPATH_FAIL_BIN"
cat >"$REALPATH_FAIL_BIN/realpath" <<'EOF'
#!/usr/bin/env bash
exit 127
EOF
chmod +x "$REALPATH_FAIL_BIN/realpath"
REALPATH_GUARD_OUT="$TMP_ROOT/realpath-guard.msg"
set +e
OUT="$(cd "$WORKTREE" && PATH="$REALPATH_FAIL_BIN:$FAKE_BIN:$PATH" bash "$WRAPPER" consult claude -p hi -o "$REALPATH_GUARD_OUT" 2>&1)"
CODE=$?
set -e
expect_code 2 "consult path guard without realpath"
expect_out "cannot resolve -o path" "consult path guard without realpath"
[ ! -e "$REALPATH_GUARD_OUT" ] || fail "consult path guard without realpath: answer file was created"
ok "consult: in-tree write guard fails closed when realpath resolution is unavailable"

# Edits inside an already-modified file leave `git status` text unchanged;
# only the diff checksum in the snapshot catches them.
printf 'local edit\n' >>"$WORKTREE/tracked.txt"
run_wrapper_env AGENT_FAKE_APPEND=1 -- consult claude -p hi
expect_code 4 "consult drift in modified file"
expect_out "DIRTY (consult modified: file-content,unstaged-diff)" "consult drift in modified file"
git -C "$WORKTREE" checkout -q -- tracked.txt
ok "consult: Git's unstaged diff detects drift inside an already-modified tracked file"

# User-configured diff drivers are presentation layers, not content identity.
# A constant textconv makes both the index and worktree render identically, so
# plain `git diff` emits no header even while a delegate rewrites the bytes.
TEXTCONV="$TMP_ROOT/agent-run-constant-textconv"
cat >"$TEXTCONV" <<'EOF'
#!/usr/bin/env bash
printf 'constant representation\n'
EOF
chmod +x "$TEXTCONV"
printf 'tracked.txt diff=agent-run-opaque\n' >"$WORKTREE/.gitattributes"
git -C "$WORKTREE" config diff.agent-run-opaque.textconv "$TEXTCONV"
printf 'local\n' >"$WORKTREE/tracked.txt"
run_wrapper_env AGENT_FAKE_REPLACE_PATH=tracked.txt -- consult codex -p hi
expect_code 4 "consult drift hidden by textconv"
expect_out "DIRTY (consult modified: file-content,unstaged-diff)" "consult drift hidden by textconv"
[ -z "$(git -C "$WORKTREE" diff)" ] \
  || fail "textconv fixture unexpectedly appeared in presentation diff"
[ -n "$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)" ] \
  || fail "textconv fixture did not differ at the repository-byte layer"
git -C "$WORKTREE" config --unset diff.agent-run-opaque.textconv
rm -f "$WORKTREE/.gitattributes"
git -C "$WORKTREE" checkout -q -- tracked.txt
ok "consult: raw diff snapshots catch drift hidden by textconv drivers"

# Clean filters run before Git compares worktree content with the index. Make
# an already-modified path whose two raw representations clean to the same
# bytes: status and even a --no-textconv diff stay unchanged, so the drift
# snapshot must still catch the raw tracked-path mutation.
CLEAN_FILTER_BASE="$(git -C "$WORKTREE" rev-parse HEAD)"
CLEAN_FILTER="$TMP_ROOT/agent-run-constant-clean"
cat >"$CLEAN_FILTER" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'constant cleaned representation\n'
EOF
chmod +x "$CLEAN_FILTER"
printf 'clean-filter.txt filter=agent-run-constant-clean\n' >"$WORKTREE/.gitattributes"
git -C "$WORKTREE" add .gitattributes
git -C "$WORKTREE" commit -qm 'clean filter attributes fixture'
printf 'indexed representation\n' >"$WORKTREE/clean-filter.txt"
git -C "$WORKTREE" add clean-filter.txt
git -C "$WORKTREE" commit -qm 'clean filter drift fixture'
git -C "$WORKTREE" config filter.agent-run-constant-clean.clean "$CLEAN_FILTER"
git -C "$WORKTREE" config filter.agent-run-constant-clean.smudge cat
printf 'first raw representation\n' >"$WORKTREE/clean-filter.txt"
CLEAN_FILTER_STATUS="$(git -C "$WORKTREE" status --porcelain)"
CLEAN_FILTER_DIFF="$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)"
[ -n "$CLEAN_FILTER_STATUS" ] && [ -n "$CLEAN_FILTER_DIFF" ] \
  || fail "clean-filter fixture did not start with a stable normalized difference"
run_wrapper_env AGENT_FAKE_REPLACE_PATH=clean-filter.txt -- consult codex -p hi
expect_code 4 "consult raw tracked drift hidden by clean filter"
expect_out "DIRTY (consult modified: file-content)" "consult raw tracked drift hidden by clean filter"
[ "$(cat "$WORKTREE/clean-filter.txt")" = 'next' ] \
  || fail "clean-filter fixture did not rewrite the raw worktree representation"
[ "$(git -C "$WORKTREE" status --porcelain)" = "$CLEAN_FILTER_STATUS" ] \
  || fail "clean-filter fixture unexpectedly changed git status"
[ "$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)" = "$CLEAN_FILTER_DIFF" ] \
  || fail "clean-filter fixture unexpectedly changed the normalized diff"
git -C "$WORKTREE" reset -q --hard "$CLEAN_FILTER_BASE"
git -C "$WORKTREE" config --unset filter.agent-run-constant-clean.clean
git -C "$WORKTREE" config --unset filter.agent-run-constant-clean.smudge
ok "consult: tracked-path identity catches raw byte drift hidden by clean filters"

# The tracked-path identity pass is not a raw-content proof: on a filesystem
# whose timestamps advance only once per second, an equal-length same-inode
# rewrite can preserve its complete stat tuple. Pair that behavior with a clean
# filter that maps both byte strings to the same Git representation and prove
# the wrapper reports only a best-effort unchanged result, never authoritative
# `clean`.
COARSE_FILTER_BASE="$(git -C "$WORKTREE" rev-parse HEAD)"
COARSE_FILTER="$TMP_ROOT/agent-run-coarse-constant-clean"
cat >"$COARSE_FILTER" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'constant cleaned representation\n'
EOF
chmod +x "$COARSE_FILTER"
printf 'coarse-filter.txt filter=agent-run-coarse-clean\n' >"$WORKTREE/.gitattributes"
printf 'index\n' >"$WORKTREE/coarse-filter.txt"
git -C "$WORKTREE" add .gitattributes coarse-filter.txt
git -C "$WORKTREE" commit -qm 'coarse clean filter fixture'
git -C "$WORKTREE" config filter.agent-run-coarse-clean.clean "$COARSE_FILTER"
git -C "$WORKTREE" config filter.agent-run-coarse-clean.smudge cat
printf 'AAAA\n' >"$WORKTREE/coarse-filter.txt"
COARSE_FILTER_STATUS="$(git -C "$WORKTREE" status --porcelain)"
COARSE_FILTER_DIFF="$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)"
COARSE_STAT_BIN="$TMP_ROOT/coarse-stat-bin"
mkdir -p "$COARSE_STAT_BIN"
# The wrapper stats the whole tracked set in one batched call, so this double
# freezes the pinned path's tuple and delegates every other path to the real
# binary under the caller's own format.
cat >"$COARSE_STAT_BIN/stat" <<'EOF'
#!/usr/bin/env bash
opts=()
paths=()
fmt=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -c | --format | --printf) opts+=("$1" "$2"); fmt="$2"; shift 2 ;;
    --printf=* | --format=*) opts+=("$1"); fmt="${1#*=}"; shift ;;
    --) shift ;;
    -*) opts+=("$1"); shift ;;
    *) paths+=("$1"); shift ;;
  esac
done
for p in "${paths[@]}"; do
  case "$p" in
    coarse-filter.txt | */coarse-filter.txt)
      case "$fmt" in
        *tracked-path*) printf 'tracked-path %s\0' "$p" ;;
      esac
      printf '1:2:81a4:5:2020-01-01 00:00:00.000000000 +0000:2020-01-01 00:00:00.000000000 +0000\0'
      ;;
    *) "$AGENT_REAL_STAT" "${opts[@]}" -- "$p" ;;
  esac
done
EOF
chmod +x "$COARSE_STAT_BIN/stat"
REAL_STAT_BIN="$(command -v stat)"
set +e
OUT="$(cd "$WORKTREE" && PATH="$COARSE_STAT_BIN:$FAKE_BIN:$PATH" \
  AGENT_REAL_STAT="$REAL_STAT_BIN" \
  AGENT_FAKE_REPLACE_PATH=coarse-filter.txt \
  AGENT_FAKE_REPLACE_CONTENT=BBBB \
  bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "consult equal-length coarse-stat rewrite"
expect_out "agent-run: worktree: best-effort-clean" "consult equal-length coarse-stat rewrite"
[ "$(cat "$WORKTREE/coarse-filter.txt")" = 'BBBB' ] \
  || fail "coarse-stat fixture did not perform the equal-length rewrite"
[ "$(git -C "$WORKTREE" status --porcelain)" = "$COARSE_FILTER_STATUS" ] \
  || fail "coarse-stat fixture unexpectedly changed git status"
[ "$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)" = "$COARSE_FILTER_DIFF" ] \
  || fail "coarse-stat fixture unexpectedly changed the normalized diff"
git -C "$WORKTREE" reset -q --hard "$COARSE_FILTER_BASE"
git -C "$WORKTREE" config --unset filter.agent-run-coarse-clean.clean
git -C "$WORKTREE" config --unset filter.agent-run-coarse-clean.smudge
ok "consult: an unchanged drift snapshot is explicitly best-effort when raw bytes can evade its signals"

# Git deliberately hides worktree changes to assume-unchanged and skip-worktree
# paths from status and diff. The snapshot must hash only those exceptional
# tracked paths so this cannot turn a mutating consult into a clean report.
git -C "$WORKTREE" update-index --assume-unchanged tracked.txt
run_wrapper_env AGENT_FAKE_APPEND=1 -- consult claude -p hi
expect_code 4 "consult drift in assume-unchanged tracked file"
expect_out "DIRTY (consult modified: file-content)" "consult drift in assume-unchanged tracked file"
[ -z "$(git -C "$WORKTREE" status --porcelain)" ] \
  || fail "assume-unchanged fixture unexpectedly appeared in git status"
[ -z "$(git -C "$WORKTREE" diff)" ] \
  || fail "assume-unchanged fixture unexpectedly appeared in git diff"
git -C "$WORKTREE" update-index --no-assume-unchanged tracked.txt
git -C "$WORKTREE" checkout -q -- tracked.txt
ok "consult: flagged-content hashing catches drift hidden by assume-unchanged"

git -C "$WORKTREE" update-index --skip-worktree tracked.txt
run_wrapper_env AGENT_FAKE_APPEND=1 -- consult claude -p hi
expect_code 4 "consult drift in skip-worktree tracked file"
expect_out "DIRTY (consult modified: file-content)" "consult drift in skip-worktree tracked file"
[ -z "$(git -C "$WORKTREE" status --porcelain)" ] \
  || fail "skip-worktree fixture unexpectedly appeared in git status"
[ -z "$(git -C "$WORKTREE" diff)" ] \
  || fail "skip-worktree fixture unexpectedly appeared in git diff"
git -C "$WORKTREE" update-index --no-skip-worktree tracked.txt
git -C "$WORKTREE" checkout -q -- tracked.txt
ok "consult: flagged-content hashing catches drift hidden by skip-worktree"

# A tracked symlink's worktree identity is its target spelling, not the bytes
# reached through it. Retargeting between equal-content files must therefore
# change the exceptional-path hash even though a following cksum would match.
printf 'identical target\n' >"$WORKTREE/link-target-a"
printf 'identical target\n' >"$WORKTREE/link-target-b"
ln -s link-target-a "$WORKTREE/tracked-link"
git -C "$WORKTREE" add tracked-link
git -C "$WORKTREE" update-index --assume-unchanged tracked-link
run_wrapper_env AGENT_FAKE_RETARGET_SYMLINK_PATH=tracked-link AGENT_FAKE_RETARGET_SYMLINK_TARGET=link-target-b -- consult codex -p hi
expect_code 4 "consult flagged symlink retarget drift"
expect_out "DIRTY (consult modified: file-content)" "consult flagged symlink retarget drift"
[ "$(cat "$WORKTREE/tracked-link")" = "$(cat "$WORKTREE/link-target-a")" ] \
  || fail "flagged symlink fixture targets did not have identical content"
git -C "$WORKTREE" update-index --no-assume-unchanged tracked-link
git -C "$WORKTREE" update-index --force-remove tracked-link
rm -f "$WORKTREE/tracked-link" "$WORKTREE/link-target-a" "$WORKTREE/link-target-b"
ok "consult: flagged symlink hashing catches equal-content retargets"

# A successful fsmonitor query marks clean paths valid and lets later status and
# diff calls skip them. Hash that tagged exception set even when a monitor
# incorrectly reports no changes.
FSMONITOR_HOOK="$TMP_ROOT/agent-run-empty-fsmonitor"
cat >"$FSMONITOR_HOOK" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FSMONITOR_HOOK"
git -C "$WORKTREE" config core.fsmonitor "$FSMONITOR_HOOK"
git -C "$WORKTREE" config core.fsmonitorHookVersion 1
git -C "$WORKTREE" update-index --fsmonitor
git -C "$WORKTREE" status --porcelain >/dev/null
git -C "$WORKTREE" ls-files -f tracked.txt | grep -q '^h ' \
  || fail "fsmonitor fixture did not mark tracked.txt valid"
run_wrapper_env AGENT_FAKE_REPLACE_PATH=tracked.txt -- consult codex -p hi
expect_code 4 "consult drift hidden by fsmonitor"
expect_out "DIRTY (consult modified: file-content)" "consult drift hidden by fsmonitor"
[ -z "$(git -C "$WORKTREE" status --porcelain)" ] \
  || fail "fsmonitor fixture unexpectedly appeared in git status"
[ -z "$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)" ] \
  || fail "fsmonitor fixture unexpectedly appeared in git diff"
git -C "$WORKTREE" config --unset core.fsmonitor
git -C "$WORKTREE" config --unset core.fsmonitorHookVersion
git -C "$WORKTREE" update-index --no-fsmonitor
rm -f "$WORKTREE/tracked.txt"
git -C "$WORKTREE" checkout-index -- tracked.txt
ok "consult: flagged-content hashing catches drift hidden by fsmonitor"

# With trustctime disabled, equal-size bytes plus a preserved non-racy mtime
# can satisfy Git's cached stat tuple. Force ctime trust in the wrapper's
# private diff view instead of hashing every tracked file.
git -C "$WORKTREE" config core.trustctime false
touch -d '2020-01-01T00:00:00Z' "$WORKTREE/tracked.txt"
git -C "$WORKTREE" update-index --refresh
run_wrapper_env AGENT_FAKE_SLEEP=2 AGENT_FAKE_REPLACE_PRESERVE_MTIME_PATH=tracked.txt -- consult codex -p hi
expect_code 4 "consult stat-clean drift with trustctime disabled"
expect_out "DIRTY (consult modified: file-content,unstaged-diff)" "consult stat-clean drift with trustctime disabled"
[ -z "$(git -C "$WORKTREE" status --porcelain)" ] \
  || fail "trustctime fixture unexpectedly appeared in repository-configured status"
[ -z "$(git -C "$WORKTREE" diff --no-textconv --no-ext-diff)" ] \
  || fail "trustctime fixture unexpectedly appeared in repository-configured diff"
git -C "$WORKTREE" config --unset core.trustctime
git -C "$WORKTREE" checkout -q -- tracked.txt
ok "consult: forced ctime trust catches equal-size preserved-mtime drift"

# A consult that commits leaves `git status` clean; HEAD is snapshotted too.
BASE_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
run_wrapper_env AGENT_FAKE_COMMIT=1 -- consult claude -p hi
expect_code 4 "consult drift via commit"
expect_out "DIRTY" "consult drift via commit"
git -C "$WORKTREE" reset -q --hard "$BASE_SHA"
ok "consult: a consult that commits its mutation is still caught"

run_wrapper_env AGENT_FAKE_MOVE_OTHER_REF=1 -- consult codex -p hi
expect_code 4 "consult drift via non-current ref"
expect_out "DIRTY (consult modified: refs)" "consult drift via non-current ref"
git -C "$WORKTREE" update-ref -d refs/heads/agent-run-other-ref
ok "consult: a codex consult that moves a non-current ref is caught"

run_wrapper_env AGENT_FAKE_WRITE_GIT_HOOK=1 -- consult claude -p hi
expect_code 4 "consult drift via git hook"
expect_out "DIRTY" "consult drift via git hook"
rm -f "$WORKTREE/.git/hooks/pre-commit"
ok "consult: a consult that plants an executable git hook is caught"

run_wrapper_env AGENT_FAKE_WRITE_GIT_CONFIG=1 -- consult claude -p hi
expect_code 4 "consult drift via git config"
expect_out "DIRTY" "consult drift via git config"
git -C "$WORKTREE" config --unset alias.agent-run-test
ok "consult: a consult that changes local git config is caught"

# --- trailer completeness outside a git repo ---------------------------------------

NONREPO_DIR="$TMP_ROOT/nonrepo"
mkdir -p "$NONREPO_DIR"
set +e
OUT="$(cd "$NONREPO_DIR" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "consult outside git"
expect_out "agent-run: worktree: unchecked (not a git repository)" "consult outside git"
set +e
OUT="$(cd "$NONREPO_DIR" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "work outside git"
expect_out "agent-run: worktree: unchecked (not a git repository)" "work outside git"
ok "trailers: dispatch outside a git repository reports worktree unchecked instead of omitting the trailer"

# --- dispatch header and killed-wrapper finalization --------------------------------

# Every run that reaches its backend opens the log with wrapper-owned
# breadcrumb lines (dispatched + backend-pid). They survive any later death of
# the wrapper — including SIGKILL, which can never run a trap — so a waiter
# can always tell "dead, un-finalized" (header present, wrapper pid dead, no
# completion trailers) from "healthy, just quiet".
HDR_ANSWER="$TMP_ROOT/header-answer.msg"
run_wrapper consult claude -p hi -o "$HDR_ANSWER"
expect_code 0 "dispatch header consult"
grep -qE "^agent-run: dispatched: consult claude wrapper-pid [0-9]+ answer $HDR_ANSWER\$" <<<"$OUT" \
  || fail "dispatch header consult: missing dispatched header with the answer path ($OUT)"
grep -qE '^agent-run: backend-pid: [0-9]+$' <<<"$OUT" \
  || fail "dispatch header consult: missing backend-pid line ($OUT)"
rm -f "$HDR_ANSWER"
ok "header: runs open with dispatched + backend-pid breadcrumbs naming the answer path"

run_wrapper review codex -- --commit abc123
expect_code 0 "dispatch header review"
expect_out "agent-run: dispatched: review codex wrapper-pid" "dispatch header review"
grep -qE '^agent-run: dispatched: .* answer ' <<<"$OUT" \
  && fail "dispatch header review: review has no answer file but the header names one ($OUT)"
ok "header: review's header carries no answer path (review rejects -o)"

run_wrapper work claude
expect_code 2 "usage reject stays header-free"
expect_not_out "agent-run: dispatched:" "usage reject stays header-free"
ok "header: usage rejections print no dispatch header (no run was dispatched)"

# A fatal signal while emit_dispatch_header is active but before `dispatched:`
# reaches the log must not manufacture completion anchors. A waiter treats a
# worktree/backend-exit anchor as decided, so trailers without the launch line
# would falsely finalize a backend that never started.
HEADER_SIGNAL_ANSWER="$TMP_ROOT/header-signal-answer.msg"
HEADER_SIGNAL_READY="$TMP_ROOT/header-signal.ready"
HEADER_SIGNAL_RELEASE="$TMP_ROOT/header-signal.release"
HEADER_SIGNAL_LOG="$TMP_ROOT/header-signal.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_DISPATCH_HEADER_READY="$HEADER_SIGNAL_READY" \
  AGENT_RUN_TEST_DISPATCH_HEADER_RELEASE="$HEADER_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$HEADER_SIGNAL_ANSWER") >"$HEADER_SIGNAL_LOG" 2>&1 &
HEADER_SIGNAL_WRAPPER=$!
await_ready "$HEADER_SIGNAL_READY" "$HEADER_SIGNAL_WRAPPER" "dispatch-header signal: wrapper never reached the pre-write boundary" "$HEADER_SIGNAL_LOG"
kill -TERM "$HEADER_SIGNAL_WRAPPER"
: >"$HEADER_SIGNAL_RELEASE"
wait_wrapper "$HEADER_SIGNAL_WRAPPER" "$HEADER_SIGNAL_LOG"
expect_code 1 "dispatch-header signal"
assert_prelaunch_reject_contract "dispatch-header signal" "$OUT"
grep -qE "^agent-run: attempt: .* record .* wrapper-pid $HEADER_SIGNAL_WRAPPER\$" <<<"$OUT" \
  || fail "dispatch-header signal: attempt breadcrumb did not attribute the wrapper pid ($OUT)"
set +e
OUT="$(bash "$WAITER" "$HEADER_SIGNAL_LOG" --timeout 0 2>&1)"
CODE=$?
set -e
expect_code 22 "dispatch-header signal waiter classification"
expect_out "attempt=finalized-no-answer retryable=yes" "dispatch-header signal waiter classification"
run_wrapper consult claude -p hi -o "$HEADER_SIGNAL_ANSWER"
expect_code 0 "retry after dispatch-header signal"
ok "header: a fatal signal before dispatched bytes is attributable and classified as retryable"

# A handled signal can run between simple commands. Defer it across the
# successful dispatched printf -> emitted-flag handoff so the signal handler
# emits the required backend-pid and completion records instead of finalizing
# a launched-looking log as a pre-dispatch retry.
HEADER_WRITE_ANSWER="$TMP_ROOT/header-write-answer.msg"
HEADER_WRITE_READY="$TMP_ROOT/header-write.ready"
HEADER_WRITE_RELEASE="$TMP_ROOT/header-write.release"
HEADER_WRITE_LOG="$TMP_ROOT/header-write.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_DISPATCH_WRITE_READY="$HEADER_WRITE_READY" \
  AGENT_RUN_TEST_DISPATCH_WRITE_RELEASE="$HEADER_WRITE_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$HEADER_WRITE_ANSWER") >"$HEADER_WRITE_LOG" 2>&1 &
HEADER_WRITE_WRAPPER=$!
await_ready "$HEADER_WRITE_READY" "$HEADER_WRITE_WRAPPER" "dispatch-header write signal: wrapper never reached the post-write boundary" "$HEADER_WRITE_LOG"
grep -q '^agent-run: dispatched:' "$HEADER_WRITE_LOG" \
  || fail "dispatch-header write signal: dispatched bytes were not logged before the boundary"
grep -q '^agent-run: backend-pid:' "$HEADER_WRITE_LOG" \
  && fail "dispatch-header write signal: backend pid appeared before the signal boundary"
kill -TERM "$HEADER_WRITE_WRAPPER"
: >"$HEADER_WRITE_RELEASE"
wait_wrapper "$HEADER_WRITE_WRAPPER" "$HEADER_WRITE_LOG"
expect_code 1 "dispatch-header write signal"
assert_finalized_contract "dispatch-header write signal" "$OUT"
expect_out "agent-run: backend-pid: none (launch aborted before exec; no backend started)" \
  "dispatch-header write signal"
grep -qFx 'state=finalized' "$(attempt_record_path "$HEADER_WRITE_ANSWER")" \
  || fail "dispatch-header write signal: attempt record did not finalize"
ok "header: a signal after dispatched bytes preserves backend-pid and finalized trailer contracts"

# Claude, Cursor, and Copilot launch without a pipeline. TERM in the narrow
# background-launch -> $! capture gap must recover the child pid and propagate,
# never finalize while a lock-holding backend survives untracked.
for SIGNAL_AGENT in claude cursor copilot; do
  SIGNAL_CAPTURE_LOG="$TMP_ROOT/sig-capture-$SIGNAL_AGENT.log"
  SIGNAL_CAPTURE_ANS="$TMP_ROOT/sig-capture-$SIGNAL_AGENT.msg"
  SIGNAL_CAPTURE_PID="$TMP_ROOT/sig-capture-$SIGNAL_AGENT.pid"
  SIGNAL_CAPTURE_ARGS=(consult "$SIGNAL_AGENT" -p hi -o "$SIGNAL_CAPTURE_ANS")
  if [ "$SIGNAL_AGENT" = copilot ]; then
    SIGNAL_CAPTURE_ARGS=(consult copilot -m m -p hi -o "$SIGNAL_CAPTURE_ANS")
  fi
  SIGNAL_CAPTURE_READY="$TMP_ROOT/sig-capture-$SIGNAL_AGENT.ready"
  SIGNAL_CAPTURE_RELEASE="$TMP_ROOT/sig-capture-$SIGNAL_AGENT.release"
  # Park the wrapper inside the window rather than widening it with a timer: a
  # timed delay goes green without exercising the race whenever a loaded runner
  # lets the wrapper leave the delay before the TERM lands, because an ordinary
  # wait also propagates and kills the backend.
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
    AGENT_FAKE_PID_FILE="$SIGNAL_CAPTURE_PID" \
    AGENT_RUN_TEST_PID_CAPTURE_READY="$SIGNAL_CAPTURE_READY" \
    AGENT_RUN_TEST_PID_CAPTURE_RELEASE="$SIGNAL_CAPTURE_RELEASE" \
    exec bash "$WRAPPER" "${SIGNAL_CAPTURE_ARGS[@]}") >"$SIGNAL_CAPTURE_LOG" 2>&1 &
  SIGNAL_CAPTURE_WRAPPER=$!
  await_ready "$SIGNAL_CAPTURE_READY" "$SIGNAL_CAPTURE_WRAPPER" \
    "$SIGNAL_AGENT capture-window race: wrapper never reached the pid-capture window" \
    "$SIGNAL_CAPTURE_LOG"
  n=0
  until [ -s "$SIGNAL_CAPTURE_PID" ] || ! kill -0 "$SIGNAL_CAPTURE_WRAPPER" 2>/dev/null \
    || [ "$n" -ge 100 ]; do
    sleep 0.05
    n=$((n + 1))
  done
  [ -s "$SIGNAL_CAPTURE_PID" ] \
    || fail "$SIGNAL_AGENT capture-window race: backend never started ($(cat "$SIGNAL_CAPTURE_LOG"))"
  # The park holds before the pid is captured, so this cannot flake; it fails
  # only if the boundary itself drifts past the capture it is meant to precede.
  grep -q '^agent-run: backend-pid:' "$SIGNAL_CAPTURE_LOG" \
    && fail "$SIGNAL_AGENT capture-window race: pid was captured before TERM — window not exercised ($(cat "$SIGNAL_CAPTURE_LOG"))"
  SIGNAL_CAPTURE_BACKEND="$(cat "$SIGNAL_CAPTURE_PID")"
  kill -TERM "$SIGNAL_CAPTURE_WRAPPER"
  : >"$SIGNAL_CAPTURE_RELEASE"
  wait_wrapper "$SIGNAL_CAPTURE_WRAPPER" "$SIGNAL_CAPTURE_LOG"
  if kill -0 "$SIGNAL_CAPTURE_BACKEND" 2>/dev/null; then
    kill -9 -- "-$SIGNAL_CAPTURE_BACKEND" 2>/dev/null \
      || kill -9 "$SIGNAL_CAPTURE_BACKEND" 2>/dev/null || true
    fail "$SIGNAL_AGENT capture-window race: backend survived wrapper TERM ($OUT)"
  fi
  expect_code 1 "$SIGNAL_AGENT capture-window race exit code"
  expect_out "propagated to backend pid $SIGNAL_CAPTURE_BACKEND" \
    "$SIGNAL_AGENT capture-window race"
  expect_not_out "may be orphaned" "$SIGNAL_AGENT capture-window race"
done
ok "signals: non-pipeline launch races recover and terminate every backend pid"

# A backend has fully exited, but wait returned before the launcher advanced
# BACKEND_PHASE to `reaped`. TERM in that exact inter-command window must detect
# the dead backend tree and defer until parsing settles, then publish a valid
# candidate instead of finalizing the attempt as a signal no-answer. Exercise
# every launcher shape.
for REAPED_AGENT in claude cursor copilot codex; do
  REAPED_LOG="$TMP_ROOT/sig-reaped-$REAPED_AGENT.log"
  REAPED_ANS="$TMP_ROOT/sig-reaped-$REAPED_AGENT.msg"
  REAPED_READY="$TMP_ROOT/sig-reaped-$REAPED_AGENT.ready"
  REAPED_RELEASE="$TMP_ROOT/sig-reaped-$REAPED_AGENT.release"
  REAPED_ARGS=(consult "$REAPED_AGENT" -p hi -o "$REAPED_ANS")
  if [ "$REAPED_AGENT" = copilot ]; then
    REAPED_ARGS=(consult copilot -m m -p hi -o "$REAPED_ANS")
  fi
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    AGENT_RUN_TEST_REAPED_READY="$REAPED_READY" \
    AGENT_RUN_TEST_REAPED_RELEASE="$REAPED_RELEASE" \
    exec bash "$WRAPPER" "${REAPED_ARGS[@]}") >"$REAPED_LOG" 2>&1 &
  REAPED_WRAPPER=$!
  await_ready "$REAPED_READY" "$REAPED_WRAPPER" \
    "$REAPED_AGENT reaped-window race: wrapper never returned from wait" "$REAPED_LOG"
  kill -TERM "$REAPED_WRAPPER"
  : >"$REAPED_RELEASE"
  wait_wrapper "$REAPED_WRAPPER" "$REAPED_LOG"
  expect_code 0 "$REAPED_AGENT reaped-window race exit code"
  [ -s "$REAPED_ANS" ] \
    || fail "$REAPED_AGENT reaped-window race: complete candidate was not published ($OUT)"
  expect_out "agent-run: answer: $REAPED_ANS" "$REAPED_AGENT reaped-window race answer trailer"
  grep -qFx 'answer-outcome=answer' "$(attempt_record_path "$REAPED_ANS")" \
    || fail "$REAPED_AGENT reaped-window race: complete answer was recorded as no-answer"
done
ok "signals: TERM between wait return and the reaped phase preserves complete answers"

# Prove the retry path with a real trapped signal and a real blocked wait.
# Hold the backend immediately before exit, wait until the wrapper has reached
# wait, then deliver TERM and hold its handler before the liveness probe. Release
# the backend while that real signal is interrupting wait; once its process
# group is dead, let the handler continue. The first wait reports 143, but the
# retained child status must still be collected as 7.
REAL_WAIT_LOG="$TMP_ROOT/sig-real-wait.log"
REAL_WAIT_ANS="$TMP_ROOT/sig-real-wait.msg"
REAL_WAIT_BACKEND_READY="$TMP_ROOT/sig-real-wait-backend.ready"
REAL_WAIT_BACKEND_RELEASE="$TMP_ROOT/sig-real-wait-backend.release"
REAL_WAIT_READY="$TMP_ROOT/sig-real-wait-wrapper.ready"
REAL_WAIT_BACKEND_PID_FILE="$TMP_ROOT/sig-real-wait-backend.pid"
REAL_WAIT_INTERRUPTED="$TMP_ROOT/sig-real-wait-interrupted.marker"
REAL_WAIT_SIGNAL_READY="$TMP_ROOT/sig-real-wait-signal.ready"
REAL_WAIT_SIGNAL_RELEASE="$TMP_ROOT/sig-real-wait-signal.release"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_FAKE_EXIT=7 \
  AGENT_FAKE_EXIT_READY="$REAL_WAIT_BACKEND_READY" \
  AGENT_FAKE_EXIT_RELEASE="$REAL_WAIT_BACKEND_RELEASE" \
  AGENT_FAKE_PID_FILE="$REAL_WAIT_BACKEND_PID_FILE" \
  AGENT_RUN_TEST_WAIT_READY_SITE=spawn-backend \
  AGENT_RUN_TEST_WAIT_READY_MARKER="$REAL_WAIT_READY" \
  AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER="$REAL_WAIT_INTERRUPTED" \
  AGENT_RUN_TEST_SIGNAL_PROBE_READY="$REAL_WAIT_SIGNAL_READY" \
  AGENT_RUN_TEST_SIGNAL_PROBE_RELEASE="$REAL_WAIT_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$REAL_WAIT_ANS") >"$REAL_WAIT_LOG" 2>&1 &
REAL_WAIT_WRAPPER=$!
n=0
until { [ -e "$REAL_WAIT_BACKEND_READY" ] \
    && [ -e "$REAL_WAIT_READY" ] \
    && [ -s "$REAL_WAIT_BACKEND_PID_FILE" ]; } \
  || ! kill -0 "$REAL_WAIT_WRAPPER" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
if [ ! -e "$REAL_WAIT_BACKEND_READY" ] \
  || [ ! -e "$REAL_WAIT_READY" ] \
  || [ ! -s "$REAL_WAIT_BACKEND_PID_FILE" ]; then
  : >"$REAL_WAIT_BACKEND_RELEASE"
  fail "real wait interruption: backend and wrapper did not reach the blocked-wait boundary ($(cat "$REAL_WAIT_LOG"))"
fi
REAL_WAIT_BACKEND_PID="$(cat "$REAL_WAIT_BACKEND_PID_FILE")"
kill -TERM "$REAL_WAIT_WRAPPER"
n=0
until [ -e "$REAL_WAIT_SIGNAL_READY" ] \
  || ! kill -0 "$REAL_WAIT_WRAPPER" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
if [ ! -e "$REAL_WAIT_SIGNAL_READY" ]; then
  : >"$REAL_WAIT_BACKEND_RELEASE"
  : >"$REAL_WAIT_SIGNAL_RELEASE"
  fail "real wait interruption: TERM did not enter the blocked wait handler ($(cat "$REAL_WAIT_LOG"))"
fi
: >"$REAL_WAIT_BACKEND_RELEASE"
n=0
while kill -0 -- "-$REAL_WAIT_BACKEND_PID" 2>/dev/null && [ "$n" -lt 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
if kill -0 -- "-$REAL_WAIT_BACKEND_PID" 2>/dev/null; then
  : >"$REAL_WAIT_SIGNAL_RELEASE"
  fail "real wait interruption: backend process group stayed live after release ($(cat "$REAL_WAIT_LOG"))"
fi
: >"$REAL_WAIT_SIGNAL_RELEASE"
wait_wrapper "$REAL_WAIT_WRAPPER" "$REAL_WAIT_LOG"
expect_code 1 "real wait interruption exit code"
expect_out "agent-run: backend-exit: 7" "real wait interruption retained status"
expect_not_out "agent-run: backend-exit: 127" "real wait interruption stale retry"
[ "$(cat "$REAL_WAIT_INTERRUPTED" 2>/dev/null || true)" = spawn-backend ] \
  || fail "real wait interruption: TERM did not exercise the in-flight wait trap ($OUT)"
ok "signals: a real TERM interrupting a blocked wait preserves the backend status"

# assert_wait_signal_boundary <slug> <hook-family> <boundary> <label> <marker-failure> <ok>
# Park a wrapper at one of the two wait-marker boundaries, TERM it exactly
# there, and prove the real backend status survives with no stale wait retry
# requested. Both boundaries take the identical run; only which hook family
# parks the wrapper differs, so they share one body rather than two copies that
# must be kept in sync. The ready poll is spelled out instead of using
# await_ready because a miss must still release the parked wrapper before
# failing, or the run leaks.
assert_wait_signal_boundary() {
  local slug="$1" family="$2" boundary="$3" label="$4" marker_fail="$5" ok_message="$6"
  local log="$TMP_ROOT/$slug.log" ans="$TMP_ROOT/$slug.msg"
  local ready="$TMP_ROOT/$slug.ready" release="$TMP_ROOT/$slug.release"
  local interrupted="$TMP_ROOT/$slug-interrupted.marker" pid n=0
  (cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EXIT=7 \
    exec env "AGENT_RUN_TEST_${family}_SITE=spawn-backend" \
      "AGENT_RUN_TEST_${family}_READY=$ready" \
      "AGENT_RUN_TEST_${family}_RELEASE=$release" \
      "AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER=$interrupted" \
      bash "$WRAPPER" consult claude -p hi -o "$ans") >"$log" 2>&1 &
  pid=$!
  until [ -e "$ready" ] || ! kill -0 "$pid" 2>/dev/null || [ "$n" -ge 100 ]; do
    sleep 0.05
    n=$((n + 1))
  done
  if [ ! -e "$ready" ]; then
    : >"$release"
    fail "$label: wrapper did not reach the $boundary boundary ($(cat "$log"))"
  fi
  kill -TERM "$pid"
  : >"$release"
  set +e
  wait "$pid"
  CODE=$?
  set -e
  OUT="$(cat "$log")"
  expect_code 1 "$label exit code"
  expect_out "agent-run: backend-exit: 7" "$label retained status"
  expect_not_out "agent-run: backend-exit: 127" "$label stale retry"
  [ ! -e "$interrupted" ] || fail "$label: $marker_fail ($OUT)"
  ok "$ok_message"
}

# A real TERM in the command boundary immediately before wait must not request
# a retry: the first wait has not run yet and will collect the real status.
assert_wait_signal_boundary sig-pre-wait WAIT_BEFORE pre-wait "pre-wait signal" \
  "TERM incorrectly marked a wait that had not started" \
  "signals: a real TERM immediately before wait does not request a stale retry"

# A real TERM after wait returns but before its status is copied must see the
# temporary wait marker already restored. The test pause returns the genuine
# wait status so the following assignment still exercises that exact boundary.
assert_wait_signal_boundary sig-returned-wait WAIT_RETURNED post-wait "returned wait signal" \
  "TERM marked an already-returned wait for retry" \
  "signals: a real TERM immediately after wait return cannot request a stale retry"

# A signal can also land while bash is still blocked inside wait, after the
# backend has exited. The trap then preserves the completed backend by marking
# the phase reaped, but the interrupted wait itself returns 128+signum. Keep the
# test-only substitution to cover the shared launcher and every
# status-capturing codex wait without repeating the real-signal synchronization
# for every site.
for MIDWAIT_AGENT in claude cursor copilot codex; do
  MIDWAIT_ANS="$TMP_ROOT/sig-midwait-$MIDWAIT_AGENT.msg"
  MIDWAIT_MARKER="$TMP_ROOT/sig-midwait-$MIDWAIT_AGENT.marker"
  MIDWAIT_SITE=spawn-backend
  MIDWAIT_ARGS=(consult "$MIDWAIT_AGENT" -p hi -o "$MIDWAIT_ANS")
  if [ "$MIDWAIT_AGENT" = copilot ]; then
    MIDWAIT_ARGS=(consult copilot -m m -p hi -o "$MIDWAIT_ANS")
  elif [ "$MIDWAIT_AGENT" = codex ]; then
    MIDWAIT_SITE=codex-backend
  fi
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
    AGENT_RUN_TEST_WAIT_INTERRUPTED_SITE="$MIDWAIT_SITE" \
    AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER="$MIDWAIT_MARKER" \
    bash "$WRAPPER" "${MIDWAIT_ARGS[@]}" 2>&1)"
  CODE=$?
  set -e
  expect_code 0 "$MIDWAIT_AGENT mid-wait retry exit code"
  [ "$(cat "$MIDWAIT_MARKER" 2>/dev/null || true)" = "$MIDWAIT_SITE" ] \
    || fail "$MIDWAIT_AGENT mid-wait retry: wait interruption hook did not exercise $MIDWAIT_SITE ($OUT)"
  [ -s "$MIDWAIT_ANS" ] \
    || fail "$MIDWAIT_AGENT mid-wait retry: complete candidate was not published ($OUT)"
  MIDWAIT_RECORD="$(attempt_record_path "$MIDWAIT_ANS")"
  grep -qFx 'backend-disposition=success' "$MIDWAIT_RECORD" \
    || fail "$MIDWAIT_AGENT mid-wait retry: successful backend retained an interrupted-wait disposition"
  grep -qFx 'answer-outcome=answer' "$MIDWAIT_RECORD" \
    || fail "$MIDWAIT_AGENT mid-wait retry: complete answer was recorded as no-answer"
done

MIDWAIT_TEE_ANS="$TMP_ROOT/sig-midwait-codex-tee.msg"
MIDWAIT_TEE_MARKER="$TMP_ROOT/sig-midwait-codex-tee.marker"
run_wrapper_env AGENT_RUN_TEST_PID_WRITE_FAIL=1 AGENT_RUN_TEST_WAIT_INTERRUPTED_SITE=codex-tee AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER="$MIDWAIT_TEE_MARKER" -- consult codex -p hi -o "$MIDWAIT_TEE_ANS"
expect_code 1 "codex tee mid-wait retry exit code"
[ "$(cat "$MIDWAIT_TEE_MARKER" 2>/dev/null || true)" = codex-tee ] \
  || fail "codex tee mid-wait retry: wait interruption hook did not exercise the site ($OUT)"
MIDWAIT_TEE_RECORD="$(attempt_record_path "$MIDWAIT_TEE_ANS")"
grep -qFx 'backend-disposition=exit-1' "$MIDWAIT_TEE_RECORD" \
  || fail "codex tee mid-wait retry: launch-abort disposition was not retained"
grep -qFx 'answer-outcome=no-answer' "$MIDWAIT_TEE_RECORD" \
  || fail "codex tee mid-wait retry: launch abort unexpectedly recorded an answer"

run_sourced_phase '
  set +e
  AGENT_RUN_TEST_WAIT_INTERRUPTED_SITE=codex-late-backend
  AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER="$TMP_ROOT/sig-midwait-codex-late-backend.marker"
  (exit 7) &
  backend_pid=$!
  BACKEND_PHASE=running
  wait_for_backend_status "$backend_pid" codex-late-backend
  printf "%s|%s\n" "$code" "$(cat "$AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER")"
'
expect_code 0 "codex late-backend mid-wait helper"
expect_out "7|codex-late-backend" "codex late-backend mid-wait helper"
ok "signals: interrupted waits retry and preserve backend status at every launch site"

# Codex can discover its session id while tee still drains the rest of the
# pipe. Exercise the final drain helper with a genuine child and blocked wait:
# TERM must request a retry, the child must fully flush, and the saved backend
# status must survive the tee's own status.
TEE_DRAIN_LOG="$TMP_ROOT/sig-tee-drain.log"
TEE_DRAIN_RELEASE="$TMP_ROOT/sig-tee-drain.release"
TEE_DRAIN_WAIT_READY="$TMP_ROOT/sig-tee-drain-wait.ready"
TEE_DRAIN_INTERRUPTED="$TMP_ROOT/sig-tee-drain-interrupted.marker"
TEE_DRAIN_CAPTURE="$TMP_ROOT/sig-tee-drain.capture"
(cd "$WORKTREE" && \
  AGENT_RUN_TEST_WAIT_READY_SITE=codex-drain \
  AGENT_RUN_TEST_WAIT_READY_MARKER="$TEE_DRAIN_WAIT_READY" \
  AGENT_RUN_TEST_WAIT_INTERRUPTED_MARKER="$TEE_DRAIN_INTERRUPTED" \
  exec bash -c '
    AGENT_RUN_SOURCE_ONLY=1
    # shellcheck source=/dev/null
    . "$1"
    agent_run_reset_state
    set +e
    SETSID=()
    BACKEND_PID_FILE=""
    BACKEND_PHASE=running
    code=7
    (exit 0) &
    BACKEND_PID=$!
    wait "$BACKEND_PID"
    (
      while [ ! -e "$2" ]; do sleep 0.02; done
      printf "fully flushed\n" >"$3"
    ) &
    TEE_PID=$!
    DISPATCH_HEADER_EMITTED=1
    install_signal_traps
    drain_codex_tee
    printf "code=%s|tee=%s|capture=%s\n" \
      "$code" "${TEE_PID:-cleared}" "$(cat "$3")"
  ' _ "$WRAPPER" "$TEE_DRAIN_RELEASE" "$TEE_DRAIN_CAPTURE") >"$TEE_DRAIN_LOG" 2>&1 &
TEE_DRAIN_WRAPPER=$!
n=0
until [ -e "$TEE_DRAIN_WAIT_READY" ] \
  || ! kill -0 "$TEE_DRAIN_WRAPPER" 2>/dev/null || [ "$n" -ge 300 ]; do
  sleep 0.05
  n=$((n + 1))
done
if [ ! -e "$TEE_DRAIN_WAIT_READY" ]; then
  : >"$TEE_DRAIN_RELEASE"
  wait "$TEE_DRAIN_WRAPPER" 2>/dev/null || true
  fail "codex tee drain: wrapper did not block on the final tee wait ($(cat "$TEE_DRAIN_LOG"))"
fi
kill -TERM "$TEE_DRAIN_WRAPPER"
n=0
until [ -e "$TEE_DRAIN_INTERRUPTED" ] \
  || ! kill -0 "$TEE_DRAIN_WRAPPER" 2>/dev/null || [ "$n" -ge 300 ]; do
  sleep 0.05
  n=$((n + 1))
done
if [ ! -e "$TEE_DRAIN_INTERRUPTED" ]; then
  : >"$TEE_DRAIN_RELEASE"
  wait "$TEE_DRAIN_WRAPPER" 2>/dev/null || true
  fail "codex tee drain: TERM did not interrupt the blocked drain wait ($(cat "$TEE_DRAIN_LOG"))"
fi
: >"$TEE_DRAIN_RELEASE"
wait_wrapper "$TEE_DRAIN_WRAPPER" "$TEE_DRAIN_LOG"
expect_code 0 "codex tee drain signal exit code"
[ "$(cat "$TEE_DRAIN_INTERRUPTED")" = codex-drain ] \
  || fail "codex tee drain: signal interrupted the wrong wait site ($OUT)"
expect_out "code=7|tee=cleared|capture=fully flushed" \
  "codex tee drain preserved backend status and flushed output"
ok "signals: codex finalization fully drains tee after a real interrupted wait"

# Once run_backend has returned a complete candidate, a fatal signal is deferred
# like one arriving inside finalize_run: the completed answer is published and
# its successful attempt record is retained.
FINALIZE_WINDOW_LOG="$TMP_ROOT/sig-finalize-window.log"
FINALIZE_WINDOW_ANS="$TMP_ROOT/sig-finalize-window.msg"
FINALIZE_WINDOW_READY="$TMP_ROOT/sig-finalize-window.ready"
FINALIZE_WINDOW_RELEASE="$TMP_ROOT/sig-finalize-window.release"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_RUN_TEST_FINALIZE_READY="$FINALIZE_WINDOW_READY" \
  AGENT_RUN_TEST_FINALIZE_RELEASE="$FINALIZE_WINDOW_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$FINALIZE_WINDOW_ANS") >"$FINALIZE_WINDOW_LOG" 2>&1 &
FINALIZE_WINDOW_WRAPPER=$!
await_ready "$FINALIZE_WINDOW_READY" "$FINALIZE_WINDOW_WRAPPER" "finalize-window race: wrapper never returned from its backend" "$FINALIZE_WINDOW_LOG"
kill -TERM "$FINALIZE_WINDOW_WRAPPER"
: >"$FINALIZE_WINDOW_RELEASE"
wait_wrapper "$FINALIZE_WINDOW_WRAPPER" "$FINALIZE_WINDOW_LOG"
expect_code 0 "finalize-window race exit code"
[ "$(cat "$FINALIZE_WINDOW_ANS")" = "fake codex last message" ] \
  || fail "finalize-window race: completed candidate was not published ($OUT)"
expect_out "agent-run: answer: $FINALIZE_WINDOW_ANS" "finalize-window race answer trailer"
FINALIZE_WINDOW_RECORD="$(attempt_record_path "$FINALIZE_WINDOW_ANS")"
grep -qFx 'state=finalized' "$FINALIZE_WINDOW_RECORD" \
  || fail "finalize-window race: attempt was not finalized"
grep -qFx 'answer-outcome=answer' "$FINALIZE_WINDOW_RECORD" \
  || fail "finalize-window race: completed answer was recorded as no-answer"
ok "signals: TERM after backend completion defers through answer finalization"

# Codex writes its private candidate directly. A signal while that write is in
# progress must settle as no-answer instead of publishing the nonempty prefix.
PARTIAL_SIGNAL_LOG="$TMP_ROOT/sig-partial-codex.log"
PARTIAL_SIGNAL_ANS="$TMP_ROOT/sig-partial-codex.msg"
PARTIAL_SIGNAL_READY="$TMP_ROOT/sig-partial-codex.ready"
PARTIAL_SIGNAL_RELEASE="$TMP_ROOT/sig-partial-codex.release"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_FAKE_PARTIAL_ANSWER_READY="$PARTIAL_SIGNAL_READY" \
  AGENT_FAKE_PARTIAL_ANSWER_RELEASE="$PARTIAL_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult codex -p hi -o "$PARTIAL_SIGNAL_ANS") >"$PARTIAL_SIGNAL_LOG" 2>&1 &
PARTIAL_SIGNAL_WRAPPER=$!
await_ready "$PARTIAL_SIGNAL_READY" "$PARTIAL_SIGNAL_WRAPPER" "partial Codex signal: backend never began writing its candidate" "$PARTIAL_SIGNAL_LOG"
PARTIAL_SIGNAL_ATTEMPT="$(attempt_current_id "$PARTIAL_SIGNAL_ANS")"
PARTIAL_SIGNAL_CANDIDATE="$PARTIAL_SIGNAL_ANS.agent-run/$PARTIAL_SIGNAL_ATTEMPT/answer.tmp"
[ -s "$PARTIAL_SIGNAL_CANDIDATE" ] \
  || fail "partial Codex signal: test did not observe a nonempty partial candidate"
kill -TERM "$PARTIAL_SIGNAL_WRAPPER"
wait_wrapper "$PARTIAL_SIGNAL_WRAPPER" "$PARTIAL_SIGNAL_LOG"
expect_code 1 "partial Codex signal exit code"
expect_not_out "agent-run: answer:" "partial Codex signal answer trailer"
[ ! -e "$PARTIAL_SIGNAL_ANS" ] \
  || fail "partial Codex signal: a truncated answer reached the public path"
[ ! -e "$PARTIAL_SIGNAL_CANDIDATE" ] \
  || fail "partial Codex signal: incomplete private candidate survived settled cleanup"
grep -qFx 'answer-outcome=no-answer' "$(attempt_record_path "$PARTIAL_SIGNAL_ANS")" \
  || fail "partial Codex signal: interrupted candidate was not finalized as no-answer"
run_wrapper consult codex -p hi -o "$PARTIAL_SIGNAL_ANS"
expect_code 0 "retry after partial Codex signal"
ok "signals: TERM cannot publish a partially written Codex candidate"

# A TERM'd wrapper must finalize: propagate the signal to the backend's
# process tree, then emit backend-exit/session-id/worktree trailers so the
# caller learns the run died (and where to resume) without pgrep forensics.
SIG_LOG="$TMP_ROOT/sig-term.log"
SIG_ANS="$TMP_ROOT/sig-term.msg"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 \
  exec bash "$WRAPPER" work codex -p hi -o "$SIG_ANS") >"$SIG_LOG" 2>&1 &
SIG_WRAPPER=$!
n=0
until { grep -q '^agent-run: backend-pid:' "$SIG_LOG" && grep -q '^session id:' "$SIG_LOG"; } 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
grep -q '^agent-run: backend-pid:' "$SIG_LOG" || fail "TERM finalization: run never reached the backend ($(cat "$SIG_LOG"))"
kill -TERM "$SIG_WRAPPER"
wait_wrapper "$SIG_WRAPPER" "$SIG_LOG"
expect_code 1 "TERM finalization exit code"
expect_out "agent-run: backend-exit: killed (SIGTERM" "TERM finalization backend-exit trailer"
expect_out "agent-run: session-id: 12345678-1234-1234-1234-123456789abc" "TERM finalization session id from the log header"
expect_out "(unchanged)" "TERM finalization head trailer"
expect_out "agent-run: worktree: clean" "TERM finalization worktree trailer"
assert_finalized_contract "TERM contract" "$OUT"
SIG_BACKEND="$(sed -n 's/^agent-run: backend-pid: //p' "$SIG_LOG" | head -n1)"
if [ -n "$SIG_BACKEND" ] && kill -0 "$SIG_BACKEND" 2>/dev/null; then
  kill -9 -- "-$SIG_BACKEND" 2>/dev/null || kill -9 "$SIG_BACKEND" 2>/dev/null || true
  fail "TERM finalization: backend survived the propagated signal"
fi
[ ! -s "$SIG_ANS" ] || fail "TERM finalization: a killed run must not report an answer"
SIG_ATTEMPT="$(attempt_current_id "$SIG_ANS")"
SIG_RECORD="$(attempt_record_path "$SIG_ANS")"
[ ! -e "$SIG_ANS.agent-run/$SIG_ATTEMPT/answer.tmp" ] \
  || fail "TERM finalization: private answer candidate survived settled signal cleanup"
grep -qFx 'state=finalized' "$SIG_RECORD" \
  || fail "TERM finalization: attempt record was not finalized"
grep -qFx 'finalization-count=1' "$SIG_RECORD" \
  || fail "TERM finalization: attempt record did not finalize exactly once"
grep -qFx 'answer-outcome=no-answer' "$SIG_RECORD" \
  || fail "TERM finalization: killed attempt did not record no-answer"
run_wrapper work claude -p hi
expect_code 0 "lock is free after a TERM'd run"
ok "signals: a TERM'd work wrapper kills its backend and emits completion trailers"
ok "contract: TERM exits 1 with launch header before completion anchors"

# codex streams its session id in the exec header, and the wrapper logs it as
# soon as it appears — before the run finalizes. A crash before finalization
# (OOM/SIGKILL, which cannot run the fatal-signal trap) then still leaves a
# resumable id in the log. Prove the id is present while the backend is still
# sleeping and no completion anchor has been written yet.
EARLY_LOG="$TMP_ROOT/early-session.log"
EARLY_ANS="$TMP_ROOT/early-session.msg"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 \
  exec bash "$WRAPPER" work codex -p hi -o "$EARLY_ANS") >"$EARLY_LOG" 2>&1 &
EARLY_WRAPPER=$!
n=0
until grep -q '^agent-run: session-id:' "$EARLY_LOG" 2>/dev/null || [ "$n" -ge 200 ]; do
  sleep 0.05
  n=$((n + 1))
done
grep -q '^agent-run: session-id: 12345678-1234-1234-1234-123456789abc' "$EARLY_LOG" \
  || fail "codex early session: session id not logged before finalization ($(cat "$EARLY_LOG"))"
if grep -Eq '^agent-run: (worktree|backend-exit):' "$EARLY_LOG"; then
  fail "codex early session: a completion anchor beat the early session id — not proving early capture ($(cat "$EARLY_LOG"))"
fi
# a crashed run's recovery reads exactly this line; make sure it is retrievable
CRASH_SID="$(sed -n 's/^agent-run: session-id: //p' "$EARLY_LOG" | head -n1)"
[ "$CRASH_SID" = "12345678-1234-1234-1234-123456789abc" ] \
  || fail "codex early session: crash recovery cannot retrieve the id ($CRASH_SID)"
# the early id is logged once, not duplicated when the run later finalizes
kill -TERM "$EARLY_WRAPPER" 2>/dev/null || true
set +e
wait "$EARLY_WRAPPER"
set -e
SID_COUNT="$(grep -c '^agent-run: session-id: 12345678-1234-1234-1234-123456789abc' "$EARLY_LOG")"
[ "$SID_COUNT" = 1 ] || fail "codex early session: session id logged $SID_COUNT times, expected once ($(cat "$EARLY_LOG"))"
EARLY_BACKEND="$(sed -n 's/^agent-run: backend-pid: //p' "$EARLY_LOG" | head -n1)"
if [ -n "$EARLY_BACKEND" ] && kill -0 "$EARLY_BACKEND" 2>/dev/null; then
  kill -9 -- "-$EARLY_BACKEND" 2>/dev/null || kill -9 "$EARLY_BACKEND" 2>/dev/null || true
fi
run_wrapper work claude -p hi
expect_code 0 "lock free after the early-session probe run"
ok "signals: codex logs a resumable session id before finalization, exactly once (crash-recoverable)"

# Escalation must track the backend *tree*: here the backend leader dies on
# TERM but leaves a TERM-ignoring child in its process group holding the
# inherited lock fd. The grace loop has to see the group as still alive and
# escalate to KILL, or the lock stays held by a silent orphan (the ~5s this
# test spends in the grace window is the cost of proving that).
SIGS_LOG="$TMP_ROOT/sig-stubborn.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 AGENT_FAKE_STUBBORN_CHILD=1 AGENT_FAKE_CREATE_INDEX_LOCK=1 \
  exec bash "$WRAPPER" work codex -p hi -o "$TMP_ROOT/sig-stubborn.msg") >"$SIGS_LOG" 2>&1 &
SIGS_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$SIGS_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
kill -TERM "$SIGS_WRAPPER"
wait_wrapper "$SIGS_WRAPPER" "$SIGS_LOG"
expect_code 1 "stubborn-child escalation exit code"
expect_out "agent-run: backend-exit: killed (SIGTERM" "stubborn-child escalation backend-exit trailer"
[ -e "$WORKTREE/.git/index.lock" ] \
  || fail "stubborn-child escalation: wrapper removed a potentially foreign index.lock"
expect_out "no open holder found, likely stale" "stubborn-child stale index.lock attribution"
expect_out "rm -f -- $WORKTREE/.git/index.lock" "stubborn-child stale index.lock recovery"
rm -f "$WORKTREE/.git/index.lock"
run_wrapper work claude -p hi
expect_code 0 "lock is free after KILL escalation reaped the stubborn child"
ok "signals: KILL escalation reports but never unlinks a leftover index.lock"

# A live index.lock held outside the killed backend's process group belongs to
# another Git operation. KILL cleanup must preserve it even though the wrapper
# owns the worktree dispatch lock and the pathname appeared during this run.
FOREIGN_INDEX_LOG="$TMP_ROOT/sig-foreign-index.log"
FOREIGN_INDEX_READY="$TMP_ROOT/sig-foreign-index.ready"
FOREIGN_INDEX_RELEASE="$TMP_ROOT/sig-foreign-index.release"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
  AGENT_FAKE_SKIP_OUTPUT=1 AGENT_FAKE_STUBBORN_CHILD=1 \
  exec bash "$WRAPPER" work codex -p hi -o "$TMP_ROOT/sig-foreign-index.msg") \
  >"$FOREIGN_INDEX_LOG" 2>&1 &
FOREIGN_INDEX_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$FOREIGN_INDEX_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
grep -q '^agent-run: backend-pid:' "$FOREIGN_INDEX_LOG" \
  || fail "foreign index.lock: wrapper never reached the backend ($(cat "$FOREIGN_INDEX_LOG"))"
(
  exec 9>"$WORKTREE/.git/index.lock"
  : >"$FOREIGN_INDEX_READY"
  while [ ! -e "$FOREIGN_INDEX_RELEASE" ]; do sleep 0.02; done
) &
FOREIGN_INDEX_HOLDER=$!
await_ready "$FOREIGN_INDEX_READY" "$FOREIGN_INDEX_HOLDER" \
  "foreign index.lock: unrelated holder never opened the lock" "$FOREIGN_INDEX_LOG"
kill -TERM "$FOREIGN_INDEX_WRAPPER"
wait_wrapper "$FOREIGN_INDEX_WRAPPER" "$FOREIGN_INDEX_LOG"
expect_code 1 "foreign index.lock KILL escalation exit code"
[ -e "$WORKTREE/.git/index.lock" ] \
  || fail "foreign index.lock: KILL cleanup deleted another process's live lock"
expect_out "held by pid $FOREIGN_INDEX_HOLDER" "foreign index.lock holder attribution"
expect_out "do not remove $WORKTREE/.git/index.lock" "foreign index.lock holder warning"
expect_not_out "rm -f -- $WORKTREE/.git/index.lock" "foreign index.lock unsafe recovery recipe"
: >"$FOREIGN_INDEX_RELEASE"
wait "$FOREIGN_INDEX_HOLDER"
rm -f "$WORKTREE/.git/index.lock"
ok "signals: KILL cleanup attributes a live foreign index.lock without a removal recipe"

SIGC_LOG="$TMP_ROOT/sig-consult.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 \
  exec bash "$WRAPPER" consult codex -p hi -o "$TMP_ROOT/sig-consult.msg") >"$SIGC_LOG" 2>&1 &
SIGC_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$SIGC_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
kill -TERM "$SIGC_WRAPPER"
wait_wrapper "$SIGC_WRAPPER" "$SIGC_LOG"
expect_code 1 "TERM'd consult exit code"
expect_out "agent-run: worktree: unchecked (run killed by SIGTERM" "TERM'd consult reports unchecked, not a false clean"
ok "signals: a TERM'd consult reports the drift check as unchecked"

SIGL_LOG="$TMP_ROOT/sig-claude.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 \
  exec bash "$WRAPPER" work claude -p hi -o "$TMP_ROOT/sig-claude.msg") >"$SIGL_LOG" 2>&1 &
SIGL_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$SIGL_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
kill -TERM "$SIGL_WRAPPER"
wait_wrapper "$SIGL_WRAPPER" "$SIGL_LOG"
expect_code 1 "TERM'd claude work exit code"
expect_out "agent-run: backend-exit: killed (SIGTERM" "TERM'd claude work backend-exit trailer"
expect_not_out "agent-run: session-id:" "TERM'd claude has no session id (envelope never arrived)"
expect_out "agent-run: worktree: clean" "TERM'd claude work worktree trailer"
ok "signals: the non-pipeline (claude) spawn path finalizes on TERM too"

# SIGKILL can never run a trap: the log must still hold the dispatched header,
# the orphaned backend keeps the lock (fail-safe against a recovery dispatch
# racing a still-writing delegate), and no completion trailers appear.
SIGK_LOG="$TMP_ROOT/sig-kill.log"
SIGK_ANS="$TMP_ROOT/sig-kill.msg"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 \
  exec bash "$WRAPPER" work codex -p hi -o "$SIGK_ANS") >"$SIGK_LOG" 2>&1 &
SIGK_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$SIGK_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
kill -KILL "$SIGK_WRAPPER"
wait_wrapper "$SIGK_WRAPPER" "$SIGK_LOG"
expect_code 137 "KILL'd wrapper exit code"
expect_out "agent-run: dispatched: work codex wrapper-pid" "KILL'd wrapper leaves the dispatched header"
expect_not_out "agent-run: worktree:" "KILL'd wrapper has no completion trailers"
expect_not_out "agent-run: backend-exit:" "KILL'd wrapper has no backend-exit trailer"
assert_dead_run_contract "SIGKILL orphan contract" "$OUT"
SIGK_BACKEND="$(sed -n 's/^agent-run: backend-pid: //p' "$SIGK_LOG" | head -n1)"
[ -n "$SIGK_BACKEND" ] || fail "KILL'd wrapper: backend-pid missing from the header"
kill -0 "$SIGK_BACKEND" 2>/dev/null || fail "KILL'd wrapper: backend should survive as an orphan (fail-safe lock)"
run_wrapper work claude -p hi
expect_code 3 "orphaned backend still holds the lock"
kill -9 -- "-$SIGK_BACKEND" 2>/dev/null || kill -9 "$SIGK_BACKEND" 2>/dev/null || true
n=0
while kill -0 "$SIGK_BACKEND" 2>/dev/null && [ "$n" -lt 50 ]; do
  sleep 0.1
  n=$((n + 1))
done
run_wrapper work claude -p hi
expect_code 0 "lock frees once the orphan dies"
run_wrapper consult claude -p hi -o "$SIGK_ANS"
expect_code 2 "retry after SIGKILL-unfinalized attempt"
expect_out "unfinalized attempt" "retry after SIGKILL-unfinalized attempt"
expect_not_out "ARG:" "retry after SIGKILL-unfinalized attempt"
# A crashed predecessor is the common unattended dead end, so its rejection must
# name both the cheap way forward and the procedure governing the damaged bundle
# rather than leaving "explicit recovery is required" as the whole instruction.
expect_out "dispatch again with a fresh -o path" "SIGKILL retry rejection offers the fresh-path escape"
expect_out "Explicit Attempt Recovery" "SIGKILL retry rejection names the recovery procedure"
# Derived from the wrapper under test, not the repo layout: the suite also runs
# against a copied wrapper via AGENT_RUN_WRAPPER_UNDER_TEST, and the message is
# supposed to name that copy's own doc.
expect_out "$(realpath -m "$(dirname -- "$WRAPPER")/../references/trailer-contract.md")" \
  "SIGKILL retry rejection resolves the recovery doc to an absolute path"
expect_out "never hand-edit or delete records" "SIGKILL retry rejection forbids hand-editing"
ok "signals: SIGKILL leaves the header + a lock-holding orphan, and no false trailers"
ok "attempts: a SIGKILL-unfinalized predecessor stays non-retryable after its orphan dies"
ok "contract: SIGKILL-orphan leaves launch headers without completion anchors"

# A TERM that lands in the codex pid-capture window (the backend pipeline is up
# and its pid file is written, but BACKEND_PID has not been read yet) must still
# propagate: the fatal-signal path recovers the pid from the file and kills the
# backend, rather than emitting a "killed" trailer while the backend survives as
# a lock-holding orphan. This also guards the launch->phase ordering: BACKEND_PHASE
# must be set to `running` *before* the pipeline is backgrounded, so a signal in
# this window sees `running` (and recovers the pid) instead of the `pre` branch's
# "no backend dispatched yet" — the widened delay sits immediately after the
# launch, so a phase assignment that regressed to after the launch would fall
# inside it and flip this assertion. AGENT_RUN_TEST_PID_CAPTURE_DELAY widens the
# window so the race is deterministic; the fake codex prints its `session id:`
# header (through tee) as soon as it execs — i.e. after the pid file is written —
# so the window is entered once that line reaches the log but `backend-pid:` has
# not.
SIGW_LOG="$TMP_ROOT/sig-window.log"
SIGW_ANS="$TMP_ROOT/sig-window.msg"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 AGENT_RUN_TEST_PID_CAPTURE_DELAY=3 \
  exec bash "$WRAPPER" work codex -p hi -o "$SIGW_ANS") >"$SIGW_LOG" 2>&1 &
SIGW_WRAPPER=$!
n=0
until grep -q '^session id:' "$SIGW_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
grep -q '^session id:' "$SIGW_LOG" || fail "capture-window race: backend never exec'd ($(cat "$SIGW_LOG"))"
grep -q '^agent-run: backend-pid:' "$SIGW_LOG" \
  && fail "capture-window race: pid was already captured before TERM — window not exercised ($(cat "$SIGW_LOG"))"
kill -TERM "$SIGW_WRAPPER"
wait_wrapper "$SIGW_WRAPPER" "$SIGW_LOG"
expect_code 1 "capture-window race exit code"
expect_out "agent-run: backend-exit: killed (SIGTERM, propagated to backend pid" \
  "capture-window race: TERM in the pid-capture window still propagates to the recovered backend"
expect_not_out "no backend dispatched yet" \
  "capture-window race: a live backend must never be reported as never-dispatched (phase set before launch)"
SIGW_BACKEND="$(sed -n 's/^agent-run: backend-exit: killed (SIGTERM, propagated to backend pid \([0-9]*\).*/\1/p' "$SIGW_LOG" | head -n1)"
[ -n "$SIGW_BACKEND" ] || fail "capture-window race: propagated trailer named no backend pid ($OUT)"
if kill -0 "$SIGW_BACKEND" 2>/dev/null; then
  kill -9 -- "-$SIGW_BACKEND" 2>/dev/null || kill -9 "$SIGW_BACKEND" 2>/dev/null || true
  fail "capture-window race: backend survived the propagated signal"
fi
[ ! -s "$SIGW_ANS" ] || fail "capture-window race: a killed run must not report an answer"
run_wrapper work claude -p hi
expect_code 0 "lock is free after a TERM in the capture window"
ok "signals: a TERM racing the codex pid-capture window recovers the pid and kills the backend"

# The codex launch records the backend pid with `printf ... >pidfile && exec`,
# so an empty pid file can only mean the printf failed and exec never ran — i.e.
# no backend was started. AGENT_RUN_TEST_PID_WRITE_FAIL points that write at an
# unwritable path to force exactly that launch abort. The finalize path must
# settle the pipeline, see the empty file, and report `backend-pid: none` (no
# backend to orphan) instead of an `unknown` pid that might mask a lock-holding
# orphan. The run fails for want of an answer, but leaves nothing behind: the
# next work run takes the lock immediately.
ABORT_LOG="$TMP_ROOT/pid-abort.log"
ABORT_ANS="$TMP_ROOT/pid-abort.msg"
run_wrapper_env AGENT_RUN_TEST_PID_WRITE_FAIL=1 -- work codex -p hi -o "$ABORT_ANS"
: >"$ABORT_LOG" # ABORT_LOG reserved for symmetry with the other kill-window logs
expect_code 1 "pid-write abort exits 1 (no answer landed)"
expect_out "agent-run: backend-pid: none (launch aborted before exec" "pid-write abort names no backend pid"
expect_not_out "backend-pid: unknown" "pid-write abort must not report an unknown pid"
expect_not_out "may be orphaned" "pid-write abort must not warn of an orphan (none was launched)"
assert_finalized_contract "pid-write abort contract" "$OUT"
[ ! -s "$ABORT_ANS" ] || fail "pid-write abort: a run that never launched a backend must not report an answer"
run_wrapper work claude -p hi
expect_code 0 "lock is free after a launch that aborted before exec"

run_wrapper_env AGENT_RUN_TEST_PID_WRITE_FAIL=1 -- review codex -- --commit abc123
expect_code 1 "pid-write abort review exits 1 (launch aborted before exec)"
expect_out "agent-run: backend-pid: none (launch aborted before exec" "pid-write abort review names no backend pid"
expect_not_out "backend-pid: unknown" "pid-write abort review must not report an unknown pid"
expect_not_out "may be orphaned" "pid-write abort review must not warn of an orphan (none was launched)"
assert_finalized_contract "pid-write abort review contract" "$OUT"
run_wrapper work claude -p hi
expect_code 0 "lock is free after a review launch that aborted before exec"
ok "signals: a codex launch that aborts before exec reports no backend and orphans nothing"

# The shared launcher precreates its capture before dispatch so pid-write
# failures still have a readable parser input. If that precreation itself
# fails, the run must finalize as a launch abort instead of dying under
# errexit after the dispatch header and leaving an active attempt record.
for backend in claude cursor copilot; do
  capture_abort_answer="$TMP_ROOT/capture-abort-$backend.msg"
  capture_abort_args=(work "$backend" -p hi -o "$capture_abort_answer")
  if [ "$backend" = copilot ]; then capture_abort_args+=(-m m); fi
  run_wrapper_env AGENT_RUN_TEST_CAPTURE_PRECREATE_FAIL=1 -- "${capture_abort_args[@]}"
  expect_code 1 "$backend capture-precreation abort exits 1"
  expect_out "agent-run: backend-pid: none (launch aborted before exec" \
    "$backend capture-precreation abort names no backend pid"
  expect_not_out "may be orphaned" \
    "$backend capture-precreation abort must not warn of an orphan"
  expect_not_out "agent-run: answer:" \
    "$backend capture-precreation abort must not report an answer"
  assert_finalized_contract "$backend capture-precreation abort contract" "$OUT"
  [ ! -s "$capture_abort_answer" ] \
    || fail "$backend capture-precreation abort: a run that never launched a backend must not report an answer"
done
run_wrapper work claude -p hi
expect_code 0 "lock is free after shared capture precreation aborts"
ok "signals: shared capture precreation failures finalize without launching a backend"

# The shared non-pipeline launcher uses the same `printf ... >pidfile && exec`
# handshake as codex. A failed pid write must therefore report that no backend
# started for claude, cursor, and copilot too, rather than naming the short-lived
# launch subshell as though it exec'd the backend.
for backend in claude cursor copilot; do
  shared_abort_answer="$TMP_ROOT/shared-abort-$backend.msg"
  shared_abort_args=(work "$backend" -p hi -o "$shared_abort_answer")
  if [ "$backend" = copilot ]; then shared_abort_args+=(-m m); fi
  run_wrapper_env AGENT_RUN_TEST_PID_WRITE_FAIL=1 -- "${shared_abort_args[@]}"
  expect_code 1 "$backend shared-launch pid-write abort exits 1"
  expect_out "agent-run: backend-pid: none (launch aborted before exec" \
    "$backend shared-launch pid-write abort names no backend pid"
  if grep -Eq '^agent-run: backend-pid: [0-9]+$' <<<"$OUT"; then
    fail "$backend shared-launch pid-write abort reported a launch subshell as the backend ($OUT)"
  fi
  expect_not_out "may be orphaned" \
    "$backend shared-launch pid-write abort must not warn of an orphan"
  expect_not_out "agent-run: answer:" \
    "$backend shared-launch pid-write abort must not report an answer"
  assert_finalized_contract "$backend shared-launch pid-write abort contract" "$OUT"
  [ ! -s "$shared_abort_answer" ] \
    || fail "$backend shared-launch pid-write abort: a run that never launched a backend must not report an answer"
done
run_wrapper work claude -p hi
expect_code 0 "lock is free after shared launches abort before exec"
ok "signals: shared launches that abort before exec report no backend and orphan nothing"

# A backend that exits 0 but leaves a background child running in its process
# group (a delegate that backgrounded a long command and ended its turn) must
# not finalize as an unqualified clean success: the wrapper flags a distinct
# `backend-exit: orphaned-children` anchor and exits 1 so a trailer-reading
# caller learns the "success" is unreliable.
if command -v setsid >/dev/null 2>&1; then
  run_wrapper_env AGENT_FAKE_ORPHAN_CHILD=1 -- work claude -p hi
  expect_code 1 "orphaned-children exit code"
  expect_out "agent-run: backend-exit: orphaned-children" "orphaned-children distinct trailer"
  expect_out "die at end-of-turn" "orphaned-children trailer explains the lifetime"
  assert_finalized_contract "orphaned-children contract" "$OUT"
  # The wrapper must not merely flag the orphan: it TERMs the reaped backend
  # group so "die at end-of-turn" is true. Pin that production kill path — the
  # backgrounded child's group is gone once the wrapper has exited (no manual
  # kill here). A short grace covers the TERM delivery after the wrapper returns.
  OC_BACKEND="$(sed -n 's/^agent-run: backend-pid: //p' <<<"$OUT" | head -n1)"
  if [ -n "$OC_BACKEND" ]; then
    OC_N=0
    while [ "$OC_N" -lt 20 ] && kill -0 -- "-$OC_BACKEND" 2>/dev/null; do
      sleep 0.05
      OC_N=$((OC_N + 1))
    done
    kill -0 -- "-$OC_BACKEND" 2>/dev/null \
      && fail "orphaned-children: wrapper left the backend group alive (production TERM did not fire)"
    # belt-and-suspenders reap in case a future regression leaves it running
    kill -9 -- "-$OC_BACKEND" 2>/dev/null || true
  fi
  run_wrapper work claude -p hi
  expect_code 0 "clean run after orphaned-children run"
  ok "signals: a backend exiting 0 with a live background child fails with a distinct orphaned-children trailer and TERMs the abandoned group"

  # A read-only consult cannot leave mutating work behind, and some backends
  # (cursor's worker-server daemons) linger in the backend group on an otherwise
  # clean consult. So the same orphan on a consult reaps the group but stays a
  # success: a distinct warning trailer, no backend-exit: failure anchor, and
  # exit 0 (the worktree: anchor finalizes; the answer still landed).
  run_wrapper_env AGENT_FAKE_ORPHAN_CHILD=1 -- consult claude -p hi
  expect_code 0 "consult orphaned-children stays a success"
  expect_out "agent-run: orphaned-children-reaped: consult" "consult orphan reap warning trailer"
  expect_not_out "agent-run: backend-exit: orphaned-children" "consult orphan is not a backend-exit failure"
  expect_out "fake claude answer" "consult orphan still landed an answer"
  assert_finalized_contract "consult orphaned-children contract" "$OUT"
  # The consult must still TERM the reaped group so the lingering child dies.
  OC_C_BACKEND="$(sed -n 's/^agent-run: backend-pid: //p' <<<"$OUT" | head -n1)"
  if [ -n "$OC_C_BACKEND" ]; then
    OC_C_N=0
    while [ "$OC_C_N" -lt 20 ] && kill -0 -- "-$OC_C_BACKEND" 2>/dev/null; do
      sleep 0.05
      OC_C_N=$((OC_C_N + 1))
    done
    kill -0 -- "-$OC_C_BACKEND" 2>/dev/null \
      && fail "consult orphaned-children: wrapper left the backend group alive (production TERM did not fire)"
    kill -9 -- "-$OC_C_BACKEND" 2>/dev/null || true
  fi
  ok "signals: a consult backend exiting 0 with a live background child reaps the group and stays a success (no failure anchor)"
else
  ok "skipped orphaned-children check (setsid unavailable)"
fi

# --- agent-wait.sh -----------------------------------------------------------------------
# Bounded wait helper: semantic exit codes over a dispatch log, status-only
# output. The synthetic logs pin the waiter's parsing contract; the real-run
# case guards against trailer-format drift between wrapper and waiter.

run_waiter() {
  set +e
  OUT="$(bash "$WAITER" "$@" 2>&1)"
  CODE=$?
  set -e
}

WAIT_DIR="$TMP_ROOT/agent-wait"
mkdir -p "$WAIT_DIR"

# A pid that is guaranteed dead: spawn and reap it.
sleep 0 &
DEAD_PID=$!
wait "$DEAD_PID" 2>/dev/null || true

run_waiter
expect_code 2 "waiter no args"
run_waiter "$WAIT_DIR/absent.log"
expect_code 2 "waiter missing log"
run_waiter "$WAIT_DIR/absent.log" --interval 0
expect_code 2 "waiter zero interval"
ok "agent-wait: usage errors exit 2"

cat >"$WAIT_DIR/finalized.log" <<EOF
agent-run: attempt: attempt.synthetic record $WAIT_DIR/attempt.synthetic/record
agent-run: transcript: $WAIT_DIR/transcript.md (caller-owned)
agent-run: dispatched: consult codex wrapper-pid $DEAD_PID answer $WAIT_DIR/finalized.msg
agent-run: backend-pid: $DEAD_PID
backend log noise that must never be echoed
agent-run: backend-exit: 0
agent-run: session-id: 12345678-1234-1234-1234-123456789abc
agent-run: worktree: best-effort-clean
EOF
run_waiter "$WAIT_DIR/finalized.log"
expect_code 0 "waiter finalized"
expect_out "agent-wait: finalized" "waiter finalized"
expect_out "agent-run: attempt: attempt.synthetic record $WAIT_DIR/attempt.synthetic/record" "waiter finalized attempt summary"
expect_out "agent-run: transcript: $WAIT_DIR/transcript.md (caller-owned)" "waiter finalized transcript summary"
expect_out "agent-run: worktree: best-effort-clean" "waiter finalized summary"
expect_not_out "noise" "waiter finalized log body"
ok "agent-wait: finalized run exits 0 with status-only trailers, no log body"

sleep 30 &
LIVE_WRAPPER=$!
printf 'agent-run: dispatched: work codex wrapper-pid %s answer %s/live.msg\n' "$LIVE_WRAPPER" "$WAIT_DIR" >"$WAIT_DIR/live.log"
run_waiter "$WAIT_DIR/live.log" --timeout 0
expect_code 10 "waiter running"
expect_out "agent-wait: running" "waiter running"
ok "agent-wait: header-only log with a live wrapper is running, not finalized (bare-header footgun)"

printf 'landed\n' >"$WAIT_DIR/live.msg"
run_waiter "$WAIT_DIR/live.log" --timeout 0
expect_code 0 "waiter answer-landed"
expect_out "agent-wait: answer-landed" "waiter answer-landed"
ok "agent-wait: a non-empty answer file (parsed from the header) decides the run"

run_waiter "$WAIT_DIR/live.log" --timeout 0 --finalized-only
expect_code 10 "waiter finalized-only"
expect_out "agent-wait: running" "waiter finalized-only"
ok "agent-wait: --finalized-only ignores the landed answer until the trailers arrive"
kill "$LIVE_WRAPPER" 2>/dev/null || true

WAIT_FINALIZE_LOG="$WAIT_DIR/backend-exit-before-finalize.log"
WAIT_FINALIZE_ANS="$TMP_ROOT/agent-wait-before-finalize.msg"
WAIT_FINALIZE_READY="$WAIT_DIR/backend-exit-before-finalize.ready"
WAIT_FINALIZE_RELEASE="$WAIT_DIR/backend-exit-before-finalize.release"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EXIT=7 \
  AGENT_RUN_TEST_RECORD_FINALIZE_READY="$WAIT_FINALIZE_READY" \
  AGENT_RUN_TEST_RECORD_FINALIZE_RELEASE="$WAIT_FINALIZE_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$WAIT_FINALIZE_ANS") >"$WAIT_FINALIZE_LOG" 2>&1 &
WAIT_FINALIZE_WRAPPER=$!
await_ready "$WAIT_FINALIZE_READY" "$WAIT_FINALIZE_WRAPPER" "waiter backend-exit window: wrapper never paused before attempt finalization" "$WAIT_FINALIZE_LOG"
grep -qFx 'state=active' "$(attempt_record_path "$WAIT_FINALIZE_ANS")" \
  || fail "waiter backend-exit window: attempt was not active during the regression window"
[ ! -s "$WAIT_FINALIZE_ANS" ] \
  || fail "waiter backend-exit window: -o was already published during the regression window"
if grep -qE '^agent-run: (worktree|backend-exit):' "$WAIT_FINALIZE_LOG"; then
  fail "waiter backend-exit window: a completion anchor preceded publication and finalization ($(cat "$WAIT_FINALIZE_LOG"))"
fi
run_waiter "$WAIT_FINALIZE_LOG" --timeout 0
expect_code 10 "waiter default mode before finalization"
expect_out "agent-wait: running" "waiter default mode before finalization"
run_waiter "$WAIT_FINALIZE_LOG" --timeout 0 --finalized-only
expect_code 10 "waiter backend-exit before finalization"
expect_out "agent-wait: running" "waiter backend-exit before finalization"
: >"$WAIT_FINALIZE_RELEASE"
set +e
wait "$WAIT_FINALIZE_WRAPPER"
WAIT_FINALIZE_CODE=$?
set -e
[ "$WAIT_FINALIZE_CODE" -eq 1 ] \
  || fail "waiter backend-exit window: wrapper exited $WAIT_FINALIZE_CODE instead of 1"
grep -q '^agent-run: backend-exit: 7$' "$WAIT_FINALIZE_LOG" \
  || fail "waiter backend-exit window: backend trailer was never emitted after finalization"
run_waiter "$WAIT_FINALIZE_LOG" --timeout 0 --finalized-only
expect_code 0 "waiter after backend failure finalization"
expect_out "agent-wait: finalized" "waiter after backend failure finalization"
run_waiter "$WAIT_FINALIZE_LOG" --timeout 0
expect_code 0 "waiter default mode after backend failure finalization"
expect_out "agent-wait: finalized" "waiter default mode after backend failure finalization"
grep -qFx 'state=finalized' "$(attempt_record_path "$WAIT_FINALIZE_ANS")" \
  || fail "waiter backend-exit window: attempt did not finalize after release"
ok "agent-wait: neither waiter mode decides a failed backend before -o publication and attempt finalization"

WAIT_SIGNAL_LOG="$WAIT_DIR/signal-before-finalize.log"
WAIT_SIGNAL_ANS="$TMP_ROOT/agent-wait-signal-before-finalize.msg"
WAIT_SIGNAL_READY="$WAIT_DIR/signal-before-finalize.ready"
WAIT_SIGNAL_RELEASE="$WAIT_DIR/signal-before-finalize.release"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 \
  AGENT_RUN_TEST_RECORD_FINALIZE_READY="$WAIT_SIGNAL_READY" \
  AGENT_RUN_TEST_RECORD_FINALIZE_RELEASE="$WAIT_SIGNAL_RELEASE" \
  exec bash "$WRAPPER" consult claude -p hi -o "$WAIT_SIGNAL_ANS") >"$WAIT_SIGNAL_LOG" 2>&1 &
WAIT_SIGNAL_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$WAIT_SIGNAL_LOG" 2>/dev/null \
  || ! kill -0 "$WAIT_SIGNAL_WRAPPER" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.05
  n=$((n + 1))
done
grep -q '^agent-run: backend-pid:' "$WAIT_SIGNAL_LOG" \
  || fail "waiter signal window: wrapper never reached the backend ($(cat "$WAIT_SIGNAL_LOG"))"
kill -TERM "$WAIT_SIGNAL_WRAPPER"
await_ready "$WAIT_SIGNAL_READY" "$WAIT_SIGNAL_WRAPPER" "waiter signal window: wrapper never paused before attempt finalization" "$WAIT_SIGNAL_LOG" 200
grep -qFx 'state=active' "$(attempt_record_path "$WAIT_SIGNAL_ANS")" \
  || fail "waiter signal window: attempt was not active during the regression window"
[ ! -s "$WAIT_SIGNAL_ANS" ] \
  || fail "waiter signal window: -o was already published during the regression window"
if grep -qE '^agent-run: (worktree|backend-exit):' "$WAIT_SIGNAL_LOG"; then
  fail "waiter signal window: a completion anchor preceded publication and finalization ($(cat "$WAIT_SIGNAL_LOG"))"
fi
run_waiter "$WAIT_SIGNAL_LOG" --timeout 0
expect_code 10 "waiter default mode before signal finalization"
expect_out "agent-wait: running" "waiter default mode before signal finalization"
run_waiter "$WAIT_SIGNAL_LOG" --timeout 0 --finalized-only
expect_code 10 "waiter signal backend-exit before finalization"
expect_out "agent-wait: running" "waiter signal backend-exit before finalization"
: >"$WAIT_SIGNAL_RELEASE"
set +e
wait "$WAIT_SIGNAL_WRAPPER"
WAIT_SIGNAL_CODE=$?
set -e
[ "$WAIT_SIGNAL_CODE" -eq 1 ] \
  || fail "waiter signal window: wrapper exited $WAIT_SIGNAL_CODE instead of 1"
grep -q '^agent-run: backend-exit: killed (SIGTERM' "$WAIT_SIGNAL_LOG" \
  || fail "waiter signal window: signal trailer was never emitted after finalization"
run_waiter "$WAIT_SIGNAL_LOG" --timeout 0 --finalized-only
expect_code 0 "waiter after signal finalization"
run_waiter "$WAIT_SIGNAL_LOG" --timeout 0
expect_code 0 "waiter default mode after signal finalization"
grep -qFx 'state=finalized' "$(attempt_record_path "$WAIT_SIGNAL_ANS")" \
  || fail "waiter signal window: attempt did not finalize after release"
ok "agent-wait: neither waiter mode decides a fatal-signal abort before attempt finalization finishes"

# A work backend may finish, commit, and produce no answer. Kill the wrapper
# after its no-answer record is durable but before `worktree:` is emitted: the
# finalized record makes the output path reusable, but dispatch/backend
# evidence means the mission itself must not be classified as a retryable
# pre-dispatch abort.
WAIT_POST_DISPATCH_LOG="$WAIT_DIR/finalized-no-answer-after-dispatch.log"
WAIT_POST_DISPATCH_ANS="$TMP_ROOT/agent-wait-finalized-no-answer-after-dispatch.msg"
WAIT_POST_DISPATCH_READY="$WAIT_DIR/finalized-no-answer-after-dispatch.ready"
WAIT_POST_DISPATCH_RELEASE="$WAIT_DIR/finalized-no-answer-after-dispatch.release"
WAIT_POST_DISPATCH_BASE="$(git -C "$WORKTREE" rev-parse HEAD)"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" \
  AGENT_FAKE_COMMIT=1 AGENT_FAKE_NO_ENVELOPE=1 \
  AGENT_RUN_TEST_RECORD_FINALIZED_READY="$WAIT_POST_DISPATCH_READY" \
  AGENT_RUN_TEST_RECORD_FINALIZED_RELEASE="$WAIT_POST_DISPATCH_RELEASE" \
  exec bash "$WRAPPER" work claude -p hi -o "$WAIT_POST_DISPATCH_ANS") \
  >"$WAIT_POST_DISPATCH_LOG" 2>&1 &
WAIT_POST_DISPATCH_WRAPPER=$!
await_ready "$WAIT_POST_DISPATCH_READY" "$WAIT_POST_DISPATCH_WRAPPER" \
  "waiter post-dispatch no-answer window: wrapper never paused after record finalization" \
  "$WAIT_POST_DISPATCH_LOG" 200
grep -q '^agent-run: dispatched: work claude ' "$WAIT_POST_DISPATCH_LOG" \
  || fail "waiter post-dispatch no-answer window: dispatch evidence missing"
grep -q '^agent-run: backend-pid: ' "$WAIT_POST_DISPATCH_LOG" \
  || fail "waiter post-dispatch no-answer window: backend launch evidence missing"
grep -qFx 'state=finalized' "$(attempt_record_path "$WAIT_POST_DISPATCH_ANS")" \
  || fail "waiter post-dispatch no-answer window: attempt was not finalized"
grep -qFx 'answer-outcome=no-answer' "$(attempt_record_path "$WAIT_POST_DISPATCH_ANS")" \
  || fail "waiter post-dispatch no-answer window: attempt was not no-answer"
[ "$(git -C "$WORKTREE" rev-parse HEAD)" != "$WAIT_POST_DISPATCH_BASE" ] \
  || fail "waiter post-dispatch no-answer window: backend did not commit before wrapper death"
kill -KILL "$WAIT_POST_DISPATCH_WRAPPER"
set +e
wait "$WAIT_POST_DISPATCH_WRAPPER" 2>/dev/null
set -e
run_waiter "$WAIT_POST_DISPATCH_LOG" --timeout 0
expect_code 20 "waiter finalized no-answer after dispatch"
expect_out "post-dispatch-incomplete" "waiter finalized no-answer after dispatch"
git -C "$WORKTREE" reset -q --hard "$WAIT_POST_DISPATCH_BASE"
ok "agent-wait: finalized no-answer after backend dispatch requires worktree inspection, not mission retry"

# The same finalized-no-answer fact must not outrank backend evidence elsewhere
# in the table: a live launched backend is still exit 21, and an explicit
# launch-aborted `backend-pid: none` remains an incomplete post-dispatch run
# rather than being relabeled pre-dispatch.
WAIT_FINALIZED_LIVE_OUT="$WAIT_DIR/finalized-no-answer-live.msg"
write_test_attempt_record "$WAIT_FINALIZED_LIVE_OUT" attempt.wait-live finalized success no-answer 1
WAIT_FINALIZED_LIVE_RECORD="$(attempt_record_path "$WAIT_FINALIZED_LIVE_OUT")"
sleep 30 &
WAIT_FINALIZED_LIVE_BACKEND=$!
cat >"$WAIT_DIR/finalized-no-answer-live.log" <<EOF
agent-run: attempt: attempt.wait-live record $WAIT_FINALIZED_LIVE_RECORD wrapper-pid $DEAD_PID
agent-run: dispatched: work codex wrapper-pid $DEAD_PID answer $WAIT_FINALIZED_LIVE_OUT
agent-run: backend-pid: $WAIT_FINALIZED_LIVE_BACKEND
EOF
run_waiter "$WAIT_DIR/finalized-no-answer-live.log" --timeout 0
expect_code 21 "waiter finalized no-answer with live backend"
expect_out "backend=alive" "waiter finalized no-answer with live backend"
kill "$WAIT_FINALIZED_LIVE_BACKEND" 2>/dev/null || true

WAIT_FINALIZED_NONE_OUT="$WAIT_DIR/finalized-no-answer-launch-abort.msg"
write_test_attempt_record "$WAIT_FINALIZED_NONE_OUT" attempt.wait-none finalized no-launch no-answer 1
WAIT_FINALIZED_NONE_RECORD="$(attempt_record_path "$WAIT_FINALIZED_NONE_OUT")"
cat >"$WAIT_DIR/finalized-no-answer-launch-abort.log" <<EOF
agent-run: attempt: attempt.wait-none record $WAIT_FINALIZED_NONE_RECORD wrapper-pid $DEAD_PID
agent-run: dispatched: work codex wrapper-pid $DEAD_PID answer $WAIT_FINALIZED_NONE_OUT
agent-run: backend-pid: none (launch aborted before exec; no backend started)
EOF
run_waiter "$WAIT_DIR/finalized-no-answer-launch-abort.log" --timeout 0
expect_code 20 "waiter finalized no-answer after launch abort"
expect_out "post-dispatch-incomplete" "waiter finalized no-answer after launch abort"
ok "agent-wait: finalized no-answer never overrides live or explicit launch-phase evidence"

printf 'agent-run: dispatched: work codex wrapper-pid %s\nagent-run: backend-pid: %s\n' "$DEAD_PID" "$DEAD_PID" >"$WAIT_DIR/dead.log"
run_waiter "$WAIT_DIR/dead.log"
expect_code 20 "waiter dead-run"
expect_out "agent-wait: dead-run" "waiter dead-run"
expect_out "backend=dead" "waiter dead-run"
ok "agent-wait: dead wrapper without completion trailers is the dead-run signature (exit 20)"

sleep 30 &
ORPHAN_BACKEND=$!
printf 'agent-run: dispatched: work codex wrapper-pid %s\nagent-run: backend-pid: %s\n' "$DEAD_PID" "$ORPHAN_BACKEND" >"$WAIT_DIR/orphan.log"
run_waiter "$WAIT_DIR/orphan.log"
expect_code 21 "waiter orphan"
expect_out "backend=alive" "waiter orphan"
ok "agent-wait: dead wrapper with a live backend reports the lock-holding orphan (exit 21)"
kill "$ORPHAN_BACKEND" 2>/dev/null || true

REAL_WAIT_LOG="$WAIT_DIR/real.log"
REAL_WAIT_ANS="$TMP_ROOT/agent-wait-real.msg"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" consult claude -p hi -o "$REAL_WAIT_ANS") >"$REAL_WAIT_LOG" 2>&1 || true
run_waiter "$REAL_WAIT_LOG"
expect_code 0 "waiter real run"
expect_out "agent-wait: finalized" "waiter real run"
expect_out "agent-run: worktree:" "waiter real run summary"
ok "agent-wait: a real wrapper log finalizes (trailer formats in sync)"

# --- SKILL.md and target metadata behavior ----------------------------------------------

[ -f "$CONTRACT_DOC" ] || fail "contract doc: missing $CONTRACT_DOC"
contract_requires 'Completion is anchored only by:' "missing completion-anchor rule"
expect_contract_required_record attempt '`consult`/`work`'
expect_contract_required_record transcript 'Copilot `consult`/`work`'
contract_requires '## Attempt Bundle and Retry Contract' "missing attempt bundle lifecycle"
contract_requires 'transcript-identity' "attempt bundle layout omits caller transcript identity"
contract_requires 'Only `finalized` + `no-answer`' "missing finalized no-answer retry rule"
contract_requires '## Explicit Attempt Recovery' "missing explicit recovery workflow"
contract_requires '`finalizing` with both public content and `answer.tmp`' \
  "missing publication-collision reconciliation"
contract_requires 'Malformed/incomplete lineage or malformed/ambiguous record' \
  "missing malformed/provenance recovery"
contract_requires 'ignored `bundle.key` and a syntactically valid ignored `record-seal=` line' \
  "missing legacy seal compatibility policy"
if grep -Eq 'record authentication|record seals|reseal records|sealed by|sha256sum|/dev/urandom|`od`|`bundle.key`,' "$CONTRACT_DOC"; then
  fail "contract doc: obsolete seal machinery remains documented"
fi
contract_requires 'Caller-owned Copilot `--share` artifacts are' \
  "recovery does not preserve caller-owned shares"
contract_requires 'Auto-generated output cleanup unlinks the retired path only when' \
  "retired-path auto cleanup is not documented"
contract_requires 'Only post-launch artifact-sync and lock-identity failures emit a `backend-exit: wrapper-failure (...)` completion anchor' \
  "exit-1 row overstates the wrapper-failure completion anchor"
for record in branch backend-exit answer session-id cost-usd head drift-status drift; do
  expect_contract_optional_record "$record"
done
grep -qF 'references/trailer-contract.md' "$WRAPPER" \
  || fail "contract doc: wrapper header does not point at references/trailer-contract.md"
grep -qF '[references/trailer-contract.md](references/trailer-contract.md)' "$REPO_ROOT/.claude/skills/agent-cli/SKILL.md" \
  || fail "contract doc: SKILL.md does not link references/trailer-contract.md"
grep -qF 'Nested delegated runs deliberately cannot inherit that authority.' "$WRAPPER" \
  || fail "test hook contract: nested delegated runs are not documented as intentionally scrubbed"
ok "contract: launch/finalize records and the attempt retry lifecycle are documented and linked"

CLAUDE_SKILL="$REPO_ROOT/.claude/skills/agent-cli/SKILL.md"
CODEX_SKILL="$REPO_ROOT/.codex/skills/agent-cli/SKILL.md"
[ -f "$CLAUDE_SKILL" ] || fail "skill guidance: missing $CLAUDE_SKILL"
[ -f "$CODEX_SKILL" ] || fail "skill guidance: missing $CODEX_SKILL"

for f in \
  "$CLAUDE_SKILL" \
  "$CODEX_SKILL" \
  "$REPO_ROOT/.claude/skills/agent-cli/references/copilot.md" \
  "$REPO_ROOT/.codex/skills/agent-cli/references/copilot.md" \
  "$REPO_ROOT/.codex/skills/agent-cli/agents/openai.yaml"; do
  grep -qF 'gemini-3.6-flash' "$f" \
    || fail "model recommendation: $f does not recommend gemini-3.6-flash"
  if grep -qF 'gemini-3.5-flash' "$f"; then
    fail "model recommendation: $f still recommends superseded gemini-3.5-flash"
  fi
done
ok "agent-cli recommends Gemini 3.6 Flash across skill guidance and UI metadata"

# Each block carries its own harness's caveats and not the other's: the Codex
# polling pattern lives only in the codex tree; the Claude-workflow/idle lore
# lives only in the claude tree.
grep -q '### Codex polling pattern' "$CODEX_SKILL" \
  || fail "mirror: codex tree is missing its Codex polling pattern (codex-only caveat)"
if grep -q '### Codex polling pattern' "$CLAUDE_SKILL"; then
  fail "mirror: claude tree must not carry the Codex polling pattern (codex-only caveat leaked across trees)"
fi
grep -q 'idle enforcer' "$CLAUDE_SKILL" \
  || fail "mirror: claude tree is missing its Claude Code workflow/idle caveats (claude-only)"
if grep -q 'idle enforcer' "$CODEX_SKILL"; then
  fail "mirror: codex tree must not carry Claude Code workflow/idle lore (claude-only caveat leaked across trees)"
fi
ok "agent-cli SKILL.md: each tree carries only its own harness's caveats"

[ ! -e "$REPO_ROOT/.codex/skills/agent-cli/scripts/agent-run.sh" ] \
  || fail "mirror: .codex must not carry agent-run.sh; its openai.yaml dispatches through the .claude wrapper path"
ok "agent-cli .codex skill has no dispatch wrapper mirror"

# The reference files are byte-copies across trees. Only SKILL.md diverges (its
# per-harness caveats are asserted above), so every reference must compare
# equal — otherwise a contract edit lands in one tree and the other tree keeps
# serving the superseded text to its readers.
for f in claude-workflows claude codex copilot cursor portability trailer-contract; do
  CLAUDE_REF="$REPO_ROOT/.claude/skills/agent-cli/references/$f.md"
  CODEX_REF="$REPO_ROOT/.codex/skills/agent-cli/references/$f.md"
  [ -f "$CLAUDE_REF" ] || fail "mirror: missing $CLAUDE_REF"
  [ -f "$CODEX_REF" ] || fail "mirror: missing $CODEX_REF"
  cmp -s "$CLAUDE_REF" "$CODEX_REF" \
    || fail "mirror: references/$f.md differs between the .claude and .codex trees"
done
ok "agent-cli reference files are byte-identical across the .claude and .codex trees"

printf '\nall %d skill dispatch wrapper checks passed\n' "$PASS"

#!/usr/bin/env bash
# smoke-order: 460
# smoke-subjects: .claude/skills/agent-cli/scripts/agent-run.sh
# smoke-subjects: .claude/skills/agent-cli/scripts/agent-wait.sh
# smoke-subjects: .claude/skills/agent-cli/SKILL.md
# smoke-subjects: .claude/skills/agent-cli/references/claude.md
# smoke-subjects: .claude/skills/agent-cli/references/codex.md
# smoke-subjects: .claude/skills/agent-cli/references/copilot.md
# smoke-subjects: .claude/skills/agent-cli/references/trailer-contract.md
# smoke-subjects: .codex/skills/agent-cli/SKILL.md
# smoke-subjects: .codex/skills/agent-cli/references/claude.md
# smoke-subjects: .codex/skills/agent-cli/references/codex.md
# smoke-subjects: .codex/skills/agent-cli/references/copilot.md
# smoke-subjects: .codex/skills/agent-cli/references/trailer-contract.md
# smoke-subjects: scripts/tests/test-skill-dispatch-wrappers.sh
# Pure-shell tests for the unified agent dispatch wrapper behind the agent-cli
# skill (agent-run.sh), plus the .claude -> .codex mirror invariants for the
# skill's SKILL.md and reference docs.
#
# The wrapper runs its CLI binary as a child, so the tests run it against fake
# `claude`/`codex`/`copilot` executables on PATH that print their argv and the
# permission-relevant environment, inside a throwaway git repo so the
# per-worktree lock path and the consult drift check resolve somewhere
# disposable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER="$REPO_ROOT/.claude/skills/agent-cli/scripts/agent-run.sh"
CONTRACT_DOC="$REPO_ROOT/.claude/skills/agent-cli/references/trailer-contract.md"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
# The wrapper auto-generates -o under $TMPDIR when omitted; point it into the
# throwaway root so every generated answer file is cleaned up with the tests.
export TMPDIR="$TMP_ROOT"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"

# Fake claude: echoes argv, optionally dirties the worktree, then prints the
# --output-format json result envelope the wrapper parses.
cat >"$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done
if [ "${AGENT_FAKE_PRINT_GIT_OPTIONAL_LOCKS-}" = "1" ]; then
  printf 'BACKEND_GIT_OPTIONAL_LOCKS=%s\n' "${GIT_OPTIONAL_LOCKS-__unset__}"
fi
if [ "${AGENT_FAKE_READ_STDIN-}" = "1" ]; then printf 'STDIN:[%s]\n' "$(cat)"; fi
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
if [ "${AGENT_FAKE_STUBBORN_CHILD-}" = "1" ]; then bash -c 'trap "" TERM; sleep 30' & fi
if [ "${AGENT_FAKE_CREATE_INDEX_LOCK-}" = "1" ]; then
  git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
  if [ -n "$git_dir" ]; then : >"$git_dir/index.lock"; fi
fi
if [ -n "${AGENT_FAKE_SLEEP-}" ]; then sleep "$AGENT_FAKE_SLEEP"; fi
if [ "${AGENT_FAKE_TOUCH-}" = "1" ]; then touch drift-artifact.txt; fi
if [ "${AGENT_FAKE_APPEND_UNTRACKED-}" = "1" ]; then printf 'drift\n' >>untracked-drift.txt; fi
if [ "${AGENT_FAKE_APPEND_IGNORED-}" = "1" ]; then printf 'drift\n' >>ignored-drift.txt; fi
if [ "${AGENT_FAKE_SKIP_OUTPUT-}" != "1" ]; then
  prev=''
  for arg in "$@"; do
    if [ "$prev" = "-o" ]; then printf 'fake codex last message\n' >"$arg"; fi
    prev="$arg"
  done
fi
exit "${AGENT_FAKE_EXIT-0}"
EOF

# Fake copilot: reports COPILOT_ALLOW_ALL and argv on stderr (the wrapper
# always runs -s, which reserves stdout for the bare answer), and writes a
# share transcript whose header carries the session id and whose body quotes a
# decoy --resume id — like real transcripts, which quote prompt content.
cat >"$FAKE_BIN/copilot" <<'EOF'
#!/usr/bin/env bash
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
      --deny-tool | --model | --effort | -p | -C)
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
if [ -n "$share" ]; then
  {
    printf '# Copilot CLI Session\n> - **Session ID:** `99999999-8888-7777-6666-555555555555`\n'
    printf 'body quoting --resume=11111111-1111-1111-1111-111111111111 must not win\n'
  } >"$share"
fi
if [ "${AGENT_FAKE_TOUCH-}" = "1" ]; then touch drift-artifact.txt; fi
if [ "${AGENT_FAKE_EXIT-0}" != "0" ]; then exit "${AGENT_FAKE_EXIT-0}"; fi
if [ "${AGENT_FAKE_EMPTY_ANSWER-}" = "1" ]; then exit 0; fi
printf 'fake copilot answer\n'
exit 0
EOF
chmod +x "$FAKE_BIN/claude" "$FAKE_BIN/codex" "$FAKE_BIN/copilot"

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
run_wrapper() {
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" bash "$WRAPPER" "$@" 2>&1)"
  CODE=$?
  set -e
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

run_sourced_phase 'parse_and_validate_args work codex -p build -m gpt-5.5 -e high -r sess-123 -o "$TMP_ROOT/unit-codex.msg" -- --color never; run_passthrough_guards; assemble_prompt; STDIN_SRC=/dev/null; build_codex_command; cmd_lines'
expect_code 0 "sourced codex command"
expect_out "<codex>" "sourced codex command"
expect_out "<-c>" "sourced codex command"
expect_out "<model_reasoning_effort=high>" "sourced codex command"
expect_out "<resume>" "sourced codex command"
expect_out "<sess-123>" "sourced codex command"
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

run_sourced_phase 'parse_and_validate_args consult copilot -m gemini-3.5-flash -p review -o "$TMP_ROOT/unit-copilot.msg"; assemble_prompt; STDIN_SRC=/dev/null; SIDECAR="$TMP_ROOT/unit-copilot.msg.transcript.md"; build_copilot_command; cmd_lines'
expect_code 0 "sourced copilot command"
expect_out "<copilot>" "sourced copilot command"
expect_out "<--deny-tool>" "sourced copilot command"
expect_out "<write>" "sourced copilot command"
expect_out "<--share=$TMP_ROOT/unit-copilot.msg.transcript.md>" "sourced copilot command"
ok "phase command: copilot argv assembly is directly testable"

run_sourced_phase 'MODE=consult; AGENT=codex; OUT="$TMP_ROOT/unit-header.msg"; emit_dispatch_header'
expect_code 0 "sourced dispatch header"
grep -qE "^agent-run: dispatched: consult codex wrapper-pid [0-9]+ answer $TMP_ROOT/unit-header.msg$" <<<"$OUT" \
  || fail "sourced dispatch header: malformed header ($OUT)"
ok "phase trailers: emit_dispatch_header names mode, agent, wrapper pid, and answer"

if command -v flock >/dev/null 2>&1; then
  run_sourced_phase 'parse_and_validate_args work codex -p hi; load_git_context; acquire_worktree_lock; [ "$LOCK_ACQUIRED" = 1 ] || exit 10; flock -n "$LOCK_PATH" -c true && exit 11; release_worktree_lock; flock -n "$LOCK_PATH" -c true'
  expect_code 0 "sourced lock acquire release"
  ok "phase lock: acquire_worktree_lock holds and release_worktree_lock releases"
else
  ok "skipped sourced lock phase check (flock unavailable)"
fi

run_sourced_phase 'MODE=consult; AGENT=codex; BACKEND_PHASE=pre; on_fatal_signal TERM'
expect_code 1 "sourced signal no backend"
expect_out "agent-run: backend-exit: killed (SIGTERM, no backend dispatched yet)" "sourced signal no backend"
expect_out "agent-run: worktree: unchecked (run killed by SIGTERM before the drift check)" "sourced signal no backend"
ok "phase signals: on_fatal_signal finalizes a pre-launch TERM"

UNIT_FINAL_OUT="$TMP_ROOT/unit-finalize.msg"
printf 'unit answer\n' >"$UNIT_FINAL_OUT"
run_sourced_phase 'MODE=work; AGENT=codex; OUT="$TMP_ROOT/unit-finalize.msg"; SESSION_ID=12345678-1234-1234-1234-123456789abc; code=0; DRIFT_CHECKED_MODE=0; finalize_run'
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
run_sourced_phase 'for a in codex claude copilot; do declare -F "guard_$a" "build_${a}_command" "launch_$a" >/dev/null || { printf "missing verbs for %s\n" "$a"; exit 7; }; done'
expect_code 0 "adapter required verbs"
ok "adapter: every backend defines guard/build/launch verbs"

# run_adapter_hook fires <verb>_<backend> for the active backend and no-ops when
# a backend omits an optional hook (the pattern that keeps per-backend behavior
# out of the shared lifecycle).
run_sourced_phase 'AGENT=copilot; FIRED=0; probe_copilot() { FIRED=1; }; run_adapter_hook probe; [ "$FIRED" = 1 ] || exit 7; AGENT=codex; run_adapter_hook probe; [ "$FIRED" = 1 ] || exit 8'
expect_code 0 "adapter hook dispatch"
ok "adapter: run_adapter_hook fires the active backend's hook and no-ops when absent"

# codex is the only backend that forces the lock on for consults; the hook makes
# that a per-backend fact, not a shared branch.
run_sourced_phase 'AGENT=codex; MODE=consult; run_adapter_hook lock_required; [ "${LOCK_NEEDED:-0}" = 1 ] || exit 7; AGENT=claude; LOCK_NEEDED=0; run_adapter_hook lock_required; [ "$LOCK_NEEDED" = 0 ] || exit 8'
expect_code 0 "adapter lock_required"
ok "adapter: lock_required_codex forces the lock while other backends leave it off"

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

# --- claude mapping -------------------------------------------------------------

run_wrapper consult claude -p 'hello world' -m fable -e low
expect_code 0 "claude consult happy path"
for expected in ARG:-p ARG:--output-format ARG:json ARG:--disallowedTools 'ARG:Write,Edit,NotebookEdit,Task' ARG:--model ARG:fable ARG:--effort ARG:low; do
  expect_out "$expected" "claude consult args"
done
expect_out "Do not modify files" "claude consult preamble"
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
ok "claude: -o extracts the result field into the answer file"

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

run_wrapper work codex -p 'verify failed: retry' -r sess-123
expect_code 0 "codex resume"
expect_out "ARG:resume" "codex resume args"
expect_out "ARG:sess-123" "codex resume args"
ok "codex: -r maps to exec resume <id>"

run_wrapper consult codex -p 'where does the answer land'
expect_code 0 "auto answer file"
AUTO_ANSWER="$(grep -o 'agent-run: answer: .*' <<<"$OUT" | head -n1 | cut -d' ' -f3-)"
[ -n "$AUTO_ANSWER" ] || fail "auto answer file: no answer trailer ($OUT)"
case "$AUTO_ANSWER" in
  "$TMP_ROOT"/*) ;;
  *) fail "auto answer file: expected a \$TMPDIR path, got $AUTO_ANSWER" ;;
esac
[ "$(cat "$AUTO_ANSWER")" = "fake codex last message" ] || fail "auto answer file: answer content missing"
rm -f "$AUTO_ANSWER"
ok "answer: omitting -o auto-generates an answer file under \$TMPDIR and names it in the trailer"

AUTO_PRE="$(find "$TMP_ROOT" -maxdepth 1 -name 'agent-answer.*' | wc -l)"
run_wrapper work claude -p hi -- --model sonnet
expect_code 2 "auto answer cleanup on guard rejection"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_NO_ENVELOPE=1 bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 1 "auto answer cleanup on backend failure"
AUTO_POST="$(find "$TMP_ROOT" -maxdepth 1 -name 'agent-answer.*' | wc -l)"
[ "$AUTO_PRE" = "$AUTO_POST" ] || fail "auto answer cleanup: files leaked ($AUTO_PRE -> $AUTO_POST)"
ok "answer: an auto-generated file that never receives an answer is removed on exit"

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

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_CODEX_HEADER_AFTER_ARGS=1 bash "$WRAPPER" consult codex -p 'content quoting session id: 99999999-8888-7777-6666-555555555555 and --resume=99999999-8888-7777-6666-555555555555 must not win' 2>&1)"
CODE=$?
set -e
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

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_READ_STDIN=1 bash "$WRAPPER" work codex -p hi <"$MATERIAL" 2>&1)"
CODE=$?
set -e
expect_code 0 "file stdin closed"
expect_out "STDIN:[]" "file stdin closed"
ok "stdin: redirected files are also closed — material goes through -f"

BIG_FILE="$TMP_ROOT/big-material.txt"
{ head -c 120000 /dev/zero | tr '\0' 'x'; printf '\nENDMARKER\n'; } >"$BIG_FILE"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_READ_STDIN=1 bash "$WRAPPER" work codex -p 'apply this' -f "$BIG_FILE" 2>&1)"
CODE=$?
set -e
expect_code 0 "codex oversize prompt"
expect_out "ENDMARKER" "codex oversize prompt"
expect_not_out "ARG:apply this" "codex oversize prompt"
ok "prompt: oversize material falls back to stdin delivery for codex"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_READ_STDIN=1 bash "$WRAPPER" work claude -p 'apply this' -f "$BIG_FILE" 2>&1)"
CODE=$?
set -e
expect_code 0 "claude oversize prompt"
expect_out "ENDMARKER" "claude oversize prompt"
expect_not_out "ARG:apply this" "claude oversize prompt"
ok "prompt: oversize material falls back to stdin delivery for claude"

run_wrapper work copilot -m m -p 'apply this' -f "$BIG_FILE"
expect_code 2 "copilot oversize prompt"
expect_out "too large" "copilot oversize prompt"
ok "prompt: oversize material is rejected for copilot (no stdin support)"

run_wrapper work codex -p 'apply this' -f "$BIG_FILE" -r sess-123
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

run_wrapper work codex -p hi --mission-file "$MISSION_FILE_PATH"
expect_code 2 "-p plus --mission-file"
expect_out "exactly one" "-p plus --mission-file"
run_wrapper work codex --mission-file "$MISSION_FILE_PATH" -p hi
expect_code 2 "--mission-file plus -p"
ok "mission: -p plus --mission-file is rejected in either order"

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
run_wrapper work codex --mission-file "$MISSION_FILE_PATH" -P "$EQ_MISSION"
expect_code 2 "duplicate mission file"
expect_out "duplicate" "duplicate mission file"
run_wrapper work codex --mission-file
expect_code 2 "bare --mission-file"
ok "mission: missing, directory, empty, duplicate, and valueless mission files are usage errors"

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
expect_out "agent-run: worktree: clean" "in-tree mission file drift"
rm -f "$WORKTREE/mission-in-tree.prompt"
ok "mission: a mission file inside the worktree is accepted (caller input, not an in-tree write)"

# --- failure normalization ---------------------------------------------------------

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EXIT=7 bash "$WRAPPER" work codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 1 "backend exit remap"
expect_out "agent-run: backend-exit: 7" "backend exit remap"
ok "failure: backend exit codes normalize to 1 with a backend-exit trailer"
assert_finalized_contract "backend failure contract" "$OUT"
ok "contract: backend failures exit 1 with launch header before completion anchors"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EXIT=3 bash "$WRAPPER" work copilot -m m -p hi -o "$TMP_ROOT/copilot-failed.txt" 2>&1)"
CODE=$?
set -e
expect_code 1 "copilot -o failure"
expect_out "agent-run: backend-exit: 3" "copilot -o failure"
expect_not_out "agent-run: answer:" "copilot -o failure"
ok "failure: a failed run never masquerades as lock-busy or advertises an empty answer"

STALE_COPILOT_OUT="$TMP_ROOT/copilot-stale.txt"
printf '# Copilot CLI Session\n> - **Session ID:** `11111111-1111-1111-1111-111111111111`\n' >"$STALE_COPILOT_OUT.transcript.md"
run_wrapper work copilot -m m -p hi -o "$STALE_COPILOT_OUT"
expect_code 2 "copilot stale sidecar"
expect_out "transcript sidecar" "copilot stale sidecar"
expect_not_out "11111111-1111-1111-1111-111111111111" "copilot stale sidecar"
rm -f "$STALE_COPILOT_OUT.transcript.md"
ok "usage: a reused copilot transcript sidecar is rejected before it can feed a stale session id"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_NO_ENVELOPE=1 bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 1 "claude envelope missing"
expect_out "envelope" "claude envelope missing"
ok "failure: a missing claude result envelope fails the run instead of a silent 0"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EMPTY_ANSWER=1 bash "$WRAPPER" work copilot -m m -p hi -o "$TMP_ROOT/copilot-empty.txt" 2>&1)"
CODE=$?
set -e
expect_code 1 "empty -o answer"
expect_out "no answer landed" "empty -o answer"
ok "failure: success with an empty -o answer file is flagged as a failure"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EMPTY_RESULT=1 bash "$WRAPPER" work claude -p hi -o "$TMP_ROOT/claude-empty.txt" 2>&1)"
CODE=$?
set -e
expect_code 1 "claude empty result"
expect_out "no answer landed" "claude empty result"
ok "failure: an empty claude result with -o is a broken answer contract, not a blank success"

WHITESPACE_CLAUDE_OUT="$TMP_ROOT/claude-whitespace.txt"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_WHITESPACE_RESULT=1 bash "$WRAPPER" work claude -p hi -o "$WHITESPACE_CLAUDE_OUT" 2>&1)"
CODE=$?
set -e
expect_code 1 "claude whitespace result"
expect_out "no answer landed" "claude whitespace result"
if [ -s "$WHITESPACE_CLAUDE_OUT" ]; then fail "claude whitespace result: whitespace-only answer survived"; fi
ok "failure: a whitespace-only claude result with -o is a no-answer failure"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_IS_ERROR=1 bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 1 "claude is_error envelope"
expect_out "error result" "claude is_error envelope"
ok "failure: an is_error claude envelope fails the run even on backend exit 0"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_EMPTY_RESULT=1 bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
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

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SKIP_OUTPUT=1 bash "$WRAPPER" work codex -p hi -o "$TMP_ROOT/codex-nowrite.msg" 2>&1)"
CODE=$?
set -e
expect_code 1 "codex no-write -o"
expect_out "no answer landed" "codex no-write -o"
ok "failure: a backend that writes no -o still fails the answer contract on a fresh path"

EMPTY_REUSE_OUT="$TMP_ROOT/codex-empty-reuse.msg"
: >"$EMPTY_REUSE_OUT"
run_wrapper work codex -p hi -o "$EMPTY_REUSE_OUT"
expect_code 0 "empty -o reuse"
rm -f "$EMPTY_REUSE_OUT"
ok "usage: an empty existing -o file (a failed run's leftover) is accepted for retry"

run_wrapper work codex -p hi -o "$TMP_ROOT/no-such-dir/answer.msg"
expect_code 2 "codex unwritable -o"
expect_out "cannot write" "codex unwritable -o"
ok "usage: an -o path whose directory is missing fails fast before the run"

# --- copilot mapping --------------------------------------------------------------

export COPILOT_ALLOW_ALL=1
run_wrapper consult copilot -m gemini-3.5-flash -p 'second opinion' -e low
unset COPILOT_ALLOW_ALL
expect_code 0 "copilot consult happy path"
expect_out "COPILOT_ALLOW_ALL=__unset__" "copilot consult env strip"
for expected in ARG:--no-color ARG:--no-auto-update ARG:--deny-tool ARG:write ARG:--model ARG:gemini-3.5-flash ARG:--effort ARG:low ARG:-p; do
  expect_out "$expected" "copilot consult args"
done
expect_out "Do not modify files" "copilot consult preamble"
expect_not_out "ARG:--allow-all" "copilot consult args"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot consult trailer"
ok "copilot: consult composes read-only flags and strips COPILOT_ALLOW_ALL"

run_wrapper work copilot -m gemini-3.1-pro-preview -p 'implement it' -r bbbb-session
expect_code 0 "copilot work happy path"
expect_out "ARG:--allow-all" "copilot work args"
expect_out "ARG:--resume=bbbb-session" "copilot work args"
ok "copilot: work composes --allow-all and --resume=<id>"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_STRICT=1 bash "$WRAPPER" consult copilot -m m -p hi -- "--share=$TMP_ROOT/strict-share.md" 2>&1)"
CODE=$?
set -e
expect_code 0 "copilot strict fake benign passthrough"
expect_out "ARG:--share=$TMP_ROOT/strict-share.md" "copilot strict fake benign passthrough"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_STRICT=1 bash "$WRAPPER" consult copilot -m m -p hi -- --strict-fake-unknown 2>&1)"
CODE=$?
set -e
expect_code 1 "copilot strict fake unknown passthrough"
expect_out "UNKNOWN:--strict-fake-unknown" "copilot strict fake unknown passthrough"
ok "copilot: strict fake mode accepts known passthroughs and rejects unknown flags"

COPILOT_OUT="$TMP_ROOT/copilot-answer.txt"
run_wrapper consult copilot -m gemini-3.5-flash -p hi -o "$COPILOT_OUT"
expect_code 0 "copilot -o"
[ "$(cat "$COPILOT_OUT")" = "fake copilot answer" ] || fail "copilot -o: unexpected answer file content"
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot -o trailer (share sidecar)"
[ -f "$COPILOT_OUT.transcript.md" ] || fail "copilot -o: share transcript sidecar missing"
ok "copilot: -o strips to the answer file and reads the session id from the sidecar"

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
rm -f -- "$TMP_ROOT/-x" "$TMP_ROOT/-x.transcript.md"
ok "copilot: leading-dash -o and transcript paths are treated as file operands"

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
run_wrapper work codex -p hi -- --config=model_reasoning_effort=high
expect_code 2 "codex config effort"
expect_out "model_reasoning_effort" "codex config effort"
ok "codex: config keys for model and effort cannot override wrapper options"

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
ok "copilot: --output-format is rejected (the -o strip contract needs text output)"

run_wrapper consult copilot -m m -p hi -- -s
expect_code 2 "copilot passthrough -s"
expect_out "wrapper-owned" "copilot passthrough -s"
run_wrapper work copilot -m m -p hi -- --silent
expect_code 2 "copilot passthrough --silent"
ok "copilot: passthrough -s/--silent is rejected (the wrapper owns output stripping)"

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
ok "copilot: bare --share and --share-gist are rejected (default or remote transcript exposure)"

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
expect_out "agent-run: session-id: 99999999-8888-7777-6666-555555555555" "copilot caller --share session id"
rm -f "$CALLER_SHARE_ANSWER" "$TMP_ROOT/caller-share.md"
ok "copilot: a caller --share= replaces the wrapper sidecar instead of racing it for the transcript"

printf 'prior transcript\n' >"$TMP_ROOT/stale-caller-share.md"
run_wrapper consult copilot -m m -p hi -- "--share=$TMP_ROOT/stale-caller-share.md"
expect_code 2 "copilot stale caller --share"
expect_out "already holds" "copilot stale caller --share"
rm -f "$TMP_ROOT/stale-caller-share.md"
ok "copilot: a caller --share= path holding a prior transcript is rejected like a stale sidecar"

run_wrapper consult copilot -m m -p hi -o "$TMP_ROOT/collide.msg" -- "--share=$TMP_ROOT/collide.msg"
expect_code 2 "copilot --share colliding with -o"
expect_out "same file" "copilot --share colliding with -o"
rm -f "$TMP_ROOT/collide.msg"
ok "copilot: a --share= that resolves to the -o file is rejected (transcript would overwrite the answer)"

run_wrapper consult copilot -m m -p hi -- "--share=$TMP_ROOT/share-a.md" "--share=$TMP_ROOT/share-b.md"
expect_code 2 "copilot duplicate --share"
expect_out "duplicate --share" "copilot duplicate --share"
ok "copilot: duplicate --share= flags are rejected (one transcript per run)"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" TMPDIR="$WORKTREE" bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "auto answer with in-tree TMPDIR"
expect_out "agent-run: worktree: clean" "auto answer with in-tree TMPDIR"
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
expect_out "agent-run: worktree: clean" "copilot consult option value starting -C"
expect_not_out "agent-run: worktree: unchecked" "copilot consult option value starting -C"
ok "copilot: cwd scans ignore -C-looking values consumed by native options"

run_wrapper consult copilot -m m -p hi -- -C /elsewhere
expect_code 0 "copilot consult -C"
expect_out "ARG:-C" "copilot consult -C"
expect_out "agent-run: worktree: unchecked" "copilot consult -C drift"
expect_out "-C moved the run" "copilot consult -C drift reason"
expect_not_out "agent-run: worktree: clean" "copilot consult -C drift"
run_wrapper consult copilot -m m -p hi -- -C/elsewhere
expect_code 0 "copilot consult attached -C"
expect_out "agent-run: worktree: unchecked" "copilot consult attached -C drift"
ok "copilot: consult passes -C through but reports drift unchecked (snapshot covers only the dispatch worktree)"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 bash "$WRAPPER" consult copilot -m m -p hi -- -C . 2>&1)"
CODE=$?
set -e
expect_code 4 "copilot consult in-tree -C drift"
expect_out "DIRTY" "copilot consult in-tree -C drift"
expect_not_out "agent-run: worktree: unchecked" "copilot consult in-tree -C drift"
reset_worktree
ok "copilot: consult -C inside this worktree remains drift checked"

run_wrapper consult copilot -m m -p hi -- --model other
expect_code 2 "copilot passthrough model"
ok "copilot: passthrough --model is rejected (wrapper owns -m)"

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
  run_wrapper consult codex -p hi
  expect_code 3 "consult codex lock busy"
  run_wrapper review codex -- --commit abc
  expect_code 3 "review codex lock busy"
  ok "lock: work runs and every codex run exit 3 while the lock is held"

  run_wrapper consult claude -p hi
  expect_code 0 "consult claude lock free"
  expect_out "agent-run: worktree: unchecked" "consult claude under held lock"
  run_wrapper consult copilot -m m -p hi
  expect_code 0 "consult copilot lock free"
  ok "lock: claude/copilot consults stay lock-free (enforced read-only)"

  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 bash "$WRAPPER" consult claude -p hi 2>&1)"
  CODE=$?
  set -e
  expect_code 0 "consult touch under held lock"
  expect_out "agent-run: worktree: unchecked" "consult touch under held lock"
  reset_worktree
  ok "lock: drift reads unchecked (not DIRTY) while another run holds the lock"

  exec 9>&-
  run_wrapper work claude -p hi
  expect_code 0 "lock released"
  ok "lock: work proceeds after the lock is released"

  rm -f "$WORKTREE/.git/agent-run.lock"
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
  for tool in bash git mktemp rm wc tee tail grep cut sort cksum realpath; do
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
run_wrapper work claude -p hi --dirty-ok
expect_code 0 "dirty work start with --dirty-ok"
run_wrapper consult claude -p hi
expect_code 0 "consult on a dirty tree"
expect_out "agent-run: worktree: clean" "consult on a dirty tree"
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
git -C "$WORKTREE" branch -q -D feat/branch-exists
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
grep -qF $'0\tdiff' "$GIT_PROBE_LOG" \
  || fail "git optional locks consult probe: unstaged diff did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'0\tdiff --cached' "$GIT_PROBE_LOG" \
  || fail "git optional locks consult probe: staged diff did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
grep -qF $'0\tstatus --porcelain' "$GIT_PROBE_LOG" \
  || fail "git optional locks consult probe: drift-report status did not disable optional locks ($(cat "$GIT_PROBE_LOG"))"
reset_worktree
ok "git: read-only wrapper probes disable optional locks without reaching writes or backend env"

# --- consult drift check -----------------------------------------------------------

reset_worktree
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "consult drift"
expect_out "DIRTY" "consult drift"
reset_worktree
ok "consult: a run that mutates the worktree exits 4 with a DIRTY trailer"
assert_finalized_contract "consult drift contract" "$OUT"
ok "contract: consult drift exits 4 with launch header before completion anchors"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
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
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_COMMIT=1 bash "$WRAPPER" work claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "work commit trailers"
expect_out "(+1 commit)" "work commit head trailer"
expect_out "agent-run: head: $(git -C "$WORKTREE" rev-parse --short=12 "$WORK_BASE_SHA")" "work commit head range"
expect_out "agent-run: worktree: clean" "work commit worktree trailer"
git -C "$WORKTREE" reset -q --hard "$WORK_BASE_SHA"
ok "work: a run that commits reports the head range and new-commit count"

run_wrapper consult claude -p hi
expect_code 0 "consult clean"
expect_out "agent-run: worktree: clean" "consult clean"
ok "consult: clean runs report a clean worktree trailer"

# codex consults take the lock-holding drift path (no probe), which the
# claude/copilot cases above never exercise.
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "codex consult drift"
expect_out "DIRTY" "codex consult drift"
reset_worktree
ok "consult: codex drift on the lock-holding path is caught like the lock-free path"

# review is read-only by intent and holds the lock like any codex run, so it
# takes the same drift check even though it never gets the consult preamble.
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 bash "$WRAPPER" review codex -- --commit abc123 2>&1)"
CODE=$?
set -e
expect_code 4 "review drift"
expect_out "DIRTY" "review drift"
reset_worktree
ok "review: a codex review that mutates the worktree exits 4 like a consult"

run_wrapper review codex -- --commit abc123
expect_code 0 "review clean"
expect_out "agent-run: worktree: clean" "review clean"
expect_not_out "Do not modify files" "review clean has no consult preamble"
ok "review: clean review runs report a clean worktree trailer without the consult preamble"

printf 'pre-existing\n' >"$WORKTREE/untracked-drift.txt"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_APPEND_UNTRACKED=1 bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "codex consult drift in untracked file"
expect_out "DIRTY" "codex consult drift in untracked file"
rm -f "$WORKTREE/untracked-drift.txt"
ok "consult: codex drift inside a pre-existing untracked file is caught"

printf 'pre-existing\n' >"$WORKTREE/ignored-drift.txt"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_APPEND_IGNORED=1 bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
expect_code 0 "codex consult drift in ignored file"
expect_out "agent-run: worktree: clean" "codex consult drift in ignored file"
expect_not_out "DIRTY" "codex consult drift in ignored file"
rm -f "$WORKTREE/ignored-drift.txt"
ok "consult: ignored file churn is outside the drift snapshot"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_TOUCH=1 AGENT_FAKE_EXIT=7 bash "$WRAPPER" consult codex -p hi 2>&1)"
CODE=$?
set -e
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
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_APPEND=1 bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "consult drift in modified file"
expect_out "DIRTY" "consult drift in modified file"
git -C "$WORKTREE" checkout -q -- tracked.txt
ok "consult: drift inside an already-modified file is still caught"

# A consult that commits leaves `git status` clean; HEAD is snapshotted too.
BASE_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_COMMIT=1 bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "consult drift via commit"
expect_out "DIRTY" "consult drift via commit"
git -C "$WORKTREE" reset -q --hard "$BASE_SHA"
ok "consult: a consult that commits its mutation is still caught"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_WRITE_GIT_HOOK=1 bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
expect_code 4 "consult drift via git hook"
expect_out "DIRTY" "consult drift via git hook"
rm -f "$WORKTREE/.git/hooks/pre-commit"
ok "consult: a consult that plants an executable git hook is caught"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_WRITE_GIT_CONFIG=1 bash "$WRAPPER" consult claude -p hi 2>&1)"
CODE=$?
set -e
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
set +e
wait "$SIG_WRAPPER"
CODE=$?
set -e
OUT="$(cat "$SIG_LOG")"
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
run_wrapper work claude -p hi
expect_code 0 "lock is free after a TERM'd run"
ok "signals: a TERM'd work wrapper kills its backend and emits completion trailers"
ok "contract: TERM exits 1 with launch header before completion anchors"

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
set +e
wait "$SIGS_WRAPPER"
CODE=$?
set -e
OUT="$(cat "$SIGS_LOG")"
expect_code 1 "stubborn-child escalation exit code"
expect_out "agent-run: backend-exit: killed (SIGTERM" "stubborn-child escalation backend-exit trailer"
if [ -e "$WORKTREE/.git/index.lock" ]; then
  rm -f "$WORKTREE/.git/index.lock"
  fail "stubborn-child escalation: stale index.lock survived KILL cleanup"
fi
run_wrapper work claude -p hi
expect_code 0 "lock is free after KILL escalation reaped the stubborn child"
ok "signals: a TERM-ignoring child is KILL-escalated, freeing the lock and stale index.lock"

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
set +e
wait "$SIGC_WRAPPER"
CODE=$?
set -e
OUT="$(cat "$SIGC_LOG")"
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
set +e
wait "$SIGL_WRAPPER"
CODE=$?
set -e
OUT="$(cat "$SIGL_LOG")"
expect_code 1 "TERM'd claude work exit code"
expect_out "agent-run: backend-exit: killed (SIGTERM" "TERM'd claude work backend-exit trailer"
expect_not_out "agent-run: session-id:" "TERM'd claude has no session id (envelope never arrived)"
expect_out "agent-run: worktree: clean" "TERM'd claude work worktree trailer"
ok "signals: the non-pipeline (claude) spawn path finalizes on TERM too"

# SIGKILL can never run a trap: the log must still hold the dispatched header,
# the orphaned backend keeps the lock (fail-safe against a recovery dispatch
# racing a still-writing delegate), and no completion trailers appear.
SIGK_LOG="$TMP_ROOT/sig-kill.log"
(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_FAKE_SLEEP=30 AGENT_FAKE_SKIP_OUTPUT=1 \
  exec bash "$WRAPPER" work codex -p hi -o "$TMP_ROOT/sig-kill.msg") >"$SIGK_LOG" 2>&1 &
SIGK_WRAPPER=$!
n=0
until grep -q '^agent-run: backend-pid:' "$SIGK_LOG" 2>/dev/null || [ "$n" -ge 100 ]; do
  sleep 0.1
  n=$((n + 1))
done
kill -KILL "$SIGK_WRAPPER"
set +e
wait "$SIGK_WRAPPER"
CODE=$?
set -e
OUT="$(cat "$SIGK_LOG")"
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
ok "signals: SIGKILL leaves the header + a lock-holding orphan, and no false trailers"
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
set +e
wait "$SIGW_WRAPPER"
CODE=$?
set -e
OUT="$(cat "$SIGW_LOG")"
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
set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_RUN_TEST_PID_WRITE_FAIL=1 \
  bash "$WRAPPER" work codex -p hi -o "$ABORT_ANS" 2>&1)"
CODE=$?
set -e
: >"$ABORT_LOG" # ABORT_LOG reserved for symmetry with the other kill-window logs
expect_code 1 "pid-write abort exits 1 (no answer landed)"
expect_out "agent-run: backend-pid: none (launch aborted before exec" "pid-write abort names no backend pid"
expect_not_out "backend-pid: unknown" "pid-write abort must not report an unknown pid"
expect_not_out "may be orphaned" "pid-write abort must not warn of an orphan (none was launched)"
assert_finalized_contract "pid-write abort contract" "$OUT"
[ ! -s "$ABORT_ANS" ] || fail "pid-write abort: a run that never launched a backend must not report an answer"
run_wrapper work claude -p hi
expect_code 0 "lock is free after a launch that aborted before exec"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" AGENT_RUN_TEST_PID_WRITE_FAIL=1 \
  bash "$WRAPPER" review codex -- --commit abc123 2>&1)"
CODE=$?
set -e
expect_code 1 "pid-write abort review exits 1 (launch aborted before exec)"
expect_out "agent-run: backend-pid: none (launch aborted before exec" "pid-write abort review names no backend pid"
expect_not_out "backend-pid: unknown" "pid-write abort review must not report an unknown pid"
expect_not_out "may be orphaned" "pid-write abort review must not warn of an orphan (none was launched)"
assert_finalized_contract "pid-write abort review contract" "$OUT"
run_wrapper work claude -p hi
expect_code 0 "lock is free after a review launch that aborted before exec"
ok "signals: a codex launch that aborts before exec reports no backend and orphans nothing"

# --- agent-wait.sh -----------------------------------------------------------------------
# Bounded wait helper: semantic exit codes over a dispatch log, status-only
# output. The synthetic logs pin the waiter's parsing contract; the real-run
# case guards against trailer-format drift between wrapper and waiter.

WAITER="$REPO_ROOT/.claude/skills/agent-cli/scripts/agent-wait.sh"

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
agent-run: dispatched: consult codex wrapper-pid $DEAD_PID answer $WAIT_DIR/finalized.msg
agent-run: backend-pid: $DEAD_PID
backend log noise that must never be echoed
agent-run: backend-exit: 0
agent-run: session-id: 12345678-1234-1234-1234-123456789abc
agent-run: worktree: clean
EOF
run_waiter "$WAIT_DIR/finalized.log"
expect_code 0 "waiter finalized"
expect_out "agent-wait: finalized" "waiter finalized"
expect_out "agent-run: worktree: clean" "waiter finalized summary"
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

# --- SKILL.md and reference mirror invariants -------------------------------------------

[ -f "$CONTRACT_DOC" ] || fail "contract doc: missing $CONTRACT_DOC"
grep -qF 'Completion is anchored only by:' "$CONTRACT_DOC" \
  || fail "contract doc: missing completion-anchor rule"
for record in branch backend-exit answer session-id cost-usd head drift-status drift; do
  expect_contract_optional_record "$record"
done
grep -qF 'references/trailer-contract.md' "$WRAPPER" \
  || fail "contract doc: wrapper header does not point at references/trailer-contract.md"
grep -qF '[references/trailer-contract.md](references/trailer-contract.md)' "$REPO_ROOT/.claude/skills/agent-cli/SKILL.md" \
  || fail "contract doc: SKILL.md does not link references/trailer-contract.md"
ok "contract: optional trailer records are documented as optional and linked by wrapper/SKILL.md"

# Reference docs stay byte-identical mirrors across the two trees.
for doc in references/claude.md references/codex.md references/copilot.md references/trailer-contract.md; do
  src="$REPO_ROOT/.claude/skills/agent-cli/$doc"
  dst="$REPO_ROOT/.codex/skills/agent-cli/$doc"
  [ -f "$src" ] || fail "mirror: missing $src"
  [ -f "$dst" ] || fail "mirror: missing $dst (cp from .claude/skills/agent-cli/$doc)"
  cmp -s "$src" "$dst" \
    || fail "mirror: .claude and .codex copies of agent-cli $doc differ — re-copy after editing (cp .claude/skills/agent-cli/$doc .codex/skills/agent-cli/$doc)"
done
ok "agent-cli reference docs are byte-identical mirrors across both trees"

# SKILL.md is a STRUCTURAL mirror, not byte-identical: the two trees are
# identical everywhere EXCEPT one marked harness-specific block per tree (the
# only permitted divergence), and each tree's block is addressed to its own
# harness. The markers are HTML comments so the assertion is greppable.
CLAUDE_SKILL="$REPO_ROOT/.claude/skills/agent-cli/SKILL.md"
CODEX_SKILL="$REPO_ROOT/.codex/skills/agent-cli/SKILL.md"
[ -f "$CLAUDE_SKILL" ] || fail "mirror: missing $CLAUDE_SKILL"
[ -f "$CODEX_SKILL" ] || fail "mirror: missing $CODEX_SKILL"

# Exactly one BEGIN/END harness-specific marker pair per tree.
for f in "$CLAUDE_SKILL" "$CODEX_SKILL"; do
  begins="$(grep -c '<!-- BEGIN HARNESS-SPECIFIC:' "$f")"
  ends="$(grep -c '<!-- END HARNESS-SPECIFIC -->' "$f")"
  [ "$begins" = 1 ] || fail "mirror: $f must carry exactly one harness-specific BEGIN marker (found $begins)"
  [ "$ends" = 1 ] || fail "mirror: $f must carry exactly one harness-specific END marker (found $ends)"
done

# Each tree's block is addressed to its own harness.
grep -q '<!-- BEGIN HARNESS-SPECIFIC: claude' "$CLAUDE_SKILL" \
  || fail "mirror: .claude SKILL.md harness-specific block is not addressed to claude"
grep -q '<!-- BEGIN HARNESS-SPECIFIC: codex' "$CODEX_SKILL" \
  || fail "mirror: .codex SKILL.md harness-specific block is not addressed to codex"
ok "agent-cli SKILL.md: each tree carries exactly one harness-specific block, addressed to its own harness"

# The shared core — everything outside the marked block — is byte-identical.
strip_harness_block() {
  awk '
    /<!-- END HARNESS-SPECIFIC -->/ { skip=0; next }
    /<!-- BEGIN HARNESS-SPECIFIC:/ { skip=1 }
    skip { next }
    { print }
  ' "$1"
}
if ! diff <(strip_harness_block "$CLAUDE_SKILL") <(strip_harness_block "$CODEX_SKILL") >/dev/null; then
  fail "mirror: agent-cli SKILL.md shared core differs between .claude and .codex outside the harness-specific block — edit shared prose in both trees identically"
fi
ok "agent-cli SKILL.md shared core is identical across trees outside the marked harness-specific block"

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

printf '\nall %d skill dispatch wrapper checks passed\n' "$PASS"

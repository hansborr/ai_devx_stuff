#!/usr/bin/env bash
# Pure-shell tests for the agent dispatch wrappers behind the codex-cli and
# copilot-cli skills, plus the copilot-cli SKILL.md mirror invariant.
#
# The wrappers exec their CLI binary, so the tests run them against fake
# `copilot`/`codex` executables on PATH that print their argv and the
# permission-relevant environment, inside a throwaway git repo so the
# per-worktree lock path resolves somewhere disposable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COPILOT_WRAPPER="$REPO_ROOT/.claude/skills/copilot-cli/scripts/copilot-run.sh"
CODEX_WRAPPER="$REPO_ROOT/.claude/skills/codex-cli/scripts/codex-run.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"
cat >"$FAKE_BIN/copilot" <<'EOF'
#!/usr/bin/env bash
printf 'COPILOT_ALLOW_ALL=%s\n' "${COPILOT_ALLOW_ALL-__unset__}"
for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done
EOF
cat >"$FAKE_BIN/codex" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done
if [ "${CODEX_FAKE_READ_STDIN-}" = "1" ]; then
  printf 'STDIN:[%s]\n' "$(cat)"
fi
EOF
chmod +x "$FAKE_BIN/copilot" "$FAKE_BIN/codex"

WORKTREE="$TMP_ROOT/repo"
git init -q "$WORKTREE"

# run_wrapper <wrapper> [args...] — fake CLIs first on PATH, cwd inside the
# throwaway repo; captures OUT and CODE.
run_wrapper() {
  local wrapper="$1"
  shift
  set +e
  OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" bash "$wrapper" "$@" 2>&1)"
  CODE=$?
  set -e
}

expect_code() { [ "$CODE" -eq "$1" ] || fail "$2: expected exit $1, got $CODE ($OUT)"; }
expect_out() { printf '%s' "$OUT" | grep -qF -- "$1" || fail "$2: missing '$1' in output ($OUT)"; }
expect_not_out() { printf '%s' "$OUT" | grep -qF -- "$1" && fail "$2: unexpected '$1' in output ($OUT)"; return 0; }

# --- copilot-run.sh usage rejections -----------------------------------------

run_wrapper "$COPILOT_WRAPPER"
expect_code 2 "no args"
expect_out "Usage:" "no args"
ok "copilot: argument-less call exits 2 with usage"

run_wrapper "$COPILOT_WRAPPER" bogus -p hi --model m
expect_code 2 "bogus mode"
ok "copilot: unknown mode exits 2"

run_wrapper "$COPILOT_WRAPPER" consult --model m
expect_code 2 "missing prompt"
expect_out "interactive TUI" "missing prompt"
ok "copilot: consult without -p exits 2"

run_wrapper "$COPILOT_WRAPPER" consult -p hi
expect_code 2 "consult missing model"
expect_out "--model is required" "consult missing model"
ok "copilot: consult without --model exits 2"

run_wrapper "$COPILOT_WRAPPER" work -p hi
expect_code 2 "work missing model"
expect_out "--model is required" "work missing model"
ok "copilot: work without --model exits 2"

for flag in --allow-all --yolo --allow-all-tools; do
  run_wrapper "$COPILOT_WRAPPER" consult --model m -p hi "$flag"
  expect_code 2 "consult $flag"
  expect_out "read-only" "consult $flag"
done
ok "copilot: blanket permission flags are rejected in consult mode"

# --- copilot-run.sh empty/missing option values ------------------------------

run_wrapper "$COPILOT_WRAPPER" consult --model= -p hi
expect_code 2 "empty --model="
ok "copilot: empty --model= exits 2"

run_wrapper "$COPILOT_WRAPPER" consult --model m --prompt=
expect_code 2 "empty --prompt="
ok "copilot: empty --prompt= exits 2"

run_wrapper "$COPILOT_WRAPPER" consult --model m -p ''
expect_code 2 "empty -p value"
ok "copilot: empty -p value exits 2"

run_wrapper "$COPILOT_WRAPPER" consult --model m -p
expect_code 2 "trailing bare -p"
ok "copilot: trailing bare -p exits 2"

# --- copilot-run.sh consult read-only boundary --------------------------------

run_wrapper "$COPILOT_WRAPPER" consult --model m -p hi --allow-tool shell
expect_code 2 "blanket shell grant"
expect_out "blanket grant" "blanket shell grant"
ok "copilot: consult rejects variadic blanket shell grant"

run_wrapper "$COPILOT_WRAPPER" consult --model m -p hi --allow-tool=write
expect_code 2 "blanket write grant"
ok "copilot: consult rejects --allow-tool=write"

run_wrapper "$COPILOT_WRAPPER" consult --model m -p hi '--allow-tool=shell(git diff:*),shell'
expect_code 2 "blanket grant in comma list"
ok "copilot: consult rejects blanket grant inside a comma list"

run_wrapper "$COPILOT_WRAPPER" consult --model m -p hi --allow-tool 'shell(git diff:*)'
expect_code 0 "narrow grant"
expect_out "ARG:shell(git diff:*)" "narrow grant"
ok "copilot: consult passes a narrow shell grant through"

run_wrapper "$COPILOT_WRAPPER" work --model m -p hi --allow-tool shell
expect_code 0 "work blanket grant"
ok "copilot: work mode leaves --allow-tool shell to the caller"

# --- copilot-run.sh flag composition and env stripping ------------------------

export COPILOT_ALLOW_ALL=1
run_wrapper "$COPILOT_WRAPPER" consult --model m1 -p hello --effort low
unset COPILOT_ALLOW_ALL
expect_code 0 "consult happy path"
expect_out "COPILOT_ALLOW_ALL=__unset__" "consult strips COPILOT_ALLOW_ALL"
for expected in ARG:--no-color ARG:--no-auto-update ARG:--deny-tool ARG:write ARG:--model ARG:m1 ARG:hello ARG:--effort; do
  expect_out "$expected" "consult happy path args"
done
expect_not_out "ARG:--allow-all" "consult happy path args"
ok "copilot: consult composes read-only flags and strips COPILOT_ALLOW_ALL"

run_wrapper "$COPILOT_WRAPPER" work --model m2 --prompt hello
expect_code 0 "work happy path"
expect_out "ARG:--allow-all" "work happy path args"
expect_out "ARG:m2" "work happy path args"
ok "copilot: work composes --allow-all"

# --- copilot-run.sh -C lock alignment -----------------------------------------

run_wrapper "$COPILOT_WRAPPER" work --model m -p hi -C /elsewhere
expect_code 2 "work -C"
expect_out "lock" "work -C"
ok "copilot: work rejects -C (lock would guard the wrong worktree)"

run_wrapper "$COPILOT_WRAPPER" consult --model m -p hi -C /elsewhere
expect_code 0 "consult -C"
expect_out "ARG:-C" "consult -C"
ok "copilot: consult passes -C through (read-only, lock-free)"

# --- copilot-run.sh per-worktree lock ------------------------------------------

if command -v flock >/dev/null 2>&1; then
  exec 9>"$WORKTREE/.git/codex-run.lock"
  flock -n 9 || fail "lock setup: could not take the test lock"
  run_wrapper "$COPILOT_WRAPPER" work --model m -p hi
  expect_code 3 "lock busy"
  exec 9>&-
  ok "copilot: work exits 3 while the worktree lock is held"

  run_wrapper "$COPILOT_WRAPPER" work --model m -p hi
  expect_code 0 "lock released"
  ok "copilot: work proceeds after the lock is released"
else
  ok "skipped lock checks (flock unavailable)"
  ok "skipped lock-release check (flock unavailable)"
fi

# --- codex-run.sh ---------------------------------------------------------------

run_wrapper "$CODEX_WRAPPER"
expect_code 2 "codex no args"
ok "codex: argument-less call exits 2"

run_wrapper "$CODEX_WRAPPER" exec -C /elsewhere hi
expect_code 2 "codex -C"
expect_out "lock" "codex -C"
ok "codex: -C is rejected (lock would guard the wrong worktree)"

run_wrapper "$CODEX_WRAPPER" exec --cd=/elsewhere hi
expect_code 2 "codex --cd="
ok "codex: --cd= is rejected"

run_wrapper "$CODEX_WRAPPER" exec hi
expect_code 0 "codex happy path"
for expected in ARG:-c ARG:sandbox_mode=danger-full-access ARG:-a ARG:never ARG:exec ARG:hi; do
  expect_out "$expected" "codex happy path args"
done
ok "codex: sandbox flags compose ahead of caller args"

# --- codex-run.sh stdin policy -----------------------------------------------

# codex (0.142.5) blocks reading any open non-TTY stdin to EOF before the run
# starts, so a backgrounded dispatch inheriting a never-closing pipe hangs
# while holding the worktree lock. The wrapper must close pipe stdin, preserve
# a deliberate regular-file attach for `exec`, and reject the attach on
# `exec resume` (which silently ignores stdin on 0.139.0 and 0.142.5).
STDIN_FILE="$TMP_ROOT/stdin-material.txt"
printf 'attached material\n' >"$STDIN_FILE"

set +e
OUT="$(cd "$WORKTREE" && printf 'pipe material' | PATH="$FAKE_BIN:$PATH" CODEX_FAKE_READ_STDIN=1 bash "$CODEX_WRAPPER" exec hi 2>&1)"
CODE=$?
set -e
expect_code 0 "codex pipe stdin"
expect_out "STDIN:[]" "codex pipe stdin"
ok "codex: pipe stdin is closed before exec (codex blocks reading it)"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" CODEX_FAKE_READ_STDIN=1 bash "$CODEX_WRAPPER" exec hi <"$STDIN_FILE" 2>&1)"
CODE=$?
set -e
expect_code 0 "codex file stdin"
expect_out "STDIN:[attached material]" "codex file stdin"
ok "codex: regular-file stdin passes through to exec"

set +e
OUT="$(cd "$WORKTREE" && PATH="$FAKE_BIN:$PATH" bash "$CODEX_WRAPPER" exec resume --last hi <"$STDIN_FILE" 2>&1)"
CODE=$?
set -e
expect_code 2 "codex resume file stdin"
expect_out "ignores stdin" "codex resume file stdin"
ok "codex: exec resume with attached stdin material exits 2"

set +e
OUT="$(cd "$WORKTREE" && printf 'pipe material' | PATH="$FAKE_BIN:$PATH" CODEX_FAKE_READ_STDIN=1 bash "$CODEX_WRAPPER" exec resume --last hi 2>&1)"
CODE=$?
set -e
expect_code 0 "codex resume pipe stdin"
expect_out "STDIN:[]" "codex resume pipe stdin"
ok "codex: exec resume with pipe stdin proceeds with stdin closed"

# --- SKILL.md mirror invariant ---------------------------------------------------

cmp -s "$REPO_ROOT/.claude/skills/copilot-cli/SKILL.md" "$REPO_ROOT/.codex/skills/copilot-cli/SKILL.md" \
  || fail "mirror: .claude and .codex copies of copilot-cli SKILL.md differ — re-copy after editing (cp .claude/skills/copilot-cli/SKILL.md .codex/skills/copilot-cli/SKILL.md)"
ok "copilot-cli SKILL.md mirror copies are byte-identical"

printf '\nall %d skill dispatch wrapper checks passed\n' "$PASS"

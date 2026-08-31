#!/usr/bin/env bash
# smoke-order: 365
# smoke-subjects: scripts/mutation-run.sh
# smoke-subjects: scripts/tests/test-mutation-run.sh
# Smoke tests for scripts/mutation-run.sh.
#
# Every case runs against a throwaway git repo with its own Stryker lane
# configs and a stubbed `stryker` binary, so no real mutation run happens here.
# The throwaway repo also gets a `scripts/` symlink back to the real one and a
# `node_modules/.bin/stryker` stub, so the recovery commands the runner prints
# can be executed there verbatim rather than merely read.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/../mutation-run.sh"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/tests/lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env

PASS=0
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}
ok() {
  PASS=$((PASS + 1))
  printf 'ok %d - %s\n' "$PASS" "$1"
}

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/musi-mutation-run-test.XXXXXX")" || exit 1
trap 'rm -rf "$SANDBOX"' EXIT

STUB="$SANDBOX/stryker-stub.sh"
cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
# Stands in for `stryker run`. STUB_BACKUP_FILES reproduces what an in-place
# run actually does to a file: copy the pre-run content into
# .stryker-tmp/backup-*/ and rewrite the worktree copy (Stryker prefixes
# `// @ts-nocheck` onto every JS/TS file, mutate target or not).
[ -n "${STUB_CALL_LOG:-}" ] && printf '%s\n' "$*" >> "$STUB_CALL_LOG"
if [ -n "${STUB_BACKUP_FILES:-}" ]; then
  backup_dir=".stryker-tmp/backup-Stub01"
  for backed_up in $STUB_BACKUP_FILES; do
    mkdir -p "$backup_dir/$(dirname "$backed_up")"
    cp "$backed_up" "$backup_dir/$backed_up"
    { printf '// @ts-nocheck\n'; cat "$backup_dir/$backed_up"; } > "$backed_up"
  done
fi
[ -n "${STUB_SCRATCH:-}" ] && : > "stryker-setup-42.js"
[ -n "${STUB_MUTATES:-}" ] && printf 'MUTATED\n' > "$STUB_MUTATES"
exit "${STUB_EXIT:-0}"
STUB
chmod +x "$STUB"

REAL_GIT="$(command -v git)"
GIT_STUB_DIR="$SANDBOX/gitstub"
mkdir -p "$GIT_STUB_DIR"
cat > "$GIT_STUB_DIR/git" <<GITSTUB
#!/usr/bin/env bash
# Fails only the untracked candidate listing, so the tracked preflight pass
# still succeeds and what breaks is the *producer* half of the untracked pass.
for stub_arg in "\$@"; do
  [ "\$stub_arg" = "--others" ] && exit 128
done
exec "$REAL_GIT" "\$@"
GITSTUB
chmod +x "$GIT_STUB_DIR/git"

REPO="$SANDBOX/repo"

reset_repo() {
  # `scripts` is a symlink into the real tree; unlink it before the recursive
  # delete so nothing can descend through it.
  rm -f "$REPO/scripts"
  rm -rf "$REPO"
  mkdir -p "$REPO/src/nested" "$REPO/node_modules/.bin"
  ln -s "$REAL_SCRIPTS_DIR" "$REPO/scripts"
  ln -s "$STUB" "$REPO/node_modules/.bin/stryker"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email "test@example.com"
  git -C "$REPO" config user.name "Mutation Run Test"
  git -C "$REPO" config commit.gpgsign false
  git -C "$REPO" config core.hooksPath /dev/null

  cat > "$REPO/stryker.config.mjs" <<'CONFIG'
export default { mutate: ["src/**/*.ts", "!**/*.test.ts"] };
CONFIG
  cat > "$REPO/stryker.inplace.mjs" <<'CONFIG'
export default { mutate: ["src/**/*.ts", "!**/*.test.ts"], inPlace: true };
CONFIG
  cat > "$REPO/stryker.empty.mjs" <<'CONFIG'
export default { mutate: ["nothing/**/*.ts"], inPlace: true };
CONFIG
  cat > "$REPO/stryker.sandboxed-no-mutate.mjs" <<'CONFIG'
export default { inPlace: false };
CONFIG
  # Imports cleanly once, then throws: the tracked preflight pass succeeds and
  # the untracked one fails, which is the fail-open case being pinned.
  cat > "$REPO/stryker.flaky.mjs" <<'CONFIG'
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const marker = fileURLToPath(new URL("./flaky-marker", import.meta.url));
if (existsSync(marker)) throw new Error("lane config import failed");
writeFileSync(marker, "1");
export default { mutate: ["src/**/*.ts", "!**/*.test.ts"], inPlace: true };
CONFIG
  printf 'export const a = 1;\n' > "$REPO/src/a.ts"
  printf 'export const b = 2;\n' > "$REPO/src/nested/b.ts"
  printf 'export const t = 3;\n' > "$REPO/src/a.test.ts"
  printf '# readme\n' > "$REPO/README.md"
  printf '.stryker-tmp/\nnode_modules/\nscripts\nflaky-marker\n' > "$REPO/.gitignore"
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "init"

  CALL_LOG="$SANDBOX/calls.log"
  : > "$CALL_LOG"
}

# run_runner <output-file> [args...] — invoke the runner inside the sandbox repo.
run_runner() {
  local out="$1"
  shift
  (
    cd "$REPO" || exit 99
    STUB_CALL_LOG="$CALL_LOG" \
      MUSI_MUTATION_RUN_STRYKER="$STUB" \
      bash "$RUNNER" "$@"
  ) > "$out" 2>&1
}

# printed_command <output-file> <sed-pattern> — the command the runner printed,
# stripped of its "mutation-run:   " prefix, so a case can run it verbatim.
printed_command() {
  grep -E "^mutation-run:   $2$" "$1" | head -1 | sed 's/^mutation-run:   //'
}

# --- sandboxed lane: no rails, no refusals ---------------------------------

reset_repo
printf 'export const a = 999;\n' > "$REPO/src/a.ts"
OUT="$SANDBOX/out-sandboxed.txt"
run_runner "$OUT" --mutate "src/a.ts"
status=$?
[ "$status" -eq 0 ] || fail "sandboxed lane should run despite dirty targets (exit $status): $(cat "$OUT")"
grep -qF -- '--mutate src/a.ts' "$CALL_LOG" \
  || fail "sandboxed lane must forward pass-through args: $(cat "$CALL_LOG")"
grep -q "verified clean" "$OUT" && fail "sandboxed lane must not run the in-place rails"
[ "$(cat "$REPO/src/a.ts")" = "export const a = 999;" ] \
  || fail "sandboxed lane must not touch the worktree"
ok "sandboxed lane runs without preflight and forwards arguments"

# --- sandboxed lane without mutate globs is not the runner's business -------

reset_repo
OUT="$SANDBOX/out-sandboxed-no-mutate.txt"
run_runner "$OUT" stryker.sandboxed-no-mutate.mjs
status=$?
[ "$status" -eq 0 ] \
  || fail "a sandboxed lane leaning on Stryker's default mutate must still run (exit $status): $(cat "$OUT")"
grep -qF 'run stryker.sandboxed-no-mutate.mjs' "$CALL_LOG" \
  || fail "sandboxed lane must reach stryker: $(cat "$CALL_LOG")"
ok "sandboxed lane with no mutate globs is passed through, not refused"

# --- in-place lane: happy path ---------------------------------------------

reset_repo
OUT="$SANDBOX/out-clean.txt"
run_runner "$OUT" stryker.inplace.mjs --concurrency 1
status=$?
[ "$status" -eq 0 ] || fail "clean in-place run should exit 0 (exit $status): $(cat "$OUT")"
grep -q "2 mutate target(s) verified clean" "$OUT" \
  || fail "expected the preflight target count in the output: $(cat "$OUT")"
grep -qF -- 'run stryker.inplace.mjs --concurrency 1' "$CALL_LOG" \
  || fail "in-place lane must forward the config and pass-through args: $(cat "$CALL_LOG")"
[ -e "$REPO/.stryker-tmp/mutation-run.pid" ] && fail "the run marker must not outlive the run"
ok "in-place lane preflights clean targets and forwards arguments"

# --- in-place lane: refuses on a dirty mutate target, staged or not ---------

reset_repo
printf 'export const a = 999;\n' > "$REPO/src/a.ts"
git -C "$REPO" add src/a.ts
printf 'export const b = 999;\n' > "$REPO/src/nested/b.ts"
OUT="$SANDBOX/out-dirty.txt"
run_runner "$OUT" stryker.inplace.mjs
status=$?
[ "$status" -eq 1 ] || fail "dirty target should abort with exit 1, got $status: $(cat "$OUT")"
grep -q "src/nested/b.ts" "$OUT" || fail "abort must name the unstaged target: $(cat "$OUT")"
grep -q "src/a.ts" "$OUT" || fail "abort must name the staged target too: $(cat "$OUT")"
[ ! -s "$CALL_LOG" ] || fail "stryker must not be invoked after a preflight abort"
[ "$(cat "$REPO/src/nested/b.ts")" = "export const b = 999;" ] \
  || fail "preflight abort must not touch the dirty file"
ok "in-place lane refuses to start on a staged or unstaged mutate target"

# --- a --mutate override is what gets preflighted, not the config's globs ----
#
# `stryker run -m/--mutate` replaces the config's globs, so preflighting the
# config's set would silently under-cover an overridden run in both directions.

reset_repo
printf 'export const t = 999;\n' > "$REPO/src/a.test.ts"
OUT="$SANDBOX/out-mutate-widen.txt"
run_runner "$OUT" stryker.inplace.mjs --mutate 'src/**/*.ts'
status=$?
[ "$status" -eq 1 ] \
  || fail "an override that widens past the config's ! exclusion must be preflighted (exit $status): $(cat "$OUT")"
grep -q "src/a.test.ts" "$OUT" || fail "abort must name the overridden target: $(cat "$OUT")"
[ ! -s "$CALL_LOG" ] || fail "stryker must not be invoked after a preflight abort"

OUT="$SANDBOX/out-mutate-narrow.txt"
run_runner "$OUT" stryker.inplace.mjs --mutate=src/a.ts
status=$?
[ "$status" -eq 0 ] \
  || fail "an override that narrows must run despite dirt outside it (exit $status): $(cat "$OUT")"
grep -q "1 mutate target(s) verified clean" "$OUT" \
  || fail "the override, not the config, must set the preflight scope: $(cat "$OUT")"
grep -qF -- '--mutate=src/a.ts' "$CALL_LOG" \
  || fail "the override must still reach stryker verbatim: $(cat "$CALL_LOG")"
ok "a --mutate override sets the preflight scope and is still forwarded"

# --- preflight is scoped to the targets, not the whole tree -----------------

reset_repo
printf '# dirty readme\n' > "$REPO/README.md"
printf 'export const t = 999;\n' > "$REPO/src/a.test.ts"
printf 'export const c = 4;\n' > "$REPO/src/untracked-not-a-target.txt"
OUT="$SANDBOX/out-scoped.txt"
run_runner "$OUT" stryker.inplace.mjs
status=$?
[ "$status" -eq 0 ] \
  || fail "dirt outside the mutate globs must not block the run (exit $status): $(cat "$OUT")"
[ "$(cat "$REPO/README.md")" = "# dirty readme" ] || fail "unrelated dirty work must survive"
[ "$(cat "$REPO/src/a.test.ts")" = "export const t = 999;" ] \
  || fail "an excluded (! glob) file's dirty work must survive"
ok "preflight covers only the mutate targets, not the whole tree"

# --- untracked file matching the globs is unrecoverable, so it aborts -------

reset_repo
printf 'export const n = 5;\n' > "$REPO/src/new.ts"
OUT="$SANDBOX/out-untracked.txt"
run_runner "$OUT" stryker.inplace.mjs
status=$?
[ "$status" -eq 1 ] || fail "untracked target should abort with exit 1, got $status: $(cat "$OUT")"
grep -q "src/new.ts" "$OUT" || fail "abort must name the untracked target: $(cat "$OUT")"
grep -q "could not restore" "$OUT" || fail "abort must explain why untracked files are fatal"
ok "in-place lane refuses when an untracked file matches the mutate globs"

# --- a broken untracked pass fails closed, not open -------------------------

reset_repo
OUT="$SANDBOX/out-untracked-broken.txt"
run_runner "$OUT" stryker.flaky.mjs
status=$?
[ "$status" -eq 1 ] \
  || fail "a failing untracked resolve must abort, got $status: $(cat "$OUT")"
grep -q "could not resolve untracked mutate targets" "$OUT" \
  || fail "abort must say the untracked pass failed: $(cat "$OUT")"
[ ! -s "$CALL_LOG" ] || fail "stryker must not be invoked after a failed untracked resolve"
ok "in-place lane fails closed when the untracked-target resolve breaks"

# --- a broken untracked *producer* fails closed too -------------------------
#
# The resolver reads whatever `git ls-files --others` produced. If that half
# dies, the resolver still succeeds over empty input, so the pipeline's own
# status is the only thing that separates "no untracked targets" from "the
# listing never ran".

reset_repo
OUT="$SANDBOX/out-untracked-producer.txt"
(
  cd "$REPO" || exit 99
  PATH="$GIT_STUB_DIR:$PATH" STUB_CALL_LOG="$CALL_LOG" \
    MUSI_MUTATION_RUN_STRYKER="$STUB" \
    bash "$RUNNER" stryker.inplace.mjs
) > "$OUT" 2>&1
status=$?
[ "$status" -eq 1 ] \
  || fail "a failing untracked listing must abort, got $status: $(cat "$OUT")"
grep -q "could not resolve untracked mutate targets" "$OUT" \
  || fail "abort must say the untracked pass failed: $(cat "$OUT")"
[ ! -s "$CALL_LOG" ] || fail "stryker must not be invoked after a failed untracked listing"
ok "in-place lane fails closed when the untracked-target listing itself breaks"

# --- empty target set is a refusal, not a silent green ----------------------

reset_repo
OUT="$SANDBOX/out-empty.txt"
run_runner "$OUT" stryker.empty.mjs
status=$?
[ "$status" -eq 1 ] || fail "empty target set should abort with exit 1, got $status: $(cat "$OUT")"
grep -q "no tracked files" "$OUT" || fail "abort must say the globs matched nothing: $(cat "$OUT")"
ok "in-place lane refuses when the mutate globs match no tracked file"

# --- stale-state detection --------------------------------------------------

reset_repo
mkdir -p "$REPO/.stryker-tmp/backup-AbC123"
OUT="$SANDBOX/out-stale.txt"
run_runner "$OUT" stryker.inplace.mjs
status=$?
[ "$status" -eq 1 ] || fail "stale backup should abort with exit 1, got $status: $(cat "$OUT")"
grep -q "was interrupted" "$OUT" || fail "abort must name the interrupted run: $(cat "$OUT")"
grep -q -- "--restore stryker.inplace.mjs" "$OUT" \
  || fail "abort must print the exact recovery command: $(cat "$OUT")"
grep -q "Do not delete .stryker-tmp before restoring" "$OUT" \
  || fail "abort must warn against deleting the only complete restore source: $(cat "$OUT")"
grep -q "rm -rf .stryker-tmp$" "$OUT" \
  && fail "abort must not tell the operator to delete the backup: $(cat "$OUT")"
[ -d "$REPO/.stryker-tmp/backup-AbC123" ] || fail "abort must not silently clean up for the operator"
[ ! -s "$CALL_LOG" ] || fail "stryker must not be invoked after a stale-state abort"
ok "in-place lane detects an interrupted run and prints the recovery command"

# --- the printed --restore command runs as printed --------------------------

reset_repo
mkdir -p "$REPO/.stryker-tmp/backup-AbC123"
printf 'export const a = 1 - 1;\n' > "$REPO/src/a.ts"
OUT="$SANDBOX/out-stale-cmd.txt"
run_runner "$OUT" stryker.inplace.mjs
RESTORE_CMD="$(printed_command "$OUT" 'bash scripts/mutation-run\.sh --restore.*')"
[ -n "$RESTORE_CMD" ] || fail "no --restore command was printed: $(cat "$OUT")"
OUT="$SANDBOX/out-stale-cmd-run.txt"
(
  cd "$REPO" || exit 99
  env -u MUSI_MUTATION_RUN_STRYKER STUB_CALL_LOG="$CALL_LOG" bash -c "$RESTORE_CMD"
) > "$OUT" 2>&1
status=$?
[ "$status" -eq 0 ] \
  || fail "the printed --restore command must run as printed (exit $status): $(cat "$OUT")"
[ "$(cat "$REPO/src/a.ts")" = "export const a = 1;" ] \
  || fail "the printed --restore command must recover the stranded mutant"
[ ! -d "$REPO/.stryker-tmp/backup-AbC123" ] || fail "--restore must consume the stale backup directory"
ok "the recovery command the stale-state rail prints runs as printed"

# --- the printed by-hand command runs as printed ----------------------------

reset_repo
mkdir -p "$REPO/.stryker-tmp/backup-AbC123/src"
printf 'export const a = 1;\n' > "$REPO/.stryker-tmp/backup-AbC123/src/a.ts"
printf 'export const t = 999;\n' > "$REPO/.stryker-tmp/backup-AbC123/src/a.test.ts"
printf '// @ts-nocheck\nexport const a = 1 - 1;\n' > "$REPO/src/a.ts"
printf '// @ts-nocheck\nexport const t = 999;\n' > "$REPO/src/a.test.ts"
OUT="$SANDBOX/out-byhand.txt"
run_runner "$OUT" stryker.inplace.mjs
BY_HAND_CMD="$(printed_command "$OUT" 'for d in .*')"
[ -n "$BY_HAND_CMD" ] || fail "no by-hand recovery command was printed: $(cat "$OUT")"
(cd "$REPO" && eval "$BY_HAND_CMD") || fail "the printed by-hand command failed: $BY_HAND_CMD"
[ "$(cat "$REPO/src/a.ts")" = "export const a = 1;" ] \
  || fail "the by-hand command must restore the mutate target"
[ "$(cat "$REPO/src/a.test.ts")" = "export const t = 999;" ] \
  || fail "the by-hand command must restore uncommitted work outside the mutate globs"
[ ! -d "$REPO/.stryker-tmp/backup-AbC123" ] || fail "the by-hand command must consume the backup"
ok "the by-hand recovery command the runner prints runs as printed"

# --- recovery covers the whole in-place write scope, not just the targets ---
#
# Stryker's disableTypeChecks defaults to true, so an in-place run rewrites every
# JS/TS file in the tree, not only the mutate targets. Only its own backup holds
# the pre-run content of the rest — git would restore the committed content and
# destroy the operator's uncommitted work in them.

reset_repo
printf 'export const t = 999;\n' > "$REPO/src/a.test.ts"
OUT="$SANDBOX/out-writescope.txt"
(
  cd "$REPO" || exit 99
  STUB_CALL_LOG="$CALL_LOG" STUB_EXIT=7 \
    STUB_BACKUP_FILES="src/a.test.ts src/nested/b.ts" STUB_MUTATES="src/nested/b.ts" \
    MUSI_MUTATION_RUN_STRYKER="$STUB" \
    bash "$RUNNER" stryker.inplace.mjs
) > "$OUT" 2>&1
status=$?
[ "$status" -eq 7 ] || fail "expected Stryker's exit status to propagate, got $status: $(cat "$OUT")"
[ "$(cat "$REPO/src/a.test.ts")" = "export const t = 999;" ] \
  || fail "recovery must restore uncommitted work outside the mutate globs from the backup, got: $(cat "$REPO/src/a.test.ts")"
[ "$(cat "$REPO/src/nested/b.ts")" = "export const b = 2;" ] \
  || fail "recovery must restore the mutated target"
[ ! -d "$REPO/.stryker-tmp/backup-Stub01" ] || fail "recovery must consume the backup directory"
ok "exit trap recovers the whole in-place write scope from Stryker's backup"

# --- --restore refuses without the interrupted-run marker -------------------

reset_repo
printf 'export const a = 999;\n' > "$REPO/src/a.ts"
OUT="$SANDBOX/out-restore-refused.txt"
run_runner "$OUT" --restore stryker.inplace.mjs
status=$?
[ "$status" -eq 1 ] || fail "--restore without a marker should abort, got $status: $(cat "$OUT")"
[ "$(cat "$REPO/src/a.ts")" = "export const a = 999;" ] \
  || fail "--restore must never discard ordinary uncommitted work"
grep -q "ordinary uncommitted work" "$OUT" || fail "refusal must explain itself: $(cat "$OUT")"
ok "--restore refuses to discard uncommitted work without an interrupted-run marker"

# --- --restore refuses while another supervised run holds the worktree ------

reset_repo
mkdir -p "$REPO/.stryker-tmp/backup-AbC123"
printf 'export const a = 1;\n' > "$REPO/.stryker-tmp/backup-AbC123/a-original"
sleep 30 &
LIVE_PID=$!
printf '%s\n' "$LIVE_PID" > "$REPO/.stryker-tmp/mutation-run.pid"
OUT="$SANDBOX/out-live.txt"
run_runner "$OUT" --restore stryker.inplace.mjs
status=$?
kill "$LIVE_PID" 2>/dev/null
wait "$LIVE_PID" 2>/dev/null
[ "$status" -eq 1 ] || fail "--restore over a live run should abort, got $status: $(cat "$OUT")"
grep -q "another supervised run is in progress" "$OUT" \
  || fail "refusal must name the live run: $(cat "$OUT")"
[ -f "$REPO/.stryker-tmp/backup-AbC123/a-original" ] \
  || fail "--restore must not move a live run's backup out from under it"
grep -q "rm .stryker-tmp/mutation-run.pid" "$OUT" \
  || fail "refusal must name the escape for a stale marker: $(cat "$OUT")"
ok "--restore refuses while another supervised run is still going"

# --- a recycled pid in the marker must not wedge the recovery rail ----------
#
# No trap fires on the SIGKILL/OOM this runner exists for, so the marker
# outlives the run. Once the OS reuses that pid, a bare liveness check would
# refuse every later run and every --restore — the rail unreachable in exactly
# the case it was built for. The recorded start identity is what tells the two
# apart. Where `ps` cannot report one, liveness is all there is, so skip.
if ps -o lstart= -p $$ > /dev/null 2>&1; then
  reset_repo
  sleep 30 &
  LIVE_PID=$!
  mkdir -p "$REPO/.stryker-tmp"
  {
    printf '%s\n' "$LIVE_PID"
    printf 'Thu Jan  1 00:00:00 1970\n'
    printf 'stryker.inplace.mjs\n'
  } > "$REPO/.stryker-tmp/mutation-run.pid"
  OUT="$SANDBOX/out-recycled.txt"
  run_runner "$OUT" stryker.inplace.mjs
  status=$?
  kill "$LIVE_PID" 2>/dev/null
  wait "$LIVE_PID" 2>/dev/null
  [ "$status" -eq 0 ] \
    || fail "a marker whose pid was recycled must not block a new run (exit $status): $(cat "$OUT")"
  grep -q "verified clean" "$OUT" || fail "the stale marker must be reclaimed: $(cat "$OUT")"
  ok "a recycled pid in the run marker is not mistaken for a live supervised run"
fi

# --- exit trap restores a stranded mutant with no backup to fall back on ----

reset_repo
OUT="$SANDBOX/out-trap.txt"
(
  cd "$REPO" || exit 99
  STUB_CALL_LOG="$CALL_LOG" STUB_EXIT=1 STUB_MUTATES="src/nested/b.ts" \
    MUSI_MUTATION_RUN_STRYKER="$STUB" \
    bash "$RUNNER" stryker.inplace.mjs
) > "$OUT" 2>&1
status=$?
[ "$status" -eq 1 ] || fail "expected the stub's failing status to propagate, got $status"
[ "$(cat "$REPO/src/nested/b.ts")" = "export const b = 2;" ] \
  || fail "exit trap must restore a target Stryker left mutated"
grep -q "stranded mutants in 1 mutate target" "$OUT" \
  || fail "exit trap must report what it reverted: $(cat "$OUT")"
grep -q "src/nested/b.ts" "$OUT" || fail "exit trap must name what it reverted"
ok "exit trap falls back to git when no backup directory survives"

# --- scratch-file cleanup survives the rewrite ------------------------------

reset_repo
OUT="$SANDBOX/out-scratch.txt"
(
  cd "$REPO" || exit 99
  STUB_CALL_LOG="$CALL_LOG" STUB_SCRATCH=1 \
    MUSI_MUTATION_RUN_STRYKER="$STUB" \
    bash "$RUNNER" stryker.inplace.mjs
) > "$OUT" 2>&1
[ -e "$REPO/stryker-setup-42.js" ] && fail "in-place lane must delete stryker-setup-*.js scratch files"
(
  cd "$REPO" || exit 99
  STUB_CALL_LOG="$CALL_LOG" STUB_SCRATCH=1 \
    MUSI_MUTATION_RUN_STRYKER="$STUB" \
    bash "$RUNNER"
) > "$OUT" 2>&1
[ -e "$REPO/stryker-setup-42.js" ] && fail "sandboxed lane must delete stryker-setup-*.js scratch files"
ok "both lane kinds still clean up stryker-setup-*.js scratch files"

# --- usage -------------------------------------------------------------------

reset_repo
OUT="$SANDBOX/out-help.txt"
run_runner "$OUT" --help
status=$?
[ "$status" -eq 0 ] || fail "--help should exit 0, got $status"
grep -q "usage: mutation-run.sh" "$OUT" || fail "--help should print usage: $(cat "$OUT")"
[ ! -s "$CALL_LOG" ] || fail "--help must not invoke stryker"
ok "--help prints usage without running anything"

printf 'test-mutation-run: %d checks passed\n' "$PASS"

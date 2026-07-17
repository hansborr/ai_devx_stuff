#!/usr/bin/env bash
# Packaged fresh-install portability smoke for the lint-ratchet demo.
#
# Proves the demo is genuinely clone-and-run: it copies the tracked demo files
# to a throwaway directory OUTSIDE this checkout, does a real
# `bun install --frozen-lockfile` there (no symlink into any host node_modules),
# and walks the documented adoption path — check-registry, a green gate, a
# regression, an accepted-debt update, and a locked-in improvement — asserting
# exit codes and the debt-log record at each step. The source demo is never
# mutated.
#
# Run from the demo directory: `bun run smoke` (or `bash smoke.sh`).
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lint-ratchet-demo-smoke-XXXXXX")"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

fail() {
  printf 'smoke FAIL: %s\n' "$1" >&2
  exit 1
}

# 1. Copy the tracked demo into a fresh directory (no node_modules, no host
#    symlinks). git ls-files enumerates exactly what a clone would carry.
while IFS= read -r rel; do
  mkdir -p "$WORK_DIR/$(dirname "$rel")"
  cp "$DEMO_DIR/$rel" "$WORK_DIR/$rel"
done < <(git -C "$DEMO_DIR" ls-files .)

cd "$WORK_DIR"

# A fresh git repo so the ratchet's `git ls-files` collector sees the sources.
git init -q
git add -A
git -c user.name="Lint Ratchet Demo Smoke" \
  -c user.email="lint-ratchet-demo@example.invalid" \
  commit -qm "seed pristine demo state"

# 2. Fresh, frozen install — the lockfile must be self-sufficient.
bun install --frozen-lockfile >/dev/null 2>&1 || fail "bun install --frozen-lockfile failed"

# 3. The registry validates.
bun run lint:ratchet:install-merge-driver >/dev/null 2>&1 \
  || fail "install-merge-driver package script failed"
registered_driver="$(git config --get merge.lint-ratchet-baseline.driver 2>/dev/null || true)"
[ -n "$registered_driver" ] || fail "install-merge-driver did not register the Git driver"
bun run lint:ratchet:check-baseline >/dev/null 2>&1 \
  || fail "check-baseline package script failed"
bun scripts/lint-ratchet.ts --check-registry >/dev/null 2>&1 \
  || fail "check-registry did not pass on a fresh install"

# 4. The bounded default trend report is exposed through the documented package
#    script and runs against the fresh repository history.
bun run lint:ratchet:trend >/dev/null 2>&1 \
  || fail "trend package script failed"

# 5. The gate is green at the committed baseline (2 accepted findings).
bun scripts/lint-ratchet.ts >/dev/null 2>&1 \
  || fail "gate did not pass against the committed baseline"

# 6. A new console.log call is a blocking local-rule regression (exit 1) that
#    prints the recovery command.
cat >>src/app.ts <<'TS'

export function debugPing(): void {
  console.log("ping");
}
TS
git add -A
regression_out="$(bun scripts/lint-ratchet.ts 2>&1)" && fail "gate should have failed on a regression"
grep -q '"kind": "regression"' <<<"$regression_out" || fail "regression not reported in the envelope"
grep -q -- '--allow-worse --reason' <<<"$regression_out" || fail "recovery command missing from the envelope"

# 7. Accepting the debt records a reasoned line in the append-only debt log.
bun scripts/lint-ratchet.ts --update --allow-worse \
  --reason "smoke: intentional debug ping" >/dev/null 2>&1 \
  || fail "--allow-worse update failed"
grep -q '"acceptanceReason":"smoke: intentional debug ping"' lint-ratchet.debt-log.jsonl \
  || fail "debt-log line not written"

# 8. Removing the finding is an improvement; locking it in returns the gate to
#    green.
git checkout -q HEAD -- src/app.ts
improvement_out="$(bun scripts/lint-ratchet.ts 2>&1)" \
  && fail "gate should have failed on the restored improvement"
grep -q '"kind": "improvement"' <<<"$improvement_out" \
  || fail "restored improvement not reported in the envelope"
grep -q '"baselineCount": 3' <<<"$improvement_out" \
  || fail "restored improvement did not retain the accepted count of 3"
grep -q '"currentCount": 2' <<<"$improvement_out" \
  || fail "restored improvement did not drop the current count to 2"
bun scripts/lint-ratchet.ts --update >/dev/null 2>&1 || fail "improvement update failed"
bun scripts/lint-ratchet.ts >/dev/null 2>&1 || fail "gate not green after locking in the improvement"

printf 'smoke OK: fresh-install clone-and-run walk passed\n'

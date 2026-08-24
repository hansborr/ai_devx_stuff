#!/usr/bin/env bash
# smoke-order: 380
# smoke-subjects: scripts/migration-safety-scan.sh
# smoke-subjects: scripts/lib/migration-safety-cli.ts
# smoke-subjects: scripts/lib/migration-safety-core.ts
# smoke-subjects: scripts/lib/migration-safety-io.ts
# smoke-subjects: scripts/lib/migration-safety-report.ts
# smoke-subjects: scripts/lib/codepoint-compare.ts
# smoke-subjects: scripts/lib/git.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-migration-safety-scan.sh
# smoke-subjects: scripts/harness-emit-envelope.ts
# smoke-subjects: scripts/harness/harness-diagnostics-output.ts
# smoke-subjects: tools/harness-diagnostics/
# test-migration-safety-scan.sh — facade smoke for
# scripts/migration-safety-scan.sh.
#
# The SQL grammar, the allowlist and stale-entry policy, and both renderings are
# specified in scripts/lib/migration-safety-{core,cli,io}.test.ts (backlog leaf
# 119), which drive the same runMigrationSafetyCli through an in-memory io. A
# case belongs here only when the process is the subject: the forwarder itself,
# invocation from an arbitrary working directory, argv reaching bun intact
# through `--`, one schema-valid envelope on real stdout, git-root discovery
# from inside a foreign repository, and this repository's own migrations tree —
# the two intentional-risk precedents and the state of the shipped allowlist.
# Anything a fixture tree can show belongs in vitest instead: every case here
# pays a bash -> bun spawn. Every invocation below runs under `set -e` with an
# explicit `|| fail`, so the warn-only exit-0 contract is asserted throughout
# rather than by a case of its own. Run via
# `bash scripts/tests/test-migration-safety-scan.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
SCRIPT="$SCRIPT_DIR/../migration-safety-scan.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-migration-safety-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

write_migration() {
  local name="$1" body="$2"
  mkdir -p "$SANDBOX/$name"
  printf '%s' "$body" > "$SANDBOX/$name/migration.sql"
}

# --- the forwarder itself -------------------------------------------------
bash -n "$SCRIPT" || fail "migration-safety-scan.sh fails bash -n"
ok "scanner passes bash -n"

bash "$SCRIPT" --help >/dev/null 2>&1 || fail "scanner --help should succeed"
ok "scanner --help exits 0"

write_migration "20260101000000_safe" "$(cat <<'SQL'
CREATE TABLE "widgets" (
    "id" TEXT NOT NULL,
    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);
SQL
)"
write_migration "20260103000000_drop_column" "$(cat <<'SQL'
ALTER TABLE "widgets" DROP COLUMN "obsolete_flag";
SQL
)"

# The scanner must work from any working directory: doctor invokes it by path
# from the repository root, `db:migration-safety` from a package directory.
output=$(cd / && bash "$SCRIPT" "$SANDBOX/20260103000000_drop_column")
grep -qE '^WARN: .*20260103000000_drop_column/migration\.sql:1 — DROP COLUMN' <<< "$output" \
  || fail "scanner should work when invoked from an unrelated working directory: $output"
ok "scanner runs from any working directory"

# --- intentional-risk migration precedent --------------------------------
# Both migrations were intentional but ARE destructive. The scanner must
# surface them so a future similar PR is reviewed at the same level.
# Detection is tested with the allowlist disabled so the raw scanner output
# is asserted; a follow-up case re-enables the repo allowlist to confirm
# both precedents are acknowledged in shipped state.
ENUM_MIG="$REPO_ROOT/packages/server/prisma/migrations/20260408223838_convert_string_fields_to_enums"
SPELLS_MIG="$REPO_ROOT/packages/server/prisma/migrations/20260409120000_add_monster_spells_table"
REPO_ALLOWLIST="$REPO_ROOT/packages/server/prisma/migrations/.safety-acknowledged"

[ -f "$ENUM_MIG/migration.sql" ] \
  || fail "expected fixture $ENUM_MIG/migration.sql to exist (intentional-risk precedent)"
[ -f "$SPELLS_MIG/migration.sql" ] \
  || fail "expected fixture $SPELLS_MIG/migration.sql to exist (intentional-risk precedent)"

output=$(MUSI_MIGRATION_ALLOWLIST=/dev/null bash "$SCRIPT" "$ENUM_MIG")
# Pin each known intentional-risk line so the test fails if any specific
# narrowing stops being detected, while remaining tolerant of unrelated
# additions to the historical migration. Lines 21-23 narrow spells columns,
# 27 narrows equipment.category, 31-32 narrow magic_items columns.
for ln in 21 22 23 27 31 32; do
  grep -qE "^WARN: .*20260408223838_convert_string_fields_to_enums/migration\.sql:$ln — ALTER COLUMN \.\.\. TYPE" <<< "$output" \
    || fail "expected ALTER COLUMN TYPE finding at line $ln in convert_string_fields_to_enums"
done
ok "intentional-risk precedent: enum-conversion migration surfaces every known type narrowing"

output=$(MUSI_MIGRATION_ALLOWLIST=/dev/null bash "$SCRIPT" "$SPELLS_MIG")
grep -qE '^WARN: .*20260409120000_add_monster_spells_table/migration\.sql:[0-9]+ — DROP COLUMN' <<< "$output" \
  || fail "expected DROP COLUMN finding in add_monster_spells_table"
grep -qF 'destroys column data' <<< "$output" \
  || fail "DROP COLUMN risk guidance missing for spells migration"
ok "intentional-risk precedent: monster-spells migration surfaces the spellcasting column drop"

# Confirm the shipped allowlist acknowledges both intentional-risk
# precedents so doctor stays quiet on already-reviewed history.
[ -f "$REPO_ALLOWLIST" ] \
  || fail "expected repo allowlist at $REPO_ALLOWLIST"
output=$(bash "$SCRIPT" "$ENUM_MIG" "$SPELLS_MIG")
grep -qE '^INFO: .*20260408223838_convert_string_fields_to_enums/migration\.sql:[0-9]+ — ALTER COLUMN \.\.\. TYPE \(acknowledged: ' <<< "$output" \
  || fail "shipped allowlist should acknowledge enum-conversion migration: $output"
grep -qE '^INFO: .*20260409120000_add_monster_spells_table/migration\.sql:[0-9]+ — DROP COLUMN \(acknowledged: ' <<< "$output" \
  || fail "shipped allowlist should acknowledge monster-spells migration: $output"
! grep -qE '^WARN: .*(20260408223838_convert_string_fields_to_enums|20260409120000_add_monster_spells_table)/migration\.sql' <<< "$output" \
  || fail "no precedent migration finding should remain on WARN once shipped allowlist applies"
ok "shipped allowlist acknowledges both intentional-risk precedents"

# --- --json emits a harness-diagnostics envelope -------------------------
# What the in-memory io cannot show: the envelope reaches real stdout, as one
# parseable JSON document, through the forwarder. Finding shapes themselves are
# pinned in migration-safety-cli.test.ts's "--json findings" describe.
assert_envelope() {
  local file=$1
  local expected_warnings=$2
  local expected_infos=$3
  ASSERT_FILE="$file" ASSERT_WARN="$expected_warnings" ASSERT_INFO="$expected_infos" bun -e '
    const fs = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
    const expectedWarn = Number(process.env.ASSERT_WARN);
    const expectedInfo = Number(process.env.ASSERT_INFO);
    if (env.version !== "1") assertionFailed("bad version");
    if (env.tool !== "migration-safety-scan") assertionFailed(`bad tool ${env.tool}`);
    if (!Array.isArray(env.findings)) assertionFailed("findings not array");
    if (env.summary.blocking !== 0) assertionFailed(`blocking expected 0, got ${env.summary.blocking}`);
    if (env.summary.warning !== expectedWarn) {
      assertionFailed(`warning expected ${expectedWarn}, got ${env.summary.warning}`);
    }
    if (env.summary.info !== expectedInfo) {
      assertionFailed(`info expected ${expectedInfo}, got ${env.summary.info}`);
    }
    for (const f of env.findings) {
      if (f.control !== "sensor/db-migration-safety") {
        assertionFailed(`bad control ${f.control}`);
      }
      if (f.repairKind !== "manual") {
        assertionFailed(`bad repairKind ${f.repairKind}`);
      }
    }
  ' || fail "invalid migration-safety-scan envelope: $file"
}

# A clean scan is the case where stdout could plausibly carry the human
# "INFO: no destructive operations detected" text instead of JSON and break
# every consumer parsing it; the finding-carrying envelopes are covered by the
# two process-only cases below.
JSON_OUT="$SANDBOX/json-safe.json"
bash "$SCRIPT" --json "$SANDBOX/20260101000000_safe" > "$JSON_OUT" \
  || fail "--json on safe migration must exit 0"
assert_envelope "$JSON_OUT" 0 0
ok "--json on safe migration emits an envelope on real stdout"

# The whole shipped tree under the shipped allowlist. This is the one assertion
# no fixture can make: zero warn findings means every destructive operation in
# real history is acknowledged *and* no allowlist entry has gone stale (stale
# entries are warn findings — migration-safety-cli.test.ts "emits stale
# allowlist entries as warn findings at their allowlist line").
JSON_OUT="$SANDBOX/json-repo.json"
bash "$SCRIPT" --json > "$JSON_OUT" \
  || fail "--json on real repo migrations must exit 0"
ASSERT_FILE="$JSON_OUT" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  if (env.summary.warning !== 0) {
    assertionFailed(`real repo should have 0 warnings, got ${env.summary.warning}`);
  }
  if (env.summary.info < 1) {
    assertionFailed("real repo should have at least one acknowledged finding");
  }
  for (const f of env.findings) {
    if (f.severity !== "info") assertionFailed(`real repo finding has severity ${f.severity}`);
  }
' || fail "real repo --json envelope failed"
ok "--json on the real repo emits info-severity acknowledged findings"

# Default collection can also fail before any SQL files are collected when the
# repo has no packages/server/prisma/migrations directory. JSON consumers still
# need a parseable envelope with that warning, and this is the one case that
# pins the git-root discovery: the scanner reads the root of whatever
# repository it is invoked inside.
NO_MIG_REPO="$SANDBOX/no-migrations-repo"
git init -q "$NO_MIG_REPO"
JSON_OUT="$SANDBOX/json-missing-dir.json"
JSON_ERR="$SANDBOX/json-missing-dir.err"
(
  cd "$NO_MIG_REPO" && bash "$SCRIPT" --json > "$JSON_OUT" 2> "$JSON_ERR"
) || fail "--json with no default migrations directory must exit 0"
assert_envelope "$JSON_OUT" 1 0
grep -qF 'no migrations directory' "$JSON_ERR" \
  || fail "missing default migrations directory should still emit stderr WARN"
ASSERT_FILE="$JSON_OUT" NO_MIG_REPO="$NO_MIG_REPO" bun -e '
  import { readFileSync } from "node:fs";
  const env = JSON.parse(readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings.find((f) => f.messageId === "missing-migrations-directory");
  if (!finding) throw new Error("missing missing-migrations-directory finding");
  if (!finding.path.startsWith(process.env.NO_MIG_REPO)) {
    throw new Error(`scanner did not resolve the invoking repository root: ${finding.path}`);
  }
' || fail "missing-directory JSON envelope missing expected finding"
ok "--json surfaces missing default migrations directory as warn-severity finding"

# `--` end-of-options must let option-shaped path arguments through. The
# parser only sees `-` as a leading char if the *argument itself* starts
# with `-`. Using an absolute sandbox path like `/tmp/.../--weird-name`
# doesn't exercise the new branch because the arg starts with `/`. Use a
# relative basename so the parser sees a real `--<flag>`-looking token.
mkdir -p "$SANDBOX/--weird-name"
printf 'ALTER TABLE "widgets" DROP COLUMN "obsolete";\n' > "$SANDBOX/--weird-name/migration.sql"
JSON_OUT="$SANDBOX/json-weird-name.json"
JSON_ERR="$SANDBOX/json-weird-name.err"
(
  cd "$SANDBOX" && bash "$SCRIPT" --json -- "--weird-name" > "$JSON_OUT" 2> "$JSON_ERR"
) || fail "-- end-of-options must accept option-shaped paths"
assert_envelope "$JSON_OUT" 1 0
# Without --, the parser would either reject `--weird-name` as an unknown
# flag (exit 0 with no findings) or downstream tools would emit `dirname:
# unrecognized option` errors to stderr. Assert clean stderr to lock in both
# the parser fix and the option-shaped path handling in migrationNameFor.
[ ! -s "$JSON_ERR" ] || fail "-- end-of-options should not produce stderr noise (got: $(cat "$JSON_ERR"))"
ok "-- end-of-options passes option-shaped paths through cleanly"

printf 'migration-safety-scan tests passed (%d)\n' "$PASS"

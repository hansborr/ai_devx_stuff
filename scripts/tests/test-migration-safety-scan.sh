#!/usr/bin/env bash
# smoke-order: 380
# smoke-subjects: scripts/migration-safety-scan.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-migration-safety-scan.sh
# smoke-subjects: scripts/harness-emit-envelope.ts
# smoke-subjects: packages/shared/src/schemas/harness-diagnostics.ts
# test-migration-safety-scan.sh — pure-shell smoke tests for
# scripts/migration-safety-scan.sh.
#
# Exercises destructive-operation detection (DROP TABLE, DROP COLUMN,
# ALTER COLUMN ... TYPE, ADD COLUMN ... NOT NULL without DEFAULT) with
# synthetic SQL fixtures, plus the intentional-risk migration precedent
# already in this repo (20260408223838_convert_string_fields_to_enums and
# 20260409120000_add_monster_spells_table). Run via
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
line_number_for() {
  local pattern="$1" text="$2"
  awk -v pattern="$pattern" '$0 ~ pattern { print NR; found = 1; exit } END { if (!found) exit 1 }' <<< "$text" || true
}

SANDBOX="$(mktemp -d /tmp/musi-migration-safety-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

write_migration() {
  local name="$1" body="$2"
  mkdir -p "$SANDBOX/$name"
  printf '%s' "$body" > "$SANDBOX/$name/migration.sql"
}

# --- syntax / argument parsing -------------------------------------------
bash -n "$SCRIPT" || fail "migration-safety-scan.sh fails bash -n"
ok "scanner passes bash -n"

bash "$SCRIPT" --help >/dev/null 2>&1 || fail "scanner --help should succeed"
ok "scanner --help exits 0"

# --- safe migration produces no findings ---------------------------------
write_migration "20260101000000_safe" "$(cat <<'SQL'
-- CreateTable
CREATE TABLE "widgets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "widgets_name_idx" ON "widgets"("name");
SQL
)"

output=$(bash "$SCRIPT" "$SANDBOX/20260101000000_safe")
grep -qF 'No destructive operations detected.' <<< "$output" \
  || fail "safe migration reported findings"
grep -qF 'Scanned 1 migration file(s).' <<< "$output" \
  || fail "scan count missing for safe migration"
ok "safe CREATE TABLE migration reports no findings"

# CREATE TABLE columns marked NOT NULL must not trigger the
# ADD-COLUMN-NOT-NULL rule (only ALTER TABLE ADD COLUMN should).
! grep -q 'ADD COLUMN ... NOT NULL' <<< "$output" \
  || fail "CREATE TABLE NOT NULL columns must not be flagged"
ok "CREATE TABLE NOT NULL columns are not false-positives"

# --- DROP TABLE detection ------------------------------------------------
write_migration "20260102000000_drop_table" "$(cat <<'SQL'
DROP TABLE "old_widgets";
DROP TABLE IF EXISTS "old_gadgets";
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260102000000_drop_table")
grep -qE 'WARN: .*20260102000000_drop_table/migration\.sql:1 — DROP TABLE' <<< "$output" \
  || fail "DROP TABLE on line 1 not detected"
grep -qE 'WARN: .*20260102000000_drop_table/migration\.sql:2 — DROP TABLE' <<< "$output" \
  || fail "DROP TABLE IF EXISTS on line 2 not detected"
grep -qF 'destroys all data in the table' <<< "$output" \
  || fail "DROP TABLE risk guidance missing"
ok "scanner detects DROP TABLE and DROP TABLE IF EXISTS"

# --- DROP COLUMN detection -----------------------------------------------
write_migration "20260103000000_drop_column" "$(cat <<'SQL'
ALTER TABLE "widgets" DROP COLUMN "obsolete_flag";
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260103000000_drop_column")
grep -qE 'WARN: .*20260103000000_drop_column/migration\.sql:1 — DROP COLUMN' <<< "$output" \
  || fail "DROP COLUMN not detected"
grep -qF 'destroys column data' <<< "$output" \
  || fail "DROP COLUMN risk guidance missing"
ok "scanner detects DROP COLUMN"

# --- ALTER COLUMN ... TYPE detection -------------------------------------
write_migration "20260104000000_alter_type" "$(cat <<'SQL'
ALTER TABLE "widgets"
  ALTER COLUMN "size" TYPE "widget_size" USING "size"::"widget_size",
  ALTER COLUMN "color" TYPE "widget_color" USING "color"::"widget_color";
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260104000000_alter_type")
grep -qE 'WARN: .*20260104000000_alter_type/migration\.sql:2 — ALTER COLUMN \.\.\. TYPE' <<< "$output" \
  || fail "ALTER COLUMN TYPE on line 2 not detected"
grep -qE 'WARN: .*20260104000000_alter_type/migration\.sql:3 — ALTER COLUMN \.\.\. TYPE' <<< "$output" \
  || fail "ALTER COLUMN TYPE on line 3 not detected"
grep -qF 'type change can narrow or fail' <<< "$output" \
  || fail "ALTER COLUMN TYPE risk guidance missing"
ok "scanner detects every ALTER COLUMN ... TYPE clause"

# --- ADD COLUMN ... NOT NULL without DEFAULT detection --------------------
write_migration "20260105000000_add_required" "$(cat <<'SQL'
ALTER TABLE "widgets" ADD COLUMN "owner_id" TEXT NOT NULL;
ALTER TABLE "widgets" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "widgets" ADD COLUMN "label" TEXT;
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260105000000_add_required")
grep -qE 'WARN: .*20260105000000_add_required/migration\.sql:1 — ADD COLUMN \.\.\. NOT NULL without DEFAULT' <<< "$output" \
  || fail "ADD COLUMN NOT NULL without DEFAULT not detected"
! grep -q 'migration\.sql:2 — ADD COLUMN' <<< "$output" \
  || fail "ADD COLUMN with DEFAULT must not be flagged"
! grep -q 'migration\.sql:3 — ADD COLUMN' <<< "$output" \
  || fail "nullable ADD COLUMN must not be flagged"
grep -qF 'will fail on tables with existing rows' <<< "$output" \
  || fail "ADD COLUMN NOT NULL risk guidance missing"
ok "scanner detects ADD COLUMN NOT NULL only when DEFAULT is absent"

# Safe split pattern: add nullable, backfill, then SET NOT NULL. Each line
# alone must not trip the ADD COLUMN NOT NULL rule.
write_migration "20260106000000_safe_backfill" "$(cat <<'SQL'
ALTER TABLE "widgets" ADD COLUMN "tier" TEXT;
UPDATE "widgets" SET "tier" = 'standard' WHERE "tier" IS NULL;
ALTER TABLE "widgets" ALTER COLUMN "tier" SET NOT NULL;
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260106000000_safe_backfill")
grep -qF 'No destructive operations detected.' <<< "$output" \
  || fail "safe backfill pattern produced unexpected findings"
ok "scanner does not flag the add-nullable + backfill + SET NOT NULL pattern"

# --- WHERE ... IS NOT NULL is not a false positive -----------------------
write_migration "20260107000000_where_not_null" "$(cat <<'SQL'
UPDATE "widgets" SET "label" = 'x' WHERE "owner_id" IS NOT NULL;
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260107000000_where_not_null")
grep -qF 'No destructive operations detected.' <<< "$output" \
  || fail "WHERE ... IS NOT NULL incorrectly flagged"
ok "WHERE clauses with IS NOT NULL are not false positives"

# --- SQL line comments must not trigger false positives ------------------
write_migration "20260108000000_comment_only" "$(cat <<'SQL'
-- DROP TABLE "old_widgets" — describing what we're NOT doing
-- ALTER COLUMN "x" TYPE TEXT (history note)
ALTER TABLE "widgets" ADD COLUMN "label" TEXT; -- DROP COLUMN "obsolete" later
CREATE TABLE "more_widgets" (
    "id" TEXT NOT NULL,  -- ADD COLUMN "x" TEXT NOT NULL would be unsafe
    CONSTRAINT "more_widgets_pkey" PRIMARY KEY ("id")
);
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260108000000_comment_only")
grep -qF 'No destructive operations detected.' <<< "$output" \
  || fail "SQL line comments produced false positives: $output"
ok "SQL line comments are stripped before pattern matching"

# --- SQL strings and block comments must not trigger false positives ------
write_migration "20260109000000_strings_and_block_comments" "$(cat <<'SQL'
UPDATE "widgets" SET "label" = 'please DROP TABLE old_widgets safely';
UPDATE "widgets" SET "label" = 'DROP COLUMN old_col';
UPDATE "widgets" SET "label" = 'ALTER COLUMN "size" TYPE TEXT';
UPDATE "widgets" SET "label" = 'ADD COLUMN "owner_id" TEXT NOT NULL';
UPDATE "widgets" SET "label" = 'owner''s note: DROP COLUMN old_col';
UPDATE "widgets" SET "label" = 'comment marker -- DROP TABLE old_widgets';
/* DROP TABLE "old_widgets"; */
ALTER TABLE "widgets" ADD COLUMN "safe_label" TEXT; /* DROP COLUMN "obsolete"; */
/*
ALTER TABLE "widgets" DROP COLUMN "legacy_flag";
ALTER TABLE "widgets" ADD COLUMN "owner_id" TEXT NOT NULL;
*/
SQL
)"
output=$(bash "$SCRIPT" "$SANDBOX/20260109000000_strings_and_block_comments")
grep -qF 'No destructive operations detected.' <<< "$output" \
  || fail "SQL strings or block comments produced false positives: $output"
ok "SQL strings and block comments are masked before pattern matching"

# --- multiple migrations in one scan, sorted output -----------------------
output=$(bash "$SCRIPT" "$SANDBOX")
grep -qE 'Findings: 6 in 4 migration\(s\) of 9 scanned \(6 unacknowledged WARN, 0 acknowledged INFO\)\.' <<< "$output" \
  || fail "summary count wrong for sandbox roll-up: $output"
ok "summary aggregates findings across the sandbox"

# --- doctor signal lines: PASS on clean, WARN on unacknowledged ------------
# A clean migrations dir should emit a final `PASS:` line so doctor's
# section counts the scanner as healthy. Findings without an allowlist
# entry should produce a final `WARN:` line so the section is loud.
output=$(MUSI_MIGRATION_ALLOWLIST=/dev/null bash "$SCRIPT" "$SANDBOX/20260101000000_safe")
grep -qE '^PASS: migration safety — no destructive operations detected' <<< "$output" \
  || fail "clean scan should emit PASS doctor signal"
ok "clean scan emits PASS doctor signal"

output=$(MUSI_MIGRATION_ALLOWLIST=/dev/null bash "$SCRIPT" "$SANDBOX/20260102000000_drop_table")
grep -qE '^WARN: migration safety — 2 unacknowledged destructive operation\(s\) in 1 migration\(s\)' <<< "$output" \
  || fail "unacknowledged findings should emit a final WARN doctor signal"
ok "unacknowledged findings emit final WARN doctor signal"

# --- allowlist acknowledges intentional-risk migrations -------------------
# An allowlist file lets the scanner mark known intentional-risk migrations
# as acknowledged (INFO:) rather than treating them as new findings (WARN:),
# so doctor doesn't drown in noise from migrations that have already been
# reviewed. The format is one acknowledged migration name per line, with an
# optional reason after the first whitespace; lines starting with # and
# blank lines are ignored.
ALLOWLIST="$SANDBOX/.safety-acknowledged"
cat > "$ALLOWLIST" <<'EOF'
# Acknowledged intentional-risk migrations (test fixture).

20260102000000_drop_table  Reviewed: legacy table drop after backfill.
20260104000000_alter_type
EOF

output=$(MUSI_MIGRATION_ALLOWLIST="$ALLOWLIST" bash "$SCRIPT" "$SANDBOX/20260102000000_drop_table")
grep -qE '^== actionable warnings ==$' <<< "$output" \
  || fail "fully acknowledged scan should show the actionable warning section: $output"
grep -qF 'No actionable warnings; acknowledged findings are listed separately.' <<< "$output" \
  || fail "fully acknowledged scan should state that there are no actionable warnings: $output"
grep -qE '^== acknowledged findings ==$' <<< "$output" \
  || fail "fully acknowledged scan should show the acknowledged findings section: $output"
grep -qE '^INFO: .*20260102000000_drop_table/migration\.sql:1 — DROP TABLE \(acknowledged: Reviewed: legacy table drop after backfill\.\)' <<< "$output" \
  || fail "acknowledged finding should be emitted as INFO with reason: $output"
! grep -qE '^WARN: .*20260102000000_drop_table/migration\.sql' <<< "$output" \
  || fail "acknowledged finding must not also emit WARN"
grep -qE 'Findings: 2 in 1 migration\(s\) of 1 scanned \(0 unacknowledged WARN, 2 acknowledged INFO\)\.' <<< "$output" \
  || fail "summary should split unacknowledged vs acknowledged counts: $output"
grep -qE '^PASS: migration safety — 2 acknowledged finding\(s\), 0 unacknowledged' <<< "$output" \
  || fail "fully acknowledged scan should emit PASS doctor signal: $output"
ok "scanner emits INFO for migrations listed in the allowlist"

# Allowlist entries without a reason are accepted; the INFO line still
# distinguishes them from WARN, just without a reason fragment.
output=$(MUSI_MIGRATION_ALLOWLIST="$ALLOWLIST" bash "$SCRIPT" "$SANDBOX/20260104000000_alter_type")
grep -qE '^INFO: .*20260104000000_alter_type/migration\.sql:[0-9]+ — ALTER COLUMN \.\.\. TYPE \(acknowledged: \)' <<< "$output" \
  || fail "allowlist entry without reason should still emit INFO: $output"
ok "scanner accepts allowlist entries with no reason"

# Mixed scan: one acknowledged migration, one unacknowledged. The
# unacknowledged finding stays on WARN; the acknowledged one stays on INFO.
output=$(MUSI_MIGRATION_ALLOWLIST="$ALLOWLIST" bash "$SCRIPT" \
  "$SANDBOX/20260102000000_drop_table" \
  "$SANDBOX/20260103000000_drop_column")
grep -qE '^INFO: .*20260102000000_drop_table' <<< "$output" \
  || fail "mixed scan: acknowledged migration should emit INFO"
grep -qE '^WARN: .*20260103000000_drop_column/migration\.sql:1 — DROP COLUMN' <<< "$output" \
  || fail "mixed scan: unacknowledged migration should still emit WARN"
action_header_line=$(line_number_for '^== actionable warnings ==$' "$output")
warn_line=$(line_number_for '^WARN: .*20260103000000_drop_column/migration\.sql:1 — DROP COLUMN' "$output")
ack_header_line=$(line_number_for '^== acknowledged findings ==$' "$output")
info_line=$(line_number_for '^INFO: .*20260102000000_drop_table' "$output")
[ -n "$action_header_line" ] && [ -n "$warn_line" ] && [ -n "$ack_header_line" ] && [ -n "$info_line" ] \
  || fail "mixed scan should render both actionable and acknowledged sections: $output"
[ "$action_header_line" -lt "$warn_line" ] && [ "$warn_line" -lt "$ack_header_line" ] && [ "$ack_header_line" -lt "$info_line" ] \
  || fail "mixed scan should render actionable WARN findings before acknowledged INFO findings: $output"
grep -qE 'Findings: 3 in 2 migration\(s\) of 2 scanned \(1 unacknowledged WARN, 2 acknowledged INFO\)\.' <<< "$output" \
  || fail "mixed scan summary counts wrong: $output"
grep -qE '^WARN: migration safety — 1 unacknowledged destructive operation\(s\) in 1 migration\(s\)' <<< "$output" \
  || fail "mixed scan should still emit final WARN doctor signal"
ok "scanner mixes INFO and WARN correctly across allowlisted and new migrations"

# --- stale allowlist entries ---------------------------------------------
# An allowlist entry that names a directory which doesn't exist next to the
# allowlist file is a typo or a removed migration. The scanner must surface
# each stale entry as its own WARN: line (so doctor's counter picks it up)
# plus a final WARN: summary line, even when the scanned migration set has
# no destructive operations.

STALE_ALLOWLIST="$SANDBOX/.safety-acknowledged-stale"
cat > "$STALE_ALLOWLIST" <<'EOF'
# Stale-entry test fixture.
20260101000000_safe              Reviewed: real migration in sandbox.
20260199999999_typoed_migration  Reviewed: typoed name; no such directory.
EOF

# Clean scan + stale entry → stale warning still surfaces.
output=$(MUSI_MIGRATION_ALLOWLIST="$STALE_ALLOWLIST" bash "$SCRIPT" \
  "$SANDBOX/20260101000000_safe")
grep -qE '^WARN: .*\.safety-acknowledged-stale:3 — stale acknowledgement "20260199999999_typoed_migration" — no migration at .*/20260199999999_typoed_migration/migration\.sql' <<< "$output" \
  || fail "stale allowlist entry should emit a per-entry WARN line: $output"
grep -qF 'fix the typo or remove the line if the migration was renamed or removed' <<< "$output" \
  || fail "stale allowlist entry should emit risk guidance"
grep -qE '^Stale allowlist entries: 1 in .*\.safety-acknowledged-stale\.' <<< "$output" \
  || fail "summary should report stale allowlist entry count: $output"
grep -qE '^WARN: migration safety — 1 stale allowlist entry in .*\.safety-acknowledged-stale — fix the typo or remove the line' <<< "$output" \
  || fail "stale allowlist should emit final WARN doctor signal: $output"
! grep -qE '^PASS: migration safety' <<< "$output" \
  || fail "stale allowlist must not also emit a PASS line"
# Valid entry must NOT be reported as stale.
! grep -qE '20260101000000_safe.*stale acknowledgement' <<< "$output" \
  || fail "valid allowlist entry must not be reported as stale"
ok "scanner reports stale allowlist entries even when scanned migrations are clean"

# Multiple stale entries → each gets its own WARN, plus a plural summary.
STALE_MULTI="$SANDBOX/.safety-acknowledged-multi"
cat > "$STALE_MULTI" <<'EOF'
20260101000000_typo_one  Reviewed: typoed.
20260101000000_typo_two
EOF
output=$(MUSI_MIGRATION_ALLOWLIST="$STALE_MULTI" bash "$SCRIPT" \
  "$SANDBOX/20260101000000_safe")
grep -qE '^WARN: .*\.safety-acknowledged-multi:1 — stale acknowledgement "20260101000000_typo_one"' <<< "$output" \
  || fail "first stale entry should emit WARN with line 1: $output"
grep -qE '^WARN: .*\.safety-acknowledged-multi:2 — stale acknowledgement "20260101000000_typo_two"' <<< "$output" \
  || fail "second stale entry should emit WARN with line 2: $output"
grep -qE '^Stale allowlist entries: 2 in .*\.safety-acknowledged-multi\.' <<< "$output" \
  || fail "summary should count both stale entries: $output"
grep -qE '^WARN: migration safety — 2 stale allowlist entries in .*\.safety-acknowledged-multi — fix the typos or remove the lines' <<< "$output" \
  || fail "multiple stale entries should emit pluralized final WARN: $output"
ok "scanner reports each stale allowlist entry with its allowlist line number"

# Stale + unacknowledged finding → both warnings surface in the final summary.
output=$(MUSI_MIGRATION_ALLOWLIST="$STALE_ALLOWLIST" bash "$SCRIPT" \
  "$SANDBOX/20260103000000_drop_column")
grep -qE '^WARN: .*20260103000000_drop_column/migration\.sql:1 — DROP COLUMN' <<< "$output" \
  || fail "unacknowledged finding should still emit per-finding WARN: $output"
grep -qE '^WARN: .*\.safety-acknowledged-stale:3 — stale acknowledgement' <<< "$output" \
  || fail "stale entry should still emit per-entry WARN: $output"
grep -qE '^WARN: migration safety — 1 unacknowledged destructive operation\(s\) in 1 migration\(s\)' <<< "$output" \
  || fail "unacknowledged final WARN should still appear: $output"
grep -qE '^WARN: migration safety — 1 stale allowlist entry in .*\.safety-acknowledged-stale' <<< "$output" \
  || fail "stale final WARN should still appear: $output"
ok "scanner emits both unacknowledged-finding and stale-entry final WARN signals together"

# Allowlist with only valid entries → no stale warnings, PASS preserved.
VALID_ALLOWLIST="$SANDBOX/.safety-acknowledged-valid"
cat > "$VALID_ALLOWLIST" <<'EOF'
20260101000000_safe  Reviewed: real migration in sandbox.
EOF
output=$(MUSI_MIGRATION_ALLOWLIST="$VALID_ALLOWLIST" bash "$SCRIPT" \
  "$SANDBOX/20260101000000_safe")
! grep -qE 'stale acknowledgement|stale allowlist entr' <<< "$output" \
  || fail "valid-only allowlist must not emit any stale warnings: $output"
grep -qE '^PASS: migration safety — no destructive operations detected' <<< "$output" \
  || fail "valid-only allowlist with clean scan should still emit PASS: $output"
ok "scanner does not report stale entries for allowlists that only name real migrations"

# Stale check is independent of which migrations are scanned — scanning one
# unrelated migration should still surface the typoed entry alongside it.
output=$(MUSI_MIGRATION_ALLOWLIST="$STALE_ALLOWLIST" bash "$SCRIPT" \
  "$SANDBOX/20260102000000_drop_table")
grep -qE '^WARN: .*\.safety-acknowledged-stale:3 — stale acknowledgement "20260199999999_typoed_migration"' <<< "$output" \
  || fail "stale-entry detection should not depend on the scanned set: $output"
# Sanity: scanning a sibling migration does not flag the valid `20260101000000_safe`
# entry as stale just because it wasn't in the input set.
! grep -qE '20260101000000_safe.*stale acknowledgement' <<< "$output" \
  || fail "scanning a different migration must not make the safe entry appear stale: $output"
ok "stale-entry detection is independent of the scanned migration set"

# Repo allowlist must be free of stale entries — guards against a real
# `.safety-acknowledged` typo slipping through review.
output=$(bash "$SCRIPT")
! grep -qE '^WARN: migration safety — [0-9]+ stale allowlist entr' <<< "$output" \
  || fail "shipped repo allowlist contains stale entries: $output"
ok "shipped repo allowlist has no stale entries"

# Duplicate allowlist entries are tolerated: the parser keeps the last
# occurrence's line number and does not double-emit. Pin this so future
# refactors don't accidentally produce two WARN lines for the same name.
DUP_ALLOWLIST="$SANDBOX/.safety-acknowledged-dup"
cat > "$DUP_ALLOWLIST" <<'EOF'
20260101000000_typo_dup  Reviewed: typoed (first occurrence).
20260101000000_typo_dup  Reviewed: typoed (second occurrence).
EOF
output=$(MUSI_MIGRATION_ALLOWLIST="$DUP_ALLOWLIST" bash "$SCRIPT" \
  "$SANDBOX/20260101000000_safe")
dup_count=$(grep -cE 'stale acknowledgement "20260101000000_typo_dup"' <<< "$output")
[ "$dup_count" -eq 1 ] \
  || fail "duplicate allowlist entries should emit exactly one stale WARN, got $dup_count: $output"
grep -qE '^WARN: .*\.safety-acknowledged-dup:2 — stale acknowledgement "20260101000000_typo_dup"' <<< "$output" \
  || fail "duplicate allowlist entry should report the last occurrence's line number: $output"
grep -qE '^WARN: migration safety — 1 stale allowlist entry' <<< "$output" \
  || fail "duplicate stale entry should still produce a singular final WARN: $output"
ok "duplicate allowlist entries collapse to a single stale WARN"

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

# --- exit code is always 0 (warn-only) -----------------------------------
set +e
bash "$SCRIPT" "$ENUM_MIG" >/dev/null
rc=$?
set -e
[ "$rc" -eq 0 ] || fail "scanner must exit 0 on findings (warn-only)"
ok "scanner exits 0 even when findings are present"

# --- --json emits a harness-diagnostics envelope -------------------------
# Use the existing fixtures: safe (no findings), drop_column (one WARN),
# and the repo's acknowledged set (info severity). The envelope must
# validate against harnessDiagnosticsSchema and reflect the right
# severities. Always exits 0 (warn-only).
assert_envelope() {
  local file=$1
  local expected_warnings=$2
  local expected_infos=$3
  ASSERT_FILE="$file" ASSERT_WARN="$expected_warnings" ASSERT_INFO="$expected_infos" bun -e '
    const fs = require("fs");
    const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
    const expectedWarn = Number(process.env.ASSERT_WARN);
    const expectedInfo = Number(process.env.ASSERT_INFO);
    if (env.version !== "1") throw new Error("bad version");
    if (env.tool !== "migration-safety-scan") throw new Error(`bad tool ${env.tool}`);
    if (!Array.isArray(env.findings)) throw new Error("findings not array");
    if (env.summary.blocking !== 0) throw new Error(`blocking expected 0, got ${env.summary.blocking}`);
    if (env.summary.warning !== expectedWarn) {
      throw new Error(`warning expected ${expectedWarn}, got ${env.summary.warning}`);
    }
    if (env.summary.info !== expectedInfo) {
      throw new Error(`info expected ${expectedInfo}, got ${env.summary.info}`);
    }
    for (const f of env.findings) {
      if (f.control !== "sensor/db-migration-safety") {
        throw new Error(`bad control ${f.control}`);
      }
      if (f.repairKind !== "manual") {
        throw new Error(`bad repairKind ${f.repairKind}`);
      }
    }
  ' || fail "invalid migration-safety-scan envelope: $file"
}

JSON_OUT="$SANDBOX/json-safe.json"
bash "$SCRIPT" --json "$SANDBOX/20260101000000_safe" > "$JSON_OUT" \
  || fail "--json on safe migration must exit 0"
assert_envelope "$JSON_OUT" 0 0
ok "--json on safe migration emits empty envelope"

JSON_OUT="$SANDBOX/json-drop.json"
bash "$SCRIPT" --json "$SANDBOX/20260103000000_drop_column" > "$JSON_OUT" \
  || fail "--json on drop_column must exit 0"
assert_envelope "$JSON_OUT" 1 0
# Sanity: the warn finding must carry path/line/messageId.
ASSERT_FILE="$JSON_OUT" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (!finding.path || !finding.path.endsWith("/migration.sql")) {
    throw new Error("missing path");
  }
  if (finding.line !== 1) throw new Error(`bad line ${finding.line}`);
  if (finding.messageId !== "DROP COLUMN") throw new Error(`bad messageId ${finding.messageId}`);
  if (finding.severity !== "warn") throw new Error(`bad severity ${finding.severity}`);
' || fail "drop_column envelope missing expected finding shape"
ok "--json on drop_column emits warn finding with messageId/path/line"

# Acknowledged migrations come from the repo's real allowlist; severity must
# be info rather than warn.
JSON_OUT="$SANDBOX/json-repo.json"
bash "$SCRIPT" --json > "$JSON_OUT" \
  || fail "--json on real repo migrations must exit 0"
ASSERT_FILE="$JSON_OUT" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  if (env.summary.warning !== 0) {
    throw new Error(`real repo should have 0 warnings, got ${env.summary.warning}`);
  }
  if (env.summary.info < 1) {
    throw new Error("real repo should have at least one acknowledged finding");
  }
  for (const f of env.findings) {
    if (f.severity !== "info") throw new Error(`real repo finding has severity ${f.severity}`);
  }
' || fail "real repo --json envelope failed"
ok "--json on the real repo emits info-severity acknowledged findings"

# Stale allowlist must surface as a warn-severity finding pointing at the
# allowlist file with the entry's line number.
JSON_OUT="$SANDBOX/json-stale.json"
MUSI_MIGRATION_ALLOWLIST="$STALE_ALLOWLIST" bash "$SCRIPT" --json \
  "$SANDBOX/20260101000000_safe" > "$JSON_OUT" \
  || fail "--json on stale allowlist must exit 0"
ASSERT_FILE="$JSON_OUT" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const stale = env.findings.find((f) => f.messageId === "stale-allowlist");
  if (!stale) throw new Error("missing stale-allowlist finding");
  if (stale.severity !== "warn") throw new Error(`stale severity ${stale.severity}`);
  if (!stale.path.endsWith(".safety-acknowledged-stale")) {
    throw new Error(`stale path ${stale.path}`);
  }
  if (stale.line !== 3) throw new Error(`stale line ${stale.line}`);
' || fail "stale --json envelope missing expected finding shape"
ok "--json surfaces stale allowlist entries as warn-severity findings"

# --- empty migrations dir is benign --------------------------------------
EMPTY="$SANDBOX/empty"
mkdir -p "$EMPTY"
output=$(bash "$SCRIPT" "$EMPTY")
grep -qF 'no migration.sql files found' <<< "$output" \
  || fail "empty dir should report 'no migration.sql files found'"
ok "scanner handles a directory without migration.sql files"

# --json must always emit an envelope, even when nothing was scanned. Bare
# "INFO: no migration.sql files found" output would break consumers that
# parse stdout as JSON.
JSON_OUT="$SANDBOX/json-empty-dir.json"
bash "$SCRIPT" --json "$EMPTY" > "$JSON_OUT" \
  || fail "--json on empty dir must exit 0"
assert_envelope "$JSON_OUT" 0 0
ok "--json on empty directory emits empty envelope"

# --json must preserve tabs in allowlist reasons. The earlier TSV bridge
# silently shifted fields when a reason contained a tab; the regression test
# fails if the bridge is reintroduced.
TAB_ALLOWLIST="$SANDBOX/.safety-acknowledged-tab"
{
  printf '20260103000000_drop_column  Reviewed: data export\tand verified\n'
} > "$TAB_ALLOWLIST"
JSON_OUT="$SANDBOX/json-tab-reason.json"
MUSI_MIGRATION_ALLOWLIST="$TAB_ALLOWLIST" bash "$SCRIPT" --json \
  "$SANDBOX/20260103000000_drop_column" > "$JSON_OUT" \
  || fail "--json with tab in allowlist reason must exit 0"
assert_envelope "$JSON_OUT" 0 1
ASSERT_FILE="$JSON_OUT" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  if (env.findings.length !== 1) throw new Error(`expected 1 finding, got ${env.findings.length}`);
  const f = env.findings[0];
  if (f.severity !== "info") throw new Error(`expected info, got ${f.severity}`);
  if (!f.why.includes("data export")) throw new Error(`why missing reason prefix: ${f.why}`);
  if (!f.why.includes("and verified")) throw new Error(`why missing reason suffix: ${f.why}`);
  if (!f.howToFix.startsWith("Already acknowledged")) {
    throw new Error(`howToFix shifted by tab corruption: ${f.howToFix}`);
  }
' || fail "tab-in-reason envelope corrupted"
ok "--json preserves tabs in allowlist reasons without corrupting fields"

# Missing explicit targets are WARN lines in the human-readable collection
# phase. JSON mode must preserve that signal in the envelope instead of
# reporting an empty, clean scan.
JSON_OUT="$SANDBOX/json-missing-target.json"
JSON_ERR="$SANDBOX/json-missing-target.err"
bash "$SCRIPT" --json "$SANDBOX/does-not-exist-json" > "$JSON_OUT" 2> "$JSON_ERR" \
  || fail "--json on a missing explicit target must exit 0"
assert_envelope "$JSON_OUT" 1 0
grep -qF 'not a file or directory, skipping' "$JSON_ERR" \
  || fail "missing explicit target should still emit stderr WARN"
ASSERT_FILE="$JSON_OUT" bun -e '
  import { readFileSync } from "node:fs";
  const env = JSON.parse(readFileSync(process.env.ASSERT_FILE, "utf8"));
  if (env.summary.warning !== 1) throw new Error(`expected one warning, got ${env.summary.warning}`);
  const finding = env.findings.find((f) => f.messageId === "missing-target");
  if (!finding) throw new Error("missing missing-target finding");
  if (finding.severity !== "warn") throw new Error(`bad severity ${finding.severity}`);
  if (!finding.why.includes("not a file or directory")) throw new Error(`bad why ${finding.why}`);
  if (!finding.path.endsWith("does-not-exist-json")) throw new Error(`bad path ${finding.path}`);
' || fail "missing-target JSON envelope missing expected finding"
ok "--json surfaces missing explicit targets as warn-severity findings"

# Default collection can also fail before any SQL files are collected when the
# repo has no packages/server/prisma/migrations directory. JSON consumers still
# need a parseable envelope with that warning.
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
ASSERT_FILE="$JSON_OUT" bun -e '
  import { readFileSync } from "node:fs";
  const env = JSON.parse(readFileSync(process.env.ASSERT_FILE, "utf8"));
  if (env.summary.warning !== 1) throw new Error(`expected one warning, got ${env.summary.warning}`);
  const finding = env.findings.find((f) => f.messageId === "missing-migrations-directory");
  if (!finding) throw new Error("missing missing-migrations-directory finding");
  if (finding.severity !== "warn") throw new Error(`bad severity ${finding.severity}`);
  if (!finding.why.includes("no migrations directory")) throw new Error(`bad why ${finding.why}`);
  if (!finding.path.endsWith("packages/server/prisma/migrations")) {
    throw new Error(`bad path ${finding.path}`);
  }
' || fail "missing-directory JSON envelope missing expected finding"
ok "--json surfaces missing default migrations directory as warn-severity finding"

# Path containing a tab must be rejected before it can corrupt the TSV.
# The previous version silently shifted fields, downstream jq failed with
# `invalid JSON text passed to --argjson`, but a mid-loop failure in a
# brace-group pipe never propagated. Now the scanner fails loudly at the
# detection stage.
TAB=$(printf '\t')
TABBED_DIR="$SANDBOX/20260104${TAB}_tabbed_dir"
mkdir -p "$TABBED_DIR"
printf 'ALTER TABLE "widgets" DROP COLUMN "obsolete";\n' > "$TABBED_DIR/migration.sql"
set +e
output=$(bash "$SCRIPT" --json "$TABBED_DIR" 2>&1)
rc=$?
set -e
[ "$rc" -ne 0 ] || fail "tab in path must produce a non-zero exit, got $rc"
grep -qF 'contains tab or newline' <<< "$output" \
  || fail "tab in path should produce a 'contains tab or newline' diagnostic"
ok "scanner rejects paths containing tabs before they can corrupt the TSV"
rm -rf "$TABBED_DIR"

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
# the parser fix and the `dirname --` / `basename --` calls in
# migration_name_for.
[ ! -s "$JSON_ERR" ] || fail "-- end-of-options should not produce stderr noise (got: $(cat "$JSON_ERR"))"
ok "-- end-of-options passes option-shaped paths through cleanly"

# --- non-existent path is reported but not fatal -------------------------
set +e
output=$(bash "$SCRIPT" "$SANDBOX/does-not-exist" 2>&1)
rc=$?
set -e
grep -qF 'not a file or directory' <<< "$output" \
  || fail "missing path should be reported"
[ "$rc" -eq 0 ] || fail "missing path should not be fatal"
ok "scanner skips missing paths with a WARN line"

printf 'migration-safety-scan tests passed (%d)\n' "$PASS"

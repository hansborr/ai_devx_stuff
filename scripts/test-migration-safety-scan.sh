#!/usr/bin/env bash
# test-migration-safety-scan.sh — pure-shell smoke tests for
# scripts/migration-safety-scan.sh.
#
# Exercises destructive-operation detection (DROP TABLE, DROP COLUMN,
# ALTER COLUMN ... TYPE, ADD COLUMN ... NOT NULL without DEFAULT) with
# synthetic SQL fixtures, plus the intentional-risk migration precedent
# already in this repo (20260408223838_convert_string_fields_to_enums and
# 20260409120000_add_monster_spells_table). Run via
# `bash scripts/test-migration-safety-scan.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/migration-safety-scan.sh"
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

# --- empty migrations dir is benign --------------------------------------
EMPTY="$SANDBOX/empty"
mkdir -p "$EMPTY"
output=$(bash "$SCRIPT" "$EMPTY")
grep -qF 'no migration.sql files found' <<< "$output" \
  || fail "empty dir should report 'no migration.sql files found'"
ok "scanner handles a directory without migration.sql files"

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

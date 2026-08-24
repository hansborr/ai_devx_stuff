# shellcheck shell=bash
# shellcheck disable=SC2034
# The edit-check wire contract the advisory hooks share with the ratchet CLI:
# row kinds, field names and arities, and the readers that decode one row into
# named variables.
#
# Hand-written, single-owner-checked: EDIT_CHECK_ROW_LAYOUTS in
# tools/lint-ratchet/src/governance/edit-check-protocol.ts owns the layout, and
# scripts/lint-ratchet/edit-check-protocol-shell.test.ts fails if this file
# drifts from it. Change the table first, then this file.

EDIT_CHECK_TARGET_KIND='target'
EDIT_CHECK_TARGET_FIELDS=('kind' 'path' 'testId' 'ruleId' 'cacheIdentity')
EDIT_CHECK_TARGET_FIELD_COUNT=5
EDIT_CHECK_TARGET_MIN_FIELD_COUNT=5

EDIT_CHECK_CHECKED_KIND='checked'
EDIT_CHECK_CHECKED_FIELDS=('kind' 'path')
EDIT_CHECK_CHECKED_FIELD_COUNT=2
EDIT_CHECK_CHECKED_MIN_FIELD_COUNT=2

EDIT_CHECK_REGRESSION_KIND='regression'
EDIT_CHECK_REGRESSION_FIELDS=('kind' 'path' 'testId' 'ruleId' 'reason' 'line' 'baselineCount' 'currentCount' 'repairCommand')
EDIT_CHECK_REGRESSION_FIELD_COUNT=9
EDIT_CHECK_REGRESSION_MIN_FIELD_COUNT=8

EDIT_CHECK_RATCHET_COVERED_KIND='ratchet-covered'
EDIT_CHECK_RATCHET_COVERED_FIELDS=('kind' 'path' 'ruleIds')
EDIT_CHECK_RATCHET_COVERED_FIELD_COUNT=3
EDIT_CHECK_RATCHET_COVERED_MIN_FIELD_COUNT=3

edit_check_read_target_row() {
  IFS=$'\t' read -r EDIT_CHECK_TARGET_ROW_KIND EDIT_CHECK_TARGET_ROW_PATH EDIT_CHECK_TARGET_ROW_TEST_ID EDIT_CHECK_TARGET_ROW_RULE_ID EDIT_CHECK_TARGET_ROW_CACHE_IDENTITY <<< "$1"
}

# The caller supplies a non-whitespace separator so an empty regression line field survives.
edit_check_read_result_row() {
  IFS="$1" read -r EDIT_CHECK_RESULT_KIND EDIT_CHECK_RESULT_PATH EDIT_CHECK_RESULT_TEST_ID EDIT_CHECK_RESULT_RULE_ID EDIT_CHECK_RESULT_REASON EDIT_CHECK_RESULT_LINE EDIT_CHECK_RESULT_BASELINE_COUNT EDIT_CHECK_RESULT_CURRENT_COUNT EDIT_CHECK_RESULT_REPAIR_COMMAND EDIT_CHECK_RESULT_EXTRA <<< "$2"
}

edit_check_read_ratchet_covered_row() {
  IFS=$'\t' read -r EDIT_CHECK_RATCHET_COVERED_ROW_KIND EDIT_CHECK_RATCHET_COVERED_ROW_PATH EDIT_CHECK_RATCHET_COVERED_ROW_RULE_IDS <<< "$1"
}

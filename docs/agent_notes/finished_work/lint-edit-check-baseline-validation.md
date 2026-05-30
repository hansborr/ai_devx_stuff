# Lint Edit-Check Baseline Validation

Date: 2026-05-29

Implemented `/home/node/lint-merge-debt/04-edit-check-baseline-validation.md`.

Notes:

- `scripts/lint-ratchet/baseline-validation.ts` now exports `validateBaselineTestForRatchet(...)`, reusing the full baseline metadata, rule-source, and metric-item validation for one selected test.
- `scripts/lint-ratchet/edit-check.ts` uses that helper before grouping targets, so malformed selected baseline tests soft-skip with no `checked` or `regression` rows.
- `scripts/test-lint-ratchet.sh` covers a corrupted `effective-line-count` baseline item that is still discoverable but not linted by `--edit-check`.
- Verification run: `bash scripts/test-lint-ratchet.sh`; `bun run lint:ratchet`.

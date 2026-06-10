// Pure default config values for the commented-out-code check. Kept in a leaf with
// NO ts-morph (or any runtime-adapter) import so the lightweight check-config module
// (`commented-out-code-check-config.ts`) can reference the default without pulling
// the snippet parser — and therefore ts-morph — into the metadata-registry value
// closure. This mirrors duplicate-shapes-config-values.ts; the metadata import
// boundary test in check-metadata.test.ts enforces the split.

// A run of fewer than three pure-comment lines is not a "block": single
// commented-out statements are often intentional debug toggles, and two-line runs
// are dominated by ordinary leading/trailing prose. Three keeps the sensor focused
// on tombstoned blocks. Override with `checks.commented-out-code.minLines`.
export const DEFAULT_COMMENTED_OUT_CODE_MIN_LINES = 3;

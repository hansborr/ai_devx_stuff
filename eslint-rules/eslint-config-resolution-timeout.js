// @ts-check
//
// Shared per-test timeout for the eslint-rules suites that exercise the REAL
// repo `eslint.config.js` through `ESLint#calculateConfigForFile`
// (max-lines-policy, e2e-selector-config, restricted-syntax-and-globals-config,
// no-shared-schemas-barrel). Each of those pays a one-time ~0.9s flat-config
// normalization on its first resolved path; the actual assertion work is ~1.2s
// standalone.
//
// This value is a HANG-GUARD, not a performance assertion — none of those tests
// measures speed. It only exists to fail a genuinely stuck run (deadlock /
// infinite loop) in finite time. The previous 15s literal was copy-pasted into
// each file and tripped under transient CPU oversubscription (the pre-commit
// hook runs ~8 CPU-heavy gates in parallel, and a co-tenant process — e.g. a
// second review/agent session — can multiply that load), surfacing as a flake
// even though the test was nowhere near 15s of real work. 30s gives ~25x
// headroom over the ~1.2s baseline, absorbing that load without slowing any
// passing run (a passing test returns in ~1-2s regardless of this ceiling).
export const resolvedConfigTestTimeoutMs = 30_000;

// @ts-check
//
// Shared per-test timeout for the eslint-rules suites that exercise the REAL
// repo `eslint.config.js` — every suite importing `./repo-config-harness.js`,
// ten of them today. Naming the harness rather than listing the consumers is
// deliberate: this header previously named four of them and silently went
// stale as the other six were added. Each pays a one-time ~0.9s flat-config
// normalization on its first resolved path; the actual assertion work is ~1.2s
// standalone.
//
// This value is a HANG-GUARD, not a performance assertion — none of those tests
// measures speed. It only exists to fail a genuinely stuck run (deadlock /
// infinite loop) in finite time. The previous 15s literal was copy-pasted into
// each file and tripped under transient CPU oversubscription (the pre-commit
// hook overlaps CPU-heavy checks; the incident record also found orphaned
// synthetic-load busy loops contaminating a high-load session, not live
// concurrent worktrees), surfacing as a flake even though the test was nowhere
// near 15s of real work. A later parallel-gate recurrence reached the 30s guard
// in the two broadest real-config suites while both completed in the full
// ESLint-rule project. 60s keeps a finite hang guard with ~50x headroom over
// the ~1.2s standalone baseline without slowing passing runs.
export const resolvedConfigTestTimeoutMs = 60_000;

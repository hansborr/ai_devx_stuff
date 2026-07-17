// Slots whose pre-commit command legitimately differs from a marker-bridge
// superset consumer's same-named slot. Every other shared slot must render
// identical command tokens: the marker bridge lets a fresh verify/verify:changed
// success marker stand in for a pre-commit run, so a silent command drift would
// let a marker that never exercised pre-commit's semantics satisfy the gate.
// Changed/staged-mode variants are blessed against full verify's stronger
// whole-tree/worktree variants when the bridge uses the worktree fingerprint.
export const MARKER_BRIDGE_DIVERGENCE_ALLOWLIST: readonly {
  readonly supersetId: string;
  readonly slot: string;
  readonly reason: string;
}[] = [
  {
    supersetId: "verify-wrapper/verify",
    slot: "lint",
    reason:
      "pre-commit lints changed files (lint:changed); full verify lints the whole tree (lint).",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "suppressions",
    reason:
      "pre-commit scans suppressions in changed files; full verify audits suppression policy across the whole tree.",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "near-duplicates",
    reason:
      "pre-commit checks pairs touching staged files; full verify checks the whole-tree baseline.",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "debt-accounting",
    reason:
      "pre-commit checks the staged index (--staged); full verify audits the worktree baseline.",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "coverage-map",
    reason:
      "pre-commit checks the staged coverage map (check --staged); full verify audits the worktree (audit).",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "format-check",
    reason:
      "pre-commit format-checks changed files (format:changed:check); full verify checks the whole tree (format:check).",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "test",
    reason:
      "pre-commit runs test:changed with a dynamic per-run timings reporter; full verify runs the whole suite with static json+timings reporters.",
  },
  {
    supersetId: "verify-wrapper/verify",
    slot: "scripts",
    reason:
      "pre-commit runs test:scripts:changed via the staged-script classifier; full verify runs the whole script smoke suite (test:scripts).",
  },
  {
    supersetId: "verify-wrapper/verify-changed",
    slot: "test",
    reason:
      "pre-commit runs test:changed with a dynamic per-run timings reporter; changed verify uses static json+timings reporters.",
  },
];

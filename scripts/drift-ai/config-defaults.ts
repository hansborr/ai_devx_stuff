import { buildDefaultChecksConfig } from "./check-metadata.js";
import type { DriftAiConfig } from "./config.js";

// Returns a fresh, fully plain DriftAiConfig on every call. Each nested array and
// object is newly allocated — the per-check defaults come from
// buildDefaultChecksConfig(), which structuredClones each plugin's defaultConfig —
// so callers can mutate the result without aliasing DEFAULT_DRIFT_AI_CONFIG or any
// other instance. `checks` is built eagerly here (no accessor), so the returned
// object is plain data end to end.
export function makeDefaultDriftAiConfig(): DriftAiConfig {
  return {
    roots: [],
    additionalSourceExtensions: [],
    ignore: {
      segments: [
        "node_modules",
        "vendor",
        "dist",
        "build",
        "coverage",
        ".next",
        "out",
        "target",
        "reports",
        "tmp",
        "generated",
        ".git",
        ".husky",
      ],
      prefixes: [".claude/worktrees/"],
      globs: [],
    },
    checks: buildDefaultChecksConfig(),
  };
}

// A shared, read-only snapshot of the defaults for callers that only read them
// (the ignore rules in git-changed-scope/hotspots, plus tests). Plain materialized
// data — `checks` is a data property, not a getter — so direct reads and
// structuredClone observe identical values. Treat as immutable; use
// makeDefaultDriftAiConfig() when you need a copy you intend to mutate.
export const DEFAULT_DRIFT_AI_CONFIG: DriftAiConfig = makeDefaultDriftAiConfig();

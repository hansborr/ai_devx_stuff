import { matchesAnyGlob } from "./config-match.js";

export const EXACT_NEAR_DUPLICATE_MIN_LINES = 3;
export const EXACT_NEAR_DUPLICATE_MIN_TOKENS = 15;
export const EXACT_NEAR_DUPLICATE_MAX_EQUALITY_GROUP = 100;
export const EXACT_NEAR_DUPLICATE_MAX_PROJECTED_PAIRS = 50_000;

const EXACT_INCLUDE_PREFIXES = ["eslint-rules/", "scripts/"] as const;
const EXACT_EXCLUDE_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/*.fixture.*",
  "**/generated/**",
  "**/*.generated.*",
  "**/*.gen.*",
  "**/*.d.ts",
] as const;

export function isExactCloneFileEligible(filePath: string): boolean {
  return (
    EXACT_INCLUDE_PREFIXES.some((prefix) => filePath.startsWith(prefix)) &&
    !matchesAnyGlob(filePath, EXACT_EXCLUDE_GLOBS)
  );
}

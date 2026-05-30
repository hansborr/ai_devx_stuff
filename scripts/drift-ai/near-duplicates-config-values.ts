export const NEAR_DUPLICATE_TOOL = "ts-morph";
export const SIMILARITY_TS_TOOL = "similarity-ts";

export const DEFAULT_NEAR_DUPLICATE_MIN_LINES = 8;
export const DEFAULT_NEAR_DUPLICATE_MIN_TOKENS = 45;
export const DEFAULT_NEAR_DUPLICATE_SIMILARITY = 0.85;
export const DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO = 0.35;

export const DEFAULT_NEAR_DUPLICATE_IGNORE_GLOBS: readonly string[] = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/*.fixture.ts",
  "**/*.fixture.tsx",
  "**/*.d.ts",
];

export type NearDuplicateEngine = typeof NEAR_DUPLICATE_TOOL | typeof SIMILARITY_TS_TOOL;

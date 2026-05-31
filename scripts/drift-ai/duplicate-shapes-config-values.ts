// Pure default config values for the four duplicate-shape checks. Kept in a leaf
// with NO ts-morph (or any runtime-adapter) import so the lightweight check-config
// modules (`duplicate-*-check-config.ts`) can reference the defaults without
// pulling the AST extractors — and therefore ts-morph — into the metadata-registry
// value closure. This mirrors near-duplicates-config-values.ts; the metadata import
// boundary test in check-metadata.test.ts enforces the split.

export const DEFAULT_DUPLICATE_TYPES_MIN_PROPS = 3;

export const DEFAULT_DUPLICATE_SCHEMAS_MIN_KEYS = 3;

export const DEFAULT_DUPLICATE_LITERALS_MIN_DISTINCT_FILES = 3;
export const DEFAULT_DUPLICATE_LITERALS_MIN_LENGTH = 8;
export const DEFAULT_DUPLICATE_LITERALS_INCLUDE_NUMBERS = false;
export const DEFAULT_DUPLICATE_LITERALS_MIN_NUMBER_DIGITS = 3;

export const DEFAULT_DUPLICATE_CONSTANTS_MIN_DISTINCT_FILES = 2;
export const DEFAULT_DUPLICATE_CONSTANTS_MIN_LENGTH = 8;
export const DEFAULT_DUPLICATE_CONSTANTS_MIN_NUMBER_DIGITS = 3;

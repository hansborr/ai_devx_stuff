import type { CheckConfigMetadata } from "./check-plugin.js";
import { makeEmptyCheckConfig } from "./config-readers.js";

export type SuppressionsConfig = Record<string, never>;

// Default-on: unlike the other no-options checks this one is NOT opt-in, so
// `runByDefault` is intentionally omitted (treated as true) and suppressions stays
// in DEFAULT_CHECKS. Passing `runByDefault: false` here would silently drop it from
// the routine run — the factory call keeps that omission explicit.
export const suppressionsCheckConfig: CheckConfigMetadata<SuppressionsConfig, "suppressions"> =
  makeEmptyCheckConfig("suppressions");

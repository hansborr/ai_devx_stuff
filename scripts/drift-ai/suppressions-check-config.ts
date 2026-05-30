import type { CheckConfigMetadata } from "./check-plugin.js";
import { parseEmptyCheckConfig } from "./config-readers.js";

export type SuppressionsConfig = Record<string, never>;

const DEFAULT_SUPPRESSIONS_CONFIG: SuppressionsConfig = {};

export const suppressionsCheckConfig: CheckConfigMetadata<SuppressionsConfig, "suppressions"> = {
  id: "suppressions",
  usage: "suppressions",
  defaultConfig: DEFAULT_SUPPRESSIONS_CONFIG,
  parseConfig: parseEmptyCheckConfig,
  selectConfig: (config) => config.checks.suppressions,
};

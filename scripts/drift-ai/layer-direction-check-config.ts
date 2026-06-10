import type { CheckConfigMetadata } from "./check-plugin.js";
import { parseEmptyCheckConfig } from "./config-readers.js";

export type LayerDirectionConfig = Record<string, never>;

export const layerDirectionCheckConfig: CheckConfigMetadata<
  LayerDirectionConfig,
  "layer-direction"
> = {
  id: "layer-direction",
  usage: "layer-direction",
  defaultConfig: {},
  parseConfig: parseEmptyCheckConfig,
  selectConfig: (config) => config.checks["layer-direction"],
  // Opt-in: server layer direction is advisory until field runs prove the first
  // rules are low-noise, and building the resolved module graph is whole-project
  // work even when findings are changed-scope-filtered.
  runByDefault: false,
};

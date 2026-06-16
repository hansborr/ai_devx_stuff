import type { CheckConfigMetadata } from "./check-plugin.js";
import { makeEmptyCheckConfig } from "./config-readers.js";

export type LayerDirectionConfig = Record<string, never>;

// Opt-in: server layer direction is advisory until field runs prove the first
// rules are low-noise, and building the resolved module graph is whole-project
// work even when findings are changed-scope-filtered.
export const layerDirectionCheckConfig: CheckConfigMetadata<
  LayerDirectionConfig,
  "layer-direction"
> = makeEmptyCheckConfig("layer-direction", { runByDefault: false });

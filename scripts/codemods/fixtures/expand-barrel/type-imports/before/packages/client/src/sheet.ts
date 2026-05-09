import type { AbilityScores } from "@musi/shared/rules";
import { formatModifier, type HpAdjustmentMode } from "@musi/shared/rules";

export function label(scores: AbilityScores, mode: HpAdjustmentMode): string {
  return `${formatModifier(scores.strength)}:${mode}`;
}

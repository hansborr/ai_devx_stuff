import type { AbilityScores } from "@musi/shared/rules/character-rules.js";
import { formatModifier } from "@musi/shared/rules/character-rules.js";
import { type HpAdjustmentMode } from "@musi/shared/rules/combat.js";

export function label(scores: AbilityScores, mode: HpAdjustmentMode): string {
  return `${formatModifier(scores.strength)}:${mode}`;
}

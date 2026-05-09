import { parseDiceNotation } from "@musi/shared/dice/dice-notation.js";
import { rollFromNotation } from "@musi/shared/dice/dice-roller.js";
import type { ParsedNotation, RollResult } from "@musi/shared/dice/types.js";

export function parseAndRoll(input: string): { parsed: ParsedNotation; rolled: RollResult } {
  return {
    parsed: parseDiceNotation(input),
    rolled: rollFromNotation(input),
  };
}

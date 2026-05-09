import type { ParsedNotation, RollResult } from "@musi/shared/dice";
import { parseDiceNotation, rollFromNotation } from "@musi/shared/dice";

export function parseAndRoll(input: string): { parsed: ParsedNotation; rolled: RollResult } {
  return {
    parsed: parseDiceNotation(input),
    rolled: rollFromNotation(input),
  };
}

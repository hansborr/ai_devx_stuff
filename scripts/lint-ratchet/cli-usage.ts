import { COMMAND_CATALOG } from "./cli-catalog.js";

export function usage(): string {
  const grammar = COMMAND_CATALOG.flatMap(({ usageFragment }) =>
    usageFragment.length === 0 ? [] : [usageFragment],
  ).join(" | ");
  const helpProse = COMMAND_CATALOG.flatMap(({ helpProse: lines }) => lines);
  return [`usage: bun scripts/lint-ratchet.ts [${grammar}]`, "", ...helpProse].join("\n");
}

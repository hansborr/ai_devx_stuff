import { formatEncounterSummary } from "./public-api";

export const renderedEncounterSummary = formatEncounterSummary([
  { name: "ghoul", threat: 2 },
  { name: "wight", threat: 4 },
]);

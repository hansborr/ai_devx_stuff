export type EncounterRow = {
  readonly name: string;
  readonly threat: number;
};

export function formatEncounterSummary(rows: readonly EncounterRow[]): string {
  const sorted = [...rows].sort(
    (left, right) => right.threat - left.threat || left.name.localeCompare(right.name),
  );
  const totalThreat = sorted.reduce((sum, row) => sum + row.threat, 0);
  const names = sorted.map((row) => `${row.name}:${row.threat}`).join(", ");
  return `${names} | total=${totalThreat}`;
}

export const encounterSummaryVersion = "barrel-v1";

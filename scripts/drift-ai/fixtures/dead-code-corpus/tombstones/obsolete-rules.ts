export function abandonedMoraleRule(wounds: number, allies: number): boolean {
  return wounds > 3 && allies < 2;
}

export class LegacyInitiativeAdapter {
  readonly source = "legacy";

  roll(base: number): number {
    return base + 1;
  }
}

export const staleEncounterFlag = "old-rollout";

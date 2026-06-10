export type LazyEncounter = {
  readonly seed: number;
  readonly terrain: string;
  readonly monsterCount: number;
};

export function buildLazyEncounter(seed: number): LazyEncounter {
  return {
    seed,
    terrain: seed % 2 === 0 ? "crypt" : "forest",
    monsterCount: Math.max(1, seed % 5),
  };
}

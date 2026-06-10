export async function resolveLazyEncounterBuilder() {
  const module = await import("./lazy-feature");
  return module.buildLazyEncounter;
}

export async function renderLazyEncounter(seed: number): Promise<string> {
  const build = await resolveLazyEncounterBuilder();
  const encounter = build(seed);
  return `${encounter.terrain}:${encounter.monsterCount}`;
}

export type ScenarioFixture = {
  readonly name: string;
  readonly participants: readonly string[];
};

export function makeScenarioFixture(name: string): ScenarioFixture {
  return {
    name,
    participants: ["cleric", "rogue", "wizard"],
  };
}

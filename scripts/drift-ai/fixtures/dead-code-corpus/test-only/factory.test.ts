import { makeScenarioFixture } from "./factory";

export function buildSpecScenarioName(): string {
  return makeScenarioFixture("ambush").name;
}

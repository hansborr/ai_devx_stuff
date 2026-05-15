/** Shared test data generators and constants for E2E tests. */

export const TEST_PASSWORD = "TestPassword123!";
const RANDOM_SUFFIX_RADIX = 36;
const RANDOM_SUFFIX_START = 2;
const RANDOM_SUFFIX_END = 6;

export const ABILITY_SCORES = [
  { name: "Strength", value: "15" },
  { name: "Dexterity", value: "14" },
  { name: "Constitution", value: "13" },
  { name: "Intelligence", value: "12" },
  { name: "Wisdom", value: "10" },
  { name: "Charisma", value: "8" },
] as const;

/** Returns a unique email like `e2e-auth-1711612800000-x4f2@test.local`. */
export function uniqueEmail(prefix: string): string {
  const rand = Math.random()
    .toString(RANDOM_SUFFIX_RADIX)
    .slice(RANDOM_SUFFIX_START, RANDOM_SUFFIX_END);
  return `e2e-${prefix}-${String(Date.now())}-${rand}@test.local`;
}

/** Returns a unique name like `TestCampaign-1711612800000`. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${String(Date.now())}`;
}

export interface TestUser {
  email: string;
  password: string;
  displayName: string;
}

/** Creates a TestUser with unique email. */
export function makeUser(prefix: string): TestUser {
  return {
    email: uniqueEmail(prefix),
    password: TEST_PASSWORD,
    displayName: `E2E ${prefix}`,
  };
}

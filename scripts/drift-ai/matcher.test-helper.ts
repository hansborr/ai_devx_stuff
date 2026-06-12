import { expect } from "vitest";

// Vitest asymmetric matchers erase to `any`, so embedding them in typed
// expected literals trips @typescript-eslint/no-unsafe-assignment. This seam
// gives expect.stringContaining the string type it stands in for.
export function stringContaining(substring: string): string {
  // type-assertion-boundary: test - vitest asymmetric matchers are typed `any`.
  return expect.stringContaining(substring) as string;
}

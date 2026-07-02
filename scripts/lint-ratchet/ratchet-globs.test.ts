import { describe, expect, it } from "vitest";

import { matchesAny } from "./ratchet-globs.js";

describe("ratchet glob matching", () => {
  it("excludes dotfiles from wildcard segments unless the pattern names the dot", () => {
    expect(matchesAny("packages/app/src/file.ts", ["packages/**/*.ts"])).toBe(true);
    expect(matchesAny("packages/app/src/.hidden.ts", ["packages/**/*.ts"])).toBe(false);
    expect(matchesAny("packages/.secret/file.ts", ["packages/**/*.ts"])).toBe(false);
    expect(matchesAny(".eslintrc.js", ["*.js"])).toBe(false);

    expect(matchesAny("packages/app/src/.hidden.ts", ["packages/**/.hidden.ts"])).toBe(true);
    expect(matchesAny(".eslintrc.js", [".*.js"])).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { globToRegExp, matchesAny, matchesRatchet } from "./ratchet-globs.js";

// The matcher is minimatch with { dot: true } — the same engine and options
// ESLint flat config resolves glob patterns with — so these cases lock the
// four historical divergences from the retired hand-rolled compiler plus the
// dotfile parity decision (see leaf 20 of the 2026-07-11 lint-ratchet audit).
describe("ratchet glob matching", () => {
  it("includes dotfiles like ESLint's dot:true, for every wildcard token", () => {
    // A `*` segment matches dot-prefixed basenames.
    expect(matchesAny(".eslintrc.js", ["*.js"])).toBe(true);
    // A `**` segment crosses dot-prefixed directories.
    expect(matchesAny("packages/.storybook/main.ts", ["packages/**/*.ts"])).toBe(true);
    expect(matchesAny("packages/app/src/.hidden.ts", ["packages/**/*.ts"])).toBe(true);
    // Trailing `**` covers dot segments.
    expect(matchesAny("packages/.storybook/main.ts", ["packages/**"])).toBe(true);
    // Naming the dot explicitly still matches.
    expect(matchesAny("packages/app/src/.hidden.ts", ["packages/**/.hidden.ts"])).toBe(true);
    expect(matchesAny(".eslintrc.js", [".*.js"])).toBe(true);
  });

  it("expands brace alternatives that contain glob metacharacters", () => {
    // The hand-rolled matcher literalized brace contents, so this matched
    // nothing; minimatch expands the globs inside each alternative.
    expect(matchesAny("src/foo/bar.ts", ["{src/**,lib/**}"])).toBe(true);
    expect(matchesAny("lib/x.ts", ["{src/**,lib/**}"])).toBe(true);
    expect(matchesAny("other/x.ts", ["{src/**,lib/**}"])).toBe(false);
    // Literal-word braces (the shape the live registry uses) still work.
    expect(matchesAny("a/b.tsx", ["a/*.{ts,tsx}"])).toBe(true);
    expect(matchesAny("a/b.ts", ["a/*.{ts,tsx}"])).toBe(true);
    expect(matchesAny("a/b.js", ["a/*.{ts,tsx}"])).toBe(false);
  });

  it("treats a mid-segment ** as a single-segment wildcard, not a directory crosser", () => {
    // The hand-rolled matcher compiled a non-segment `**` to `.*`, so this
    // wrongly matched across `/`; minimatch keeps it within one segment.
    expect(matchesAny("a/x/b.ts", ["a**b.ts"])).toBe(false);
    expect(matchesAny("axb.ts", ["a**b.ts"])).toBe(true);
  });

  it("honors character classes instead of literalizing the brackets", () => {
    // The hand-rolled fall-through escaped `[`, `]`, so this matched nothing.
    expect(matchesAny("src/a/b.ts", ["src/**/*.[jt]s"])).toBe(true);
    expect(matchesAny("src/a/b.js", ["src/**/*.[jt]s"])).toBe(true);
    expect(matchesAny("src/a/b.css", ["src/**/*.[jt]s"])).toBe(false);
  });

  it("keeps `*` scoped to a single path segment", () => {
    expect(matchesAny("a/b.ts", ["a/*.ts"])).toBe(true);
    expect(matchesAny("a/x/b.ts", ["a/*.ts"])).toBe(false);
  });

  it("matchesRatchet subtracts ignores from files", () => {
    const scope = { files: ["src/**/*.ts"], ignores: ["src/**/*.test.ts"] };
    expect(matchesRatchet(scope, "src/a/b.ts")).toBe(true);
    expect(matchesRatchet(scope, "src/a/b.test.ts")).toBe(false);
  });

  it("compiles a pattern to an anchored RegExp via the exported helper", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/a/b.ts")).toBe(false);
    expect(re.test("xsrc/a.ts")).toBe(false);
  });

  it("memoizes compiled patterns without changing results across repeated calls", () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      expect(matchesAny("packages/.storybook/main.ts", ["packages/**/*.ts"])).toBe(true);
      expect(matchesAny("other/x.ts", ["{src/**,lib/**}"])).toBe(false);
    }
  });
});

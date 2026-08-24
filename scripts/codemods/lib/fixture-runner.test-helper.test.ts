import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../../test-support/tmp-repo.test-helper.js";
import { enumerateFixtures, expectedRoot } from "./fixture-runner.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function makeFixtureRoot(directories: readonly string[], files: readonly string[] = []): string {
  const root = tmpRepo.makeTempRepo("musi-fixture-runner-enumerate-");
  for (const directory of directories) mkdirSync(path.join(root, directory));
  for (const file of files) writeFileSync(path.join(root, file), "");
  return root;
}

describe("enumerateFixtures", () => {
  it("returns the child directory names in locale order and ignores plain files", () => {
    const root = makeFixtureRoot(["zeta-case", "alpha-case", "middle-case"], ["README.md"]);

    expect(enumerateFixtures(root)).toEqual(["alpha-case", "middle-case", "zeta-case"]);
  });

  it("rejects an empty fixture root instead of returning a vacuous case list", () => {
    const root = makeFixtureRoot([]);

    expect(() => enumerateFixtures(root)).toThrow(
      `No codemod fixture directories found under ${root}`,
    );
    expect(() => enumerateFixtures(root)).toThrow("it.each would register zero cases");
  });

  it("rejects a fixture root that holds only files", () => {
    const root = makeFixtureRoot([], ["case.json", "notes.md"]);

    expect(() => enumerateFixtures(root)).toThrow(
      `No codemod fixture directories found under ${root}`,
    );
  });
});

describe("expectedRoot", () => {
  it("selects the explicit after directory when it exists", () => {
    const caseRoot = makeFixtureRoot(["before", "after"]);

    expect(expectedRoot(caseRoot)).toBe(path.join(caseRoot, "after"));
  });

  it("falls back to the before directory when after is absent", () => {
    const caseRoot = makeFixtureRoot(["before"]);

    expect(expectedRoot(caseRoot)).toBe(path.join(caseRoot, "before"));
  });
});

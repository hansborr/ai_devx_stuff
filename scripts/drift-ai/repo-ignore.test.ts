import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { defaultPathIgnored, normalizeConfiguredPath, stripTrailingSlash } from "./repo-ignore.js";

const tmpRepo = registerTempRootCleanup();

describe("repository ignore probe", () => {
  it("normalizes configured paths and ignored trailing-slash variants", () => {
    const repoRoot = tmpRepo.makeTmpGitRepo("drift-repo-ignore-");
    tmpRepo.writeRepoFile(repoRoot, ".gitignore", "reports/\ncache/\n");

    const isIgnored = defaultPathIgnored(
      repoRoot,
      ["./reports/output.json", "cache/", "./reports/output.json"],
      "repo-ignore-test",
    );

    expect(normalizeConfiguredPath("./reports\\output.json")).toBe("reports/output.json");
    expect(stripTrailingSlash("cache/")).toBe("cache");
    expect(isIgnored("reports/output.json")).toBe(true);
    expect(isIgnored("cache")).toBe(true);
    expect(isIgnored("cache/")).toBe(true);
    expect(isIgnored("src/index.ts")).toBe(false);
  });

  it("does not invoke Git when there are no candidates", () => {
    const isIgnored = defaultPathIgnored("/not/a/repository", [], "repo-ignore-test");

    expect(isIgnored("reports/output.json")).toBe(false);
  });
});

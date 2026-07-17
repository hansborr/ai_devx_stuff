import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  defaultPathProbe,
  detectTargetInstall,
  discoverToolConfig,
  type PathProbe,
} from "./adapter-support.js";

function pathExistsFor(present: readonly string[]): PathProbe {
  const set = new Set(present);
  return (relativePath) => set.has(relativePath);
}

describe("defaultPathProbe", () => {
  const tmpRepo = registerTempRootCleanup();

  function makeRepo(): string {
    const root = path.join(tmpRepo.makeTempRepo("drift-ai-adapter-support-"), "repo");
    tmpRepo.writeRepoFile(root, "config/knip.config.ts", "export default {};\n");
    return root;
  }

  it("checks repo-relative files and directories inside the root", () => {
    const root = makeRepo();
    const probe = defaultPathProbe(root);
    expect(probe("config")).toBe(true);
    expect(probe("config/knip.config.ts")).toBe(true);
    expect(probe("missing")).toBe(false);
  });

  it("refuses paths outside the repo root", () => {
    const root = makeRepo();
    tmpRepo.writeRepoFile(root, "../outside-adapter-support/secret.txt", "nope\n");
    const probe = defaultPathProbe(root);
    expect(probe("../outside-adapter-support/secret.txt")).toBe(false);
    expect(probe("/etc/hosts")).toBe(false);
  });
});

describe("detectTargetInstall", () => {
  it("is true when the repo-root node_modules exists", () => {
    expect(detectTargetInstall(pathExistsFor(["node_modules"]))).toBe(true);
  });

  it("is false on an uninstalled target", () => {
    expect(detectTargetInstall(pathExistsFor([]))).toBe(false);
  });
});

describe("discoverToolConfig", () => {
  const candidates = ["knip.json", "knip.config.ts", "config/knip.config.ts"];

  it("returns the explicit override with target-config provenance, unread", () => {
    const result = discoverToolConfig({
      override: "custom/knip.json",
      candidates,
      // Override is highest authority and is not existence-checked.
      fileExists: pathExistsFor([]),
    });
    expect(result).toEqual({ path: "custom/knip.json", configSource: "target-config" });
  });

  it("finds the first existing known location", () => {
    const result = discoverToolConfig({
      override: null,
      candidates,
      fileExists: pathExistsFor(["config/knip.config.ts"]),
    });
    expect(result).toEqual({ path: "config/knip.config.ts", configSource: "target-config" });
  });

  it("honors candidate priority when several exist", () => {
    const result = discoverToolConfig({
      override: null,
      candidates,
      fileExists: pathExistsFor(["knip.config.ts", "config/knip.config.ts"]),
    });
    expect(result?.path).toBe("knip.config.ts");
  });

  it("returns null when nothing matches (caller applies the remaining rungs)", () => {
    expect(
      discoverToolConfig({ override: null, candidates, fileExists: pathExistsFor([]) }),
    ).toBeNull();
  });
});

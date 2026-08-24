import { cpSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { musiLintRatchetWorkflowVocabulary } from "./engine-binding.js";
import { assertToolchainFreshForBaselineUpdate } from "./toolchain-freshness.js";

const tempRepos = registerTempRootCleanup();
const sourceHelper = resolve(import.meta.dirname, "..", "dependency-freshness.sh");

function makeFreshnessFixture(): string {
  const root = tempRepos.makeTempRepo("lint-ratchet-freshness-");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  cpSync(sourceHelper, join(root, "scripts/dependency-freshness.sh"));
  writeFileSync(join(root, "bun.lock"), "fixture lock\n");
  return root;
}

describe("assertToolchainFreshForBaselineUpdate", () => {
  it("refuses a stale digest marker and chains the complete update recovery", () => {
    const root = makeFreshnessFixture();
    writeFileSync(join(root, "node_modules/.musi-install-digest"), "stale-digest\n");

    expect(() => {
      assertToolchainFreshForBaselineUpdate(root, musiLintRatchetWorkflowVocabulary.updateCommand);
    }).toThrow("install state is stale; run bun install, then re-run bun run lint:ratchet:update");
  });

  it("honors the shell helper's legacy mtime fallback when no marker exists", () => {
    const root = makeFreshnessFixture();
    const old = new Date("2020-01-01T00:00:00.000Z");
    const recent = new Date("2020-01-02T00:00:00.000Z");
    utimesSync(join(root, "bun.lock"), old, old);
    utimesSync(join(root, "node_modules/.bin"), recent, recent);

    expect(() => {
      assertToolchainFreshForBaselineUpdate(root, musiLintRatchetWorkflowVocabulary.updateCommand);
    }).not.toThrow();
  });

  it("refuses missing installs and missing lockfiles with distinct helper states", () => {
    const missingInstallRoot = tempRepos.writeRepo(
      {
        "bun.lock": "fixture lock\n",
        "scripts/dependency-freshness.sh": readHelper(),
      },
      "lint-ratchet-missing-install-",
    );
    expect(() => {
      assertToolchainFreshForBaselineUpdate(
        missingInstallRoot,
        musiLintRatchetWorkflowVocabulary.updateCommand,
      );
    }).toThrow("install state is stale; run bun install, then re-run bun run lint:ratchet:update");

    const missingLockRoot = makeFreshnessFixture();
    rmSync(join(missingLockRoot, "bun.lock"));
    expect(() => {
      assertToolchainFreshForBaselineUpdate(
        missingLockRoot,
        musiLintRatchetWorkflowVocabulary.updateCommand,
      );
    }).toThrow("cannot verify install freshness without bun.lock");
  });
});

function readHelper(): string {
  return readFileSync(sourceHelper, "utf8");
}

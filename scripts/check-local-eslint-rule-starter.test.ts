import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractStandaloneStarter } from "./check-local-eslint-rule-starter.js";

const repoRoot = process.cwd();
const checkerPath = join(import.meta.dirname, "check-local-eslint-rule-starter.ts");
const guide = readFileSync(join(repoRoot, "docs/guides/local-eslint-rules.md"), "utf8");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runChecker(root: string): ReturnType<typeof spawnSync> {
  return spawnSync("bun", [checkerPath], { cwd: root, encoding: "utf8" });
}

function fixtureWithGuide(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "local-eslint-rule-starter-"));
  tempDirs.push(root);
  mkdirSync(join(root, "docs/guides"), { recursive: true });
  writeFileSync(join(root, "docs/guides/local-eslint-rules.md"), source);
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

describe("check-local-eslint-rule-starter", () => {
  it("extracts the four-file starter and exercises its test and lint scripts", () => {
    expect(extractStandaloneStarter(guide).map((file) => file.path)).toEqual([
      "package.json",
      "eslint-rules/no-console-log.js",
      "eslint.config.js",
      "eslint-rules/no-console-log.test.js",
    ]);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("standalone local ESLint rule starter passed");
  });

  it("rejects a missing file fence before trying to run the starter", () => {
    const markerIndex = guide.indexOf("`eslint.config.js` registers");
    const fenceStart = guide.indexOf("```js", markerIndex);
    const fenceEnd = guide.indexOf("\n```", fenceStart);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(fenceStart).toBeGreaterThan(markerIndex);
    expect(fenceEnd).toBeGreaterThan(fenceStart);
    const brokenGuide = `${guide.slice(0, markerIndex)}${guide.slice(fenceEnd + 4)}`;

    const result = runChecker(fixtureWithGuide(brokenGuide));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected 5 fenced blocks in Standalone Starter, found 4");
  });

  it("rejects a starter whose rule test no longer agrees with the rule", () => {
    const brokenGuide = guide.replace(
      'errors: [{ messageId: "useLogger" }]',
      'errors: [{ messageId: "missingMessage" }]',
    );

    const result = runChecker(fixtureWithGuide(brokenGuide));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bun run test failed");
  });

  it("rejects a flat config that no longer activates the documented rule", () => {
    const brokenGuide = guide.replace('      "local/no-console-log": "error",\n', "");

    const result = runChecker(fixtureWithGuide(brokenGuide));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local/no-console-log did not report console.log");
  });

  it("rejects standalone exercise commands that drift from the checker", () => {
    const brokenGuide = guide.replace("bun run lint\n", "bun run lnnt\n");

    const result = runChecker(fixtureWithGuide(brokenGuide));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("standalone exercise commands must be");
  });
});

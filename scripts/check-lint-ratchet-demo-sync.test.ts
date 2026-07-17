import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const DEMO_AUTHORED_RULE = "eslint-rules/no-console-log.js";
const DEMO_AUTHORED_REGISTRY = "scripts/lint-ratchet/lint-ratchet-config.ts";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The guide-mandated demo script surface the checker asserts (see
// REQUIRED_DEMO_SCRIPTS in the checker).
function writeDemoPackageJson(root: string, omit: readonly string[] = []): void {
  const scripts = Object.fromEntries(
    [
      "lint:ratchet",
      "lint:ratchet:check-baseline",
      "lint:ratchet:check-registry",
      "lint:ratchet:debt-log",
      "lint:ratchet:install-merge-driver",
      "lint:ratchet:summary",
      "lint:ratchet:trend",
      "lint:ratchet:update",
      "lint:ratchet:zero-baseline",
    ]
      .filter((name) => !omit.includes(name))
      .map((name) => [name, "bun scripts/lint-ratchet.ts"]),
  );
  mkdirSync(join(root, "examples/lint-ratchet-demo"), { recursive: true });
  mkdirSync(join(root, "examples/lint-ratchet-demo/eslint-rules"), { recursive: true });
  writeFileSync(
    join(root, "examples/lint-ratchet-demo/package.json"),
    `${JSON.stringify({ name: "lint-ratchet-demo", scripts })}\n`,
  );
  writeFileSync(
    join(root, "examples/lint-ratchet-demo", DEMO_AUTHORED_RULE),
    "export default {};\n",
  );
  mkdirSync(join(root, "examples/lint-ratchet-demo/scripts/lint-ratchet"), { recursive: true });
  writeFileSync(
    join(root, "examples/lint-ratchet-demo", DEMO_AUTHORED_REGISTRY),
    "export const lintRatchets = [];\n",
  );
}

function runChecker(root: string, args: readonly string[] = []): ReturnType<typeof spawnSync> {
  // Run under bun (as the package script does) so the checker's `.js` import of
  // the TypeScript shared expander resolves the same way it does in production.
  return spawnSync("bun", [join(import.meta.dirname, "check-lint-ratchet-demo-sync.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("check-lint-ratchet-demo-sync", () => {
  it("owns the demo-local rule separately from manifest-copied runtime files", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    mkdirSync(join(root, "eslint-rules"), { recursive: true });
    writeFileSync(join(root, "eslint-rules/max-lines.js"), "export default {};\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["eslint-rules/max-lines.js"],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );
    mkdirSync(join(root, demo, "eslint-rules"), { recursive: true });
    writeFileSync(join(root, demo, "eslint-rules/max-lines.js"), "export default {};\n");
    writeDemoPackageJson(root);

    expect(runChecker(root).status).toBe(0);

    rmSync(join(root, demo, DEMO_AUTHORED_RULE));
    const missing = runChecker(root);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(`missing demo-authored file: ${DEMO_AUTHORED_RULE}`);
    expect(missing.stderr).toContain("Restore the demo-authored file");
    expect(missing.stderr).not.toContain("lint:ratchet:demo-sync:update");
  });

  it("rejects overlap between demo-authored and manifest-copied files before write mode", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    mkdirSync(join(root, "eslint-rules"), { recursive: true });
    writeFileSync(join(root, DEMO_AUTHORED_RULE), "portable source\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: [DEMO_AUTHORED_RULE],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );
    writeDemoPackageJson(root);
    const authoredBefore = readFileSync(join(root, demo, DEMO_AUTHORED_RULE), "utf8");

    const check = runChecker(root);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain(
      `demo-authored file also appears in portable manifest: ${DEMO_AUTHORED_RULE}`,
    );
    expect(check.stderr).not.toContain("lint:ratchet:demo-sync:update");

    const write = runChecker(root, ["--write"]);
    expect(write.status).toBe(1);
    expect(write.stderr).toContain("Choose exactly one ownership class");
    expect(readFileSync(join(root, demo, DEMO_AUTHORED_RULE), "utf8")).toBe(authoredBefore);
  });

  it("rejects a non-canonical manifest overlap before write mode", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";
    const nonCanonicalRule = `./${DEMO_AUTHORED_RULE}`;

    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    mkdirSync(join(root, "eslint-rules"), { recursive: true });
    writeFileSync(join(root, DEMO_AUTHORED_RULE), "portable source\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: [nonCanonicalRule],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );
    writeDemoPackageJson(root);
    const authoredBefore = readFileSync(join(root, demo, DEMO_AUTHORED_RULE), "utf8");

    const check = runChecker(root);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain(`non-canonical portable manifest path: ${nonCanonicalRule}`);

    const write = runChecker(root, ["--write"]);
    expect(write.status).toBe(1);
    expect(readFileSync(join(root, demo, DEMO_AUTHORED_RULE), "utf8")).toBe(authoredBefore);
  });

  it("reports a missing manifest source without an ENOENT stack trace", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    for (const tree of ["scripts", "packages", "eslint-rules"]) {
      mkdirSync(join(root, "examples/lint-ratchet-demo", tree), { recursive: true });
    }
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["scripts/missing-runtime.ts"],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lint-ratchet demo is out of sync");
    expect(result.stderr).toContain("missing source: scripts/missing-runtime.ts");
    expect(result.stderr).not.toContain("ENOENT");
    expect(result.stderr).toContain("Restore the missing source");
    expect(result.stderr).not.toContain("lint:ratchet:demo-sync:update");
  });

  it("--write diagnoses every missing source before copying any demo file", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    writeFileSync(join(root, "scripts/a-present.ts"), "updated source\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["scripts/a-present.ts", "scripts/z-missing.ts"],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );
    mkdirSync(join(root, demo, "scripts"), { recursive: true });
    writeFileSync(join(root, demo, "scripts/a-present.ts"), "original demo copy\n");
    writeDemoPackageJson(root);

    const result = runChecker(root, ["--write"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing source: scripts/z-missing.ts");
    expect(result.stderr).not.toContain("ENOENT");
    expect(result.stderr).not.toContain("at writeDemoFromManifest");
    expect(readFileSync(join(root, demo, "scripts/a-present.ts"), "utf8")).toBe(
      "original demo copy\n",
    );
  });

  it("--write restores byte-parity from a drifted, missing, and stale demo state", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    // Two real manifest sources: one that will drift, one that will be missing.
    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    writeFileSync(join(root, "scripts/lint-ratchet/atomic-write.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "scripts/lint-ratchet.ts"), "export const b = 2;\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["scripts/lint-ratchet.ts"],
        expandDirectories: [{ path: "scripts/lint-ratchet", include: "*.ts", exclude: ["*.json"] }],
        mergeDriverFiles: [],
      })}\n`,
    );

    // Demo starts drifted (atomic-write copy differs), missing (lint-ratchet.ts
    // absent), and stale (an extra copy no longer in the manifest).
    for (const tree of ["scripts", "packages", "eslint-rules"]) {
      mkdirSync(join(root, demo, tree), { recursive: true });
    }
    writeDemoPackageJson(root);
    mkdirSync(join(root, demo, "scripts/lint-ratchet"), { recursive: true });
    writeFileSync(join(root, demo, "scripts/lint-ratchet/atomic-write.ts"), "drifted\n");
    const stale = join(root, demo, "scripts/lint-ratchet/stale-copy.ts");
    writeFileSync(stale, "export const stale = true;\n");

    const check = runChecker(root);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("lint:ratchet:demo-sync:update");

    const write = runChecker(root, ["--write"]);
    expect(write.status).toBe(0);
    expect(write.stderr).toContain("lint-ratchet demo sync written");

    expect(readFileSync(join(root, demo, "scripts/lint-ratchet/atomic-write.ts"), "utf8")).toBe(
      "export const a = 1;\n",
    );
    expect(readFileSync(join(root, demo, "scripts/lint-ratchet.ts"), "utf8")).toBe(
      "export const b = 2;\n",
    );
    expect(existsSync(stale)).toBe(false);

    expect(runChecker(root).status).toBe(0);
  });

  it("reports a stale copy under a manifest-derived tree", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    writeFileSync(join(root, "scripts/kept.ts"), "export const kept = 1;\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["scripts/kept.ts"],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );

    // Demo is in sync for the manifest file but carries a stale copy under the
    // manifest-derived `scripts` tree — no hand-maintained tree list is consulted.
    mkdirSync(join(root, demo, "scripts"), { recursive: true });
    writeFileSync(join(root, demo, "scripts/kept.ts"), "export const kept = 1;\n");
    writeFileSync(join(root, demo, "scripts/stale-copy.ts"), "export const stale = true;\n");

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not in manifest (stale copy?): scripts/stale-copy.ts");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("reports a missing demo tree alongside other findings without an ENOENT stack", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    writeFileSync(join(root, "scripts/a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "packages/b.ts"), "export const b = 2;\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["scripts/a.ts", "packages/b.ts"],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );

    // Demo has the `scripts` tree (in sync) but the `packages` tree is deleted
    // entirely: the checker must diagnose the missing tree and the missing file,
    // not crash on the absent walk root.
    mkdirSync(join(root, demo, "scripts"), { recursive: true });
    writeFileSync(join(root, demo, "scripts/a.ts"), "export const a = 1;\n");

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing tree in demo: packages");
    expect(result.stderr).toContain("missing in demo: packages/b.ts");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("reports a demo package.json missing a guide-mandated script", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);
    const demo = "examples/lint-ratchet-demo";

    // In-sync single-file manifest so the only findings are script-surface ones.
    mkdirSync(join(root, "scripts/lint-ratchet"), { recursive: true });
    writeFileSync(join(root, "scripts/kept.ts"), "export const kept = 1;\n");
    writeFileSync(
      join(root, "scripts/lint-ratchet/portable-manifest.json"),
      `${JSON.stringify({
        version: 1,
        runtimeFiles: ["scripts/kept.ts"],
        expandDirectories: [],
        mergeDriverFiles: [],
      })}\n`,
    );
    mkdirSync(join(root, demo, "scripts"), { recursive: true });
    writeFileSync(join(root, demo, "scripts/kept.ts"), "export const kept = 1;\n");

    writeDemoPackageJson(root, ["lint:ratchet:trend"]);
    const missing = runChecker(root);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("missing demo package.json script: lint:ratchet:trend");
    expect(missing.stderr).toContain("Update examples/lint-ratchet-demo/package.json");
    expect(missing.stderr).not.toContain("lint:ratchet:demo-sync:update");

    const write = runChecker(root, ["--write"]);
    expect(write.status).toBe(1);
    expect(write.stderr).toContain("missing demo package.json script: lint:ratchet:trend");
    expect(runChecker(root).status).toBe(1);

    writeDemoPackageJson(root);
    expect(runChecker(root).status).toBe(0);
  });

  it("fails fast with a run-from-repo-root message when the manifest is absent", () => {
    // An empty cwd stands in for running the checker outside the repo root, where
    // the manifest read would otherwise throw a raw Bun ENOENT stack.
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-demo-sync-"));
    tempDirs.push(root);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run the checker from the repo root");
    expect(result.stderr).not.toContain("ENOENT");
  });
});

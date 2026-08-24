import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveJscpdBin } from "./jscpd-bin.js";

describe("resolveJscpdBin", () => {
  const moduleDir = path.join("/tools", "scripts", "drift-ai");
  const toolsBin = path.join("/tools", "node_modules", ".bin", "jscpd");
  const targetRoot = "/target";
  const targetBin = path.join(targetRoot, "node_modules", ".bin", "jscpd");
  const override = path.join("/custom", "jscpd");

  it("uses the --jscpd-bin override even when the tools checkout and target also resolve", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      override,
      fileExists: (candidate) =>
        candidate === toolsBin || candidate === targetBin || candidate === override,
    });
    expect(resolution).toEqual({ found: true, binPath: override, source: "override" });
  });

  it("reports a missing override as unresolved instead of silently substituting a checkout bin", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      override,
      fileExists: (candidate) => candidate === toolsBin || candidate === targetBin,
    });
    if (resolution.found) throw new Error("expected the missing override to stay unresolved");
    expect(resolution.searched).toEqual([override]);
  });

  it("resolves the tools-checkout bin before the target when no override is supplied", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: (candidate) => candidate === toolsBin || candidate === targetBin,
    });
    expect(resolution).toEqual({ found: true, binPath: toolsBin, source: "tools-checkout" });
  });

  it("falls back to the target repo when the tools checkout has no jscpd", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: (candidate) => candidate === targetBin,
    });
    expect(resolution).toEqual({ found: true, binPath: targetBin, source: "target-repo" });
  });

  it("reports a not-found skip signal listing where it looked when nothing resolves", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: () => false,
    });
    if (resolution.found) throw new Error("expected jscpd to be unresolved");
    expect(resolution.searched).toContain(toolsBin);
    expect(resolution.searched).toContain(targetBin);
  });

  it("does not consider an override that was not supplied", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: () => false,
    });
    if (resolution.found) throw new Error("expected jscpd to be unresolved");
    expect(resolution.searched).not.toContain(override);
  });
});

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { buildControlCommandSources } from "./command-catalog-sources.js";
import type { HarnessManifest } from "./harness-manifest-schema.js";
import { parseHarnessManifest } from "./harness-manifest-schema.js";
import { loadPackageManifestSurface } from "./package-manifest-scripts.js";

const tmp = registerTempRootCleanup();

function manifestWith(controls: readonly unknown[]): HarnessManifest {
  return parseHarnessManifest({
    scriptParityExemptions: [],
    ciGateControlIds: [],
    controls,
  });
}

const SENSOR = {
  id: "sensor/x",
  kind: "sensor",
  category: "maintainability",
  principle: "Measure x.",
  pairedGuide: "none",
  repairKind: "manual",
  source: "scripts/x.ts",
  invocation: "bun run sensor:x",
};

describe("buildControlCommandSources", () => {
  it("keys a control by the script its invocation names, ignoring trailing arguments", () => {
    const sources = buildControlCommandSources(
      manifestWith([{ ...SENSOR, invocation: "bun run sensor:x --scope current" }]),
    );
    expect([...sources.keys()]).toEqual(["sensor:x"]);
    expect(sources.get("sensor:x")?.[0]?.principle).toBe("Measure x.");
  });

  it("skips a control whose invocation is not a bun run script", () => {
    const sources = buildControlCommandSources(
      manifestWith([{ ...SENSOR, invocation: "bash scripts/x.sh" }]),
    );
    expect(sources.size).toBe(0);
  });

  it("adds a separate source for a generatedSurface checkScript, so the twin is documented once and needs no exemption", () => {
    const sources = buildControlCommandSources(
      manifestWith([
        {
          ...SENSOR,
          id: "doc-generator/x",
          kind: "doc-generator",
          repairKind: "autofix",
          invocation: "bun run docs:x",
          generatedSurface: {
            triggerPaths: ["scripts/x.ts"],
            outputPaths: ["docs/generated/x.md"],
            checkScript: "docs:x:check",
            warnLabel: "x",
            bunHook: { refresh: "bypass", check: "wrapped" },
          },
        },
      ]),
    );
    expect([...sources.keys()].sort()).toEqual(["docs:x", "docs:x:check"]);
    expect(sources.get("docs:x:check")?.[0]?.checksRefreshScript).toBe("docs:x");
    expect(sources.get("docs:x:check")?.[0]?.outputPaths).toEqual(["docs/generated/x.md"]);
  });

  it("marks the refresh script of a generated surface as a writer, whatever kind its control carries", () => {
    const sources = buildControlCommandSources(
      manifestWith([
        {
          ...SENSOR,
          id: "check/x-generator",
          kind: "check",
          invocation: "bun run harness:x",
          generatedSurface: {
            triggerPaths: ["scripts/x.ts"],
            outputPaths: ["scripts/x.generated.sh"],
            checkScript: "harness:x:check",
            warnLabel: "x",
            bunHook: { refresh: "bypass", check: "wrapped" },
          },
        },
      ]),
    );
    expect(sources.get("harness:x")?.[0]?.refreshesGeneratedSurface).toBe(true);
    expect(sources.get("harness:x:check")?.[0]?.refreshesGeneratedSurface).toBeUndefined();
  });

  it("sorts several controls on one script by id, so the rendered page is stable", () => {
    const sources = buildControlCommandSources(
      manifestWith([
        { ...SENSOR, id: "sensor/b" },
        { ...SENSOR, id: "sensor/a" },
      ]),
    );
    expect(sources.get("sensor:x")?.map((source) => source.id)).toEqual(["sensor/a", "sensor/b"]);
  });
});

describe("loadPackageManifestSurface", () => {
  it("reads every tracked manifest and marks only workspace members as --filter targets", () => {
    const root = tmp.writeRepo({
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        scripts: { dev: "x" },
      }),
      "packages/server/package.json": JSON.stringify({
        name: "@x/server",
        scripts: { build: "tsc -b" },
      }),
      "examples/demo/package.json": JSON.stringify({ name: "demo", scripts: { smoke: "sh s.sh" } }),
    });
    const surface = loadPackageManifestSurface(root, () =>
      ["package.json", "packages/server/package.json", "examples/demo/package.json"].join("\0"),
    );
    expect(surface.manifests.map((entry) => entry.path)).toEqual([
      "examples/demo/package.json",
      "package.json",
      "packages/server/package.json",
    ]);
    expect([...surface.workspacePackageNames]).toEqual(["@x/server"]);
  });

  it("ignores a tracked file that merely ends in package.json", () => {
    const root = tmp.writeRepo({
      "package.json": JSON.stringify({ name: "root", scripts: {} }),
    });
    const surface = loadPackageManifestSurface(root, () =>
      ["package.json", "docs/example-package.json"].join("\0"),
    );
    expect(surface.manifests.map((entry) => entry.path)).toEqual(["package.json"]);
  });

  it("keeps a manifest that declares no scripts, so the page's manifest count stays honest", () => {
    const root = tmp.writeRepo({
      "package.json": JSON.stringify({ name: "root", scripts: { dev: "x" } }),
      "tools/thing/package.json": JSON.stringify({ name: "@x/thing" }),
    });
    const surface = loadPackageManifestSurface(root, () =>
      ["package.json", "tools/thing/package.json"].join("\0"),
    );
    expect(surface.manifests).toHaveLength(2);
    expect(surface.manifests[1]?.scripts.size).toBe(0);
  });
});

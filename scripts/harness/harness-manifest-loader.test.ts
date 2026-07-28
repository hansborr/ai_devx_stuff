import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";
import {
  loadTypedHarnessManifest,
  loadTypedHarnessManifestIfPresent,
} from "./harness-manifest-loader.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tmpRepo = registerTempRootCleanup();

function minimalControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sensor/example",
    kind: "sensor",
    category: "maintainability",
    principle: "Example principle text.",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/example.sh",
    invocation: "bun run example",
    ...overrides,
  };
}

function makeRoot(manifest: unknown): string {
  return tmpRepo.writeRepo(
    { [HARNESS_MANIFEST_FILENAME]: JSON.stringify(manifest) },
    "harness-manifest-loader-",
  );
}

function makeEmptyRoot(): string {
  return tmpRepo.writeRepo({ "package.json": "{}" }, "harness-manifest-loader-absent-");
}

const minimalManifest = {
  scriptParityExemptions: [],
  ciGateControlIds: [],
  controls: [minimalControl()],
};

describe("loadTypedHarnessManifest", () => {
  it("parses the real checked-in manifest into the typed contract", () => {
    const manifest = loadTypedHarnessManifest(repoRoot);
    expect(manifest.controls.length).toBeGreaterThan(0);
    expect(manifest.scriptParityExemptions).toBeInstanceOf(Array);
    expect(manifest.ciGateControlIds).toBeInstanceOf(Array);
  });

  it("composes the leaf read with the typed parse for an arbitrary repo root", () => {
    const manifest = loadTypedHarnessManifest(makeRoot(minimalManifest));
    expect(manifest.controls[0]?.kind).toBe("sensor");
    expect(manifest.controls[0]?.id).toBe("sensor/example");
  });

  it("throws every schema failure at once, each naming the manifest file", () => {
    const root = makeRoot({ controls: [minimalControl({ principle: undefined })] });
    expect(() => loadTypedHarnessManifest(root)).toThrow(/failed schema validation/u);
    expect(() => loadTypedHarnessManifest(root)).toThrow(/scriptParityExemptions/u);
    expect(() => loadTypedHarnessManifest(root)).toThrow(/ciGateControlIds/u);
    expect(() => loadTypedHarnessManifest(root)).toThrow(/controls\.0\.principle/u);
  });

  it("propagates the read failure when the manifest is absent", () => {
    expect(() => loadTypedHarnessManifest(makeEmptyRoot())).toThrow(/ENOENT/u);
  });
});

describe("loadTypedHarnessManifestIfPresent", () => {
  it("returns the parsed manifest when the file exists", () => {
    expect(loadTypedHarnessManifestIfPresent(makeRoot(minimalManifest))?.controls[0]?.id).toBe(
      "sensor/example",
    );
  });

  it("returns undefined when the tree carries no manifest", () => {
    expect(loadTypedHarnessManifestIfPresent(makeEmptyRoot())).toBeUndefined();
  });

  it("still throws on a present-but-invalid manifest", () => {
    expect(() => loadTypedHarnessManifestIfPresent(makeRoot({ controls: [] }))).toThrow(
      /failed schema validation/u,
    );
  });
});

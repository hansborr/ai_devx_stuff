import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HARNESS_MANIFEST_FILENAME,
  harnessManifestPath,
  loadHarnessManifest,
  readHarnessManifest,
} from "./harness-paths.js";

const tempRoots: string[] = [];

function makeTempRoot(manifestBody: string): string {
  const root = mkdtempSync(join(tmpdir(), "harness-paths-"));
  tempRoots.push(root);
  writeFileSync(join(root, HARNESS_MANIFEST_FILENAME), manifestBody);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("harnessManifestPath", () => {
  it("joins repoRoot with the manifest filename", () => {
    expect(harnessManifestPath("/repo")).toBe(join("/repo", HARNESS_MANIFEST_FILENAME));
  });
});

describe("readHarnessManifest", () => {
  it("parses the manifest JSON verbatim without shape validation", () => {
    const root = makeTempRoot('{"controls": [], "extra": 1}');
    expect(readHarnessManifest(root)).toEqual({ controls: [], extra: 1 });
  });
});

describe("loadHarnessManifest", () => {
  it("returns the controls array", () => {
    const root = makeTempRoot('{"controls": [{"id": "a"}, {"id": "b"}]}');
    expect(loadHarnessManifest(root)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("throws the shared controls-array message when the root is not an object", () => {
    const root = makeTempRoot("[]");
    expect(() => loadHarnessManifest(root)).toThrow(
      `${HARNESS_MANIFEST_FILENAME} must declare a controls array`,
    );
  });

  it("throws the shared controls-array message when controls is not an array", () => {
    const root = makeTempRoot('{"controls": {}}');
    expect(() => loadHarnessManifest(root)).toThrow(
      `${HARNESS_MANIFEST_FILENAME} must declare a controls array`,
    );
  });
});

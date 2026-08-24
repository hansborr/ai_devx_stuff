import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  HARNESS_LINT_RULE_CONTROLS_FILENAME,
  HARNESS_MANIFEST_FILENAME,
  harnessManifestPath,
  loadHarnessManifest,
  readHarnessManifest,
} from "./harness-manifest.js";

const tmpRepo = registerTempRootCleanup();

function makeTempRoot(manifestBody: string, includeBody?: string): string {
  return tmpRepo.writeRepo(
    {
      [HARNESS_MANIFEST_FILENAME]: manifestBody,
      ...(includeBody === undefined ? {} : { [HARNESS_LINT_RULE_CONTROLS_FILENAME]: includeBody }),
    },
    "harness-manifest-",
  );
}

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

  it("appends the generated lint-rule controls and keeps the other root fields", () => {
    const root = makeTempRoot(
      '{"controls": [{"id": "sensor/a"}], "extra": 1}',
      '{"$comment": "generated", "controls": [{"id": "lint/local/x"}]}',
    );

    expect(readHarnessManifest(root)).toEqual({
      controls: [{ id: "sensor/a" }, { id: "lint/local/x" }],
      extra: 1,
    });
  });

  it("reads a manifest with no include, as the doc-generator smoke fixtures carry", () => {
    const root = makeTempRoot('{"controls": [{"id": "sensor/a"}]}');
    expect(readHarnessManifest(root)).toEqual({ controls: [{ id: "sensor/a" }] });
  });

  it("refuses an include that exists but declares no controls array", () => {
    const root = makeTempRoot('{"controls": []}', '{"controls": {}}');
    expect(() => readHarnessManifest(root)).toThrow(
      `${HARNESS_LINT_RULE_CONTROLS_FILENAME} must declare a controls array`,
    );
  });

  it("leaves a defective root untouched so its own reader keeps the wording", () => {
    const root = makeTempRoot("[]", '{"controls": [{"id": "lint/local/x"}]}');
    expect(readHarnessManifest(root)).toEqual([]);
  });
});

describe("loadHarnessManifest", () => {
  it("returns the controls array", () => {
    const root = makeTempRoot('{"controls": [{"id": "a"}, {"id": "b"}]}');
    expect(loadHarnessManifest(root)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("returns the assembled controls array, include and all", () => {
    const root = makeTempRoot(
      '{"controls": [{"id": "a"}]}',
      '{"controls": [{"id": "lint/local/x"}]}',
    );
    expect(loadHarnessManifest(root)).toEqual([{ id: "a" }, { id: "lint/local/x" }]);
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

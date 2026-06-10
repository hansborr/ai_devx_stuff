import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCoverageArtifactEvidence,
  detectCoverageFormat,
  readCoverageArtifacts,
} from "./coverage-artifacts.js";

const FIXTURE_REPO = path.dirname(fileURLToPath(import.meta.url));
const UNIT = "fixtures/coverage/unit.lcov.info";
const E2E = "fixtures/coverage/e2e.lcov.info";

describe("detectCoverageFormat", () => {
  it("recognizes the lcov .info extension case-insensitively", () => {
    expect(detectCoverageFormat("coverage/lcov.info")).toBe("lcov");
    expect(detectCoverageFormat("reports/UNIT.INFO")).toBe("lcov");
  });

  it("returns null for unsupported formats", () => {
    expect(detectCoverageFormat("coverage/coverage-final.json")).toBeNull();
    expect(detectCoverageFormat("coverage/clover.xml")).toBeNull();
  });
});

describe("buildCoverageArtifactEvidence", () => {
  it("parses lcov content and carries descriptor metadata through", () => {
    const evidence = buildCoverageArtifactEvidence({
      path: "coverage/lcov.info",
      label: "unit",
      content: "SF:src/a.ts\nDA:1,2\nend_of_record\n",
      format: "lcov",
      timestamp: "2026-06-04T00:00:00.000Z",
    });
    expect(evidence.path).toBe("coverage/lcov.info");
    expect(evidence.label).toBe("unit");
    expect(evidence.format).toBe("lcov");
    expect(evidence.timestamp).toBe("2026-06-04T00:00:00.000Z");
    expect(evidence.files).toHaveLength(1);
    expect(evidence.notes).toEqual([]);
  });

  it("flags an unsupported format without parsing", () => {
    const evidence = buildCoverageArtifactEvidence({
      path: "coverage/coverage-final.json",
      label: "unit",
      content: "{}",
      format: null,
      timestamp: null,
    });
    expect(evidence.format).toBeNull();
    expect(evidence.files).toEqual([]);
    expect(evidence.notes).toEqual([
      {
        kind: "unsupported-format",
        detail:
          "no parser for artifact 'coverage/coverage-final.json'; only lcov (.info) is supported",
      },
    ]);
  });

  it("flags an empty artifact as a degradation note", () => {
    const evidence = buildCoverageArtifactEvidence({
      path: "coverage/lcov.info",
      label: "unit",
      content: "   \n",
      format: "lcov",
      timestamp: null,
    });
    expect(evidence.files).toEqual([]);
    expect(evidence.notes).toEqual([
      { kind: "empty-artifact", detail: "artifact 'coverage/lcov.info' is empty" },
    ]);
  });
});

describe("readCoverageArtifacts", () => {
  it("reads a coverage fixture into evidence with a timestamp", () => {
    const [evidence] = readCoverageArtifacts({
      repoRoot: FIXTURE_REPO,
      artifacts: [{ path: UNIT, label: "unit" }],
    });
    expect(evidence?.format).toBe("lcov");
    expect(evidence?.label).toBe("unit");
    expect(evidence?.files.map((file) => file.file)).toEqual(["src/math.ts", "src/util.ts"]);
    expect(typeof evidence?.timestamp).toBe("string");
  });

  it("keeps overlapping source files separate per artifact instead of merging", () => {
    const evidence = readCoverageArtifacts({
      repoRoot: FIXTURE_REPO,
      artifacts: [
        { path: UNIT, label: "unit" },
        { path: E2E, label: "e2e" },
      ],
    });
    expect(evidence.map((entry) => entry.label)).toEqual(["unit", "e2e"]);

    const unitAdd = evidence[0]?.files
      .find((file) => file.file === "src/math.ts")
      ?.functions.find((fn) => fn.name === "add");
    const e2eAdd = evidence[1]?.files
      .find((file) => file.file === "src/math.ts")
      ?.functions.find((fn) => fn.name === "add");
    expect(unitAdd?.hits).toBe(3);
    expect(e2eAdd?.hits).toBe(1);
  });

  it("records a read failure for a missing artifact without throwing", () => {
    const [evidence] = readCoverageArtifacts({
      repoRoot: FIXTURE_REPO,
      artifacts: [{ path: "fixtures/coverage/does-not-exist.info", label: "unit" }],
    });
    expect(evidence?.format).toBeNull();
    expect(evidence?.timestamp).toBeNull();
    expect(evidence?.files).toEqual([]);
    expect(evidence?.notes[0]?.kind).toBe("read-failure");
  });
});

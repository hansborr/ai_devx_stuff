import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readCoverageArtifacts } from "./coverage-artifacts.js";
import {
  buildCoverageEvidenceAdvisory,
  formatCoverageEvidenceAdvisoryJson,
  formatCoverageEvidenceAdvisoryText,
} from "./coverage-evidence-advisory.js";
import type { CoverageArtifactEvidence } from "./coverage-types.js";

const FIXTURE_REPO = path.dirname(fileURLToPath(import.meta.url));
const UNIT = "fixtures/coverage/unit.lcov.info";
const E2E = "fixtures/coverage/e2e.lcov.info";
const MALFORMED = "fixtures/coverage/malformed.lcov.info";

function fixtureEvidence(
  artifacts: readonly { path: string; label: string }[],
): CoverageArtifactEvidence[] {
  return readCoverageArtifacts({ repoRoot: FIXTURE_REPO, artifacts });
}

describe("buildCoverageEvidenceAdvisory", () => {
  it("wraps populated coverage rows in the prototype advisory contract", () => {
    const advisory = buildCoverageEvidenceAdvisory(
      fixtureEvidence([{ path: UNIT, label: "unit" }]),
    );
    const section = advisory.sections[0];

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("coverage-evidence");
    expect("findings" in advisory).toBe(false);
    expect(section?.artifact).toMatchObject({
      path: UNIT,
      label: "unit",
      format: "lcov",
    });
    expect(section?.totalCandidates).toBe(9);
    expect(section?.entries[0]).toMatchObject({
      rank: 1,
      source: { path: UNIT, label: "unit", format: "lcov" },
      kind: "function",
      file: "src/math.ts",
      name: "add",
      line: 1,
      hits: 3,
    });
  });

  it("renders artifact provenance, hit counts, summaries, and no finding language", () => {
    const text = formatCoverageEvidenceAdvisoryText(
      buildCoverageEvidenceAdvisory(fixtureEvidence([{ path: UNIT, label: "unit" }]), { top: 20 }),
    );

    expect(text).toContain("drift:ai coverage-evidence (advisory, prototype lane)");
    expect(text).toContain("prerequisite coverage artifacts: ok -- 1 configured artifact");
    expect(text).toContain("cap rows per artifact: within limit 20");
    expect(text).toContain(`artifact unit: ${UNIT} (lcov, timestamp `);
    expect(text).toContain("summary: files 2, functions 2/3 hit, lines 4/6 hit");
    expect(text).toContain("#1 function src/math.ts:1 add hits 3");
    expect(text).toContain("#2 function src/math.ts:5 subtract hits 0");
    expect(text).toContain("#3 line src/math.ts:1 hits 3");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("explains an unconfigured run without presenting coverage as clear", () => {
    const advisory = buildCoverageEvidenceAdvisory([]);

    expect(advisory.prerequisites).toEqual([
      {
        name: "coverage artifacts",
        satisfied: false,
        detail: "0 configured artifacts; add coverage.artifacts to drift-ai config",
      },
    ]);
    expect(advisory.sections[0]).toMatchObject({
      artifact: null,
      totalCandidates: 0,
      entries: [],
      emptyReason: "no coverage artifacts configured.",
    });
  });

  it("reports missing artifacts as partial evidence instead of findings", () => {
    const advisory = buildCoverageEvidenceAdvisory(
      fixtureEvidence([{ path: "fixtures/coverage/missing.info", label: "unit" }]),
    );
    const text = formatCoverageEvidenceAdvisoryText(advisory);

    expect(advisory.degradations[0]).toContain("unit fixtures/coverage/missing.info: read-failure");
    expect(advisory.sections[0]?.emptyReason).toBe("no coverage rows parsed from artifact 'unit'.");
    expect(text).toContain("note read-failure: could not read artifact");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("discloses parse notes while keeping parsed evidence", () => {
    const advisory = buildCoverageEvidenceAdvisory(
      fixtureEvidence([{ path: MALFORMED, label: "unit" }]),
    );
    const text = formatCoverageEvidenceAdvisoryText(advisory);

    expect(advisory.sections[0]?.entries.length).toBeGreaterThan(0);
    expect(advisory.degradations).toContain(
      "unit fixtures/coverage/malformed.lcov.info: malformed-record line 3 - DA record has a malformed line/hits 'notanumber,3'",
    );
    expect(text).toContain(
      "note malformed-record line 3: DA record has a malformed line/hits 'notanumber,3'",
    );
  });

  it("keeps multiple artifacts in separate sections", () => {
    const advisory = buildCoverageEvidenceAdvisory(
      fixtureEvidence([
        { path: UNIT, label: "unit" },
        { path: E2E, label: "e2e" },
      ]),
    );

    expect(advisory.sections.map((section) => section.artifact?.label)).toEqual(["unit", "e2e"]);
    const unitAdd = advisory.sections[0]?.entries.find(
      (row) => row.kind === "function" && row.name === "add",
    );
    const e2eAdd = advisory.sections[1]?.entries.find(
      (row) => row.kind === "function" && row.name === "add",
    );
    expect(unitAdd?.hits).toBe(3);
    expect(e2eAdd?.hits).toBe(1);
  });

  it("serializes as advisory JSON with no top-level findings key", () => {
    const json = JSON.parse(
      formatCoverageEvidenceAdvisoryJson(
        buildCoverageEvidenceAdvisory(fixtureEvidence([{ path: UNIT, label: "unit" }])),
      ),
    ) as Record<string, unknown>;

    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
    expect(json["subcommand"]).toBe("coverage-evidence");
    expect("findings" in json).toBe(false);
  });
});

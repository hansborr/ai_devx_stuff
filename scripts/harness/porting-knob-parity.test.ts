import { describe, expect, it } from "vitest";

import {
  collectPortingKnobMarkers,
  parsePortingChecklist,
  portingKnobParityFailures,
} from "./porting-knob-parity.js";

describe("porting-knob checklist parity", () => {
  it("matches Porting This checklist ids to greppable source markers", () => {
    const readme = [
      "## Porting This",
      "",
      "- `repo-root-fallback` — retarget the checkout fallback.",
      "- `hook-state-paths` — retarget state roots.",
      "",
      "## Another Section",
      "",
      "- `ignored` — outside the checklist.",
    ].join("\n");
    const markerPrefix = "// porting-" + "knob:";
    const sources = new Map([
      ["scripts/a.ts", `${markerPrefix} repo-root-fallback\n`],
      ["scripts/b.sh", `# porting-knob: hook-state-paths -- defaults\n`],
    ]);

    expect(parsePortingChecklist(readme)).toEqual(["repo-root-fallback", "hook-state-paths"]);
    expect(collectPortingKnobMarkers(sources)).toEqual(
      new Map([
        ["hook-state-paths", ["scripts/b.sh"]],
        ["repo-root-fallback", ["scripts/a.ts"]],
      ]),
    );
    expect(portingKnobParityFailures(readme, sources)).toEqual([]);
  });

  it("reports checklist-only and source-only ids", () => {
    const readme = "## Porting This\n\n- `documented-only` — stale documentation.\n";
    const markerPrefix = "# porting-" + "knob:";
    const sources = new Map([["scripts/only.sh", `${markerPrefix} source-only\n`]]);

    expect(portingKnobParityFailures(readme, sources)).toEqual([
      "Porting This documents marker without a source comment: documented-only",
      "source marker is missing from Porting This: source-only (scripts/only.sh)",
    ]);
  });

  it("rejects duplicate checklist ids and a missing Porting This section", () => {
    const duplicateReadme = [
      "## Porting This",
      "- `same-knob` — first.",
      "- `same-knob` — duplicate.",
    ].join("\n");
    const markerPrefix = "# porting-" + "knob:";
    const sources = new Map([["scripts/knob.sh", `${markerPrefix} same-knob\n`]]);

    expect(portingKnobParityFailures(duplicateReadme, sources)).toEqual([
      "Porting This contains duplicate marker id: same-knob",
    ]);
    expect(portingKnobParityFailures("# No checklist\n", new Map())).toEqual([
      "scripts/ai-hooks/README.md is missing the Porting This section",
    ]);
  });

  it("rejects Porting This bullets without a marker id", () => {
    const readme = "## Porting This\n\n- A prose-only knob that parity cannot identify.\n";

    expect(portingKnobParityFailures(readme, new Map())).toEqual([
      "Porting This bullet is missing a leading `porting-knob` id: - A prose-only knob that parity cannot identify.",
    ]);
  });
});

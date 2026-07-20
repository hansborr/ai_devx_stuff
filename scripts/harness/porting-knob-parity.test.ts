import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  checkPortingKnobParity,
  collectPortingKnobMarkers,
  parsePortingChecklist,
  portingKnobParityFailures,
} from "./porting-knob-parity.js";

const tmpRepo = registerTempRootCleanup();

function checklistReadme(ids: readonly string[]): string {
  return ["## Porting This", "", ...ids.map((id) => `- \`${id}\` — retarget.`), ""].join("\n");
}

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

  it("collects markers written in block-comment and JSDoc-continuation forms", () => {
    const sources = new Map([
      ["scripts/block.ts", "/* porting-knob: block-form -- retarget me */\n"],
      ["scripts/jsdoc.ts", "/**\n * porting-knob: jsdoc-form -- retarget me\n */\n"],
    ]);

    expect(collectPortingKnobMarkers(sources)).toEqual(
      new Map([
        ["block-form", ["scripts/block.ts"]],
        ["jsdoc-form", ["scripts/jsdoc.ts"]],
      ]),
    );
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

describe("checkPortingKnobParity (scan roots over a temp repo)", () => {
  it("scans eslint-config, .husky, and top-level files for markers", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/ai-hooks/README.md": checklistReadme([
          "config-knob",
          "hook-knob",
          "top-level-knob",
        ]),
        "eslint-config/policy.js": "// porting-knob: config-knob -- retarget policy\n",
        ".husky/pre-commit": "# porting-knob: hook-knob -- retarget hook\n",
        "commitlint.config.js": "// porting-knob: top-level-knob -- retarget config\n",
      },
      "porting-knob-roots-",
    );

    expect(checkPortingKnobParity(root)).toEqual([]);
  });

  it("reports a marker under a widened root that the checklist omits", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/ai-hooks/README.md": checklistReadme([]),
        ".husky/pre-push": "# porting-knob: escaped-knob -- would have escaped\n",
      },
      "porting-knob-escape-",
    );

    const failures = checkPortingKnobParity(root);
    expect(failures).toEqual([
      "source marker is missing from Porting This: escaped-knob (.husky/pre-push)",
    ]);
  });

  it("tolerates missing scan roots, as in reduced fixture trees", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/ai-hooks/README.md": checklistReadme(["only-knob"]),
        "scripts/hook.sh": "# porting-knob: only-knob -- the sole marker\n",
      },
      "porting-knob-sparse-",
    );

    expect(checkPortingKnobParity(root)).toEqual([]);
  });

  it("does not recurse into top-level directories outside the scan roots", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/ai-hooks/README.md": checklistReadme([]),
        "packages/server/src/thing.ts": "// porting-knob: out-of-scope -- never scanned\n",
        "docs/notes.md": "# porting-knob: prose-mention -- never scanned\n",
      },
      "porting-knob-scope-",
    );

    expect(checkPortingKnobParity(root)).toEqual([]);
  });
});

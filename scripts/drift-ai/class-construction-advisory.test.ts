import { describe, expect, it } from "vitest";

import {
  CLASS_CONSTRUCTION_STANDING_CAVEAT,
  type ClassCaveatLabeler,
  type ClassConstructionSourceInput,
  inventoryClasses,
} from "./class-construction.js";
import {
  buildClassConstructionAdvisory,
  formatClassConstructionAdvisoryJson,
  formatClassConstructionAdvisoryText,
} from "./class-construction-advisory.js";
import { type DeadCodeCorpusLabel, loadDeadCodeCorpusLabels } from "./dead-code-corpus.js";
import type { UnusedExportSymbol } from "./knip-unused-exports.js";

describe("buildClassConstructionAdvisory", () => {
  it("wraps zero-construction class candidates in the prototype advisory contract", () => {
    const inventory = inventoryClasses([
      {
        filePath: "src/service.ts",
        source:
          "export class Service {}\n" +
          "export class Built {}\n" +
          "export const built = new Built();\n" +
          "export class TypeOnly {}\n",
      },
      {
        filePath: "src/read.ts",
        source:
          "import type { TypeOnly } from './service';\n" +
          "export let current: TypeOnly | undefined;\n",
      },
    ]);

    const advisory = buildClassConstructionAdvisory({
      inventory,
      sourceFileCount: 2,
      top: 10,
    });
    const section = advisory.sections[0];

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("class-construction");
    expect("findings" in advisory).toBe(false);
    expect(section?.candidateKind).toBe(
      "classes with no direct or only ambiguous construction signal",
    );
    expect(section?.entries.map((entry) => entry.displayName)).toEqual(["Service", "TypeOnly"]);
    expect(section?.entries.some((entry) => entry.displayName === "Built")).toBe(false);
    expect(section?.entries[0]?.evidence).toMatchObject({
      newExpressions: 0,
      subclassings: 0,
      jsxReferences: 0,
      customElementRegistrations: 0,
    });
  });

  it("renders raw counts, caveats, caps, and no finding-language branding", () => {
    const advisory = buildClassConstructionAdvisory({
      inventory: inventoryClasses([
        { filePath: "src/plain.ts", source: "export class Plain {}\n" },
      ]),
      sourceFileCount: 1,
      top: 1,
    });
    const text = formatClassConstructionAdvisoryText(advisory);

    expect(text).toContain("drift:ai class-construction (advisory, prototype lane)");
    expect(text).toContain(
      "candidate: classes with no direct or only ambiguous construction signal",
    );
    expect(text).toContain("#1 src/plain.ts:1-1 Plain [named declaration]");
    expect(text).toContain(
      "direct construction counts: new 0, subclass 0, jsx 0, custom-element 0",
    );
    expect(text).toContain("reference counts: value 0, decorator 0, type-only 0, string-keyed 0");
    expect(text).toContain(`caveat: ${CLASS_CONSTRUCTION_STANDING_CAVEAT}`);
    expect(text).toContain("cap candidate rows: within limit 1");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("correlates a supplied unused-export report without treating the class as dead", () => {
    const unusedExport: UnusedExportSymbol = {
      category: "exports",
      file: "src/service.ts",
      name: "Service",
      line: 1,
      col: 14,
    };
    const advisory = buildClassConstructionAdvisory({
      inventory: inventoryClasses([
        { filePath: "src/service.ts", source: "export class Service {}\n" },
      ]),
      sourceFileCount: 1,
      unusedExportsReport: { kind: "ok", path: "knip.json", symbolCount: 1 },
      unusedExportSymbols: [unusedExport],
      top: 5,
    });
    const row = advisory.sections[0]?.entries[0];
    const text = formatClassConstructionAdvisoryText(advisory);

    expect(row?.correlations).toEqual([
      {
        kind: "unused-export",
        source: "knip report",
        category: "exports",
        symbol: "Service",
        file: "src/service.ts",
        line: 1,
        col: 14,
        namespace: null,
      },
    ]);
    expect(text).toContain("correlation: unused-export (knip report) exports Service");
    expect(text).not.toContain("Service is dead");
  });

  it("keeps same-scope duplicate class names visible as ambiguous candidates", () => {
    const advisory = buildClassConstructionAdvisory({
      inventory: inventoryClasses([
        { filePath: "src/a.ts", source: "export class Service {}\n" },
        { filePath: "src/b.ts", source: "export class Service {}\n" },
        {
          filePath: "src/use.ts",
          source: "import { Service } from './a';\nexport const service = new Service();\n",
        },
      ]),
      sourceFileCount: 3,
      top: 10,
    });
    const entries = advisory.sections[0]?.entries ?? [];

    expect(entries.map((entry) => entry.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(entries.every((entry) => entry.evidence.newExpressions === 1)).toBe(true);
    expect(
      entries.every((entry) =>
        entry.caveats.includes("risky-context: ambiguous-name-shared-evidence"),
      ),
    ).toBe(true);
  });

  it("keeps dead-code FP-trap corpus contexts candidate-framed", () => {
    const labels = loadDeadCodeCorpusLabels().labels;
    const labeler: ClassCaveatLabeler = (filePath) => corpusCaveats(labels, filePath);
    const sources: ClassConstructionSourceInput[] = [
      { filePath: "barrel/public-api.ts", source: "export class PublicApiSurface {}\n" },
      { filePath: "dynamic/lazy-feature.ts", source: "export class LazyRouteFeature {}\n" },
      {
        filePath: "framework/routes/campaign-route.tsx",
        source: "export default class CampaignRoute {}\n",
      },
      { filePath: "reflection/actions.ts", source: "export class ReflectedAction {}\n" },
      {
        filePath: "tombstones/obsolete-rules.ts",
        source: "export class LegacyInitiativeAdapter {}\n",
      },
    ];
    const advisory = buildClassConstructionAdvisory({
      inventory: inventoryClasses(sources, { caveatLabeler: labeler }),
      sourceFileCount: sources.length,
      top: 10,
    });
    const text = formatClassConstructionAdvisoryText(advisory);

    expect(advisory.sections[0]?.entries).toHaveLength(5);
    expect(text).toContain("true-trap: barrel-reexport-transitivity");
    expect(text).toContain("true-trap: dynamic-import-only");
    expect(text).toContain("true-trap: framework-entrypoint-convention");
    expect(text).toContain("true-trap: reflection-string-keyed-access");
    expect(text).toContain("known-unused: tombstoned-unused");
    expect(text).toContain("Experimental candidate signal, NOT defects or verdicts");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("never emits a top-level findings key in JSON", () => {
    const json = JSON.parse(
      formatClassConstructionAdvisoryJson(
        buildClassConstructionAdvisory({
          inventory: inventoryClasses([
            { filePath: "src/plain.ts", source: "export class Plain {}\n" },
          ]),
          sourceFileCount: 1,
        }),
      ),
    ) as Record<string, unknown>;

    expect("findings" in json).toBe(false);
    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
  });
});

function corpusCaveats(
  labels: readonly DeadCodeCorpusLabel[],
  filePath: string,
): readonly string[] {
  return labels
    .filter((label) => label.path === filePath)
    .map((label) => `${label.kind}: ${label.reason}`);
}

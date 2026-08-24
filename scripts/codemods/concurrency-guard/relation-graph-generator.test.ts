import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertRepairSuggestionReferences,
  buildRelationGraph,
  renderRelationGraph,
  renderRelationGraphModule,
} from "./relation-graph-generator.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const SCHEMA = `
model Alpha {
  id     String @id
  betas  Beta[] @relation("AlphaBetas")
  gammas Gamma[] @relation("AlphaGammas")
  tags   Tag[]
}

model Beta {
  id      String @id
  data    Json
  alphaId String
  alpha   Alpha  @relation(
    "AlphaBetas",
    fields: [alphaId],
    references: [id]
  )
  gatedId String?
  gated   Gated? @relation(fields: [gatedId], references: [id])
}

model Gamma {
  id      String @id
  alphaId String
  alpha   Alpha  @relation("AlphaGammas", fields: [alphaId], references: [id])
}

model Gated {
  id    String @id
  betas Beta[]
}

model Tag {
  id     String @id
  alphas Alpha[]
}

model Orphan {
  id       String @id
  children OrphanChild[]
}

model OrphanChild {
  id       String @id
  orphanId String
  orphan   Orphan @relation(fields: [orphanId], references: [id])
}
`;

const GATED_REPAIR_SUGGESTION =
  "Use updateCharacterStatsLocked from packages/server/src/utils/character-stats-mutations.ts " +
  "for this write; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.";
const REPAIR_SUGGESTIONS = new Map([["gated", GATED_REPAIR_SUGGESTION]]);

describe("buildRelationGraph", () => {
  it("emits only relation paths that can reach a gated model", () => {
    const graph = buildRelationGraph(SCHEMA, ["gated"], ["update", "upsert"], REPAIR_SUGGESTIONS);

    expect(graph.gatedModels).toEqual(["Gated"]);
    expect(graph.gatedOperations).toEqual(["update", "upsert"]);
    expect(graph.payloadEnvelopeKeys).toEqual(["create", "data", "update", "upsert"]);
    expect(graph.repairSuggestions).toEqual({
      gated:
        "Use updateCharacterStatsLocked from packages/server/src/utils/character-stats-mutations.ts for this write; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
    });
    expect(graph.dataScalarModels).toEqual(["Beta"]);
    expect(graph.models.Alpha).toEqual({
      betas: "Beta",
      gammas: "Gamma",
      tags: "Tag",
    });
    expect(graph.models.Beta).toEqual({
      alpha: "Alpha",
      gated: "Gated",
    });
    expect(graph.models.Gated?.betas).toBe("Beta");
    expect(graph.models).not.toHaveProperty("Orphan");
    expect(graph.models).not.toHaveProperty("OrphanChild");
  });

  it.each(["data", "where"])("rejects a reachable relation field named %s", (field) => {
    const schema = SCHEMA.replace(
      '  betas  Beta[] @relation("AlphaBetas")',
      `  ${field} Beta[] @relation("AlphaBetas")`,
    );

    expect(() =>
      buildRelationGraph(schema, ["gated"], ["update", "upsert"], REPAIR_SUGGESTIONS),
    ).toThrow(`relation field Alpha.${field} collides with Prisma payload envelope syntax`);
  });

  it.each(["create", "update", "upsert", "updateManyAndReturn"])(
    "allows the legal relation field name %s",
    (field) => {
      const schema = SCHEMA.replace(
        '  betas  Beta[] @relation("AlphaBetas")',
        `  ${field} Beta[] @relation("AlphaBetas")`,
      );

      expect(
        buildRelationGraph(
          schema,
          ["gated"],
          ["update", "updateMany", "updateManyAndReturn", "upsert"],
          REPAIR_SUGGESTIONS,
        ).models.Alpha,
      ).toHaveProperty(field, "Beta");
    },
  );

  it("rejects scalar data plus scalar where on a reachable model", () => {
    const schema = SCHEMA.replace("  data    Json", "  data    Json\n  where   Json");

    expect(() =>
      buildRelationGraph(schema, ["gated"], ["update", "upsert"], REPAIR_SUGGESTIONS),
    ).toThrow(
      "model Beta has scalar fields data and where, which makes nested write payloads ambiguous",
    );
  });

  it("rejects a to-one relation targeting a data-scalar model", () => {
    const schema = SCHEMA.replace(
      '  betas  Beta[] @relation("AlphaBetas")',
      '  beta   Beta?  @relation("AlphaBetas")',
    ).replace("  alphaId String", "  alphaId String @unique");

    expect(() =>
      buildRelationGraph(schema, ["gated"], ["update", "upsert"], REPAIR_SUGGESTIONS),
    ).toThrow(
      "to-one relation Alpha.beta targets data-scalar model Beta, making nested update data ambiguous",
    );
  });

  it("allows a to-one relation targeting a gated data-scalar model", () => {
    const schema = SCHEMA.replace(
      "model Gated {\n  id    String @id",
      "model Gated {\n  id    String @id\n  data  Json",
    );

    expect(
      buildRelationGraph(schema, ["gated"], ["update", "upsert"], REPAIR_SUGGESTIONS)
        .dataScalarModels,
    ).toEqual(["Beta", "Gated"]);
  });

  it("rejects missing or unexpected repair-policy delegates", () => {
    expect(() =>
      buildRelationGraph(
        SCHEMA,
        ["gated", "missing"],
        ["update"],
        new Map([
          ["gated", "gated repair"],
          ["unexpected", "unexpected repair"],
        ]),
      ),
    ).toThrow(
      "repair suggestions must exactly match gated delegates (missing: missing; unexpected: unexpected)",
    );
  });
});

describe("assertRepairSuggestionReferences", () => {
  it.each([
    [
      "Pattern A",
      "## Pattern A — version-CAS via a locked helper\n",
      "docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper",
    ],
    [
      "Pattern C with inline code",
      "## Pattern C — compound `updateMany` with the precondition in `where`\n",
      "docs/CONCURRENCY.md#pattern-c--compound-updatemany-with-the-precondition-in-where",
    ],
  ])("accepts a live %s heading anchor and existing repo path", (_name, heading, docsAnchor) => {
    expect(() => {
      assertRepairSuggestionReferences(
        heading,
        new Map([
          [
            "gated",
            "Use updateCharacterStatsLocked from " +
              `packages/server/src/utils/character-stats-mutations.ts; see ${docsAnchor}.`,
          ],
        ]),
        REPO_ROOT,
      );
    }).not.toThrow();
  });

  it("rejects an authored anchor after its concurrency-guide heading changes", () => {
    expect(() => {
      assertRepairSuggestionReferences(
        "## Pattern A — renamed heading\n",
        REPAIR_SUGGESTIONS,
        REPO_ROOT,
      );
    }).toThrow(
      "repair suggestion anchor for gated does not resolve to a docs/CONCURRENCY.md heading: " +
        "docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper",
    );
  });

  it("rejects a second authored anchor that does not resolve", () => {
    const suggestionWithTwoAnchors = new Map([
      [
        "gated",
        GATED_REPAIR_SUGGESTION + " Compare docs/CONCURRENCY.md#renamed-secondary-pattern.",
      ],
    ]);

    expect(() => {
      assertRepairSuggestionReferences(
        "## Pattern A — version-CAS via a locked helper\n",
        suggestionWithTwoAnchors,
        REPO_ROOT,
      );
    }).toThrow(
      "repair suggestion anchor for gated does not resolve to a docs/CONCURRENCY.md heading: " +
        "docs/CONCURRENCY.md#renamed-secondary-pattern",
    );
  });

  it("requires every suggestion to contain a concurrency-guide anchor", () => {
    expect(() => {
      assertRepairSuggestionReferences(
        "## Pattern A — version-CAS via a locked helper\n",
        new Map([
          [
            "gated",
            "Use updateCharacterStatsLocked from " +
              "packages/server/src/utils/character-stats-mutations.ts.",
          ],
        ]),
        REPO_ROOT,
      );
    }).toThrow(
      "repair suggestion anchor for gated does not resolve to a docs/CONCURRENCY.md heading: " +
        "(missing)",
    );
  });

  it("rejects an authored repo path after its target moves", () => {
    const staleSuggestions = new Map([
      [
        "gated",
        "Use updateCharacterStatsLocked from packages/server/src/utils/moved-mutations.ts; " +
          "see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
      ],
    ]);

    expect(() => {
      assertRepairSuggestionReferences(
        "## Pattern A — version-CAS via a locked helper\n",
        staleSuggestions,
        REPO_ROOT,
      );
    }).toThrow(
      "repair suggestion path for gated does not exist: " +
        "packages/server/src/utils/moved-mutations.ts",
    );
  });
});

describe("renderRelationGraph", () => {
  it("renders deterministic checked-in JSON with a generated-file warning", async () => {
    const rendered = await renderRelationGraph(
      buildRelationGraph(SCHEMA, ["gated"], ["upsert", "update"], REPAIR_SUGGESTIONS),
    );

    expect(rendered).toContain(
      '"generatedBy": "scripts/codemods/concurrency-guard/generate-relation-graph.ts"',
    );
    expect(rendered.indexOf('"update"')).toBeLessThan(rendered.indexOf('"upsert"'));
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("renders the same graph as a typed immutable ESM module", async () => {
    const rendered = await renderRelationGraphModule(
      buildRelationGraph(SCHEMA, ["gated"], ["upsert", "update"], REPAIR_SUGGESTIONS),
    );

    expect(rendered).toContain("const relationGraph = {");
    expect(rendered).toContain("} as const;");
    expect(rendered).toContain("export default relationGraph;");
    expect(rendered.indexOf('"update"')).toBeLessThan(rendered.indexOf('"upsert"'));
  });
});

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runDocGeneratorAsync } from "../../lib/doc-generator.js";
import { DIRECT_WRITE_REPAIR_SUGGESTIONS, GATED_DELEGATES, GATED_MUTATORS } from "./constants.js";
import {
  assertRepairSuggestionReferences,
  buildRelationGraph,
  renderRelationGraph,
  renderRelationGraphModule,
} from "./relation-graph-generator.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = join(repoRoot, "packages/server/prisma/schema.prisma");
const concurrencyGuidePath = join(repoRoot, "docs/CONCURRENCY.md");
const jsonOutputPath = join(
  repoRoot,
  "packages/server/src/prisma/concurrency-relation-graph.generated.json",
);
const moduleOutputPath = join(
  repoRoot,
  "packages/server/src/prisma/concurrency-relation-graph.generated.ts",
);

async function main(): Promise<void> {
  assertRepairSuggestionReferences(
    readFileSync(concurrencyGuidePath, "utf8"),
    DIRECT_WRITE_REPAIR_SUGGESTIONS,
    repoRoot,
  );
  const graph = buildRelationGraph(
    readFileSync(schemaPath, "utf8"),
    [...GATED_DELEGATES],
    [...GATED_MUTATORS],
    DIRECT_WRITE_REPAIR_SUGGESTIONS,
  );
  await runDocGeneratorAsync({
    outputPath: jsonOutputPath,
    refreshCommand: "concurrency:relation-graph",
    render: async () => ({
      rendered: await renderRelationGraph(graph),
    }),
  });
  await runDocGeneratorAsync({
    outputPath: moduleOutputPath,
    refreshCommand: "concurrency:relation-graph",
    render: async () => ({
      rendered: await renderRelationGraphModule(graph),
    }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

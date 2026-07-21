import { resolve } from "node:path";

import { matchesRatchet } from "@musi/lint-ratchet/kernel/ratchet-globs.js";

import { readCurrentOutput, runDocGeneratorAsync } from "./lib/doc-generator.js";
import { createEslintReachChecker } from "./lint-coverage-map-check-eslint-reach.js";
import { loadTrackedFiles, repoRoot } from "./lint-coverage-map-check-io.js";
import {
  deriveDriftAiCoverageBlock,
  spliceDriftAiCoverageBlock,
} from "./lint-coverage-map-gen-core.js";
import { lintRatchets } from "./lint-ratchet/lint-ratchet-config.js";

const outputPath = resolve(repoRoot, "docs/generated/lint-coverage-map.md");

await runDocGeneratorAsync({
  outputPath,
  refreshCommand: "docs:lint-coverage-map:generate",
  render: async () => {
    const block = await deriveDriftAiCoverageBlock({
      trackedFiles: loadTrackedFiles(repoRoot),
      isEslintReachable: createEslintReachChecker(repoRoot),
      ratchets: lintRatchets.map((ratchet) => ({
        id: ratchet.id,
        matches: (file: string) => matchesRatchet(ratchet, file),
      })),
    });
    return {
      rendered: spliceDriftAiCoverageBlock(readCurrentOutput(outputPath), block),
      wroteSuffix: " (drift-ai coverage block)",
    };
  },
});

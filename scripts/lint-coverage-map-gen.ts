import { matchesRatchet } from "@musi/lint-ratchet/kernel/ratchet-globs.js";

import { runDocGeneratorAsync } from "./lib/doc-generator.js";
import { createEslintReachChecker } from "./lint-coverage-map-check-eslint-reach.js";
import { coverageMapPath, loadTrackedFiles, repoRoot } from "./lint-coverage-map-check-io.js";
import { renderCoverageMapDocument } from "./lint-coverage-map-gen-core.js";
import { coverageManifest } from "./lint-coverage-map-manifest.js";
import { lintRatchets } from "./lint-ratchet/lint-ratchet-config.js";

await runDocGeneratorAsync({
  outputPath: coverageMapPath,
  refreshCommand: "docs:lint-coverage-map:generate",
  render: async () => ({
    rendered: await renderCoverageMapDocument({
      sections: coverageManifest,
      trackedFiles: loadTrackedFiles(repoRoot),
      isEslintReachable: createEslintReachChecker(repoRoot),
      ratchets: lintRatchets.map((ratchet) => ({
        id: ratchet.id,
        matches: (file: string) => matchesRatchet(ratchet, file),
      })),
    }),
  }),
});

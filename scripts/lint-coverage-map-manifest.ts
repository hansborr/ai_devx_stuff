import {
  type CoverageEntry,
  coverageManifestSchema,
  type CoverageSection,
} from "./lint-coverage-map-manifest-schema.js";
import { coverageSections } from "./lint-coverage-map-manifest-sections.js";

// Single entry point for the lint coverage-map policy manifest. Parsing at
// module load is deliberate: a malformed entry is a policy defect, and every
// consumer (checker, generator, `--suggest`) should fail on it at the same
// point rather than each rediscovering it downstream.
export const coverageManifest: readonly CoverageSection[] =
  coverageManifestSchema.parse(coverageSections);

export const coverageEntries: readonly CoverageEntry[] = coverageManifest.flatMap((section) =>
  section.groups.flatMap((group) => group.entries),
);

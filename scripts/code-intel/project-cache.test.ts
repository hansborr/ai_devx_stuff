import { describe, expect, it } from "vitest";

import { ProjectCache } from "./project-cache.js";
import {
  createFixtureProject,
  createFixtureResolver,
  repoRoot,
} from "./test-fixtures.test-helper.js";

describe("project-cache", () => {
  it("rejects out-of-scope files with the shared supported-scope error", () => {
    const project = createFixtureProject();
    const resolver = createFixtureResolver(project);
    const cache = new ProjectCache(repoRoot, {
      computeManifest: () => "fixture",
      rebuild: () => ({
        graphProject: project,
        manifest: "fixture",
        projects: { client: project, scripts: project, server: project, shared: project },
        resolver,
      }),
    });
    // Daemon def/exports resolve their per-file project here (overview is not
    // daemon-routable and always runs one-shot); the guard must match one-shot
    // createProjectForFile so the same query cannot answer differently
    // depending on whether code:intel:server is running
    // (docs/guides/code-intel.md#supported-scope).
    const scopeError = (file: string): string =>
      "File must be under packages/shared/src, packages/server/src, packages/client/src, " +
      `or scripts (excluding scripts/codemods/fixtures): ${file}`;

    expect(() => cache.projectForFile("tools/lint-ratchet/src/atomic-write.ts")).toThrow(
      scopeError("tools/lint-ratchet/src/atomic-write.ts"),
    );
    expect(() => cache.projectForFile("packages/server/prisma/seed.ts")).toThrow(
      scopeError("packages/server/prisma/seed.ts"),
    );
    expect(() => cache.projectForFile("scripts/codemods/fixtures/widget.ts")).toThrow(
      scopeError("scripts/codemods/fixtures/widget.ts"),
    );
    expect(cache.projectForFile("packages/server/src/feature.ts")).toBe(project);
    expect(cache.projectForFile("scripts/lib/atomic-write.ts")).toBe(project);
  });
});

import { describe, expect, it } from "vitest";

import {
  classifyLicenseAudit,
  collectInstalledPackages,
  collectProductionPackages,
} from "./audit-dependency-licenses.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function manifest(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function makeFixtureRepository(): string {
  return tmpRepo.writeRepo(
    {
      "package.json": manifest({
        name: "fixture-root",
        version: "1.0.0",
        dependencies: {
          "@musi/fixture-workspace": "workspace:*",
          "licenses-array-apache": "1.0.0",
          "nearby-license-mit": "1.0.0",
          "prod-mit": "1.0.0",
        },
        devDependencies: { "dev-gpl": "1.0.0" },
      }),
      "packages/workspace/package.json": manifest({
        name: "@musi/fixture-workspace",
        version: "1.0.0",
        dependencies: { "workspace-unknown": "1.0.0" },
      }),
      "node_modules/@musi/fixture-workspace/package.json": manifest({
        name: "@musi/fixture-workspace",
        version: "1.0.0",
        license: "MIT",
      }),
      "node_modules/dev-gpl/package.json": manifest({
        name: "dev-gpl",
        version: "1.0.0",
        license: "GPL-3.0-only",
      }),
      "node_modules/licenses-array-apache/package.json": manifest({
        name: "licenses-array-apache",
        version: "1.0.0",
        licenses: [{ type: "Apache-2.0" }],
      }),
      "node_modules/nearby-license-mit/LICENSE":
        "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n",
      "node_modules/nearby-license-mit/package.json": manifest({
        name: "nearby-license-mit",
        version: "1.0.0",
      }),
      "node_modules/prod-mit/package.json": manifest({
        name: "prod-mit",
        version: "1.0.0",
        license: "MIT",
      }),
      "node_modules/workspace-unknown/package.json": manifest({
        name: "workspace-unknown",
        version: "1.0.0",
      }),
    },
    "license-audit-fixture-",
  );
}

describe("license audit package collection", () => {
  it("distinguishes the production closure from all installed packages", () => {
    const rootDir = makeFixtureRepository();
    const installedPackages = collectInstalledPackages(rootDir);

    expect(collectProductionPackages(rootDir).map((pkg) => pkg.name)).toEqual([
      "licenses-array-apache",
      "nearby-license-mit",
      "prod-mit",
      "workspace-unknown",
    ]);
    expect(installedPackages.map((pkg) => pkg.name)).toEqual([
      "dev-gpl",
      "licenses-array-apache",
      "nearby-license-mit",
      "prod-mit",
      "workspace-unknown",
    ]);
    expect(installedPackages.find((pkg) => pkg.name === "licenses-array-apache")?.license).toBe(
      "Apache-2.0",
    );
    expect(installedPackages.find((pkg) => pkg.name === "nearby-license-mit")?.license).toBe("MIT");
    expect(installedPackages.find((pkg) => pkg.name === "workspace-unknown")?.license).toBe(
      "UNKNOWN",
    );
  });
});

describe("classifyLicenseAudit", () => {
  it("deduplicates packages matching multiple flagged categories", () => {
    const dualCopyleft = {
      name: "dual-copyleft",
      version: "1.0.0",
      license: "GPL-2.0 OR LGPL-3.0",
      manifestPath: "/fixture/node_modules/dual-copyleft/package.json",
    };

    expect(classifyLicenseAudit([dualCopyleft])).toMatchObject({
      strongCopyleft: [dualCopyleft],
      reviewCopyleft: [dualCopyleft],
      flaggedCount: 1,
      shouldFail: true,
    });
  });

  it("reports UNKNOWN metadata without failing the gate", () => {
    const unknown = {
      name: "unknown-license",
      version: "1.0.0",
      license: "UNKNOWN",
      manifestPath: "/fixture/node_modules/unknown-license/package.json",
    };

    expect(classifyLicenseAudit([unknown])).toMatchObject({
      unknown: [unknown],
      flaggedCount: 1,
      shouldFail: false,
    });
  });
});

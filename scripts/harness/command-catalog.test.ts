import { describe, expect, it } from "vitest";

import {
  buildCommandRows,
  type BuildCommandRowsInputs,
  collectCommandCatalogCoverageFailures,
  type CommandCatalogCoverageInputs,
  type CommandCatalogEntry,
  type ControlCommandSource,
  deriveInvocation,
  groupKeyOf,
  type PackageManifestScripts,
  summarizeControlPrinciple,
} from "./command-catalog.js";

const WORKSPACES = new Set(["@musi/server"]);

function manifest(
  path: string,
  packageName: string,
  scripts: Record<string, string>,
): PackageManifestScripts {
  return { path, packageName, scripts: new Map(Object.entries(scripts)) };
}

const DEV_CATALOG: readonly CommandCatalogEntry[] = [
  { manifest: "package.json", script: "dev", effect: "dev-utility", purpose: "Start." },
];

function inputs(overrides: Partial<BuildCommandRowsInputs> = {}): BuildCommandRowsInputs {
  return {
    manifests: [manifest("package.json", "musi", { dev: "bash scripts/dev.sh" })],
    workspacePackageNames: WORKSPACES,
    controlSources: new Map<string, readonly ControlCommandSource[]>(),
    catalog: DEV_CATALOG,
    ...overrides,
  };
}

function coverage(
  overrides: Partial<CommandCatalogCoverageInputs> = {},
): CommandCatalogCoverageInputs {
  return {
    manifests: [manifest("package.json", "musi", { dev: "bash scripts/dev.sh" })],
    controlScripts: new Map<string, number>(),
    catalog: DEV_CATALOG,
    ...overrides,
  };
}

describe("deriveInvocation", () => {
  it("spells a root script as a plain bun run", () => {
    expect(deriveInvocation("package.json", "musi", "lint", WORKSPACES)).toBe("bun run lint");
  });

  it("spells a workspace member's script with --filter, because a bare bun run resolves against the nearest package.json", () => {
    expect(
      deriveInvocation("packages/server/package.json", "@musi/server", "db:seed", WORKSPACES),
    ).toBe("bun run --filter @musi/server db:seed");
  });

  it("falls back to --cwd for a manifest outside the workspaces", () => {
    expect(deriveInvocation("examples/demo/package.json", "demo", "smoke", WORKSPACES)).toBe(
      "bun --cwd=examples/demo run smoke",
    );
  });
});

describe("groupKeyOf", () => {
  it("groups by the prefix before the first colon", () => {
    expect(groupKeyOf("lint:ratchet:update", new Set(["lint:ratchet:update"]))).toBe("lint");
  });

  it("keeps an unprefixed script with the family that uses its name as a prefix", () => {
    expect(groupKeyOf("test", new Set(["test", "test:changed"]))).toBe("test");
  });

  it("treats an unprefixed script with no such family as a top-level command", () => {
    expect(groupKeyOf("dev", new Set(["dev", "build"]))).toBe("");
  });
});

describe("summarizeControlPrinciple", () => {
  it("keeps the lead claim and drops the qualifiers that follow it", () => {
    expect(
      summarizeControlPrinciple(
        "Fail on drift between X and Y. Repair by rerunning the generator.",
      ),
    ).toBe("Fail on drift between X and Y");
  });

  it("splits on a semicolon clause boundary too", () => {
    expect(summarizeControlPrinciple("Do the thing; --check fails on drift.")).toBe("Do the thing");
  });

  it("leaves a single-clause principle whole, including its internal dots", () => {
    expect(summarizeControlPrinciple("Keep docs/generated/x.md in sync")).toBe(
      "Keep docs/generated/x.md in sync",
    );
  });
});

describe("buildCommandRows", () => {
  it("projects a control-declared script from its control rather than from the catalog", () => {
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("package.json", "musi", { "sensor:x": "bun scripts/x.ts" })],
        catalog: [],
        controlSources: new Map([
          [
            "sensor:x",
            [
              {
                id: "sensor/x",
                kind: "sensor",
                script: "sensor:x",
                principle: "Measure x. Then some qualifier.",
                pairedGuide: "docs/guides/lint-overview.md",
              },
            ],
          ],
        ]),
      }),
    );
    expect(rows).toEqual([
      {
        manifest: "package.json",
        script: "sensor:x",
        group: "sensor",
        invocation: "bun run sensor:x",
        effect: "check",
        purpose: "Measure x.",
        doc: "docs/guides/lint-overview.md",
        controlIds: ["sensor/x"],
      },
    ]);
  });

  it("describes a generatedSurface check twin by naming the output it guards and the refresh script", () => {
    const rows = buildCommandRows(
      inputs({
        manifests: [
          manifest("package.json", "musi", { "docs:x:check": "bun scripts/x.ts --check" }),
        ],
        catalog: [],
        controlSources: new Map([
          [
            "docs:x:check",
            [
              {
                id: "doc-generator/x",
                kind: "doc-generator",
                script: "docs:x:check",
                checksRefreshScript: "docs:x",
                outputPaths: ["docs/generated/x.md"],
              },
            ],
          ],
        ]),
      }),
    );
    expect(rows[0]?.effect).toBe("check");
    expect(rows[0]?.purpose).toBe(
      "Fail when `docs/generated/x.md` is stale — the `--check` twin of `docs:x`.",
    );
  });

  it("renders a generated surface's refresh script as a writer even when its control is kinded check", () => {
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("package.json", "musi", { "harness:wiring": "bun scripts/x.ts" })],
        catalog: [],
        controlSources: new Map([
          [
            "harness:wiring",
            [
              {
                id: "check/hook-wiring-generator",
                kind: "check",
                script: "harness:wiring",
                principle: "Generate the hook trees from harness.controls.json.",
                refreshesGeneratedSurface: true,
              },
            ],
          ],
        ]),
      }),
    );
    expect(rows[0]?.effect).toBe("generator");
  });

  it("keeps the check twin of that same surface on effect check", () => {
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("package.json", "musi", { "harness:wiring:check": "bun x --check" })],
        catalog: [],
        controlSources: new Map([
          [
            "harness:wiring:check",
            [
              {
                id: "check/hook-wiring-generator",
                kind: "generated-surface-check",
                script: "harness:wiring:check",
                checksRefreshScript: "harness:wiring",
                outputPaths: [".claude/hooks.json"],
              },
            ],
          ],
        ]),
      }),
    );
    expect(rows[0]?.effect).toBe("check");
  });

  it("takes the purpose from the catalog entry when several controls back one script, because none of them is about the command", () => {
    const source = (id: string): ControlCommandSource => ({
      id,
      kind: "check",
      script: "lint",
      principle: "Some principle.",
    });
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("package.json", "musi", { lint: "eslint ." })],
        catalog: [
          {
            manifest: "package.json",
            script: "lint",
            effect: "check",
            purpose: "Run the whole-tree lint floor.",
            doc: "docs/guides/lint-overview.md",
          },
        ],
        controlSources: new Map([["lint", [source("check/b"), source("check/a")]]]),
      }),
    );
    expect(rows[0]?.purpose).toBe("Run the whole-tree lint floor.");
    expect(rows[0]?.doc).toBe("docs/guides/lint-overview.md");
    expect(rows[0]?.controlIds).toEqual(["check/a", "check/b"]);
  });

  it("keeps the derived writer effect even when an entry claims otherwise", () => {
    const source = (id: string): ControlCommandSource => ({
      id,
      kind: "check",
      script: "harness:wiring",
      refreshesGeneratedSurface: true,
    });
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("package.json", "musi", { "harness:wiring": "bun x.ts" })],
        catalog: [
          {
            manifest: "package.json",
            script: "harness:wiring",
            effect: "check",
            purpose: "Authored purpose.",
          },
        ],
        controlSources: new Map([["harness:wiring", [source("check/b"), source("check/a")]]]),
      }),
    );
    expect(rows[0]?.effect).toBe("generator");
    expect(rows[0]?.purpose).toBe("Authored purpose.");
  });

  it("does not let a control on the root manifest document a same-named script in another package", () => {
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("packages/server/package.json", "@musi/server", { build: "tsc -b" })],
        catalog: [
          {
            manifest: "packages/server/package.json",
            script: "build",
            effect: "ci-primitive",
            purpose: "Compile the server.",
          },
        ],
        controlSources: new Map([
          [
            "build",
            [{ id: "check/root-build", kind: "check", script: "build", principle: "Root build." }],
          ],
        ]),
      }),
    );
    expect(rows[0]?.purpose).toBe("Compile the server.");
    expect(rows[0]?.controlIds).toEqual([]);
  });

  it("omits a script with no metadata source rather than rendering a blank purpose", () => {
    const rows = buildCommandRows(
      inputs({
        manifests: [manifest("package.json", "musi", { dev: "x", orphan: "y" })],
      }),
    );
    expect(rows.map((row) => row.script)).toEqual(["dev"]);
  });
});

describe("collectCommandCatalogCoverageFailures", () => {
  const catalogEntry: CommandCatalogEntry = {
    manifest: "package.json",
    script: "dev",
    effect: "dev-utility",
    purpose: "Start.",
  };

  it("passes when every script in every manifest has exactly one source", () => {
    expect(collectCommandCatalogCoverageFailures(coverage())).toEqual([]);
  });

  it("fails a script no control and no catalog entry reaches, and says how to repair it", () => {
    const [failure, ...rest] = collectCommandCatalogCoverageFailures(
      coverage({ manifests: [manifest("package.json", "musi", { dev: "x", start: "y" })] }),
    );
    expect(rest).toEqual([]);
    expect(failure).toContain('package.json script "start" has no purpose line');
    expect(failure).toContain('"script": "start"');
  });

  it("fails a script in a non-root manifest too, which script parity never sees", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({
        manifests: [
          manifest("package.json", "musi", { dev: "x" }),
          manifest("packages/client/package.json", "@musi/client", { preview: "vite preview" }),
        ],
      }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('packages/client/package.json script "preview"');
  });

  it("fails a catalog entry whose script is gone", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({ catalog: [catalogEntry, { ...catalogEntry, script: "ghost" }] }),
    );
    expect(failures).toEqual([
      'commandCatalog names unknown script "ghost" in package.json; remove the entry or restore the script',
    ]);
  });

  it("fails a catalog entry whose manifest is not tracked", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({ catalog: [catalogEntry, { ...catalogEntry, manifest: "gone/package.json" }] }),
    );
    expect(failures[0]).toContain('commandCatalog names unknown manifest "gone/package.json"');
  });

  it("fails a script documented twice — once by a control and once by the catalog", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({ controlScripts: new Map([["dev", 1]]) }),
    );
    expect(failures[0]).toContain(
      'commandCatalog entry for "dev" duplicates its harness control metadata',
    );
  });

  it("fails a script several controls declare but no catalog entry describes", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({
        manifests: [manifest("package.json", "musi", { dev: "x", lint: "y" })],
        controlScripts: new Map([["lint", 3]]),
      }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('package.json script "lint" is declared by 3 controls');
    expect(failures[0]).toContain('"script": "lint"');
  });

  it("accepts a catalog entry for a script several controls declare", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({
        manifests: [manifest("package.json", "musi", { dev: "x", lint: "y" })],
        controlScripts: new Map([["lint", 3]]),
        catalog: [
          ...DEV_CATALOG,
          { manifest: "package.json", script: "lint", effect: "check", purpose: "Lint." },
        ],
      }),
    );
    expect(failures).toEqual([]);
  });

  it("fails a duplicated catalog entry", () => {
    const failures = collectCommandCatalogCoverageFailures(
      coverage({ catalog: [catalogEntry, catalogEntry] }),
    );
    expect(failures).toEqual(['commandCatalog declares package.json script "dev" twice']);
  });
});

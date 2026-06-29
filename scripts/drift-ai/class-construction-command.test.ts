import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { runPrototypeSubcommand } from "./prototype-subcommands.js";
import { runDriftAi } from "./runner.js";

const tmpRepo = registerTempRootCleanup();

function nulDelimited(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

describe("class-construction subcommand", () => {
  it("dispatches through drift:ai and correlates optional unused-export evidence", () => {
    const repo = writeFixtureRepo({
      "src/models.ts":
        "export class Unconstructed {}\n" +
        "export class Built {}\n" +
        "export const built = new Built();\n",
      "knip.json": JSON.stringify({
        issues: [
          {
            file: "src/models.ts",
            exports: [{ name: "Unconstructed", line: 1, col: 14, pos: 13 }],
          },
        ],
      }),
    });

    const result = runDriftAi({
      argv: [
        "class-construction",
        "--config",
        repo.configPath,
        "--unused-exports-report",
        "knip.json",
        "--format",
        "json",
        "--top",
        "10",
      ],
      git: gitRoot(repo.dir),
      gitBuffer: () => nulDelimited(["src/models.ts"]),
    });
    const advisory = JSON.parse(result.stdout) as {
      kind: string;
      lane: string;
      subcommand: string;
      sections: {
        entries: {
          displayName: string;
          correlations: { kind: string; source: string; symbol: string }[];
        }[];
      }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("class-construction");
    expect("findings" in advisory).toBe(false);
    expect(advisory.sections[0]?.entries.map((entry) => entry.displayName)).toEqual([
      "Unconstructed",
    ]);
    expect(advisory.sections[0]?.entries[0]?.correlations[0]).toMatchObject({
      kind: "unused-export",
      source: "knip report",
      symbol: "Unconstructed",
    });
  });

  it("prints subcommand usage on help", () => {
    const result = runDriftAi({ argv: ["class-construction", "--help"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai class-construction");
    expect(result.stdout).toContain("--unused-exports-report");
  });

  it("does not treat inherited object keys as prototype subcommands", () => {
    const result = runPrototypeSubcommand({ argv: ["toString"] });

    expect(result).toBeUndefined();
  });

  it("buckets class inventory by configured root to avoid cross-package name bleed", () => {
    const repo = writeFixtureRepo(
      {
        "packages/server/src/service.ts": "export class Service {}\n",
        "packages/client/src/service.ts":
          "export class Service {}\nexport const service = new Service();\n",
      },
      { roots: ["packages/server/src", "packages/client/src"] },
    );

    const result = runDriftAi({
      argv: ["class-construction", "--config", repo.configPath, "--format", "json", "--top", "10"],
      git: gitRoot(repo.dir),
      gitBuffer: () =>
        nulDelimited(["packages/server/src/service.ts", "packages/client/src/service.ts"]),
    });
    const advisory = JSON.parse(result.stdout) as {
      sections: { entries: { filePath: string; displayName: string }[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.sections[0]?.entries.map(identityFields)).toEqual([
      { filePath: "packages/server/src/service.ts", displayName: "Service" },
    ]);
  });
});

function writeFixtureRepo(
  files: Readonly<Record<string, string>>,
  config: unknown = { roots: ["src"] },
): {
  readonly dir: string;
  readonly configPath: string;
} {
  const dir = tmpRepo.makeTempRepo("drift-class-construction-");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = path.join(dir, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source, "utf8");
  }
  const configPath = path.join(dir, "drift-ai.config.json");
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return { dir, configPath };
}

function gitRoot(repoRoot: string): (args: readonly string[]) => string {
  return (args) => (args[0] === "rev-parse" ? `${repoRoot}\n` : "");
}

function identityFields(entry: { readonly filePath: string; readonly displayName: string }): {
  readonly filePath: string;
  readonly displayName: string;
} {
  return { filePath: entry.filePath, displayName: entry.displayName };
}

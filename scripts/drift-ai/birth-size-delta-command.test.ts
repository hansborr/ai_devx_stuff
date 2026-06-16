import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commitBlock as buildCommitBlock } from "./git-log-fixture.test-helper.js";
import { GIT_LOG_FORMAT } from "./hotspots-history.js";
import { runDriftAi } from "./runner.js";

type MetaFields = {
  readonly hash: string;
  readonly authorDate: string;
  readonly subject: string;
};

// These cases only vary hash/date/subject, so wrap the shared git-log builder
// with the fixed author identity this file uses (committer date == author date).
function commitBlock(fields: MetaFields, rows: readonly string[]): string {
  return buildCommitBlock(
    {
      hash: fields.hash,
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authorDate: fields.authorDate,
      subject: fields.subject,
    },
    rows,
  );
}

function nulDelimited(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function statFor(paths: readonly string[]): (absolutePath: string) => { isFile: () => boolean } {
  const basenames = new Set(paths.map((filePath) => path.basename(filePath)));
  return (absolutePath) => ({ isFile: () => basenames.has(path.basename(absolutePath)) });
}

describe("birth-size-delta subcommand", () => {
  it("runs current inventory plus bounded full history and emits prototype advisory JSON", () => {
    const calls: string[][] = [];
    const showOptions: Array<
      { readonly maxOutputBytes?: number; readonly timeoutMs?: number } | undefined
    > = [];
    const output = [
      commitBlock({ hash: "c2", authorDate: "2026-05-02T00:00:00Z", subject: "fix: grow" }, [
        "2\t1\tsrc/widget.ts",
      ]),
      commitBlock({ hash: "c1", authorDate: "2026-05-01T00:00:00Z", subject: "feat: birth" }, [
        "8\t0\tsrc/widget.ts",
      ]),
    ].join("\n");

    const result = runDriftAi({
      argv: [
        "birth-size-delta",
        "--format",
        "json",
        "--top",
        "5",
        "--max-commits",
        "25",
        "--max-blob-bytes",
        "1234",
        "--blob-timeout-ms",
        "56",
      ],
      git: (args) => {
        if (args[0] === "rev-parse") return "/repo\n";
        return "";
      },
      gitBuffer: (args) => {
        calls.push([...args]);
        return nulDelimited(["src/widget.ts"]);
      },
      stat: statFor(["src/widget.ts"]),
      readFile: () => "const current = true;\nconst more = true;\n",
      boundedGit: (args, options) => {
        calls.push([...args]);
        if (args[0] === "config") return "";
        if (args[0] === "log") return output;
        if (args[0] === "show" && args[1] === "c1:src/widget.ts") {
          showOptions.push(options);
          return "const born = true;\n";
        }
        return "";
      },
    });
    const advisory = JSON.parse(result.stdout) as {
      kind: string;
      lane: string;
      subcommand: string;
      sections: { entries: { path: string; effectiveLoc: { birth: number; current: number } }[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("birth-size-delta");
    expect(advisory.sections[0]?.entries[0]).toMatchObject({
      path: "src/widget.ts",
      effectiveLoc: { birth: 1, current: 2 },
    });
    expect(calls.find((args) => args[0] === "log")).toEqual([
      "log",
      "--no-merges",
      "--no-renames",
      "--max-count=26",
      "--date=iso-strict",
      "--numstat",
      `--format=${GIT_LOG_FORMAT}`,
    ]);
    expect(calls).toContainEqual(["show", "c1:src/widget.ts"]);
    expect(showOptions).toEqual([{ maxOutputBytes: 1234, timeoutMs: 56 }]);
  });

  it("prints birth-size-delta usage on help", () => {
    const result = runDriftAi({
      argv: ["birth-size-delta", "--help"],
      git: (args) => (args[0] === "rev-parse" ? "/repo\n" : ""),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai birth-size-delta");
    expect(result.stdout).toContain("--max-blob-reads");
    expect(result.stdout).toContain("--max-output-bytes");
  });

  it("honors configured roots and ignore paths during current inventory and history collection", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "drift-birth-size-config-"));
    const configPath = path.join(dir, "drift-ai.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ roots: ["src"], ignore: { prefixes: ["generated/"] } }),
      "utf8",
    );
    const output = commitBlock(
      { hash: "c1", authorDate: "2026-05-01T00:00:00Z", subject: "feat: both" },
      ["1\t0\tgenerated/ignored.ts", "1\t0\tsrc/kept.ts"],
    );

    const result = runDriftAi({
      argv: ["birth-size-delta", "--config", configPath, "--format", "json"],
      git: (args) => (args[0] === "rev-parse" ? `${dir}\n` : ""),
      gitBuffer: () => nulDelimited(["generated/ignored.ts", "src/kept.ts", "test/out.ts"]),
      stat: statFor(["generated/ignored.ts", "src/kept.ts", "test/out.ts"]),
      readFile: (filePath) => `export const path = ${JSON.stringify(filePath)};\n`,
      boundedGit: (args) => {
        if (args[0] === "config") return "";
        if (args[0] === "log") return output;
        if (args[0] === "show") return "export const born = true;\n";
        return "";
      },
    });
    const advisory = JSON.parse(result.stdout) as {
      sections: { entries: { path: string }[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.sections[0]?.entries.map((entry) => entry.path)).toEqual(["src/kept.ts"]);
  });
});

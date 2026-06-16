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

describe("test-orphaning subcommand", () => {
  it("runs bounded full history and emits prototype advisory JSON", () => {
    const calls: string[][] = [];
    const output = [
      commitBlock(
        { hash: "c3", authorDate: "2026-05-03T00:00:00Z", subject: "fix: churn source" },
        ["2\t0\tsrc/widget.ts"],
      ),
      commitBlock({ hash: "c2", authorDate: "2026-05-02T00:00:00Z", subject: "refactor: source" }, [
        "2\t0\tsrc/widget.ts",
      ]),
      commitBlock({ hash: "c1", authorDate: "2026-05-01T00:00:00Z", subject: "feat: with test" }, [
        "8\t0\tsrc/widget.ts",
        "4\t0\tsrc/widget.test.ts",
      ]),
    ].join("\n");

    const result = runDriftAi({
      argv: ["test-orphaning", "--format", "json", "--top", "5", "--max-commits", "25"],
      git: (args) => {
        if (args[0] === "rev-parse") return "/repo\n";
        return "";
      },
      boundedGit: (args) => {
        calls.push([...args]);
        if (args[0] === "config") return "";
        if (args[0] === "log") return output;
        return "";
      },
    });
    const advisory = JSON.parse(result.stdout) as {
      kind: string;
      lane: string;
      subcommand: string;
      sections: { candidateKind: string; entries: { path: string; sourceOnlyCommits: number }[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("test-orphaning");
    expect(advisory.sections[1]?.entries[0]).toMatchObject({
      path: "src/widget.ts",
      sourceOnlyCommits: 2,
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
  });

  it("prints test-orphaning usage on help", () => {
    const result = runDriftAi({
      argv: ["test-orphaning", "--help"],
      git: (args) => (args[0] === "rev-parse" ? "/repo\n" : ""),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai test-orphaning");
    expect(result.stdout).toContain("--test-pattern");
  });

  it("honors configured ignore paths during bounded history collection", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "drift-test-orphaning-config-"));
    const configPath = path.join(dir, "drift-ai.config.json");
    writeFileSync(configPath, JSON.stringify({ ignore: { prefixes: ["generated/"] } }), "utf8");
    const output = [
      commitBlock({ hash: "c2", authorDate: "2026-05-02T00:00:00Z", subject: "fix: both" }, [
        "1\t0\tgenerated/ignored.ts",
        "1\t0\tsrc/kept.ts",
      ]),
      commitBlock({ hash: "c1", authorDate: "2026-05-01T00:00:00Z", subject: "feat: both" }, [
        "1\t0\tgenerated/ignored.ts",
        "1\t0\tsrc/kept.ts",
      ]),
    ].join("\n");

    const result = runDriftAi({
      argv: ["test-orphaning", "--config", configPath, "--format", "json"],
      git: (args) => (args[0] === "rev-parse" ? `${dir}\n` : ""),
      boundedGit: (args) => {
        if (args[0] === "config") return "";
        if (args[0] === "log") return output;
        return "";
      },
    });
    const advisory = JSON.parse(result.stdout) as {
      sections: { entries: { path: string }[] }[];
    };
    const paths = advisory.sections.flatMap((section) =>
      section.entries.map((entry) => entry.path),
    );

    expect(result.exitCode).toBe(0);
    expect(paths).toEqual(["src/kept.ts"]);
    expect(paths).not.toContain("generated/ignored.ts");
  });

  it("rejects a mapping template missing the {name} placeholder", () => {
    const result = runDriftAi({
      argv: ["test-orphaning", "--test-pattern", "{dir}/fixed.test.ts"],
      git: (args) => (args[0] === "rev-parse" ? "/repo\n" : ""),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--test-pattern template must include the {name} placeholder");
  });
});

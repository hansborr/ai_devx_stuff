import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commitBlock } from "./git-log-fixture.test-helper.js";
import { GIT_LOG_FORMAT } from "./hotspots-history.js";
import { runDriftAi } from "./runner.js";

describe("ownership subcommand", () => {
  it("runs bounded full history and emits prototype advisory JSON", () => {
    const calls: string[][] = [];
    const output = [
      commitBlock(
        {
          hash: "c2",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authorDate: "2026-05-01T00:00:00Z",
          subject: "feat: update",
          coAuthors: ["Codex <codex@example.com>"],
        },
        ["2\t0\tsrc/owned.ts"],
      ),
      commitBlock(
        {
          hash: "c1",
          authorName: "Ada Alias",
          authorEmail: "ada-old@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          subject: "feat: birth",
        },
        ["8\t0\tsrc/owned.ts"],
      ),
    ].join("\n");

    const result = runDriftAi({
      argv: [
        "ownership",
        "--format",
        "json",
        "--top",
        "5",
        "--max-commits",
        "25",
        "--agent-identity-pattern",
        "codex@example\\.com",
      ],
      git: (args) => {
        calls.push([...args]);
        if (args[0] === "rev-parse") return "/repo\n";
        if (args[0] === "config") return "";
        return "";
      },
      boundedGit: (args) => {
        calls.push([...args]);
        if (args[0] === "config") return "";
        if (args[0] === "check-mailmap" && args[1] === "Ada Alias <ada-old@example.com>") {
          return "Ada <ada@example.com>\n";
        }
        if (args[0] === "check-mailmap") return `${args[1] ?? ""}\n`;
        if (args[0] === "log") return output;
        return "";
      },
    });
    const advisory = JSON.parse(result.stdout) as {
      kind: string;
      lane: string;
      subcommand: string;
      sections: { entries: { dominantOwner: { name: string }; agentHands: unknown[] }[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("ownership");
    expect(advisory.sections[0]?.entries[0]?.dominantOwner.name).toBe("Ada");
    expect(advisory.sections[0]?.entries[0]?.agentHands).toHaveLength(1);
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

  it("prints ownership usage on help", () => {
    const result = runDriftAi({
      argv: ["ownership", "--help"],
      git: (args) => (args[0] === "rev-parse" ? "/repo\n" : ""),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai ownership");
    expect(result.stdout).toContain("--agent-identity-pattern");
  });

  it("honors configured ignore paths during bounded history collection", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "drift-ownership-config-"));
    const configPath = path.join(dir, "drift-ai.config.json");
    writeFileSync(configPath, JSON.stringify({ ignore: { prefixes: ["generated/"] } }), "utf8");
    const output = commitBlock(
      {
        hash: "c1",
        authorName: "Ada",
        authorEmail: "ada@example.com",
        authorDate: "2026-05-01T00:00:00Z",
        subject: "feat: generated and kept",
      },
      ["1\t0\tgenerated/ignored.ts", "1\t0\tsrc/kept.ts"],
    );

    const result = runDriftAi({
      argv: ["ownership", "--config", configPath, "--format", "json"],
      git: (args) => (args[0] === "rev-parse" ? `${dir}\n` : ""),
      boundedGit: (args) => {
        if (args[0] === "config") return "";
        if (args[0] === "check-mailmap") return `${args[1] ?? ""}\n`;
        if (args[0] === "log") return output;
        return "";
      },
    });
    const advisory = JSON.parse(result.stdout) as {
      sections: { entries: { path: string }[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(advisory.sections[0]?.entries.map((entry) => entry.path)).toEqual(["src/kept.ts"]);
  });

  it("rejects invalid agent identity regexes", () => {
    const result = runDriftAi({
      argv: ["ownership", "--agent-identity-pattern", "["],
      git: (args) => (args[0] === "rev-parse" ? "/repo\n" : ""),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--agent-identity-pattern must be a valid regular expression");
  });
});

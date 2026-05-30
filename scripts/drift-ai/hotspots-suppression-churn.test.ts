import { describe, expect, it } from "vitest";

import type { GitRunner } from "./git-changed-scope.js";
import type { CommitRecord } from "./hotspots-history.js";
import {
  collectSuppressionChurnRecords,
  reduceSuppressionChurn,
} from "./hotspots-suppression-churn.js";

const NUL = "\u0000";
const US = "\u001f";

function metaLine(hash: string, author = "Ada", subject = `subject ${hash}`): string {
  return (
    NUL +
    [
      hash,
      author,
      `${author.toLowerCase()}@example.com`,
      "2026-05-29T00:00:00-07:00",
      "2026-05-29T00:00:00-07:00",
      subject,
      "",
    ].join(US)
  );
}

function commitBlock(
  hash: string,
  rows: readonly string[],
  author?: string,
  subject?: string,
): string {
  return [metaLine(hash, author, subject), "", ...rows].join("\n");
}

function gitLog(blocks: readonly string[]): string {
  return blocks.join("\n");
}

function gitFake(output: string, recorded: string[][]): GitRunner {
  return (args) => {
    recorded.push([...args]);
    if (args[0] === "log") return output;
    throw new Error(`unexpected git invocation: git ${args.join(" ")}`);
  };
}

describe("collectSuppressionChurnRecords", () => {
  it("runs its own git log -G name-only walk and filters ignored paths", () => {
    const recorded: string[][] = [];
    const output = gitLog([
      commitBlock("a", ["src/a.ts", "node_modules/pkg/index.ts"]),
      commitBlock("b", ["src/a.ts"]),
    ]);

    const records = collectSuppressionChurnRecords({
      git: gitFake(output, recorded),
      windowDays: 30,
    });

    expect(recorded[0]).toContain("-G");
    expect(recorded[0]).toContain("eslint-disable|@ts-");
    expect(recorded[0]).toContain("--name-only");
    expect(recorded[0]).not.toContain("--numstat");
    expect(records).toHaveLength(2);
    expect(records[0]?.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  });
});

describe("reduceSuppressionChurn", () => {
  it("counts repeated suppression-changing commits per file", () => {
    const records: CommitRecord[] = [
      {
        hash: "a",
        authorName: "Ada",
        authorEmail: "ada@example.com",
        authorDate: "2026-05-29T00:00:00-07:00",
        committerDate: "2026-05-29T00:00:00-07:00",
        subject: "add @ts-expect-error",
        coAuthors: [],
        files: [{ path: "src/a.ts", added: 0, deleted: 0, binary: false }],
      },
      {
        hash: "b",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        authorDate: "2026-05-28T00:00:00-07:00",
        committerDate: "2026-05-28T00:00:00-07:00",
        subject: "remove eslint-disable",
        coAuthors: ["Claude <noreply@anthropic.com>"],
        files: [{ path: "src/a.ts", added: 0, deleted: 0, binary: false }],
      },
      {
        hash: "c",
        authorName: "Ada",
        authorEmail: "ada@example.com",
        authorDate: "2026-05-27T00:00:00-07:00",
        committerDate: "2026-05-27T00:00:00-07:00",
        subject: "one off suppression",
        coAuthors: [],
        files: [{ path: "src/b.ts", added: 0, deleted: 0, binary: false }],
      },
    ];

    const section = reduceSuppressionChurn(records, { top: 20, minChanges: 2 });

    expect(section.lens).toBe("suppression-churn");
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]).toMatchObject({
      path: "src/a.ts",
      suppressionChanges: 2,
      score: 2,
    });
    expect(section.entries[0]?.authors).toContainEqual({ name: "Claude", commits: 1 });
    expect(section.entries[0]?.recentSubjects).toEqual([
      "add @ts-expect-error",
      "remove eslint-disable",
    ]);
    expect(section.entries[0]?.inspectCommand).toBe(
      "git log --oneline -G'eslint-disable|@ts-' -- src/a.ts",
    );
  });

  it("reports an empty reason when no file changes suppressions repeatedly", () => {
    const records: CommitRecord[] = [
      {
        hash: "a",
        authorName: "Ada",
        authorEmail: "ada@example.com",
        authorDate: "2026-05-29T00:00:00-07:00",
        committerDate: "2026-05-29T00:00:00-07:00",
        subject: "add suppression",
        coAuthors: [],
        files: [{ path: "src/a.ts", added: 0, deleted: 0, binary: false }],
      },
    ];

    const section = reduceSuppressionChurn(records, { top: 20, minChanges: 2 });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("at least 2 suppression-changing commits");
  });
});

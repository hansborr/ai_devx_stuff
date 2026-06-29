import { describe, expect, it } from "vitest";

import { blameLineIntroductions } from "./coldspots-blame.js";
import type { GitRunner } from "./git-changed-scope.js";
import { unexpectedGitInvocationError } from "./git-runner.test-helper.js";

// A minimal --line-porcelain blame: a full header block for the first line of each
// commit, then a short header (sha + line numbers) reusing the cached metadata for
// subsequent lines of the same commit, matching real git output.
function porcelain(
  blocks: ReadonlyArray<{
    sha: string;
    line: number;
    author: string;
    epoch: number;
    content: string;
    short?: boolean;
  }>,
): string {
  const out: string[] = [];
  for (const block of blocks) {
    out.push(`${block.sha} ${block.line} ${block.line} 1`);
    if (block.short !== true) {
      out.push(`author ${block.author}`);
      out.push(`author-mail <${block.author.toLowerCase()}@example.com>`);
      out.push(`author-time ${block.epoch}`);
      out.push("author-tz -0700");
      out.push(`summary subject for ${block.sha}`);
    }
    out.push(`\t${block.content}`);
  }
  return out.join("\n");
}

function gitWith(output: string, recorder?: string[][]): GitRunner {
  return (args) => {
    recorder?.push([...args]);
    if (args[0] === "blame") return output;
    throw unexpectedGitInvocationError(args);
  };
}

describe("blameLineIntroductions", () => {
  it("parses porcelain blame into per-line sha/author/introducedAt", () => {
    const output = porcelain([
      { sha: "aaa111", line: 1, author: "Ada", epoch: 1700000000, content: "// TODO old" },
      { sha: "bbb222", line: 2, author: "Bob", epoch: 1710000000, content: "code" },
    ]);

    const blame = blameLineIntroductions({
      git: gitWith(output),
      repoRoot: "/repo",
      path: "src/a.ts",
    });

    expect(blame.get(1)).toMatchObject({
      sha: "aaa111",
      author: "Ada",
      introducedAtMs: 1700000000000,
    });
    expect(blame.get(2)).toMatchObject({ sha: "bbb222", author: "Bob" });
  });

  it("reuses cached commit metadata across short headers for the same commit", () => {
    const output = porcelain([
      { sha: "aaa111", line: 1, author: "Ada", epoch: 1700000000, content: "first" },
      { sha: "aaa111", line: 2, author: "Ada", epoch: 1700000000, content: "second", short: true },
    ]);

    const blame = blameLineIntroductions({
      git: gitWith(output),
      repoRoot: "/repo",
      path: "src/a.ts",
    });

    expect(blame.get(2)).toMatchObject({
      sha: "aaa111",
      author: "Ada",
      introducedAtMs: 1700000000000,
    });
  });

  it("invokes git blame with --line-porcelain anchored at the repo root for the path", () => {
    const recorder: string[][] = [];
    blameLineIntroductions({
      git: gitWith(porcelain([]), recorder),
      repoRoot: "/repo",
      path: "src/weird path.ts",
    });

    const call = recorder[0] ?? [];
    expect(call[0]).toBe("blame");
    expect(call).toContain("--line-porcelain");
    expect(call).toContain("src/weird path.ts");
  });

  it("returns an empty map when git blame throws (e.g. uncommitted or unreadable)", () => {
    const git: GitRunner = () => {
      throw new Error("fatal: no such path");
    };

    const blame = blameLineIntroductions({ git, repoRoot: "/repo", path: "src/a.ts" });

    expect(blame.size).toBe(0);
  });

  it("parses 64-char SHA-256 object IDs (regression: header regex capped at 40)", () => {
    const sha256 = "a".repeat(64);
    const output = porcelain([
      { sha: sha256, line: 1, author: "Ada", epoch: 1700000000, content: "// TODO old" },
    ]);

    const blame = blameLineIntroductions({
      git: gitWith(output),
      repoRoot: "/repo",
      path: "src/a.ts",
    });

    expect(blame.get(1)).toMatchObject({ sha: sha256, author: "Ada" });
  });
});

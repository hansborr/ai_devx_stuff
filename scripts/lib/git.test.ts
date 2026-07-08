import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  defaultGitRunner,
  type GitRunner,
  listTrackedFiles,
  mergeBase,
  nameStatusCode,
  type NameStatusEntry,
  parseNameStatus,
  resolveRepoRoot,
} from "./git.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function stubGit(responses: Record<string, string>): GitRunner {
  return (args) => {
    const key = args.join(" ");
    if (Object.prototype.hasOwnProperty.call(responses, key)) return responses[key] ?? "";
    throw new Error(`unexpected git invocation: git ${key}`);
  };
}

const throwingGit: GitRunner = () => {
  throw new Error("git unavailable");
};

describe("defaultGitRunner", () => {
  it("shells out to the system git and returns its stdout", () => {
    const run = defaultGitRunner();
    expect(run(["--version"])).toContain("git version");
  });

  it("runs git in the provided cwd", () => {
    // --show-prefix reports the path from the repo root to cwd, so binding cwd
    // to this test file's own directory must yield the scripts/lib/ prefix.
    const run = defaultGitRunner({ cwd: HERE });
    expect(run(["rev-parse", "--show-prefix"]).trim()).toBe("scripts/lib/");
  });
});

describe("listTrackedFiles", () => {
  it("splits ls-files output, dropping blank lines and trailing CR, order preserved", () => {
    const git = stubGit({ "ls-files": "b/z.ts\r\n\na/y.ts\nb/z.ts\n" });
    expect(listTrackedFiles(git)).toEqual(["b/z.ts", "a/y.ts", "b/z.ts"]);
  });

  it("returns an empty array for empty output", () => {
    expect(listTrackedFiles(stubGit({ "ls-files": "\n" }))).toEqual([]);
  });
});

describe("resolveRepoRoot", () => {
  it("returns the trimmed toplevel git reports", () => {
    const git = stubGit({ "rev-parse --show-toplevel": "/repo/root\n" });
    expect(resolveRepoRoot(git)).toBe("/repo/root");
  });

  it("falls back to process.cwd() when git yields nothing", () => {
    const git = stubGit({ "rev-parse --show-toplevel": "\n" });
    expect(resolveRepoRoot(git)).toBe(process.cwd());
  });

  it("falls back to process.cwd() when git throws", () => {
    expect(resolveRepoRoot(throwingGit)).toBe(process.cwd());
  });
});

describe("nameStatusCode", () => {
  it("accepts the five porcelain codes and reads only the leading letter", () => {
    expect(nameStatusCode("A")).toBe("A");
    expect(nameStatusCode("M")).toBe("M");
    expect(nameStatusCode("D")).toBe("D");
    expect(nameStatusCode("R100")).toBe("R");
    expect(nameStatusCode("C075")).toBe("C");
  });

  it("rejects unknown or missing status fields", () => {
    expect(nameStatusCode("X")).toBeUndefined();
    expect(nameStatusCode("")).toBeUndefined();
    expect(nameStatusCode(undefined)).toBeUndefined();
  });
});

describe("parseNameStatus", () => {
  it("parses added, modified, and deleted rows to code + path entries", () => {
    const entries = parseNameStatus("A\tadded.ts\nM\tmodified.ts\nD\tdeleted.ts\n");
    const expected: NameStatusEntry[] = [
      { code: "A", path: "added.ts" },
      { code: "M", path: "modified.ts" },
      { code: "D", path: "deleted.ts" },
    ];
    expect(entries).toEqual(expected);
  });

  it("keeps the destination as path and the source as previousPath for renames and copies", () => {
    const entries = parseNameStatus("R100\told.ts\tnew.ts\nC075\tsrc.ts\tcopy.ts\n");
    const expected: NameStatusEntry[] = [
      { code: "R", path: "new.ts", previousPath: "old.ts" },
      { code: "C", path: "copy.ts", previousPath: "src.ts" },
    ];
    expect(entries).toEqual(expected);
  });

  it("strips trailing CRLF and skips blank lines", () => {
    expect(parseNameStatus("A\tone.ts\r\n\r\nM\ttwo.ts\r\n")).toEqual([
      { code: "A", path: "one.ts" },
      { code: "M", path: "two.ts" },
    ]);
  });

  it("skips rows with an unknown code or an empty leading path", () => {
    expect(parseNameStatus("X\tunknown.ts\nA\t\nM\tkept.ts")).toEqual([
      { code: "M", path: "kept.ts" },
    ]);
  });

  it("treats an empty rename destination as a plain single-path entry", () => {
    expect(parseNameStatus("R100\tonly.ts\t")).toEqual([{ code: "R", path: "only.ts" }]);
  });
});

describe("mergeBase", () => {
  it("returns the trimmed merge base of the ref and HEAD", () => {
    const git = stubGit({ "merge-base origin/main HEAD": "abc123\n" });
    expect(mergeBase("origin/main", git)).toBe("abc123");
  });

  it("honours a custom head argument", () => {
    const git = stubGit({ "merge-base origin/main feature": "def456\n" });
    expect(mergeBase("origin/main", git, "feature")).toBe("def456");
  });

  it("returns undefined when git yields an empty result", () => {
    const git = stubGit({ "merge-base origin/main HEAD": "\n" });
    expect(mergeBase("origin/main", git)).toBeUndefined();
  });

  it("returns undefined when git throws", () => {
    expect(mergeBase("origin/main", throwingGit)).toBeUndefined();
  });
});

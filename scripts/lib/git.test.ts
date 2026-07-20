import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  defaultGitRunner,
  type GitRunner,
  gitStatusPorcelainArgs,
  listTrackedFiles,
  mergeBase,
  nameStatusCode,
  type NameStatusEntry,
  parseNameStatus,
  readGitBlobAtRef,
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

describe("readGitBlobAtRef", () => {
  it("reads a path from a named ref through an injected runner", () => {
    const git = stubGit({ "show HEAD:docs/baseline.json": "committed\n" });

    expect(readGitBlobAtRef(git, "HEAD", "docs/baseline.json")).toBe("committed\n");
  });

  it("supports the empty index ref and forwards bounded-runner options", () => {
    const calls: Array<{
      readonly args: readonly string[];
      readonly options: { readonly maxOutputBytes: number; readonly timeoutMs: number } | undefined;
    }> = [];
    const git = (
      args: readonly string[],
      options?: { readonly maxOutputBytes: number; readonly timeoutMs: number },
    ): string => {
      calls.push({ args, options });
      return "staged";
    };
    const options = { maxOutputBytes: 1_024, timeoutMs: 250 };

    expect(readGitBlobAtRef(git, "", "docs/map.md", options)).toBe("staged");
    expect(calls).toEqual([{ args: ["show", ":docs/map.md"], options }]);
  });
});

describe("listTrackedFiles", () => {
  it("NUL-splits ls-files -z output, dropping the trailing empty entry, order preserved", () => {
    const git = stubGit({ "ls-files -z": "b/z.ts\0a/y.ts\0b/z.ts\0" });
    expect(listTrackedFiles(git)).toEqual(["b/z.ts", "a/y.ts", "b/z.ts"]);
  });

  it("preserves a pathname containing a newline that a newline-split would corrupt", () => {
    const git = stubGit({ "ls-files -z": "a\nb.ts\0c.ts\0" });
    expect(listTrackedFiles(git)).toEqual(["a\nb.ts", "c.ts"]);
  });

  it("returns an empty array for empty output", () => {
    expect(listTrackedFiles(stubGit({ "ls-files -z": "" }))).toEqual([]);
    expect(listTrackedFiles(stubGit({ "ls-files -z": "\0" }))).toEqual([]);
  });
});

describe("gitStatusPorcelainArgs", () => {
  it("excludes generated artifacts inside the repository from dirty-state probes", () => {
    expect(
      gitStatusPorcelainArgs("/repo", [
        "/repo/semgrep-candidates.json",
        "/repo/packets",
        "/outside/report.json",
      ]),
    ).toEqual([
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(top,exclude,literal)semgrep-candidates.json",
      ":(top,exclude,literal)packets",
    ]);
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

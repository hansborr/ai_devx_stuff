import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  defaultGitRunner,
  gitCheckIgnore,
  type GitRunner,
  gitStatusPorcelainArgs,
  listStagedPaths,
  listTrackedFiles,
  mergeBase,
  nameStatusCode,
  type NameStatusEntry,
  parseNameStatus,
  readFirstParentCommit,
  readGitBlobAtRef,
  readGitDir,
  readRepoRoot,
  readStagedBlobSize,
  resolveRepoRoot,
} from "./git.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpRepo = registerTempRootCleanup();

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

describe("gitCheckIgnore", () => {
  it("distinguishes ignored output from a successful not-ignored probe", () => {
    const repoRoot = tmpRepo.makeTmpGitRepo("git-check-ignore-");
    tmpRepo.writeRepoFile(repoRoot, ".gitignore", "ignored/\n");

    const ignored = gitCheckIgnore(["ignored/file.txt"], { cwd: repoRoot });
    expect(ignored.kind).toBe("ignored-paths-output");
    if (ignored.kind !== "ignored-paths-output") throw new Error("expected ignored output");
    expect(ignored.stdout).toContain("\tignored/file.txt\n");

    const notIgnored = gitCheckIgnore(["tracked/file.txt"], { cwd: repoRoot });
    expect(notIgnored).toEqual({
      kind: "not-ignored",
      stdout: "",
    });
  });

  it("classifies an unexpected Git status with its diagnostics", () => {
    const notARepo = tmpRepo.makeTempRepo("git-check-ignore-not-repo-");

    const result = gitCheckIgnore(["candidate.txt"], { cwd: notARepo });
    expect(result.kind).toBe("unexpected-status");
    if (result.kind !== "unexpected-status") throw new Error("expected unexpected status");
    expect(result.status).toBe(128);
    expect(result.stderr).toContain("not a git repository");
  });

  it("classifies a failure to spawn Git", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = tmpRepo.makeTempRepo("git-check-ignore-empty-path-");
    try {
      const result = gitCheckIgnore(["candidate.txt"], { cwd: HERE });
      expect(result.kind).toBe("spawn-failed");
      if (result.kind !== "spawn-failed") throw new Error("expected spawn failure");
      expect(result.error).toHaveProperty("code", "ENOENT");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

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

  // The stderr modes exist because probe callers differ in what they want git's
  // diagnostics to do. "inherit" is execFileSync's own default (stderr reaches
  // the terminal AND the thrown error); "captured" keeps the error text but
  // silences the terminal; "discarded" drops it from both. `--verify` of an
  // unresolvable revision is a deterministic stderr-producing failure that
  // needs no fixture repository.
  const FAILING_PROBE = ["rev-parse", "--verify", "musi-no-such-ref^{commit}"];

  type ProbeFailure = {
    /** The thrown error's message. */
    readonly message: string;
    /** Everything the probe forwarded to the parent process's stderr. */
    readonly parentStderr: string;
  };

  // execFileSync with no explicit `stdio` buffers the child's stderr and then
  // re-emits it through `process.stderr.write`, so spying on that call is what
  // separates a forwarding mode from a silent one. Asserting only on the thrown
  // message cannot tell them apart: every non-discarded mode keeps the text.
  function runFailingProbe(run: GitRunner): ProbeFailure {
    const forwarded: string[] = [];
    const write = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      forwarded.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    });
    try {
      run(FAILING_PROBE);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
        parentStderr: forwarded.join(""),
      };
    } finally {
      write.mockRestore();
    }
    throw new Error("expected the probe to fail");
  }

  it("keeps git diagnostics in the thrown error under the default and captured modes", () => {
    for (const stderr of [undefined, "inherit", "captured"] as const) {
      const run = defaultGitRunner({ cwd: HERE, stderr });
      expect(runFailingProbe(run).message).toContain("fatal: Needed a single revision");
    }
  });

  it("forwards git's stderr to the parent under the default and inherit modes", () => {
    for (const stderr of [undefined, "inherit"] as const) {
      const run = defaultGitRunner({ cwd: HERE, stderr });
      expect(runFailingProbe(run).parentStderr).toContain("fatal: Needed a single revision");
    }
  });

  // The behaviour that makes "captured" worth asking for: callers such as the
  // `HEAD^1` probe in sensor-near-duplicates-baseline-io fold the failure into
  // their own message, so a root-commit or shallow-history repository must not
  // see a raw `fatal:` line on the parent's stderr first.
  it("writes nothing to the parent's stderr under the captured and discarded modes", () => {
    for (const stderr of ["captured", "discarded"] as const) {
      const run = defaultGitRunner({ cwd: HERE, stderr });
      expect(runFailingProbe(run).parentStderr).toBe("");
    }
  });

  it("drops git diagnostics from the thrown error under the discarded mode", () => {
    const run = defaultGitRunner({ cwd: HERE, stderr: "discarded" });
    expect(runFailingProbe(run).message).toBe(
      "Command failed: git rev-parse --verify musi-no-such-ref^{commit}",
    );
  });
});

describe("readRepoRoot", () => {
  it("returns the trimmed toplevel git reports", () => {
    const git = stubGit({ "rev-parse --show-toplevel": "/repo/root\n" });
    expect(readRepoRoot(git)).toBe("/repo/root");
  });

  it("propagates the git failure instead of substituting a fallback", () => {
    expect(() => readRepoRoot(throwingGit)).toThrow("git unavailable");
  });
});

describe("readGitDir", () => {
  it("returns the trimmed git-dir git reports", () => {
    const git = stubGit({ "rev-parse --git-dir": ".git\n" });
    expect(readGitDir(git)).toBe(".git");
  });

  it("propagates the git failure", () => {
    expect(() => readGitDir(throwingGit)).toThrow("git unavailable");
  });
});

describe("readFirstParentCommit", () => {
  it("verifies and returns HEAD's first parent", () => {
    const git = stubGit({ "rev-parse --verify HEAD^1": "abc123\n" });
    expect(readFirstParentCommit(git)).toBe("abc123");
  });

  it("propagates the git failure when HEAD has no first parent", () => {
    expect(() => readFirstParentCommit(throwingGit)).toThrow("git unavailable");
  });
});

describe("listStagedPaths", () => {
  const STAGED = "diff --cached --name-only --diff-filter=ACMR -z";

  it("NUL-splits the ACMR staged set, dropping the trailing empty entry", () => {
    const git = stubGit({ [STAGED]: "b/z.ts\0a/y.ts\0" });
    expect(listStagedPaths(git)).toEqual(["b/z.ts", "a/y.ts"]);
  });

  it("preserves pathnames a newline-split or core.quotePath would corrupt", () => {
    const git = stubGit({ [STAGED]: "a\nb.ts\0docs/café.md\0" });
    expect(listStagedPaths(git)).toEqual(["a\nb.ts", "docs/café.md"]);
  });

  it("returns an empty array for empty output", () => {
    expect(listStagedPaths(stubGit({ [STAGED]: "" }))).toEqual([]);
    expect(listStagedPaths(stubGit({ [STAGED]: "\0" }))).toEqual([]);
  });

  it("propagates the git failure so callers own the no-repository policy", () => {
    expect(() => listStagedPaths(throwingGit)).toThrow("git unavailable");
  });
});

describe("readStagedBlobSize", () => {
  it("reads the staged blob byte count from the index ref", () => {
    const git = stubGit({ "cat-file -s :docs/plan.md": "1234\n" });
    expect(readStagedBlobSize(git, "docs/plan.md")).toBe(1234);
  });

  it("propagates the git failure for an unstaged path", () => {
    expect(() => readStagedBlobSize(throwingGit, "docs/plan.md")).toThrow("git unavailable");
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

  it("appends caller pathspecs after -z, leaving the no-pathspec argv unchanged", () => {
    const git = stubGit({ "ls-files -z docs/**/*.md docs/*.md": "docs/a.md\0" });
    expect(listTrackedFiles(git, ["docs/**/*.md", "docs/*.md"])).toEqual(["docs/a.md"]);
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

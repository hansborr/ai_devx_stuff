import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../../test/support/tmp-repo.test-helper.js";
import { trackedFilesFromGit } from "./git-tracked-files.js";
import { matchesRatchet } from "./ratchet-globs.js";

const tmpRepo = registerTempRootCleanup();

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

describe("trackedFilesFromGit", () => {
  it("keeps non-ASCII pathnames in coverage that plain ls-files would C-quote", () => {
    const root = tmpRepo.makeTmpGitRepo("git-tracked-files-nonascii-");
    // Force the quoting condition the bug depends on, regardless of the test
    // runner's global git config (some environments set quotePath=false).
    git(root, ["config", "core.quotePath", "true"]);
    const nonAsciiPath = "packages/app/src/ö.ts";
    tmpRepo.writeRepoFile(root, nonAsciiPath, "export const x = 1;\n");
    tmpRepo.writeRepoFile(root, "packages/app/src/plain.ts", "export const y = 2;\n");
    git(root, ["add", "-A"]);

    // Guard: plain `git ls-files` really does emit this path C-quoted with
    // surrounding double quotes, so a newline-split of that output would drop it.
    const rawListing = git(root, ["ls-files"]);
    expect(rawListing).toContain('"packages/app/src/\\303\\266.ts"');

    const tracked = trackedFilesFromGit("test", root);
    expect(tracked).toContain(nonAsciiPath);
    // The unquoted path must actually flow through the ratchet matcher.
    expect(matchesRatchet({ files: ["**/*.ts"], ignores: [] }, nonAsciiPath)).toBe(true);
  });
});

import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../../test-support/tmp-repo.test-helper.js";
import { walkTsFiles } from "./walk-ts-files.js";

const tmpRepo = registerTempRootCleanup();

function makeTree(): string {
  return tmpRepo.writeRepo(
    {
      "a.ts": "",
      "b.tsx": "",
      "c.d.ts": "",
      "notes.md": "",
      "nested/child.ts": "",
      "nested/deep/leaf.ts": "",
      "skipme/ignored.ts": "",
    },
    "walk-ts-files-",
  );
}

const includeAllTs = (p: string): boolean => /\.tsx?$/u.test(p);

describe("walkTsFiles", () => {
  it("recurses into subdirectories and returns matching files", () => {
    const root = makeTree();
    const result = walkTsFiles([root], { include: includeAllTs, relativeTo: root });
    expect(result).toContain("a.ts");
    expect(result).toContain(path.join("nested", "child.ts"));
    expect(result).toContain(path.join("nested", "deep", "leaf.ts"));
  });

  it("prunes directories matched by skipDir", () => {
    const root = makeTree();
    const result = walkTsFiles([root], {
      include: includeAllTs,
      skipDir: (name) => name === "skipme",
      relativeTo: root,
    });
    expect(result).not.toContain(path.join("skipme", "ignored.ts"));
    expect(result).toContain(path.join("nested", "child.ts"));
  });

  it("applies the include filter to each file", () => {
    const root = makeTree();
    const result = walkTsFiles([root], {
      include: (p) => p.endsWith(".ts") && !p.endsWith(".d.ts"),
      relativeTo: root,
    });
    expect(result).toContain("a.ts");
    expect(result).not.toContain("b.tsx");
    expect(result).not.toContain("c.d.ts");
    expect(result).not.toContain("notes.md");
  });

  it("emits absolute paths when relativeTo is omitted", () => {
    const root = makeTree();
    const result = walkTsFiles([root], { include: includeAllTs });
    expect(result).toContain(path.join(root, "a.ts"));
    expect(result.every((p) => path.isAbsolute(p))).toBe(true);
  });

  it("emits relative paths when relativeTo is set", () => {
    const root = makeTree();
    const result = walkTsFiles([root], { include: includeAllTs, relativeTo: root });
    expect(result.every((p) => !path.isAbsolute(p))).toBe(true);
  });

  it("returns an empty list for a missing root and skips it among present roots", () => {
    const root = makeTree();
    const missing = path.join(root, "does-not-exist");
    expect(walkTsFiles([missing], { include: includeAllTs })).toEqual([]);
    const result = walkTsFiles([missing, root], { include: includeAllTs, relativeTo: root });
    expect(result).toContain("a.ts");
  });

  it("returns results in stable locale-sorted order across roots", () => {
    const rootA = tmpRepo.makeTempRepo("walk-ts-files-a-");
    const rootB = tmpRepo.makeTempRepo("walk-ts-files-b-");
    tmpRepo.writeRepoFile(rootB, "zebra.ts", "");
    tmpRepo.writeRepoFile(rootA, "alpha.ts", "");
    tmpRepo.writeRepoFile(rootA, "Beta.ts", "");
    const result = walkTsFiles([rootB, rootA], { include: includeAllTs });
    const expected = [...result].sort((left, right) => left.localeCompare(right, "en"));
    expect(result).toEqual(expected);
  });
});

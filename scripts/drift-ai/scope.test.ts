import { describe, expect, it } from "vitest";

import {
  buildSourceExtensions,
  BUILT_IN_SOURCE_EXTENSIONS,
  changedFilesFromScope,
  type DetectorScope,
  toChangedScopeFile,
  toCurrentScopeFile,
} from "./scope.js";

describe("buildSourceExtensions", () => {
  it("keeps built-in JS/TS extensions and adds normalized custom extensions", () => {
    const extensions = buildSourceExtensions([".VUE", "svelte"]);

    for (const extension of BUILT_IN_SOURCE_EXTENSIONS) {
      expect(extensions.has(extension)).toBe(true);
    }
    expect(extensions.has(".vue")).toBe(true);
    expect(extensions.has(".svelte")).toBe(true);
  });
});

describe("scope file helpers", () => {
  it("tags changed files and preserves previousPath when present", () => {
    expect(
      toChangedScopeFile({
        path: "src/new.ts",
        status: "renamed",
        previousPath: "src/old.ts",
      }),
    ).toEqual({
      scope: "changed",
      path: "src/new.ts",
      status: "renamed",
      previousPath: "src/old.ts",
    });
  });

  it("tags current files without lifecycle status", () => {
    expect(toCurrentScopeFile("src/app.ts")).toEqual({
      scope: "current",
      path: "src/app.ts",
    });
  });

  it("projects changed-scope files back to changed-file records", () => {
    expect(
      changedFilesFromScope({
        scopeMode: "changed",
        files: [
          toChangedScopeFile({
            path: "src/new.ts",
            status: "renamed",
            previousPath: "src/old.ts",
          }),
        ],
      }),
    ).toEqual([
      {
        path: "src/new.ts",
        status: "renamed",
        previousPath: "src/old.ts",
      },
    ]);

    const invalidScope: DetectorScope = {
      scopeMode: "changed",
      // @ts-expect-error -- changed scopes reject mixed changed/current file records
      files: [
        toChangedScopeFile({ path: "src/changed.ts", status: "modified" }),
        toCurrentScopeFile("src/current.ts"),
      ],
    };

    void invalidScope;
  });
});

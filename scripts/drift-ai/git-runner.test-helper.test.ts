import { describe, expect, it } from "vitest";

import { makeStubGit } from "./git-runner.test-helper.js";

describe("makeStubGit", () => {
  it("throws for prototype member keys that were not explicitly registered", () => {
    const git = makeStubGit({});

    expect(() => git(["toString"])).toThrow("unexpected git invocation: git toString");
  });

  it("returns explicitly registered prototype-shaped response keys", () => {
    const git = makeStubGit({ toString: "explicit response\n" });

    expect(git(["toString"])).toBe("explicit response\n");
  });
});

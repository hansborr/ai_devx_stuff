import { describe, expect, it } from "vitest";

import type { CommitIntentOverlay } from "./commit-intent.js";
import { appendRowContext, formatAuthor, type RowContextLike } from "./format-row-context.js";

const intent: CommitIntentOverlay = { category: "fix", subjects: ["fix a"], trailerHints: [] };

function row(over: Partial<RowContextLike>): RowContextLike {
  return {
    authors: [],
    recentSubjects: [],
    commitIntent: [],
    inspectCommand: "git log --oneline -- a.ts",
    ...over,
  };
}

describe("formatAuthor", () => {
  it("renders name×commits", () => {
    expect(formatAuthor({ name: "Ada", commits: 3 })).toBe("Ada×3");
  });
});

describe("appendRowContext", () => {
  it("emits all four lines when every field is populated", () => {
    const lines: string[] = [];
    appendRowContext(
      lines,
      row({
        authors: [
          { name: "Ada", commits: 2 },
          { name: "Bo", commits: 1 },
        ],
        recentSubjects: ["fix a", "tidy b"],
        commitIntent: [intent],
        inspectCommand: "git log --oneline -- src/x.ts",
      }),
    );
    expect(lines).toEqual([
      "        authors: Ada×2, Bo×1",
      `        recent: "fix a"; "tidy b"`,
      `        intent: fix ("fix a")`,
      "        inspect: git log --oneline -- src/x.ts",
    ]);
  });

  it("omits the authors/recent/intent lines when empty but always shows inspect", () => {
    const lines: string[] = [];
    appendRowContext(lines, row({ inspectCommand: "git log --oneline -- only.ts" }));
    expect(lines).toEqual(["        inspect: git log --oneline -- only.ts"]);
  });
});

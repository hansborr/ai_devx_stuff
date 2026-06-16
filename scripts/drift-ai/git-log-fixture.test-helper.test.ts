import { describe, expect, it } from "vitest";

import {
  buildGitLogFixture,
  commitBlock,
  GIT_LOG_CONTROL,
  type GitLogEntry,
  joinGitLogBlocks,
  metaLine,
} from "./git-log-fixture.test-helper.js";

// These tests pin the exact control-byte layout the helper emits so the
// hand-rolled fixtures it replaces stay byte-for-byte identical. The expected
// strings are assembled from char codes (never raw control bytes) so this source
// file itself stays plain text — the very corruption L1 is about.
const NUL = String.fromCharCode(0);
const US = String.fromCharCode(0x1f);
const GS = String.fromCharCode(0x1d);

const BASE: GitLogEntry = {
  hash: "abc123",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authorDate: "2026-05-29T09:46:48-07:00",
  committerDate: "2026-05-29T09:46:48-07:00",
  subject: "feat: thing",
};

describe("GIT_LOG_CONTROL", () => {
  it("exposes the three git-log separators by exact char code", () => {
    expect(GIT_LOG_CONTROL.record).toBe(NUL);
    expect(GIT_LOG_CONTROL.field).toBe(US);
    expect(GIT_LOG_CONTROL.coAuthor).toBe(GS);
    expect(GIT_LOG_CONTROL.record.charCodeAt(0)).toBe(0);
    expect(GIT_LOG_CONTROL.field.charCodeAt(0)).toBe(0x1f);
    expect(GIT_LOG_CONTROL.coAuthor.charCodeAt(0)).toBe(0x1d);
  });
});

describe("metaLine", () => {
  it("prefixes NUL and unit-separates the seven metadata fields", () => {
    expect(metaLine(BASE)).toBe(
      NUL +
        [
          "abc123",
          "Ada",
          "ada@example.com",
          BASE.authorDate,
          BASE.committerDate,
          "feat: thing",
          "",
        ].join(US),
    );
  });

  it("joins multiple co-authors with the group separator in the trailing field", () => {
    const line = metaLine({
      ...BASE,
      coAuthors: ["Bob <bob@example.com>", "Cleo <cleo@example.com>"],
    });

    expect(line).toBe(
      NUL +
        [
          "abc123",
          "Ada",
          "ada@example.com",
          BASE.authorDate,
          BASE.committerDate,
          "feat: thing",
          `Bob <bob@example.com>${GS}Cleo <cleo@example.com>`,
        ].join(US),
    );
  });

  it("emits an empty trailing field when no co-authors are given", () => {
    expect(metaLine(BASE).endsWith(US)).toBe(true);
  });

  it("defaults the committer date to the author date when omitted", () => {
    const { committerDate: _omitted, ...withoutCommitterDate } = BASE;

    expect(metaLine(withoutCommitterDate)).toBe(
      metaLine({ ...BASE, committerDate: BASE.authorDate }),
    );
  });
});

describe("commitBlock", () => {
  it("places the NUL meta line, a blank line, then numstat rows joined by newlines", () => {
    const block = commitBlock(BASE, ["10\t2\tsrc/a.ts", "0\t5\tsrc/b.ts"]);

    expect(block).toBe([metaLine(BASE), "", "10\t2\tsrc/a.ts", "0\t5\tsrc/b.ts"].join("\n"));
  });

  it("reads numstat rows from the entry's numstat field when rows are omitted", () => {
    const block = commitBlock({ ...BASE, numstat: ["3\t3\tsrc/a.ts"] });

    expect(block).toBe([metaLine(BASE), "", "3\t3\tsrc/a.ts"].join("\n"));
  });

  it("produces only the meta line and blank line for a commit with no rows", () => {
    expect(commitBlock(BASE, [])).toBe(`${metaLine(BASE)}\n`);
  });
});

describe("buildGitLogFixture", () => {
  it("joins commit blocks with a single newline, matching real git output", () => {
    const fixture = buildGitLogFixture([
      { ...BASE, hash: "hash1", subject: "feat: first", numstat: ["10\t2\tsrc/a.ts"] },
      { ...BASE, hash: "hash2", subject: "fix: second", numstat: ["3\t3\tsrc/a.ts"] },
    ]);

    expect(fixture).toBe(
      [
        commitBlock({ ...BASE, hash: "hash1", subject: "feat: first" }, ["10\t2\tsrc/a.ts"]),
        commitBlock({ ...BASE, hash: "hash2", subject: "fix: second" }, ["3\t3\tsrc/a.ts"]),
      ].join("\n"),
    );
  });

  it("contains exactly one NUL byte per commit (the boundary marker)", () => {
    const fixture = buildGitLogFixture([
      { ...BASE, hash: "h0", numstat: ["1\t1\tsrc/a.ts"] },
      { ...BASE, hash: "h1", numstat: ["1\t1\tsrc/b.ts"] },
    ]);

    expect(fixture.split(NUL)).toHaveLength(3); // two boundaries => three segments
  });
});

describe("joinGitLogBlocks", () => {
  it("joins pre-built blocks with a single newline (no extra blank between commits)", () => {
    const first = commitBlock({ ...BASE, hash: "h0" }, ["1\t1\tsrc/a.ts"]);
    const second = commitBlock({ ...BASE, hash: "h1" }, ["2\t2\tsrc/b.ts"]);

    expect(joinGitLogBlocks([first, second])).toBe(`${first}\n${second}`);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseLcov } from "./coverage-lcov.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "coverage");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

describe("parseLcov", () => {
  it("parses functions, lines, and summary counts from a representative lcov fixture", () => {
    const parsed = parseLcov(readFixture("unit.lcov.info"));
    expect(parsed.notes).toEqual([]);
    expect(parsed.files.map((file) => file.file)).toEqual(["src/math.ts", "src/util.ts"]);

    const math = parsed.files[0];
    expect(math?.functions).toEqual([
      { name: "add", line: 1, hits: 3 },
      { name: "subtract", line: 5, hits: 0 },
    ]);
    expect(math?.lines).toEqual([
      { line: 1, hits: 3 },
      { line: 2, hits: 3 },
      { line: 5, hits: 0 },
      { line: 6, hits: 0 },
    ]);
    expect(math?.linesFound).toBe(4);
    expect(math?.linesHit).toBe(2);
    expect(math?.functionsFound).toBe(2);
    expect(math?.functionsHit).toBe(1);
  });

  it("captures a function range from the three-field FN form and ignores branch records", () => {
    const parsed = parseLcov(readFixture("unit.lcov.info"));
    const util = parsed.files[1];
    expect(util?.functions).toEqual([{ name: "formatName", line: 2, endLine: 8, hits: 7 }]);
    expect(util?.lines).toEqual([
      { line: 2, hits: 7 },
      { line: 3, hits: 7 },
    ]);
  });

  it("defaults a function with no FNDA record to zero hits", () => {
    const parsed = parseLcov("SF:src/a.ts\nFN:1,only\nend_of_record\n");
    expect(parsed.files[0]?.functions).toEqual([{ name: "only", line: 1, hits: 0 }]);
  });

  it("ignores the optional DA checksum field", () => {
    const parsed = parseLcov("SF:src/a.ts\nDA:1,5,9f8e7d\nend_of_record\n");
    expect(parsed.files[0]?.lines).toEqual([{ line: 1, hits: 5 }]);
  });

  it("derives summary counts when LF/LH/FNF/FNH records are absent", () => {
    const parsed = parseLcov("SF:src/a.ts\nFN:1,run\nFNDA:0,run\nDA:1,0\nDA:2,4\nend_of_record\n");
    const file = parsed.files[0];
    expect(file?.linesFound).toBe(2);
    expect(file?.linesHit).toBe(1);
    expect(file?.functionsFound).toBe(1);
    expect(file?.functionsHit).toBe(0);
  });

  it("tolerates CRLF line endings", () => {
    const parsed = parseLcov("SF:src/a.ts\r\nDA:1,2\r\nend_of_record\r\n");
    expect(parsed.notes).toEqual([]);
    expect(parsed.files[0]?.lines).toEqual([{ line: 1, hits: 2 }]);
  });

  it("sorts files by path regardless of artifact order", () => {
    const parsed = parseLcov(
      "SF:src/zed.ts\nDA:1,1\nend_of_record\nSF:src/abc.ts\nDA:1,1\nend_of_record\n",
    );
    expect(parsed.files.map((file) => file.file)).toEqual(["src/abc.ts", "src/zed.ts"]);
  });

  it("discloses duplicate DA records with differing hits and keeps the last value", () => {
    const parsed = parseLcov("SF:src/a.ts\nDA:1,2\nDA:1,5\nDA:2,3\nDA:2,3\nend_of_record\n");
    expect(parsed.files[0]?.lines).toEqual([
      { line: 1, hits: 5 },
      { line: 2, hits: 3 },
    ]);
    expect(parsed.notes).toEqual([
      {
        kind: "malformed-record",
        line: 3,
        detail: "duplicate DA record for line 1 with differing hits",
      },
    ]);
  });

  it("records malformed notes for negative line and hit counts", () => {
    const parsed = parseLcov(
      "SF:src/a.ts\nDA:-1,2\nDA:2,-3\nFN:-1,bad\nFN:4,2,badRange\nFNDA:-1,bad\nLF:-1\nend_of_record\n",
    );
    expect(parsed.files[0]?.lines).toEqual([]);
    expect(parsed.files[0]?.functions).toEqual([]);
    expect(parsed.notes).toEqual([
      {
        kind: "malformed-record",
        line: 2,
        detail: "DA record has a malformed line/hits '-1,2'",
      },
      {
        kind: "malformed-record",
        line: 3,
        detail: "DA record has a malformed line/hits '2,-3'",
      },
      {
        kind: "malformed-record",
        line: 4,
        detail: "FN record has a malformed line/name '-1,bad'",
      },
      {
        kind: "malformed-record",
        line: 5,
        detail: "FN record end line precedes start line '4,2,badRange'",
      },
      {
        kind: "malformed-record",
        line: 6,
        detail: "FNDA record has a malformed hits/name '-1,bad'",
      },
      {
        kind: "malformed-record",
        line: 7,
        detail: "LF record has a malformed count '-1'",
      },
    ]);
  });

  it("keeps duplicate function declarations instead of silently collapsing them", () => {
    const parsed = parseLcov(
      "SF:src/a.ts\nFN:1,render\nFN:5,render\nFNDA:2,render\nend_of_record\n",
    );
    expect(parsed.files[0]?.functions).toEqual([
      { name: "render", line: 1, hits: 2 },
      { name: "render", line: 5, hits: 2 },
    ]);
    expect(parsed.notes).toEqual([
      {
        kind: "malformed-record",
        line: 3,
        detail:
          "duplicate FN record for function 'render' in 'src/a.ts'; FNDA hit counts are name-based and applied to each declaration",
      },
    ]);
  });

  it("records degradation notes without dropping the evidence it can parse", () => {
    const parsed = parseLcov(readFixture("malformed.lcov.info"));
    expect(parsed.files.map((file) => file.file)).toEqual(["src/missingeor.ts", "src/ok.ts"]);

    const ok = parsed.files.find((file) => file.file === "src/ok.ts");
    expect(ok?.lines).toEqual([{ line: 1, hits: 5 }]);
    expect(ok?.functions).toEqual([]);

    const missingEor = parsed.files.find((file) => file.file === "src/missingeor.ts");
    expect(missingEor?.lines).toEqual([{ line: 1, hits: 2 }]);

    expect(parsed.notes).toEqual([
      {
        kind: "malformed-record",
        line: 3,
        detail: "DA record has a malformed line/hits 'notanumber,3'",
      },
      {
        kind: "malformed-record",
        line: 4,
        detail: "FN record has a malformed line/name 'abc,brokenfn'",
      },
      {
        kind: "malformed-record",
        detail: "FNDA for function 'ghost' with no matching FN record in 'src/ok.ts'",
      },
      {
        kind: "malformed-record",
        line: 9,
        detail: "DA record before any source file (SF)",
      },
      {
        kind: "missing-end-of-record",
        detail: "source file 'src/missingeor.ts' had no end_of_record",
      },
    ]);
  });

  it("notes a stray end_of_record with no open section", () => {
    const parsed = parseLcov("end_of_record\n");
    expect(parsed.files).toEqual([]);
    expect(parsed.notes).toEqual([
      {
        kind: "malformed-record",
        line: 1,
        detail: "end_of_record with no open source-file (SF) record",
      },
    ]);
  });

  it("returns no files or notes for empty content", () => {
    expect(parseLcov("")).toEqual({ files: [], notes: [] });
  });
});

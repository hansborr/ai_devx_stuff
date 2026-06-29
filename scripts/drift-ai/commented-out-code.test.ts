import { describe, expect, it } from "vitest";

import type { ChangedFile } from "../drift-ai.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { parseArgs } from "./cli-args.js";
import {
  COMMENTED_OUT_CODE_HINT,
  type FileReader,
  findCommentedOutRegions,
  runCommentedOutCodeCheck,
} from "./commented-out-code.js";
import { commentedOutCodeCheck } from "./commented-out-code-check.js";
import { DEFAULT_DRIFT_AI_CONFIG, parseDriftAiConfig } from "./config.js";
import { buildSourceExtensions, type DetectorScope } from "./scope.js";
import { toChangedScopeFile, toCurrentScopeFile } from "./scope.js";

const tmpRepo = registerTempRootCleanup();

function makeReader(files: Record<string, string>): FileReader {
  return (filePath) => files[filePath];
}

function changed(
  items: ReadonlyArray<{ path: string; status?: ChangedFile["status"] }>,
): DetectorScope {
  const files: ChangedFile[] = items.map(({ path: p, status }) => ({
    path: p,
    status: status ?? "modified",
  }));
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

function current(paths: readonly string[]): DetectorScope {
  return { scopeMode: "current", files: paths.map(toCurrentScopeFile) };
}

function lines(...text: string[]): string {
  return text.join("\n");
}

describe("findCommentedOutRegions", () => {
  it("flags a consecutive line-comment block that parses as code", () => {
    const source = lines("// const x = 1;", "// foo(x);", "// return x;");
    const regions = findCommentedOutRegions(source);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      startLine: 1,
      endLine: 3,
      lineCount: 3,
      construct: "variable",
    });
    expect(regions[0]?.preview).toBe("const x = 1;");
    expect(regions[0]?.snippetHash).toMatch(/^[0-9a-z]+$/u);
  });

  it("flags a multi-line block comment that parses as code", () => {
    const source = lines("/*", "const enabled = false;", "toggle(enabled);", "*/");
    const regions = findCommentedOutRegions(source);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.construct).toBe("variable");
  });

  it("strips a leading JSDoc-style star from block-comment code lines", () => {
    const source = lines("/*", " * const a = 1;", " * compute(a);", " */");
    const regions = findCommentedOutRegions(source);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.construct).toBe("variable");
  });

  it("labels the first operative construct in the block", () => {
    const callFirst = findCommentedOutRegions(
      lines("// doThing();", "// doOther();", "// done();"),
    );
    expect(callFirst[0]?.construct).toBe("call");
    const ifFirst = findCommentedOutRegions(lines("// if (ready) {", "//   run();", "// }"));
    expect(ifFirst[0]?.construct).toBe("if");
  });

  it("ignores prose comments that do not parse as statements", () => {
    const source = lines(
      "// This helper computes the running total.",
      "// It caches results for speed.",
      "// See the module docs for details.",
    );
    expect(findCommentedOutRegions(source)).toEqual([]);
  });

  it("ignores JSDoc doc comments", () => {
    const source = lines(
      "/**",
      " * Computes the total.",
      " * @param x the input value",
      " * @returns the running total",
      " */",
    );
    expect(findCommentedOutRegions(source)).toEqual([]);
  });

  it("ignores code-shaped blocks that do not parse cleanly", () => {
    // An unbalanced object literal: looks like code but has a syntax error, so the
    // sensor stays quiet (precision over recall).
    const source = lines("// const config = {", "//   foo: 1,", "//   bar: 2,");
    expect(findCommentedOutRegions(source)).toEqual([]);
  });

  it("ignores blocks that parse only as bare identifiers or literals", () => {
    const identifiers = findCommentedOutRegions(lines("// alpha", "// bravo", "// charlie"));
    expect(identifiers).toEqual([]);
    const strings = findCommentedOutRegions(lines('// "one"', '// "two"', '// "three"'));
    expect(strings).toEqual([]);
  });

  it("ignores keyword-led prose trios that parse as bare-identifier expressions", () => {
    expect(
      findCommentedOutRegions(lines("// delete user", "// delete post", "// delete comment")),
    ).toEqual([]);
    expect(
      findCommentedOutRegions(lines("// await data", "// await users", "// await orders")),
    ).toEqual([]);
    expect(
      findCommentedOutRegions(lines("// yield data", "// yield users", "// yield orders")),
    ).toEqual([]);
    expect(
      findCommentedOutRegions(lines("// score = wins", "// rank = score", "// tier = rank")),
    ).toEqual([]);
  });

  it("keeps expression evidence with code-shaped operands and assignment targets", () => {
    const deletedMember = findCommentedOutRegions(
      lines("// delete this.cache", "// delete state.cache", "// delete state.flags.ready"),
    );
    expect(deletedMember).toHaveLength(1);
    expect(deletedMember[0]?.construct).toBe("delete");

    const awaitedCall = findCommentedOutRegions(
      lines("// await flush()", "// await persist()", "// await reload()"),
    );
    expect(awaitedCall).toHaveLength(1);
    expect(awaitedCall[0]?.construct).toBe("await");

    const memberAssignments = findCommentedOutRegions(
      lines("// config.value = next", "// items[index] = next", "// this.cache = value"),
    );
    expect(memberAssignments).toHaveLength(1);
    expect(memberAssignments[0]?.construct).toBe("assignment");

    const assertedMemberAssignments = findCommentedOutRegions(
      lines("// config.value! = next", "// items[index]! = next", "// this.cache! = value"),
    );
    expect(assertedMemberAssignments).toHaveLength(1);
    expect(assertedMemberAssignments[0]?.construct).toBe("assignment");
  });

  it("requires at least minLines consecutive comment lines", () => {
    const twoLine = lines("// doThing();", "// doOther();");
    expect(findCommentedOutRegions(twoLine)).toEqual([]);
    expect(findCommentedOutRegions(twoLine, { minLines: 2 })).toHaveLength(1);
  });

  it("treats a blank line as a region boundary", () => {
    const source = lines(
      "// alpha();",
      "// bravo();",
      "",
      "// charlie();",
      "// delta();",
      "// echo();",
    );
    const regions = findCommentedOutRegions(source, { minLines: 2 });
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ startLine: 1, endLine: 2 });
    expect(regions[1]).toMatchObject({ startLine: 4, endLine: 6 });
  });

  it("does not treat trailing comments on code lines as a region", () => {
    const source = lines("const x = 1; // a", "const y = 2; // b", "const z = 3; // c");
    expect(findCommentedOutRegions(source)).toEqual([]);
  });

  it("does not treat // inside a multi-line template literal as a comment", () => {
    const source = lines("const html = `<div>", "// still inside the template", "</div>`;");
    expect(findCommentedOutRegions(source)).toEqual([]);
  });
});

describe("runCommentedOutCodeCheck", () => {
  const filePath = "packages/server/src/services/example.ts";
  const block = lines("// const x = compute();", "// persist(x);", "// return x;");

  it("emits an evidence-framed finding with line-range details", () => {
    const findings = runCommentedOutCodeCheck({
      detectorScope: changed([{ path: filePath }]),
      readFile: makeReader({ [filePath]: block }),
    });
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.check).toBe("commented-out-code");
    expect(finding?.file).toBe(filePath);
    expect(finding?.message).toContain("lines 1-3");
    expect(finding?.message).toContain("appears to be commented-out code, not prose");
    expect(finding?.hint).toBe(COMMENTED_OUT_CODE_HINT);
    expect(finding?.details).toMatchObject({
      startLine: 1,
      endLine: 3,
      lineCount: 3,
      construct: "variable",
      preview: "const x = compute();",
    });
    expect(finding?.details?.["snippetHash"]).toEqual(expect.any(String));
  });

  it("scans current-scope inventory the same way", () => {
    const findings = runCommentedOutCodeCheck({
      detectorScope: current([filePath]),
      readFile: makeReader({ [filePath]: block }),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(filePath);
  });

  it("skips deleted files and files the reader cannot find", () => {
    let reads = 0;
    const reader: FileReader = (p) => {
      reads += 1;
      return p === filePath ? block : undefined;
    };
    const findings = runCommentedOutCodeCheck({
      detectorScope: changed([
        { path: filePath, status: "deleted" },
        { path: "packages/server/src/services/missing.ts", status: "added" },
      ]),
      readFile: reader,
    });
    expect(findings).toEqual([]);
    expect(reads).toBe(1);
  });

  it("ignores non-source and declaration files", () => {
    const findings = runCommentedOutCodeCheck({
      detectorScope: changed([
        { path: "packages/server/src/styles/example.css" },
        { path: "packages/shared/src/types/globals.d.ts" },
      ]),
      readFile: makeReader({
        "packages/server/src/styles/example.css": block,
        "packages/shared/src/types/globals.d.ts": block,
      }),
    });
    expect(findings).toEqual([]);
  });

  it("honors configured exclude prefixes", () => {
    const target = "scripts/some-script.ts";
    const findings = runCommentedOutCodeCheck({
      detectorScope: changed([{ path: target }]),
      readFile: makeReader({ [target]: block }),
      excludePrefixes: ["scripts/"],
    });
    expect(findings).toEqual([]);
  });

  it("processes files in lexical order for stable output", () => {
    const a = "packages/server/src/services/alpha.ts";
    const b = "packages/server/src/services/bravo.ts";
    const findings = runCommentedOutCodeCheck({
      detectorScope: changed([{ path: b }, { path: a }]),
      readFile: makeReader({ [a]: block, [b]: block }),
    });
    expect(findings.map((f) => f.file)).toEqual([a, b]);
  });
});

describe("commented-out-code config", () => {
  it("defaults to opt-in with a three-line floor and no exclude prefixes", () => {
    const config = parseDriftAiConfig({});
    expect(config.checks["commented-out-code"]).toEqual({ minLines: 3, excludePrefixes: [] });
  });

  it("parses minLines and excludePrefixes", () => {
    const config = parseDriftAiConfig({
      checks: { "commented-out-code": { minLines: 5, excludePrefixes: ["generated/"] } },
    });
    expect(config.checks["commented-out-code"].minLines).toBe(5);
    expect(config.checks["commented-out-code"].excludePrefixes).toContain("generated/");
  });

  it("rejects a minLines below 2", () => {
    expect(() => parseDriftAiConfig({ checks: { "commented-out-code": { minLines: 1 } } })).toThrow(
      "must be at least 2",
    );
  });

  it("rejects a non-integer minLines", () => {
    expect(() =>
      parseDriftAiConfig({ checks: { "commented-out-code": { minLines: 2.5 } } }),
    ).toThrow("must be a positive integer");
  });

  it("rejects unknown keys", () => {
    expect(() =>
      parseDriftAiConfig({ checks: { "commented-out-code": { minRegion: 3 } } }),
    ).toThrow("unknown key");
  });
});

describe("commentedOutCodeCheck plugin", () => {
  const writeRepo = (files: Record<string, string>): string =>
    tmpRepo.writeRepo(files, "drift-ai-commented-out-");

  it("reports a commented-out block from real current-scope files", () => {
    const repoRoot = writeRepo({
      "src/widget.ts": lines(
        "export const value = 1;",
        "// const old = computeOld();",
        "// persist(old);",
        "// return old;",
      ),
    });
    const outcome = commentedOutCodeCheck.runWithSelectedConfig({
      detectorScope: current(["src/widget.ts"]),
      inventoryByDir: null,
      repoRoot,
      suppressionDiffRef: null,
      config: DEFAULT_DRIFT_AI_CONFIG,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      warnStderr: () => undefined,
      env: {
        repoRoot,
        overrides: {},
        cli: parseArgs(["--scope", "current", "--check", "commented-out-code"]),
        warnStderr: () => undefined,
      },
    });
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.check).toBe("commented-out-code");
      expect(outcome.findings[0]?.file).toBe("src/widget.ts");
      expect(outcome.findings[0]?.details).toMatchObject({ startLine: 2, endLine: 4 });
    }
  });
});

import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  analyzeCommentMetrics,
  COMMENTS_REPAIR_HINT,
  defaultFileReader,
  type FileReader,
  runCommentsCheck,
} from "./comments.js";
import type { DetectorScope } from "./scope.js";
import { toChangedScopeFile, toCurrentScopeFile } from "./scope.js";
import type { ChangedFile } from "./types.js";

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

describe("analyzeCommentMetrics", () => {
  it("counts blank, code, and comment lines on a simple file", () => {
    const source = ["// header comment", "", "const x = 1;", "const y = 2;"].join("\n");
    expect(analyzeCommentMetrics(source)).toEqual({
      effective: 2,
      comment: 1,
      blank: 1,
      total: 4,
    });
  });

  it("treats trailing comments on a code line as effective, not comment", () => {
    const source = ["const x = 1; // trailing", "const y = 2;"].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics.effective).toBe(2);
    expect(metrics.comment).toBe(0);
  });

  it("classifies multi-line block comments line by line", () => {
    const source = ["/*", " * spans three", " */", "const x = 1;"].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics.comment).toBe(3);
    expect(metrics.effective).toBe(1);
  });

  it("treats a line that ends a block comment and continues with code as effective", () => {
    const source = ["/* opener", " * middle", " */ const x = 1;"].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics.effective).toBe(1);
    expect(metrics.comment).toBe(2);
  });

  it("does not treat // inside a string literal as a comment", () => {
    const source = [
      'const url = "https://example.com/path";',
      "const single = '// not a comment';",
      "const tmpl = `also // not a comment`;",
    ].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics).toEqual({ effective: 3, comment: 0, blank: 0, total: 3 });
  });

  it("does not treat /* inside a string literal as a block comment", () => {
    const source = ['const s = "/* still code */";', "const x = 1;"].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics).toEqual({ effective: 2, comment: 0, blank: 0, total: 2 });
  });

  it("handles escaped quotes inside strings", () => {
    const source = ['const s = "with \\"quotes\\" and // inside";'].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics).toEqual({ effective: 1, comment: 0, blank: 0, total: 1 });
  });

  it("normalizes \\r\\n line endings", () => {
    const source = "// header\r\nconst x = 1;\r\n";
    const metrics = analyzeCommentMetrics(source);
    expect(metrics.total).toBe(2);
    expect(metrics.comment).toBe(1);
    expect(metrics.effective).toBe(1);
  });

  it("does not count a trailing newline as an extra blank line", () => {
    expect(analyzeCommentMetrics("const x = 1;\n").total).toBe(1);
    expect(analyzeCommentMetrics("const x = 1;").total).toBe(1);
    expect(analyzeCommentMetrics("").total).toBe(0);
  });

  it("treats a one-line block comment with no other code as a comment line", () => {
    const metrics = analyzeCommentMetrics("/* just notes */\n");
    expect(metrics).toEqual({ effective: 0, comment: 1, blank: 0, total: 1 });
  });

  it("persists template-literal state across line boundaries", () => {
    // The middle line is text inside a backtick template literal; without
    // string-state continuation across newlines the bare `//` would
    // mis-classify the line as a comment.
    const source = [
      "const html = `<p>",
      "// not a comment, still inside a template",
      "</p>`;",
    ].join("\n");
    expect(analyzeCommentMetrics(source)).toEqual({
      effective: 3,
      comment: 0,
      blank: 0,
      total: 3,
    });
  });

  it("keeps comment markers inside template literals out of comment counts", () => {
    const source = ["const text = `", "/* not a block comment */", "`;", "// real comment"].join(
      "\n",
    );
    expect(analyzeCommentMetrics(source)).toEqual({
      effective: 3,
      comment: 1,
      blank: 0,
      total: 4,
    });
  });

  it("persists single/double quote state across a backslash-continued newline", () => {
    // JavaScript line-continuation: a `\` immediately before the newline
    // keeps the string open. classifyLine eats the `\` plus the next char,
    // and analyzeCommentMetrics should carry the open delimiter forward.
    const source = ['const s = "starts \\', '// still inside the string", code = 1;'].join("\n");
    const metrics = analyzeCommentMetrics(source);
    expect(metrics.comment).toBe(0);
    expect(metrics.effective).toBe(2);
  });

  it("keeps escaped delimiters from exposing comment markers inside strings", () => {
    const source = ['const value = "escaped \\" // still string";', "// real comment"].join("\n");
    expect(analyzeCommentMetrics(source)).toEqual({
      effective: 1,
      comment: 1,
      blank: 0,
      total: 2,
    });
  });
});

describe("runCommentsCheck", () => {
  function source(opts: { code: number; comments: number; blanks?: number }): string {
    const lines: string[] = [];
    for (let i = 0; i < opts.comments; i += 1) lines.push(`// invariant note ${i}`);
    for (let i = 0; i < opts.code; i += 1) lines.push(`const x${i} = ${i};`);
    for (let i = 0; i < (opts.blanks ?? 0); i += 1) lines.push("");
    return lines.join("\n");
  }

  const filePath = "packages/server/src/services/example.ts";

  it("emits a finding when a large file crosses the comment-ratio threshold", () => {
    const text = source({ code: 130, comments: 90 });
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: filePath }]),
      readFile: makeReader({ [filePath]: text }),
    });
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.check).toBe("comments");
    expect(finding?.file).toBe(filePath);
    expect(finding?.message).toContain(
      "41% of non-blank lines are comments over 130 effective code lines",
    );
    expect(finding?.message).toContain("warn at 40% on files with more than 120 effective lines");
    expect(finding?.hint).toBe(COMMENTS_REPAIR_HINT);
  });

  it("does not flag files at or below the effective-line threshold", () => {
    // 120 effective lines is exactly the threshold. The check uses strict >,
    // so the file should not warn even at 50% comments.
    const text = source({ code: 120, comments: 120 });
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: filePath }]),
      readFile: makeReader({ [filePath]: text }),
    });
    expect(findings).toEqual([]);
  });

  it("does not flag large files below the warn ratio", () => {
    // 200 code, 80 comments → 80 / 280 ≈ 28.5%, well under 40%.
    const text = source({ code: 200, comments: 80 });
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: filePath }]),
      readFile: makeReader({ [filePath]: text }),
    });
    expect(findings).toEqual([]);
  });

  it("respects a custom threshold and ratio", () => {
    const text = source({ code: 30, comments: 12 });
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: filePath }]),
      readFile: makeReader({ [filePath]: text }),
      effectiveLinesThreshold: 20,
      ratioWarn: 0.25,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(
      "warn at 25% on files with more than 20 effective lines",
    );
  });

  it("ignores excluded paths: tests, fixtures, configured prefixes, and *.d.ts", () => {
    const text = source({ code: 130, comments: 90 });
    const excluded = [
      "packages/server/src/services/example.test.ts",
      "packages/server/src/services/example.spec.ts",
      "packages/server/src/services/example.fixture.ts",
      "packages/server/src/__tests__/example.ts",
      "packages/server/src/fixtures/example.ts",
      "packages/server/src/__fixtures__/example.ts",
      "scripts/some-script.ts",
      "eslint-rules/some-rule.ts",
      "packages/shared/src/types/globals.d.ts",
    ];
    const files = Object.fromEntries(excluded.map((p) => [p, text]));
    const findings = runCommentsCheck({
      detectorScope: changed(excluded.map((p) => ({ path: p }))),
      readFile: makeReader(files),
      excludePrefixes: ["scripts/", "eslint-rules/"],
    });
    expect(findings).toEqual([]);
  });

  it("does not hard-code Musi tooling prefixes without config", () => {
    const target = "scripts/some-script.ts";
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: target }]),
      readFile: makeReader({ [target]: source({ code: 130, comments: 90 }) }),
    });
    expect(findings.map((finding) => finding.file)).toEqual([target]);
  });

  it("skips deleted files and files the reader cannot find", () => {
    let reads = 0;
    const reader: FileReader = (p) => {
      reads += 1;
      return p === filePath ? source({ code: 130, comments: 90 }) : undefined;
    };
    const findings = runCommentsCheck({
      detectorScope: changed([
        { path: filePath, status: "deleted" },
        { path: "packages/server/src/services/missing.ts", status: "added" },
      ]),
      readFile: reader,
    });
    expect(findings).toEqual([]);
    // Deleted entries never reach the reader; the present-but-missing file is
    // queried once and the result is ignored.
    expect(reads).toBe(1);
  });

  it("ignores non-source siblings even when the reader returns content", () => {
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: "packages/server/src/styles/example.css" }]),
      readFile: makeReader({
        "packages/server/src/styles/example.css": "/* a long stylesheet */",
      }),
    });
    expect(findings).toEqual([]);
  });

  it("processes added/modified files in lexical order for stable output", () => {
    const text = source({ code: 130, comments: 90 });
    const a = "packages/server/src/services/alpha.ts";
    const b = "packages/server/src/services/bravo.ts";
    const findings = runCommentsCheck({
      detectorScope: changed([{ path: b }, { path: a }]),
      readFile: makeReader({ [a]: text, [b]: text }),
    });
    expect(findings.map((f) => f.file)).toEqual([a, b]);
  });

  it("emits a finding for current-scope source that crosses the threshold", () => {
    const text = source({ code: 130, comments: 90 });
    const findings = runCommentsCheck({
      detectorScope: current([filePath]),
      readFile: makeReader({ [filePath]: text }),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe("comments");
    expect(findings[0]?.file).toBe(filePath);
    expect(findings[0]?.message).toContain(
      "41% of non-blank lines are comments over 130 effective code lines",
    );
  });

  it("current scope skips tests, fixtures, and declaration files", () => {
    let reads = 0;
    const findings = runCommentsCheck({
      detectorScope: current([
        "packages/server/src/services/example.d.ts",
        "packages/server/src/services/example.test.ts",
        "packages/server/src/__tests__/example.ts",
        "packages/server/src/fixtures/example.ts",
      ]),
      readFile: () => {
        reads += 1;
        return source({ code: 130, comments: 90 });
      },
    });
    expect(findings).toEqual([]);
    expect(reads).toBe(0);
  });

  it("current scope honors configured exclude prefixes", () => {
    let reads = 0;
    const findings = runCommentsCheck({
      detectorScope: current(["scripts/some-script.ts"]),
      readFile: () => {
        reads += 1;
        return source({ code: 130, comments: 90 });
      },
      excludePrefixes: ["scripts/"],
    });
    expect(findings).toEqual([]);
    expect(reads).toBe(0);
  });

  it("current scope remains JS/TS-only even when other extensions are inventoried", () => {
    let reads = 0;
    const findings = runCommentsCheck({
      detectorScope: current(["packages/client/src/App.vue"]),
      readFile: () => {
        reads += 1;
        return source({ code: 130, comments: 90 });
      },
    });
    expect(findings).toEqual([]);
    expect(reads).toBe(0);
  });

  it("current scope returns no findings under the effective-line threshold", () => {
    const findings = runCommentsCheck({
      detectorScope: current([filePath]),
      readFile: makeReader({ [filePath]: source({ code: 120, comments: 120 }) }),
    });
    expect(findings).toEqual([]);
  });
});

describe("defaultFileReader", () => {
  const tmpRepo = registerTempRootCleanup();

  function makeRepo(): { root: string; subFile: string } {
    const root = path.join(tmpRepo.makeTempRepo("drift-ai-comments-"), "repo");
    const subFile = path.join(root, "packages/server/src/services/example.ts");
    tmpRepo.writeRepoFile(root, "packages/server/src/services/example.ts", "const x = 1;\n");
    return { root, subFile };
  }

  it("reads files inside the repo root", () => {
    const { root } = makeRepo();
    const read = defaultFileReader(root);
    expect(read("packages/server/src/services/example.ts")).toBe("const x = 1;\n");
  });

  it("returns undefined for missing files instead of throwing", () => {
    const { root } = makeRepo();
    const read = defaultFileReader(root);
    expect(read("packages/server/src/services/missing.ts")).toBeUndefined();
  });

  it("refuses to escape the repo root via .. segments", () => {
    const { root } = makeRepo();
    tmpRepo.writeRepoFile(root, "../outside-secret/secret.ts", "leak\n");
    const read = defaultFileReader(root);
    expect(read("../outside-secret/secret.ts")).toBeUndefined();
  });

  it("refuses to read absolute paths outside the repo root", () => {
    const { root } = makeRepo();
    const read = defaultFileReader(root);
    expect(read("/etc/hosts")).toBeUndefined();
  });
});

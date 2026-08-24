import { describe, expect, it } from "vitest";

import type { DetectorScope } from "./scope.js";
import { toChangedScopeFile, toCurrentScopeFile } from "./scope.js";
import { runSuppressionsCheck, type SuppressionsGitRunner } from "./suppressions.js";
import {
  ESLINT_BROAD_SUPPRESSION_HINT,
  ESLINT_INLINE_SUPPRESSION_HINT,
  STRYKER_SUPPRESSION_HINT,
  TS_EXPECT_ERROR_SUPPRESSION_HINT,
  TS_IGNORE_SUPPRESSION_HINT,
  TS_NOCHECK_SUPPRESSION_HINT,
} from "./suppressions-parse.js";
import type { ChangedFile, DriftFinding } from "./types.js";

const filePath = "packages/server/src/example.ts";

function changed(
  items: ReadonlyArray<{ path: string; status?: ChangedFile["status"] }>,
): DetectorScope {
  const files: ChangedFile[] = items.map(({ path, status }) => ({
    path,
    status: status ?? "modified",
  }));
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

function current(paths: readonly string[]): DetectorScope {
  return { scopeMode: "current", files: paths.map(toCurrentScopeFile) };
}

function unifiedDiff(path: string, hunkLines: readonly string[], newStart = 12): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${newStart},1 +${newStart},${hunkLines.length} @@`,
    ...hunkLines,
  ].join("\n");
}

function run(
  diffText: string,
  detectorScope: DetectorScope = changed([{ path: filePath }]),
): DriftFinding[] {
  const git: SuppressionsGitRunner = () => diffText;
  return runSuppressionsCheck({
    detectorScope,
    repoRoot: "/repo/musi",
    ref: "merge-base",
    git,
    readFile: () => undefined,
  });
}

describe("runSuppressionsCheck", () => {
  it("reports eslint-disable with a reason", () => {
    const findings = run(
      unifiedDiff(filePath, ["+/* eslint-disable no-console -- generated fixture */"]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new eslint-disable suppression at line 12 targets no-console (reason: present)",
        hint: ESLINT_BROAD_SUPPRESSION_HINT,
        details: {
          kind: "eslint-disable",
          target: "no-console",
          line: 12,
          reasonPresent: true,
          text: "/* eslint-disable no-console -- generated fixture */",
        },
      },
    ]);
  });

  it("reports eslint-disable without a reason and defaults to all targets", () => {
    const findings = run(unifiedDiff(filePath, ["+/* eslint-disable */"]));

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new eslint-disable suppression at line 12 targets all (reason: missing)",
        hint: ESLINT_BROAD_SUPPRESSION_HINT,
        details: {
          kind: "eslint-disable",
          target: "all",
          line: 12,
          reasonPresent: false,
          text: "/* eslint-disable */",
        },
      },
    ]);
  });

  it("reports eslint-disable-next-line with a comma-separated rule list", () => {
    const findings = run(
      unifiedDiff(filePath, [
        "+// eslint-disable-next-line no-alert, @typescript-eslint/no-explicit-any -- legacy API",
      ]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message:
          "new eslint-disable-next-line suppression at line 12 targets no-alert,@typescript-eslint/no-explicit-any (reason: present)",
        hint: ESLINT_INLINE_SUPPRESSION_HINT,
        details: {
          kind: "eslint-disable-next-line",
          target: "no-alert,@typescript-eslint/no-explicit-any",
          line: 12,
          reasonPresent: true,
          text: "// eslint-disable-next-line no-alert, @typescript-eslint/no-explicit-any -- legacy API",
        },
      },
    ]);
  });

  it("reports @ts-expect-error in line and block comments", () => {
    const findings = run(
      unifiedDiff(filePath, [
        "+// @ts-expect-error -- fixture intentionally violates the contract",
        "+/* @ts-expect-error -- block form */",
      ]),
    );

    expect(findings.map((finding) => finding.message)).toEqual([
      "new @ts-expect-error suppression at line 12 targets next-line (reason: present)",
      "new @ts-expect-error suppression at line 13 targets next-line (reason: present)",
    ]);
    expect(findings.map((finding) => finding.hint)).toEqual([
      TS_EXPECT_ERROR_SUPPRESSION_HINT,
      TS_EXPECT_ERROR_SUPPRESSION_HINT,
    ]);
    expect(findings.map((finding) => finding.details)).toEqual([
      {
        kind: "@ts-expect-error",
        target: "next-line",
        line: 12,
        reasonPresent: true,
        text: "// @ts-expect-error -- fixture intentionally violates the contract",
      },
      {
        kind: "@ts-expect-error",
        target: "next-line",
        line: 13,
        reasonPresent: true,
        text: "/* @ts-expect-error -- block form */",
      },
    ]);
  });

  it("reports @ts-ignore", () => {
    const findings = run(unifiedDiff(filePath, ["+// @ts-ignore"]));

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new @ts-ignore suppression at line 12 targets next-line (reason: missing)",
        hint: TS_IGNORE_SUPPRESSION_HINT,
        details: {
          kind: "@ts-ignore",
          target: "next-line",
          line: 12,
          reasonPresent: false,
          text: "// @ts-ignore",
        },
      },
    ]);
  });

  it("reports @ts-nocheck as a file-level suppression", () => {
    const findings = run(unifiedDiff(filePath, ["+// @ts-nocheck -- generated type test"]));

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new @ts-nocheck suppression at line 12 targets file (reason: present)",
        hint: TS_NOCHECK_SUPPRESSION_HINT,
        details: {
          kind: "@ts-nocheck",
          target: "file",
          line: 12,
          reasonPresent: true,
          text: "// @ts-nocheck -- generated type test",
        },
      },
    ]);
  });

  it("reports Stryker disable next-line with a mutator target", () => {
    const findings = run(
      unifiedDiff(filePath, [
        "+// Stryker disable next-line EqualityOperator -- equivalent branch covered elsewhere",
      ]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message:
          "new Stryker disable next-line suppression at line 12 targets EqualityOperator (reason: present)",
        hint: STRYKER_SUPPRESSION_HINT,
        details: {
          kind: "Stryker disable next-line",
          target: "EqualityOperator",
          line: 12,
          reasonPresent: true,
          text: "// Stryker disable next-line EqualityOperator -- equivalent branch covered elsewhere",
        },
      },
    ]);
  });

  it("reports suppressions from added scope files missing from the git diff", () => {
    const addedPath = "packages/server/src/untracked-fixture.ts";
    const git: SuppressionsGitRunner = () => "";
    const sourceByPath = new Map([
      [
        addedPath,
        [
          'const literal = "// @ts-ignore";',
          "/*",
          " * eslint-disable no-console -- fixture block reason",
          " */",
          "// @ts-expect-error -- fixture line reason",
          "const value = 1;",
        ].join("\n"),
      ],
    ]);

    const findings = runSuppressionsCheck({
      detectorScope: changed([{ path: addedPath, status: "added" }]),
      repoRoot: "/repo/musi",
      ref: "merge-base",
      git,
      readFile: (path) => sourceByPath.get(path),
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      "new eslint-disable suppression at line 3 targets no-console (reason: present)",
      "new @ts-expect-error suppression at line 5 targets next-line (reason: present)",
    ]);
    expect(findings.map((finding) => finding.details)).toEqual([
      {
        kind: "eslint-disable",
        target: "no-console",
        line: 3,
        reasonPresent: true,
        text: " * eslint-disable no-console -- fixture block reason",
      },
      {
        kind: "@ts-expect-error",
        target: "next-line",
        line: 5,
        reasonPresent: true,
        text: "// @ts-expect-error -- fixture line reason",
      },
    ]);
  });

  it("ignores suppression markers inside multiline template literals in added files", () => {
    const addedPath = "packages/server/src/template-fixture.ts";
    const git: SuppressionsGitRunner = () => "";
    const sourceByPath = new Map([
      [
        addedPath,
        [
          "const text = `",
          "// @ts-ignore",
          "/* eslint-disable */",
          "`;",
          "// @ts-expect-error -- real suppression",
        ].join("\n"),
      ],
    ]);

    const findings = runSuppressionsCheck({
      detectorScope: changed([{ path: addedPath, status: "added" }]),
      repoRoot: "/repo/musi",
      ref: "merge-base",
      git,
      readFile: (path) => sourceByPath.get(path),
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      "new @ts-expect-error suppression at line 5 targets next-line (reason: present)",
    ]);
  });

  it("ignores suppression markers after escaped delimiters inside strings", () => {
    const addedPath = "packages/server/src/escaped-string-fixture.ts";
    const git: SuppressionsGitRunner = () => "";
    const sourceByPath = new Map([
      [
        addedPath,
        [
          'const line = "escaped \\" // @ts-ignore";',
          'const block = "escaped \\" /* eslint-disable */";',
          "// @ts-ignore -- real suppression",
        ].join("\n"),
      ],
    ]);

    const findings = runSuppressionsCheck({
      detectorScope: changed([{ path: addedPath, status: "added" }]),
      repoRoot: "/repo/musi",
      ref: "merge-base",
      git,
      readFile: (path) => sourceByPath.get(path),
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      "new @ts-ignore suppression at line 3 targets next-line (reason: present)",
    ]);
  });

  it("keeps no-prefix diff paths that start with b", () => {
    const noPrefixPath = "b/packages/server/src/example.ts";
    const findings = run(
      [
        `diff --git ${noPrefixPath} ${noPrefixPath}`,
        "index 1111111..2222222 100644",
        `--- ${noPrefixPath}`,
        `+++ ${noPrefixPath}`,
        "@@ -4,1 +4,1 @@",
        "+// @ts-ignore -- no-prefix fixture",
      ].join("\n"),
      changed([{ path: noPrefixPath }]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: noPrefixPath,
        message: "new @ts-ignore suppression at line 4 targets next-line (reason: present)",
        hint: TS_IGNORE_SUPPRESSION_HINT,
        details: {
          kind: "@ts-ignore",
          target: "next-line",
          line: 4,
          reasonPresent: true,
          text: "// @ts-ignore -- no-prefix fixture",
        },
      },
    ]);
  });

  it("ignores non-suppression comments", () => {
    const findings = run(unifiedDiff(filePath, ["+// document the edge case"]));
    expect(findings).toEqual([]);
  });

  it("ignores suppressions on removed diff lines", () => {
    const findings = run(
      unifiedDiff(filePath, ["-// @ts-ignore -- old suppression", "+const stillChecked = true;"]),
    );
    expect(findings).toEqual([]);
  });

  it("advances the reported line across context hunk lines before an added suppression", () => {
    const findings = run(
      unifiedDiff(filePath, [
        " const kept = 1;",
        " const alsoKept = 2;",
        "+// @ts-expect-error -- reason after two context lines",
      ]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new @ts-expect-error suppression at line 14 targets next-line (reason: present)",
        hint: TS_EXPECT_ERROR_SUPPRESSION_HINT,
        details: {
          kind: "@ts-expect-error",
          target: "next-line",
          line: 14,
          reasonPresent: true,
          text: "// @ts-expect-error -- reason after two context lines",
        },
      },
    ]);
  });

  it("does not advance the reported line for a deleted hunk line before an added suppression", () => {
    const findings = run(
      unifiedDiff(filePath, [
        "-const removed = 9;",
        "+// @ts-expect-error -- reason after a deleted line",
      ]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new @ts-expect-error suppression at line 12 targets next-line (reason: present)",
        hint: TS_EXPECT_ERROR_SUPPRESSION_HINT,
        details: {
          kind: "@ts-expect-error",
          target: "next-line",
          line: 12,
          reasonPresent: true,
          text: "// @ts-expect-error -- reason after a deleted line",
        },
      },
    ]);
  });

  it("advances only for context and added lines when a hunk mixes deleted, context, and added", () => {
    const findings = run(
      unifiedDiff(filePath, [
        "-const removed = 9;",
        " const kept = 1;",
        "+// @ts-expect-error -- reason after deleted then context",
      ]),
    );

    expect(findings).toEqual([
      {
        check: "suppressions",
        file: filePath,
        message: "new @ts-expect-error suppression at line 13 targets next-line (reason: present)",
        hint: TS_EXPECT_ERROR_SUPPRESSION_HINT,
        details: {
          kind: "@ts-expect-error",
          target: "next-line",
          line: 13,
          reasonPresent: true,
          text: "// @ts-expect-error -- reason after deleted then context",
        },
      },
    ]);
  });

  it("skips current scope without invoking git", () => {
    let gitCalls = 0;
    const git: SuppressionsGitRunner = () => {
      gitCalls += 1;
      return "";
    };
    const findings = runSuppressionsCheck({
      detectorScope: current(["src/current.ts"]),
      repoRoot: "/repo/musi",
      ref: "merge-base",
      git,
      readFile: () => undefined,
    });
    expect(findings).toEqual([]);
    expect(gitCalls).toBe(0);
  });
});

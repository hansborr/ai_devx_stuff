import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  harnessDiagnosticsSchema,
  type HarnessFinding,
} from "../packages/shared/src/schemas/harness-diagnostics.js";
import type { ESLintMessage } from "./lib/eslint-json.js";
import type { RuleDocsEntry } from "./lib/lint-rule-docs.js";
import {
  buildFinding,
  buildLintAgentEnvelope,
  buildParserErrorFinding,
  compareLintAgentFindings,
  parseArgs,
  parseOutputOption,
  severityFromEslint,
} from "./lint-agent-envelope.js";
import { lintAgentHowToFixFor } from "./lint-agent-fix-text.js";

function docsEntry(overrides: Partial<RuleDocsEntry> = {}): RuleDocsEntry {
  return {
    id: "local/example-rule",
    description: "An example rule.",
    principle: "Keep the example rule actionable.",
    category: "maintainability",
    pairedGuide: "none",
    repairKind: "manual",
    ...overrides,
  };
}

function eslintMessage(overrides: Partial<ESLintMessage> = {}): ESLintMessage {
  return {
    ruleId: "local/example-rule",
    severity: 2,
    message: "Why: the example is wrong. How to fix: make the example explicit.",
    ...overrides,
  };
}

function repoFile(path: string): string {
  return resolve(process.cwd(), path);
}

describe("severityFromEslint", () => {
  it("maps ESLint severities into harness severities", () => {
    expect(severityFromEslint(2)).toBe("block");
    expect(severityFromEslint(1)).toBe("warn");
    expect(severityFromEslint(0)).toBe("info");
    expect(severityFromEslint(7)).toBe("info");
  });
});

describe("parseOutputOption", () => {
  it("accepts split and equals-form output options", () => {
    expect(parseOutputOption("--output", ["--output", "diagnostics.json"], 0)).toEqual({
      outputPath: "diagnostics.json",
      nextIndex: 2,
    });
    expect(
      parseOutputOption("--output=diagnostics.json", ["--output=diagnostics.json"], 0),
    ).toEqual({
      outputPath: "diagnostics.json",
      nextIndex: 1,
    });
  });

  it("returns undefined for non-output arguments", () => {
    expect(
      parseOutputOption("packages/shared/src/index.ts", ["packages/shared/src/index.ts"], 0),
    ).toBeUndefined();
  });

  it("rejects missing, empty, and flag-shaped output paths", () => {
    expect(() => parseOutputOption("--output", ["--output"], 0)).toThrow(
      "--output requires a path argument",
    );
    expect(() => parseOutputOption("--output", ["--output", "--json"], 0)).toThrow(
      "--output requires a path argument",
    );
    expect(() => parseOutputOption("--output=", ["--output="], 0)).toThrow(
      "--output= requires a non-empty path",
    );
    expect(() => parseOutputOption("--output=--json", ["--output=--json"], 0)).toThrow(
      "--output= requires a path argument, got: --json",
    );
  });
});

describe("parseArgs", () => {
  it("collects patterns and output paths without spawning ESLint", () => {
    expect(parseArgs(["--output", "diag.json", "packages/shared/src/**/*.ts"])).toEqual({
      patterns: ["packages/shared/src/**/*.ts"],
      outputPath: "diag.json",
    });
    expect(parseArgs(["--output=diag.json", "scripts/**/*.ts"])).toEqual({
      patterns: ["scripts/**/*.ts"],
      outputPath: "diag.json",
    });
  });

  it("treats -- as a separator token and keeps later positional patterns", () => {
    expect(parseArgs(["before.ts", "--", "after.ts"])).toEqual({
      patterns: ["before.ts", "after.ts"],
      outputPath: undefined,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--json"])).toThrow("Unknown argument: --json");
  });
});

describe("buildFinding", () => {
  it("projects local rule messages with docs metadata and optional location fields", () => {
    const ruleDocs = new Map([
      [
        "local/example-rule",
        docsEntry({
          repairKind: "suggestion",
          principle: "Prefer precise diagnostics.",
        }),
      ],
    ]);

    expect(
      buildFinding(
        eslintMessage({
          severity: 1,
          line: 12,
          messageId: "preferSpecificThing",
          suggestions: [{ desc: "Use a helper", fix: { text: "helper()" } }],
        }),
        repoFile("scripts/example.ts"),
        ruleDocs,
      ),
    ).toEqual({
      control: "lint/local/example-rule",
      severity: "warn",
      path: "scripts/example.ts",
      line: 12,
      ruleId: "local/example-rule",
      messageId: "preferSpecificThing",
      why: "Prefer precise diagnostics.",
      howToFix: 'Apply ESLint suggestion "Use a helper": replace with `helper()`.',
      repairKind: "suggestion",
    });
  });

  it("attaches repairCommand only for codemod rules that define one", () => {
    const codemodDocs = new Map([
      [
        "local/example-rule",
        docsEntry({
          repairKind: "codemod",
          repairCommand: "bun run codemod:example",
        }),
      ],
    ]);
    const manualDocs = new Map([
      [
        "local/example-rule",
        docsEntry({
          repairKind: "manual",
          repairCommand: "bun run codemod:should-not-leak",
        }),
      ],
    ]);

    expect(buildFinding(eslintMessage(), "relative.ts", codemodDocs)).toMatchObject({
      repairKind: "codemod",
      repairCommand: "bun run codemod:example",
    });
    expect(buildFinding(eslintMessage(), "relative.ts", manualDocs)).not.toHaveProperty(
      "repairCommand",
    );
  });

  it("skips non-local rules and local rules missing docs entries", () => {
    const ruleDocs = new Map([["local/covered-rule", docsEntry({ id: "local/covered-rule" })]]);

    expect(
      buildFinding(eslintMessage({ ruleId: "no-console" }), "relative.ts", ruleDocs),
    ).toBeUndefined();
    expect(
      buildFinding(eslintMessage({ ruleId: "local/missing-docs" }), "relative.ts", ruleDocs),
    ).toBeUndefined();
  });
});

describe("parser error findings", () => {
  it("projects fatal or severity-2 parser messages as blocking parser-error findings", () => {
    expect(
      buildFinding(
        eslintMessage({
          ruleId: null,
          fatal: true,
          severity: 1,
          message: "Parsing error: unexpected token",
          line: 4,
        }),
        repoFile("packages/shared/src/broken.ts"),
        new Map(),
      ),
    ).toEqual({
      control: "lint/parser-error",
      severity: "block",
      path: "packages/shared/src/broken.ts",
      line: 4,
      why: "ESLint could not parse this file, so no other rule could run against it.",
      howToFix: "Fix the syntax error reported by ESLint: Parsing error: unexpected token",
      repairKind: "manual",
    });

    expect(
      buildParserErrorFinding(
        eslintMessage({
          ruleId: null,
          severity: 2,
          message: "Parsing error: no line",
        }),
        "broken.ts",
      ),
    ).toEqual({
      control: "lint/parser-error",
      severity: "block",
      path: "broken.ts",
      why: "ESLint could not parse this file, so no other rule could run against it.",
      howToFix: "Fix the syntax error reported by ESLint: Parsing error: no line",
      repairKind: "manual",
    });

    expect(
      buildFinding(
        eslintMessage({
          ruleId: null,
          fatal: false,
          severity: 2,
          message: "Parsing error: missing brace",
        }),
        "broken.ts",
        new Map(),
      ),
    ).toMatchObject({ control: "lint/parser-error", severity: "block" });
  });

  it("drops ruleId-null warnings that are not fatal parser errors", () => {
    expect(
      buildFinding(
        eslintMessage({ ruleId: null, fatal: false, severity: 1, message: "warning" }),
        "relative.ts",
        new Map(),
      ),
    ).toBeUndefined();
  });
});

describe("buildLintAgentEnvelope", () => {
  it("sorts findings by control, path, then line and emits skipped non-local findings", () => {
    const ruleDocs = new Map([
      ["local/a-rule", docsEntry({ id: "local/a-rule", principle: "Keep a-rule actionable." })],
      ["local/z-rule", docsEntry({ id: "local/z-rule", principle: "Keep z-rule actionable." })],
    ]);

    const result = buildLintAgentEnvelope(
      [
        {
          filePath: repoFile("scripts/b.ts"),
          messages: [
            eslintMessage({ ruleId: "local/z-rule", line: 1, severity: 2 }),
            eslintMessage({ ruleId: "no-console", line: 3, severity: 2 }),
            eslintMessage({ ruleId: "local/missing-docs", line: 4, severity: 2 }),
          ],
        },
        {
          filePath: repoFile("scripts/a.ts"),
          messages: [
            eslintMessage({ ruleId: "local/z-rule", line: 10, severity: 2 }),
            eslintMessage({ ruleId: "local/a-rule", line: 4, severity: 1 }),
            eslintMessage({ ruleId: "local/z-rule", line: 2, severity: 2 }),
          ],
        },
      ],
      ruleDocs,
    );

    expect(result.skippedNonLocal).toBe(1);
    expect(
      result.envelope.findings.map(({ control, path, line, ruleId, severity }) => ({
        control,
        path,
        line,
        ruleId,
        severity,
      })),
    ).toEqual([
      {
        control: "lint/local/a-rule",
        path: "scripts/a.ts",
        line: 4,
        ruleId: "local/a-rule",
        severity: "warn",
      },
      {
        control: "lint/local/z-rule",
        path: "scripts/a.ts",
        line: 2,
        ruleId: "local/z-rule",
        severity: "block",
      },
      {
        control: "lint/local/z-rule",
        path: "scripts/a.ts",
        line: 10,
        ruleId: "local/z-rule",
        severity: "block",
      },
      {
        control: "lint/local/z-rule",
        path: "scripts/b.ts",
        line: 1,
        ruleId: "local/z-rule",
        severity: "block",
      },
      {
        control: "lint/skipped-non-local",
        path: "scripts/b.ts",
        line: 3,
        ruleId: "no-console",
        severity: "info",
      },
    ]);
    expect(result.envelope.findings.at(-1)).toMatchObject({
      why: "Non-local ESLint rule; no structured local-rule metadata is available.",
      howToFix: "Run `bun run lint` for the full ESLint report and fix this finding there.",
      repairKind: "manual",
    });
    expect(result.envelope.summary).toEqual({
      blocking: 3,
      warning: 1,
      info: 1,
      byControl: {
        "lint/local/a-rule": 1,
        "lint/local/z-rule": 3,
        "lint/skipped-non-local": 1,
      },
    });
    expect(harnessDiagnosticsSchema.safeParse(result.envelope).success).toBe(true);
  });

  it("exposes the comparator for direct deterministic ordering checks", () => {
    const unordered: HarnessFinding[] = [
      {
        control: "lint/local/z",
        severity: "block",
        path: "b.ts",
        line: 1,
        why: "why",
        howToFix: "fix",
        repairKind: "manual",
      },
      {
        control: "lint/local/a",
        severity: "block",
        path: "b.ts",
        line: 1,
        why: "why",
        howToFix: "fix",
        repairKind: "manual",
      },
      {
        control: "lint/local/z",
        severity: "block",
        path: "a.ts",
        line: 5,
        why: "why",
        howToFix: "fix",
        repairKind: "manual",
      },
      {
        control: "lint/local/z",
        severity: "block",
        path: "a.ts",
        line: 2,
        why: "why",
        howToFix: "fix",
        repairKind: "manual",
      },
    ];

    expect(
      [...unordered].sort(compareLintAgentFindings).map(({ control, path, line }) => ({
        control,
        path,
        line,
      })),
    ).toEqual([
      { control: "lint/local/a", path: "b.ts", line: 1 },
      { control: "lint/local/z", path: "a.ts", line: 2 },
      { control: "lint/local/z", path: "a.ts", line: 5 },
      { control: "lint/local/z", path: "b.ts", line: 1 },
    ]);
  });
});

describe("lintAgentHowToFixFor re-export", () => {
  it("keeps the lint-agent shim wired to local rule fix text", () => {
    expect(
      lintAgentHowToFixFor(docsEntry({ repairKind: "autofix" }), {
        message: "plain message without a rendered fix",
      }),
    ).toBe("Run `bun run lint:fix`.");
  });
});

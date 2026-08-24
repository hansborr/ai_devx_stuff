import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { parseGeneratedSurfaces } from "./generated-surfaces.js";
import { type ControlFailures, pushFailure } from "./harness-check-validation.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";
import {
  buildExplainReport,
  loadLiveExplainFixtureClosure,
  resolveExplainAuthorities,
} from "./registration-explain.js";
import { parseRegistrationCheckArgs } from "./registration-explain-cli.js";
import {
  EXPLAIN_FORMAT_VERSION,
  type ExplainAuthorities,
  type ExplainFixtureClosure,
  type ExplainMatch,
  type ExplainPathPolicy,
} from "./registration-explain-model.js";
import { renderExplainJson, renderExplainText } from "./registration-explain-render.js";

const fixtureControls = [
  {
    id: "check/probe-generator",
    kind: "check",
    category: "maintainability",
    principle: "Probe generator fixture principle.",
    pairedGuide: "docs/guides/probe-guide.md",
    repairKind: "autofix",
    source: "scripts/probe/generate-probe.ts",
    invocation: "bun run probe:generate",
    generatedSurface: {
      triggerPaths: ["scripts/probe/generate-probe.ts", "scripts/probe/inputs/"],
      outputPaths: ["docs/generated/probe.generated.md"],
      checkScript: "probe:generate:check",
      warnLabel: "probe metadata",
      bunHook: {
        refresh: "bypass",
        check: "wrapped",
        scripts: { "probe:classified": "wrapped" },
      },
      fixtureExtras: [{ path: "scripts/probe/runtime.txt", reason: "Runtime probe data." }],
    },
  },
  {
    id: "codemod/probe-shared-source",
    kind: "codemod",
    category: "maintainability",
    principle: "Shared-source codemod fixture principle.",
    pairedGuide: "none",
    repairKind: "codemod",
    repairCommand: "bun run probe:codemod:fix",
    source: "scripts/probe/generate-probe.ts",
    invocation: "bun run probe:codemod",
  },
  {
    id: "hook/probe-hook",
    kind: "hook",
    category: "behavior",
    principle: "Probe hook fixture principle.",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/ai-hooks/probe-hook.sh",
    invocation: "Claude PreToolUse Bash hook",
    hookWiring: {
      event: "PreToolUse",
      body: "scripts/ai-hooks/probe-hook.sh",
      order: 10,
      surface: "bash",
      harnesses: {
        claude: {
          matcher: "Bash",
          command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/probe-hook.sh",
        },
        codex: { matcher: "Bash", command: "codex-hook run probe" },
      },
    },
    slots: [{ name: "hook-probe-slot", script: "probe:slot:run" }],
  },
  {
    id: "verify-wrapper/probe-verify",
    kind: "verify-wrapper",
    category: "maintainability",
    principle: "Probe verify wrapper fixture principle.",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/probe-verify.sh",
    invocation: "bun run probe:verify",
    slots: [
      { name: "probe-check", script: "probe:generate:check" },
      { name: "probe-slot", script: "probe:slot:run", dynamic: "staged-script-classifier" },
    ],
  },
] as const;

const fixtureScripts = new Map([
  ["probe:generate", "bun run scripts/probe/generate-probe.ts"],
  ["probe:generate:check", "bun run scripts/probe/generate-probe.ts -- --check"],
  ["probe:classified", "bun run scripts/probe/classified.ts"],
  ["probe:codemod", "bun run scripts/probe/codemod.ts"],
  ["probe:codemod:fix", "bun run scripts/probe/codemod.ts -- --fix"],
  ["probe:slot:run", "bash scripts/probe-slot.sh"],
  ["probe:verify", "bash scripts/probe-verify.sh"],
]);

const fixturePathPolicy: ExplainPathPolicy = {
  smokeSubjects: {
    "test-probe": ["scripts/probe/generate-probe.ts", "scripts/probe/inputs/"],
    "test-harness-check": ["scripts/harness-check.ts"],
  },
  smokeTestNames: ["test-probe", "test-harness-check"],
  metadataFreshnessTestName: "test-harness-check",
  isSmokeTestPath: (path) => /^scripts\/tests\/test-[^/]+\.sh$/u.test(path),
};

const emptyFixtureClosure: ExplainFixtureClosure = { entries: [], synthesizedPaths: [] };

function fixtureAuthorities(
  controls: readonly Record<string, unknown>[] = [...fixtureControls],
  fixtureClosure: ExplainFixtureClosure = emptyFixtureClosure,
): ExplainAuthorities {
  const rawManifest = {
    scriptParityExemptions: [],
    ciGateControlIds: [],
    controls,
  };
  const parsed = safeParseHarnessManifest(rawManifest);
  if (parsed.manifest === undefined) {
    throw new Error(`fixture manifest did not parse:\n${parsed.failures.join("\n")}`);
  }
  return {
    manifest: parsed.manifest,
    scripts: fixtureScripts,
    generatedSurfaces: parseGeneratedSurfaces(controls),
    pathPolicy: fixturePathPolicy,
    fixtureClosure,
  };
}

function reasons(report: ReturnType<typeof buildExplainReport>): string[] {
  return report.matches.map((match) => match.reason);
}

describe("buildExplainReport path selector", () => {
  it("joins every declared relation for a source path without collapsing owners", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/probe/generate-probe.ts" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual([
      "control-invocation",
      "control-source",
      "generated-check-script",
      "generated-refresh-script",
      "generated-trigger",
      "control-source",
      "package-script-command",
      "package-script-command",
      "smoke-subject",
      "verify-slot",
    ]);
    const [
      ,
      checkSource,
      generatedCheck,
      generatedRefresh,
      trigger,
      codemodSource,
      script,
      checkScript,
      smoke,
      slot,
    ] = report.matches;
    expect(generatedCheck?.matched).toBe("probe:generate:check");
    expect(generatedCheck?.generated?.checkScript).toBe("probe:generate:check");
    expect(generatedRefresh?.matched).toBe("probe:generate");
    expect(generatedRefresh?.generated?.refreshScript).toBe("probe:generate");
    expect(checkSource?.control?.id).toBe("check/probe-generator");
    expect(checkSource?.control?.script).toBe("probe:generate");
    expect(checkSource?.generated?.checkScript).toBe("probe:generate:check");
    expect(checkSource?.generated?.outputPaths).toEqual(["docs/generated/probe.generated.md"]);
    expect(checkSource?.generated?.fixturePaths).toEqual(["scripts/probe/runtime.txt"]);
    expect(checkSource?.verifySlots).toEqual([
      {
        consumer: "verify-wrapper/probe-verify",
        name: "probe-check",
        script: "probe:generate:check",
      },
    ]);
    expect(checkSource?.smokeSelections).toEqual([
      { test: "test-probe", subject: "scripts/probe/generate-probe.ts" },
    ]);
    expect(trigger?.matched).toBe("scripts/probe/generate-probe.ts");
    expect(trigger?.verifySlots).toEqual([
      {
        consumer: "verify-wrapper/probe-verify",
        name: "probe-check",
        script: "probe:generate:check",
      },
    ]);
    expect(codemodSource?.control?.id).toBe("codemod/probe-shared-source");
    expect(script?.packageScript).toEqual({
      name: "probe:generate",
      command: "bun run scripts/probe/generate-probe.ts",
    });
    expect(checkScript?.packageScript?.name).toBe("probe:generate:check");
    expect(smoke?.smoke).toEqual({
      test: "test-probe",
      subject: "scripts/probe/generate-probe.ts",
    });
    expect(report.matches[0]?.matched).toBe("probe:generate");
    expect(slot?.slot?.name).toBe("probe-check");
  });

  it("joins downstream verify slots onto package-script command paths", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/probe-slot.sh" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["verify-slot", "package-script-command", "verify-slot"]);
    expect(report.matches[0]?.slot).toEqual({
      consumer: "hook/probe-hook",
      name: "hook-probe-slot",
      script: "probe:slot:run",
    });
    expect(report.matches[1]?.packageScript).toEqual({
      name: "probe:slot:run",
      command: "bash scripts/probe-slot.sh",
    });
    expect(report.matches[2]?.slot).toEqual({
      consumer: "verify-wrapper/probe-verify",
      name: "probe-slot",
      script: "probe:slot:run",
      dynamic: "staged-script-classifier",
    });
  });

  it("joins consuming controls onto package-script command paths", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/probe/codemod.ts" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual([
      "control-invocation",
      "control-repair-command",
      "package-script-command",
      "package-script-command",
    ]);
    expect(report.matches[0]?.control?.id).toBe("codemod/probe-shared-source");
    expect(report.matches[0]?.matched).toBe("probe:codemod");
    expect(report.matches[1]?.control?.id).toBe("codemod/probe-shared-source");
    expect(report.matches[1]?.matched).toBe("probe:codemod:fix");
  });

  it("keeps path selectors in parity with script selectors for classified scripts", () => {
    const authorities = fixtureAuthorities();

    const viaPath = buildExplainReport(
      { kind: "path", value: "scripts/probe/classified.ts" },
      authorities,
    );
    expect(reasons(viaPath)).toEqual(["generated-classified-script", "package-script-command"]);
    expect(viaPath.matches[0]?.control?.id).toBe("check/probe-generator");
    expect(viaPath.matches[0]?.generated?.checkScript).toBe("probe:generate:check");

    // The command-path traversal reuses the whole script-name enrichment, so
    // the two selector directions report the same script-scoped relations.
    const viaScript = buildExplainReport(
      { kind: "script", value: "probe:classified" },
      authorities,
    );
    const scriptScoped = (report: ReturnType<typeof buildExplainReport>): ExplainMatch[] =>
      report.matches.filter(
        (match) => match.reason !== "package-script" && match.reason !== "package-script-command",
      );
    expect(scriptScoped(viaPath)).toEqual(scriptScoped(viaScript));
  });

  it("matches directory-prefix trigger and smoke-subject entries", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/probe/inputs/data.json" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["generated-trigger", "smoke-subject"]);
    expect(report.matches[0]?.matched).toBe("scripts/probe/inputs/");
    expect(report.matches[1]?.smoke).toEqual({
      test: "test-probe",
      subject: "scripts/probe/inputs/",
    });
  });

  it("reports generated outputs, fixture extras, hook bodies, and paired guides", () => {
    const authorities = fixtureAuthorities();

    const output = buildExplainReport(
      { kind: "path", value: "docs/generated/probe.generated.md" },
      authorities,
    );
    expect(reasons(output)).toEqual(["generated-output"]);
    expect(output.matches[0]?.control?.id).toBe("check/probe-generator");

    const extra = buildExplainReport(
      { kind: "path", value: "scripts/probe/runtime.txt" },
      authorities,
    );
    expect(reasons(extra)).toEqual(["generated-fixture-extra"]);

    const hook = buildExplainReport(
      { kind: "path", value: "scripts/ai-hooks/probe-hook.sh" },
      authorities,
    );
    expect(reasons(hook)).toEqual(["control-source", "hook-body"]);
    expect(hook.matches[1]?.hook).toEqual({
      event: "PreToolUse",
      surface: "bash",
      body: "scripts/ai-hooks/probe-hook.sh",
    });

    const harness = buildExplainReport(
      { kind: "path", value: ".claude/hooks/probe-hook.sh" },
      authorities,
    );
    expect(reasons(harness)).toEqual(["hook-harness-command"]);
    expect(harness.matches[0]?.control?.id).toBe("hook/probe-hook");
    expect(harness.matches[0]?.hook?.body).toBe("scripts/ai-hooks/probe-hook.sh");

    const guide = buildExplainReport(
      { kind: "path", value: "docs/guides/probe-guide.md" },
      authorities,
    );
    expect(reasons(guide)).toEqual(["control-paired-guide"]);
    // The guide path is not the control source, so control-scoped join
    // fields (derived from the source and the control identity) stay off
    // this match kind; the control query carries the full chain.
    expect(guide.matches[0]?.control?.id).toBe("check/probe-generator");
    expect(guide.matches[0]?.generated).toBeUndefined();
    expect(guide.matches[0]?.hook).toBeUndefined();
    expect(guide.matches[0]?.verifySlots).toBeUndefined();
    expect(guide.matches[0]?.smokeSelections).toBeUndefined();
  });

  it('omits the pairedGuide "none" sentinel from summaries and path matching', () => {
    const authorities = fixtureAuthorities();

    const sentinel = buildExplainReport({ kind: "path", value: "none" }, authorities);
    expect(sentinel.matches).toEqual([]);

    const control = buildExplainReport(
      { kind: "control", value: "codemod/probe-shared-source" },
      authorities,
    );
    expect(control.matches[0]?.control?.pairedGuide).toBeUndefined();
  });

  it("adds the metadata-freshness selection for smoke-test paths", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/tests/test-probe.sh" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["smoke-metadata-freshness"]);
    expect(report.matches[0]?.smoke).toEqual({ test: "test-harness-check" });
  });

  it("normalizes leading ./ and backslashes, and reports an authoritative empty result", () => {
    const authorities = fixtureAuthorities();

    const normalized = buildExplainReport(
      { kind: "path", value: "./scripts/probe/runtime.txt" },
      authorities,
    );
    expect(normalized.selector.value).toBe("scripts/probe/runtime.txt");
    expect(reasons(normalized)).toEqual(["generated-fixture-extra"]);

    const backslashed = buildExplainReport(
      { kind: "path", value: ".\\scripts\\probe\\runtime.txt" },
      authorities,
    );
    expect(backslashed.selector.value).toBe("scripts/probe/runtime.txt");
    expect(reasons(backslashed)).toEqual(["generated-fixture-extra"]);

    const empty = buildExplainReport({ kind: "path", value: "scripts/nowhere.ts" }, authorities);
    expect(empty.matches).toEqual([]);
    expect(empty.explainVersion).toBe(EXPLAIN_FORMAT_VERSION);
  });
});

describe("buildExplainReport control selector", () => {
  it("reports the control with its script, slots, generated surface, and smoke selections", () => {
    const report = buildExplainReport(
      { kind: "control", value: "check/probe-generator" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["control-id"]);
    const match = report.matches[0];
    expect(match?.control).toEqual({
      id: "check/probe-generator",
      kind: "check",
      source: "scripts/probe/generate-probe.ts",
      invocation: "bun run probe:generate",
      script: "probe:generate",
      pairedGuide: "docs/guides/probe-guide.md",
    });
    expect(match?.packageScript).toEqual({
      name: "probe:generate",
      command: "bun run scripts/probe/generate-probe.ts",
    });
    expect(match?.generated?.triggerPaths).toEqual([
      "scripts/probe/generate-probe.ts",
      "scripts/probe/inputs/",
    ]);
    expect(match?.verifySlots).toEqual([
      {
        consumer: "verify-wrapper/probe-verify",
        name: "probe-check",
        script: "probe:generate:check",
      },
    ]);
    expect(match?.smokeSelections).toEqual([
      { test: "test-probe", subject: "scripts/probe/generate-probe.ts" },
    ]);
  });

  it("reports the slots a queried verify-wrapper itself declares", () => {
    const report = buildExplainReport(
      { kind: "control", value: "verify-wrapper/probe-verify" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["control-id"]);
    expect(report.matches[0]?.verifySlots).toEqual([
      {
        consumer: "verify-wrapper/probe-verify",
        name: "probe-check",
        script: "probe:generate:check",
      },
      {
        consumer: "verify-wrapper/probe-verify",
        name: "probe-slot",
        script: "probe:slot:run",
        dynamic: "staged-script-classifier",
      },
    ]);
  });

  it("reports declared slots for a hook control with no derivable script", () => {
    const report = buildExplainReport(
      { kind: "control", value: "hook/probe-hook" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["control-id"]);
    expect(report.matches[0]?.control?.script).toBeUndefined();
    expect(report.matches[0]?.verifySlots).toEqual([
      { consumer: "hook/probe-hook", name: "hook-probe-slot", script: "probe:slot:run" },
    ]);
  });

  it("returns an authoritative empty result for an unknown control id", () => {
    const report = buildExplainReport(
      { kind: "control", value: "check/does-not-exist" },
      fixtureAuthorities(),
    );

    expect(report.matches).toEqual([]);
  });
});

describe("buildExplainReport script selector", () => {
  it("joins package script, invocations, generated scripts, and verify slots", () => {
    const report = buildExplainReport(
      { kind: "script", value: "probe:generate:check" },
      fixtureAuthorities(),
    );

    expect(reasons(report)).toEqual(["generated-check-script", "package-script", "verify-slot"]);
    expect(report.matches[0]?.control?.id).toBe("check/probe-generator");
    expect(report.matches[0]?.generated?.checkScript).toBe("probe:generate:check");
    expect(report.matches[2]?.slot).toEqual({
      consumer: "verify-wrapper/probe-verify",
      name: "probe-check",
      script: "probe:generate:check",
    });
  });

  it("reports refresh scripts, repair commands, classified scripts, and dynamic slots", () => {
    const authorities = fixtureAuthorities();

    const refresh = buildExplainReport({ kind: "script", value: "probe:generate" }, authorities);
    expect(reasons(refresh)).toEqual([
      "control-invocation",
      "generated-refresh-script",
      "package-script",
    ]);
    expect(refresh.matches[0]?.smokeSelections).toEqual([
      { test: "test-probe", subject: "scripts/probe/generate-probe.ts" },
    ]);

    const repair = buildExplainReport({ kind: "script", value: "probe:codemod:fix" }, authorities);
    expect(reasons(repair)).toEqual(["control-repair-command", "package-script"]);
    expect(repair.matches[0]?.control?.id).toBe("codemod/probe-shared-source");

    const classified = buildExplainReport(
      { kind: "script", value: "probe:classified" },
      authorities,
    );
    expect(reasons(classified)).toEqual(["generated-classified-script", "package-script"]);

    const dynamic = buildExplainReport({ kind: "script", value: "probe:slot:run" }, authorities);
    expect(reasons(dynamic)).toEqual(["verify-slot", "package-script", "verify-slot"]);
    expect(dynamic.matches[0]?.slot?.consumer).toBe("hook/probe-hook");
    expect(dynamic.matches[2]?.slot?.dynamic).toBe("staged-script-classifier");
  });

  it("returns an authoritative empty result for an unregistered script", () => {
    const report = buildExplainReport(
      { kind: "script", value: "probe:unregistered" },
      fixtureAuthorities(),
    );

    expect(report.matches).toEqual([]);
  });

  it("does not fabricate classified-script matches from inherited object keys", () => {
    const report = buildExplainReport({ kind: "script", value: "toString" }, fixtureAuthorities());

    expect(report.matches).toEqual([]);
  });
});

describe("fixture-closure provenance", () => {
  const sharedInfraControl = {
    id: "check/verify-steps-generator",
    kind: "check",
    category: "maintainability",
    principle: "Verify steps generator fixture principle.",
    pairedGuide: "none",
    repairKind: "autofix",
    source: "scripts/probe/generate-steps.ts",
    invocation: "bun run probe:steps",
    generatedSurface: {
      triggerPaths: ["scripts/probe/generate-steps.ts"],
      outputPaths: ["scripts/probe/steps.generated.sh"],
      checkScript: "probe:steps:check",
      warnLabel: "probe steps",
      bunHook: { refresh: "bypass", check: "wrapped" },
    },
  } as const;

  const closure: ExplainFixtureClosure = {
    entries: [
      {
        ownerId: "check/probe-generator",
        files: [
          "scripts/probe/generate-probe.ts",
          "scripts/probe/probe-dep.ts",
          "docs/generated/probe.generated.md",
          "scripts/lint-agent-guidance.ts",
        ],
      },
      {
        ownerId: "scripts/harness-registration-check.ts",
        files: ["scripts/harness/registration-explain-matchers.ts"],
      },
    ],
    synthesizedPaths: ["scripts/lint-agent-guidance.ts"],
  };

  function closureAuthorities(): ExplainAuthorities {
    return fixtureAuthorities([...fixtureControls, sharedInfraControl], closure);
  }

  it("discovers a closure-derived fixture dependency from its path", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/probe/probe-dep.ts" },
      closureAuthorities(),
    );

    expect(reasons(report)).toEqual(["generated-fixture-dependency"]);
    expect(report.matches[0]?.control?.id).toBe("check/probe-generator");
    expect(report.matches[0]?.generated?.fixturePaths).toEqual([
      "scripts/probe/generate-probe.ts",
      "scripts/probe/probe-dep.ts",
      "scripts/probe/runtime.txt",
    ]);
  });

  it("attributes validator-root closure files to the shared infra record", () => {
    const report = buildExplainReport(
      { kind: "path", value: "scripts/harness/registration-explain-matchers.ts" },
      closureAuthorities(),
    );

    expect(reasons(report)).toEqual(["generated-fixture-dependency"]);
    expect(report.matches[0]?.control?.id).toBe("check/verify-steps-generator");
  });

  it("keeps declared residue distinct and filters outputs and synthesized files", () => {
    const authorities = closureAuthorities();

    const residue = buildExplainReport(
      { kind: "path", value: "scripts/probe/runtime.txt" },
      authorities,
    );
    expect(reasons(residue)).toEqual(["generated-fixture-extra"]);

    const output = buildExplainReport(
      { kind: "path", value: "docs/generated/probe.generated.md" },
      authorities,
    );
    expect(reasons(output)).toEqual(["generated-output"]);

    const synthesized = buildExplainReport(
      { kind: "path", value: "scripts/lint-agent-guidance.ts" },
      authorities,
    );
    expect(synthesized.matches).toEqual([]);
  });

  it("reports the effective fixture paths on a control query", () => {
    const report = buildExplainReport(
      { kind: "control", value: "check/probe-generator" },
      closureAuthorities(),
    );

    expect(report.matches[0]?.generated?.fixturePaths).toEqual([
      "scripts/probe/generate-probe.ts",
      "scripts/probe/probe-dep.ts",
      "scripts/probe/runtime.txt",
    ]);
  });
});

describe("explain determinism", () => {
  it("orders matches identically when manifest declaration order is reversed", () => {
    const forward = buildExplainReport(
      { kind: "path", value: "scripts/probe/generate-probe.ts" },
      fixtureAuthorities(),
    );
    const reversed = buildExplainReport(
      { kind: "path", value: "scripts/probe/generate-probe.ts" },
      fixtureAuthorities([...fixtureControls].reverse()),
    );

    expect(renderExplainJson(reversed)).toBe(renderExplainJson(forward));
  });
});

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

describe("explain renderers", () => {
  it("keeps text and JSON output in parity for every reported value", () => {
    const selectors = [
      { kind: "path", value: "scripts/probe/generate-probe.ts" },
      { kind: "control", value: "check/probe-generator" },
      { kind: "script", value: "probe:generate:check" },
    ] as const;
    for (const selector of selectors) {
      const report = buildExplainReport(selector, fixtureAuthorities());
      const text = renderExplainText(report);
      const parsed: unknown = JSON.parse(renderExplainJson(report));
      for (const leaf of stringLeaves(parsed)) {
        expect(text).toContain(leaf);
      }
    }
  });

  it("labels the empty result explicitly in both formats", () => {
    const report = buildExplainReport(
      { kind: "script", value: "probe:unregistered" },
      fixtureAuthorities(),
    );

    expect(renderExplainText(report)).toContain("authoritative empty result");
    const parsed: unknown = JSON.parse(renderExplainJson(report));
    expect(parsed).toMatchObject({
      explainVersion: EXPLAIN_FORMAT_VERSION,
      selector: { kind: "script", value: "probe:unregistered" },
      matches: [],
    });
  });
});

describe("preflight entrypoint eager module graph", () => {
  /**
   * Static runtime import specifiers of one file: type-only declarations are
   * erased at runtime and dynamic `import(...)` expressions load lazily, so
   * neither belongs to the eager graph this walk pins.
   */
  function staticRuntimeImports(filePath: string): readonly string[] {
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const specifiers: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      specifiers.push(statement.moduleSpecifier.text);
    }
    return specifiers;
  }

  function eagerFirstPartyClosure(entry: string): ReadonlySet<string> {
    const seen = new Set<string>();
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of staticRuntimeImports(file)) {
        if (!specifier.startsWith(".")) continue;
        queue.push(resolve(dirname(file), specifier).replace(/\.js$/u, ".ts"));
      }
    }
    return seen;
  }

  it("keeps the explain view out of the no-arg preflight's eager closure", () => {
    const repoRoot = process.cwd();
    const closure = eagerFirstPartyClosure(join(repoRoot, "scripts/harness-registration-check.ts"));

    // The no-arg preflight gate must not pay for the explain-only modules or
    // run their module-scope work — path-policy-smoke-subjects.ts reads the
    // cwd-relative scripts/tests directory at import time. The explain modules
    // stay reachable through literal dynamic imports, which the fixture-copy
    // closure walker still follows (see runtime-imports.ts recordImport).
    expect(closure.has(join(repoRoot, "scripts/harness/registration-explain.ts"))).toBe(false);
    expect(closure.has(join(repoRoot, "scripts/harness/registration-explain-render.ts"))).toBe(
      false,
    );
    expect(closure.has(join(repoRoot, "scripts/path-policy/path-policy-smoke-subjects.ts"))).toBe(
      false,
    );
    // The argument grammar stays eager: every invocation parses arguments.
    expect(closure.has(join(repoRoot, "scripts/harness/registration-explain-cli.ts"))).toBe(true);
  });
});

describe("loadLiveExplainFixtureClosure", () => {
  // A walker-less tree with no declared residue (the harness-check fixture
  // sandbox default) has no derivable fixture closure: the checked-in
  // projection, which the explain view does not read, is the authority there.
  const walkerlessControls = [
    {
      id: "check/no-residue-generator",
      kind: "check",
      category: "maintainability",
      principle: "Walkerless no-residue fixture principle.",
      pairedGuide: "none",
      repairKind: "autofix",
      source: "scripts/probe/generate-probe.ts",
      invocation: "bun run probe:generate",
      generatedSurface: {
        triggerPaths: ["scripts/probe/generate-probe.ts"],
        outputPaths: ["docs/generated/probe.generated.md"],
        checkScript: "probe:generate:check",
        warnLabel: "probe metadata",
        bunHook: { refresh: "bypass", check: "wrapped" },
      },
    },
  ];

  it("refuses the walkerless no-residue mode instead of reporting an empty closure", async () => {
    vi.stubEnv("MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS", "1");
    try {
      const records = parseGeneratedSurfaces(walkerlessControls);
      expect(records).toHaveLength(1);

      const resolution = await loadLiveExplainFixtureClosure("/nonexistent-repo-root", records);

      expect(resolution.closure.entries).toEqual([]);
      expect(resolution.failures).toHaveLength(1);
      expect(resolution.failures[0]).toContain("MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS");

      const resolved = resolveExplainAuthorities(
        {
          rawManifest: {
            scriptParityExemptions: [],
            ciGateControlIds: [],
            controls: walkerlessControls,
          },
          scripts: fixtureScripts,
        },
        { failures: new Map(), generatedSurfaces: records },
        fixturePathPolicy,
        resolution,
      );
      expect(resolved.authorities).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("resolveExplainAuthorities", () => {
  const rawManifest = {
    scriptParityExemptions: [],
    ciGateControlIds: [],
    controls: [...fixtureControls],
  };
  const inputs = { rawManifest, scripts: fixtureScripts };
  const cleanClosure = { closure: emptyFixtureClosure, failures: [] };

  it("resolves authorities over a clean registration state", () => {
    const resolved = resolveExplainAuthorities(
      inputs,
      { failures: new Map(), generatedSurfaces: parseGeneratedSurfaces([...fixtureControls]) },
      fixturePathPolicy,
      cleanClosure,
    );

    expect(resolved.failures).toBeUndefined();
    expect(resolved.authorities?.manifest.controls).toHaveLength(fixtureControls.length);
    expect(resolved.authorities?.scripts).toBe(fixtureScripts);
  });

  it("refuses to resolve while registration failures exist, naming each one", () => {
    const failures = new Map<string, ControlFailures>();
    pushFailure(failures, "check/probe-generator", "references unknown package.json script: nope");
    pushFailure(failures, "verify registration", "steps.generated.sh is out of date");

    const resolved = resolveExplainAuthorities(
      inputs,
      { failures, generatedSurfaces: [] },
      fixturePathPolicy,
      cleanClosure,
    );

    expect(resolved.authorities).toBeUndefined();
    expect(resolved.failures).toEqual([
      "check/probe-generator: references unknown package.json script: nope",
      "verify registration: steps.generated.sh is out of date",
    ]);
  });

  it("refuses to resolve when the fixture-closure derivation failed", () => {
    const resolved = resolveExplainAuthorities(
      inputs,
      { failures: new Map(), generatedSurfaces: [] },
      fixturePathPolicy,
      { closure: emptyFixtureClosure, failures: ["failed to walk the import closure of x"] },
    );

    expect(resolved.authorities).toBeUndefined();
    expect(resolved.failures).toEqual(["failed to walk the import closure of x"]);
  });

  it("refuses to resolve when the manifest is not schema-parseable", () => {
    const resolved = resolveExplainAuthorities(
      { rawManifest: { controls: [] }, scripts: fixtureScripts },
      { failures: new Map(), generatedSurfaces: [] },
      fixturePathPolicy,
      cleanClosure,
    );

    expect(resolved.authorities).toBeUndefined();
    expect(resolved.failures?.length).toBeGreaterThan(0);
  });
});

describe("parseRegistrationCheckArgs", () => {
  it("keeps the no-argument check mode and the legacy unknown-argument rejection", () => {
    expect(parseRegistrationCheckArgs([])).toEqual({ mode: "check" });
    expect(parseRegistrationCheckArgs(["--verbose", "extra"])).toEqual({
      mode: "usage-error",
      message: "unknown argument(s): --verbose, extra",
    });
  });

  it("parses each explicitly typed selector and the JSON format flag", () => {
    expect(parseRegistrationCheckArgs(["--explain", "--path", "scripts/verify.sh"])).toEqual({
      mode: "explain",
      selector: { kind: "path", value: "scripts/verify.sh" },
      format: "text",
    });
    expect(parseRegistrationCheckArgs(["--explain", "--control", "check/probe", "--json"])).toEqual(
      {
        mode: "explain",
        selector: { kind: "control", value: "check/probe" },
        format: "json",
      },
    );
    expect(parseRegistrationCheckArgs(["--json", "--explain", "--script", "lint"])).toEqual({
      mode: "explain",
      selector: { kind: "script", value: "lint" },
      format: "json",
    });
  });

  it("rejects malformed explain invocations with usage errors", () => {
    const cases: readonly string[][] = [
      ["--explain"],
      ["--explain", "--path"],
      ["--explain", "--path", "--json"],
      ["--explain", "--path", "a", "--script", "b"],
      ["--explain", "--path", "a", "--explain"],
      ["--explain", "--json", "--json", "--path", "a"],
      ["--explain", "--frobnicate", "--path", "a"],
      ["--explain", "--path", ""],
    ];
    for (const args of cases) {
      expect(parseRegistrationCheckArgs(args).mode).toBe("usage-error");
    }
  });
});

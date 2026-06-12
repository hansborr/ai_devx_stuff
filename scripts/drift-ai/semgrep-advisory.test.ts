import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildSemgrepAdvisory,
  formatSemgrepAdvisoryJson,
  formatSemgrepAdvisoryText,
} from "./semgrep-advisory.js";
import { parseSemgrepScanOutput } from "./semgrep-output.js";
import {
  evaluateRuleSources,
  type RuleSourceDecision,
  type RuleSourceGateOptions,
  type SemgrepRuleSource,
} from "./semgrep-rule-sources.js";
import type { SemgrepRunnerCaps, SemgrepRunnerResult, SemgrepToolInfo } from "./semgrep-runner.js";
import type { SemgrepFinding, SemgrepFindingMetadata, SemgrepScanOutput } from "./semgrep-types.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "semgrep");

function readFixtureScan(name: string): SemgrepScanOutput {
  const parsed = parseSemgrepScanOutput(readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scan;
}

const CAPS: SemgrepRunnerCaps = { timeoutMs: 600_000 };

const TOOL: SemgrepToolInfo = {
  command: ".tools/semgrep/.venv/bin/semgrep",
  source: "tools-checkout",
  version: "1.165.0",
};

const MIT_PINNED: SemgrepRuleSource = {
  kind: "local",
  config: "/rules/patched-codes.yml",
  license: "MIT",
  sourceUrl: "https://github.com/patched-codes/semgrep-rules",
  commit: "abc123",
  sha256: null,
  operatorAcceptedLicense: false,
};

const AGPL_LOCAL: SemgrepRuleSource = {
  kind: "local",
  config: "/rules/trailofbits",
  license: "AGPL-3.0",
  sourceUrl: null,
  commit: null,
  sha256: null,
  operatorAcceptedLicense: false,
};

const REGISTRY_PACK: SemgrepRuleSource = {
  kind: "registry-pack",
  pack: "p/default",
  license: null,
  operatorAcceptedLicense: false,
};

function gate(
  sources: readonly SemgrepRuleSource[],
  options: Partial<RuleSourceGateOptions> = {},
): readonly RuleSourceDecision[] {
  return evaluateRuleSources(sources, {
    allowedRuleLicenses: [],
    allowLiveRegistry: false,
    ...options,
  });
}

function meta(overrides: Partial<SemgrepFindingMetadata> = {}): SemgrepFindingMetadata {
  return {
    confidence: null,
    likelihood: null,
    impact: null,
    category: null,
    subcategory: [],
    cwe: [],
    owasp: [],
    references: [],
    ...overrides,
  };
}

function finding(overrides: Partial<SemgrepFinding> = {}): SemgrepFinding {
  return {
    checkId: "rules.empty-catch",
    path: "src/a.ts",
    startLine: 10,
    startCol: 3,
    endLine: 14,
    endCol: 4,
    message: "Empty catch block swallows errors",
    severity: "WARNING",
    metadata: meta({ confidence: "HIGH", category: "correctness" }),
    ...overrides,
  };
}

function scan(
  findings: readonly SemgrepFinding[],
  overrides: Partial<SemgrepScanOutput> = {},
): SemgrepScanOutput {
  return {
    engineVersion: "1.165.0",
    findings,
    malformedResultCount: 0,
    errors: [],
    skippedRules: [],
    scannedCount: 12,
    ...overrides,
  };
}

function okRun(scanOutput: SemgrepScanOutput): SemgrepRunnerResult {
  return { ok: true, tool: TOOL, scan: scanOutput, caps: CAPS };
}

describe("buildSemgrepAdvisory", () => {
  it("wraps grouped (check_id, path) rows in the prototype advisory contract", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(
        scan([
          finding(),
          finding({ startLine: 20, startCol: 1, endLine: 24, endCol: 2 }),
          finding({ path: "src/b.ts" }),
        ]),
      ),
    });
    const section = advisory.sections[0];

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("semgrep-candidates");
    expect("findings" in advisory).toBe(false);
    expect(section?.candidateKind).toBe("Semgrep candidate groups");
    expect(section?.totalCandidates).toBe(2);
    // Same confidence/severity, so the smaller group ranks first.
    expect(section?.entries[0]).toMatchObject({
      rank: 1,
      candidateSource: "semgrep",
      checkId: "rules.empty-catch",
      path: "src/b.ts",
      count: 1,
    });
    expect(section?.entries[1]).toMatchObject({ rank: 2, path: "src/a.ts", count: 2 });
    expect(section?.entries[1]?.ranges).toEqual([
      { startLine: 10, startCol: 3, endLine: 14, endCol: 4 },
      { startLine: 20, startCol: 1, endLine: 24, endCol: 2 },
    ]);
  });

  it("sorts groups by confidence, severity, smaller group, then rule id and path", () => {
    const high = (overrides: Partial<SemgrepFinding>): SemgrepFinding =>
      finding({ severity: "ERROR", metadata: meta({ confidence: "HIGH" }), ...overrides });
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(
        scan([
          finding({
            checkId: "rules.low-error",
            path: "f.ts",
            severity: "ERROR",
            metadata: meta({ confidence: "LOW" }),
          }),
          finding({
            checkId: "rules.none-error",
            path: "g.ts",
            severity: "ERROR",
            metadata: meta(),
          }),
          high({ checkId: "rules.high-warning", path: "e.ts", severity: "WARNING" }),
          // Modern semgrep's top severity tier ranks ahead of ERROR.
          high({ checkId: "rules.high-critical", path: "d.ts", severity: "CRITICAL" }),
          high({ checkId: "rules.high-error", path: "b.ts" }),
          high({ checkId: "rules.high-error", path: "a.ts" }),
          // A two-hit group whose rule id sorts BEFORE the singles: group size wins.
          high({ checkId: "rules.a-high-error-pair", path: "c.ts" }),
          high({ checkId: "rules.a-high-error-pair", path: "c.ts", startLine: 30, endLine: 31 }),
        ]),
      ),
    });

    expect(advisory.sections[0]?.entries.map((row) => `${row.checkId} ${row.path}`)).toEqual([
      "rules.high-critical d.ts",
      "rules.high-error a.ts",
      "rules.high-error b.ts",
      "rules.a-high-error-pair c.ts",
      "rules.high-warning e.ts",
      "rules.low-error f.ts",
      "rules.none-error g.ts",
    ]);
  });

  it("keeps (check_id, path) groups separate when ids or paths contain spaces", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(
        scan([
          // A space-joined key would merge these two groups: local config path
          // stems prefix check ids, so spaces can reach the id side too.
          finding({ checkId: "rules.my pack.rule", path: "src/a.ts" }),
          finding({ checkId: "rules.my", path: "pack.rule src/a.ts" }),
        ]),
      ),
    });

    expect(advisory.sections[0]?.totalCandidates).toBe(2);
  });

  it("groups the real logged-out capture, keeping namespaced check ids", () => {
    const scanOutput = readFixtureScan("scan-output.logged-out.json");
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(scanOutput),
    });
    const section = advisory.sections[0];
    const text = formatSemgrepAdvisoryText(advisory);

    expect(section?.totalCandidates).toBe(2);
    expect(section?.entries[0]).toMatchObject({
      checkId: "tmp.smoke-empty-catch",
      path: "scripts/drift-ai/dolos-runner.ts",
      count: 1,
    });
    expect(section?.entries[1]).toMatchObject({
      path: "scripts/drift-ai/git-changed-scope.ts",
      count: 3,
    });
    expect(text).toContain(
      "#2 tmp.smoke-empty-catch scripts/drift-ai/git-changed-scope.ts -- 3 hits, lines 18-23, 29-34, 42-47",
    );
    expect(text).toContain(
      `engine semgrep@1.165.0; scanned ${String(scanOutput.scannedCount)} files`,
    );
  });

  it("renders metadata facts and provenance without WARN/FIX language or snippets", () => {
    const advisory = buildSemgrepAdvisory(
      {
        ruleSources: gate([MIT_PINNED]),
        targetHasSemgrepignore: false,
        run: okRun(readFixtureScan("scan-output.synthetic-rich.json")),
      },
      { includeRuleMessages: true },
    );
    const text = formatSemgrepAdvisoryText(advisory);

    expect(text).toContain("drift:ai semgrep-candidates (advisory, prototype lane)");
    expect(text).toContain(
      "prerequisite semgrep engine: ok -- semgrep@1.165.0 (tools-checkout .tools/semgrep/.venv/bin/semgrep)",
    );
    expect(text).toContain(
      "prerequisite semgrep rule source: ok -- 1 of 1 declared rule source allowed: local /rules/patched-codes.yml",
    );
    expect(text).toContain(
      "rule source: local /rules/patched-codes.yml -- license MIT (permissive); pinned commit abc123; from https://github.com/patched-codes/semgrep-rules; reproducible: true",
    );
    expect(text).toContain("#1 rules.hardcoded-secret src/server/auth.go -- 1 hit, line 12");
    expect(text).toContain(
      "severity error; confidence medium; likelihood high; impact medium; category security/audit; " +
        "cwe CWE-798: Use of Hard-coded Credentials; " +
        "owasp A07:2021 - Identification and Authentication Failures; " +
        "ref https://example.invalid/rule-docs",
    );
    expect(text).toContain("message: Possible hardcoded secret");
    expect(text).toContain(
      "rule messages: included via --include-rule-messages; Semgrep renders matched source into messages via metavariable interpolation",
    );
    expect(text).toContain("inspect: open src/server/auth.go:12");
    expect(text).toContain(
      "degraded: semgrep scan error (warn/PartialParsing) at src/broken.ts: Syntax error at line src/broken.ts:10",
    );
    expect(text).toContain("degraded: semgrep skipped 1 invalid rule: rules.invalid-pattern");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX");
    expect(text).not.toContain("requires login");
  });

  it("emits no snippet/redaction fields and no top-level findings key in JSON", () => {
    const json = formatSemgrepAdvisoryJson(
      buildSemgrepAdvisory({
        ruleSources: gate([MIT_PINNED]),
        targetHasSemgrepignore: false,
        run: okRun(readFixtureScan("scan-output.synthetic-rich.json")),
      }),
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(json).not.toContain("requires login");
    expect(json).not.toContain('"lines"');
    expect(json).not.toContain('"fingerprint"');
    // Withheld by default: the rendered message never reaches JSON either.
    expect(json).not.toContain("Possible hardcoded secret");
    expect("findings" in parsed).toBe(false);
    expect(parsed["kind"]).toBe("advisory");
    expect(parsed["lane"]).toBe("prototype");
  });

  it("withholds Semgrep-rendered rule messages by default", () => {
    // Semgrep interpolates matched metavariable values into rendered messages,
    // so a default run must not carry them: that is the "safe to hand off"
    // contract, not just the unread extra.lines field.
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(readFixtureScan("scan-output.synthetic-rich.json")),
    });
    const text = formatSemgrepAdvisoryText(advisory);
    const section = advisory.sections[0];

    expect(section?.ruleMessages).toBe("withheld");
    expect(section?.entries.every((row) => row.message === null)).toBe(true);
    expect(text).not.toContain("message:");
    expect(text).not.toContain("Possible hardcoded secret");
    expect(text).toContain(
      "rule messages: withheld (Semgrep renders matched source into messages via metavariable interpolation); pass --include-rule-messages to include them",
    );
    expect(text).toContain(
      "inspect: open src/server/auth.go:12 and confirm or discard against rule rules.hardcoded-secret.",
    );
  });

  it("marks the section's message policy as included under the opt-in", () => {
    const advisory = buildSemgrepAdvisory(
      {
        ruleSources: gate([MIT_PINNED]),
        targetHasSemgrepignore: false,
        run: okRun(scan([finding()])),
      },
      { includeRuleMessages: true },
    );
    const section = advisory.sections[0];

    expect(section?.ruleMessages).toBe("included");
    expect(section?.entries[0]?.message).toBe("Empty catch block swallows errors");
  });

  it("reports a missing semgrep binary as an unmet prerequisite, not a failure", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: {
        ok: false,
        reason: "tool-unavailable",
        error: "spawn semgrep ENOENT",
        tool: { command: "semgrep", source: "path" },
        caps: CAPS,
      },
    });
    const text = formatSemgrepAdvisoryText(advisory);

    expect(advisory.prerequisites[0]).toMatchObject({ name: "semgrep engine", satisfied: false });
    expect(advisory.degradations).toEqual([]);
    expect(text).toContain(
      "prerequisite semgrep engine: unmet -- semgrep ('semgrep' on PATH) unavailable: spawn semgrep ENOENT",
    );
    expect(advisory.sections[0]?.emptyReason).toBe(
      "semgrep produced no candidate groups (the engine was unavailable).",
    );
  });

  it("renders an unmet rule-source prerequisite and a skipped scan when nothing is declared", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: [],
      targetHasSemgrepignore: false,
      run: null,
    });

    expect(advisory.prerequisites[0]).toEqual({
      name: "semgrep engine",
      satisfied: false,
      detail: "not probed -- the scan was skipped because no rule source was declared",
    });
    expect(advisory.prerequisites[1]).toMatchObject({
      name: "semgrep rule source",
      satisfied: false,
    });
    expect(advisory.prerequisites[1]?.detail).toContain("no rule sources declared");
    expect(advisory.caps).toEqual([]);
    expect(advisory.degradations).toEqual([]);
    expect(advisory.sections[0]?.emptyReason).toBe(
      "scan skipped: no rule source was declared or allowed.",
    );
  });

  it("renders a blocked rule source as an unmet prerequisite carrying the gate's reasons", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([AGPL_LOCAL]),
      targetHasSemgrepignore: false,
      run: null,
    });
    const prerequisite = advisory.prerequisites[1];

    expect(advisory.prerequisites[0]?.detail).toBe(
      "not probed -- the scan was skipped because every declared rule source was blocked",
    );
    expect(prerequisite).toMatchObject({ name: "semgrep rule source", satisfied: false });
    expect(prerequisite?.detail).toContain("0 of 1 declared rule source allowed");
    expect(prerequisite?.detail).toContain(
      "rule license AGPL-3.0 (copyleft class) is blocked by default; " +
        "pass --allow-rule-license AGPL-3.0 to opt in",
    );
  });

  it("discloses a blocked source beside an allowed one as a degradation", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED, REGISTRY_PACK]),
      targetHasSemgrepignore: false,
      run: okRun(scan([finding()])),
    });

    expect(advisory.prerequisites[1]).toMatchObject({
      name: "semgrep rule source",
      satisfied: true,
    });
    expect(advisory.prerequisites[1]?.detail).toContain(
      "1 of 2 declared rule sources allowed: local /rules/patched-codes.yml",
    );
    expect(
      advisory.degradations.some(
        (line) =>
          line.includes("registry pack p/default") && line.includes("--allow-live-registry"),
      ),
    ).toBe(true);
    expect(advisory.sections[0]?.ruleSources).toHaveLength(1);
  });

  it("marks live-registry provenance reproducible: false and pinned local provenance true", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED, REGISTRY_PACK], {
        allowedRuleLicenses: ["Semgrep-Rules-License-1.0"],
        allowLiveRegistry: true,
      }),
      targetHasSemgrepignore: false,
      run: okRun(scan([finding()])),
    });
    const text = formatSemgrepAdvisoryText(advisory);

    expect(advisory.sections[0]?.ruleSources).toEqual([
      {
        kind: "local",
        source: "/rules/patched-codes.yml",
        license: "MIT",
        licenseClass: "permissive",
        sourceUrl: "https://github.com/patched-codes/semgrep-rules",
        commit: "abc123",
        sha256: null,
        reproducible: true,
      },
      {
        kind: "registry-pack",
        source: "p/default",
        license: "Semgrep-Rules-License-1.0",
        licenseClass: "restricted-internal-use",
        sourceUrl: null,
        commit: null,
        sha256: null,
        reproducible: false,
      },
    ]);
    expect(text).toContain(
      "rule source: registry pack p/default -- license Semgrep-Rules-License-1.0 " +
        "(restricted-internal-use); live registry; reproducible: false",
    );
    expect(text).toContain("pinned commit abc123");
    expect(text).toContain("reproducible: true");
  });

  it("renders the display cap as showing N of M candidates", () => {
    const advisory = buildSemgrepAdvisory(
      {
        ruleSources: gate([MIT_PINNED]),
        targetHasSemgrepignore: false,
        run: okRun(
          scan(
            ["a", "b", "c"].map((stem) =>
              finding({ checkId: `rules.${stem}`, path: `src/${stem}.ts` }),
            ),
          ),
        ),
      },
      { top: 2 },
    );

    expect(advisory.sections[0]?.entries).toHaveLength(2);
    expect(advisory.sections[0]?.totalCandidates).toBe(3);
    expect(formatSemgrepAdvisoryText(advisory)).toContain(
      "showing 2 of 3 candidates (1 more; raise --top to see them)",
    );
  });

  it("caps the per-row range list in text", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(
        scan(
          Array.from({ length: 7 }, (_, index) =>
            finding({ startLine: index + 1, endLine: index + 1 }),
          ),
        ),
      ),
    });

    expect(formatSemgrepAdvisoryText(advisory)).toContain("7 hits, lines 1, 2, 3, 4, 5 (+2 more)");
  });

  it("discloses a timed-out scan as a HIT subprocess cap while keeping the engine present", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: {
        ok: false,
        reason: "timeout",
        error: "timeout of 1234ms",
        tool: TOOL,
        caps: { timeoutMs: 1234 },
        phase: "scan",
      },
    });

    expect(advisory.prerequisites[0]).toMatchObject({ name: "semgrep engine", satisfied: true });
    expect(advisory.degradations).toEqual([]);
    expect(formatSemgrepAdvisoryText(advisory)).toContain(
      "cap semgrep subprocess wall-clock (ms): HIT -- PARTIAL run: semgrep scan stopped at the 1234ms subprocess cap",
    );
  });

  it("discloses a timed-out probe without implying the scan started", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: {
        ok: false,
        reason: "timeout",
        error: "timeout of 1234ms",
        tool: TOOL,
        caps: { timeoutMs: 1234 },
        phase: "probe",
      },
    });

    expect(formatSemgrepAdvisoryText(advisory)).toContain(
      "semgrep --version probe stopped at the 1234ms subprocess cap; scan never started",
    );
  });

  it("discloses a failed run as a degradation while keeping the engine present", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: {
        ok: false,
        reason: "run-failed",
        error: "semgrep exited 2: bad config",
        tool: TOOL,
        caps: CAPS,
      },
    });

    expect(advisory.prerequisites[0]).toMatchObject({ name: "semgrep engine", satisfied: true });
    expect(advisory.degradations).toEqual([
      "semgrep run failed before producing a report: semgrep exited 2: bad config",
    ]);
    expect(
      advisory.caps.find((cap) => cap.label === "semgrep subprocess wall-clock (ms)")?.hit,
    ).toBe(false);
    expect(advisory.sections[0]?.emptyReason).toBe(
      "semgrep produced no candidate groups (the run failed).",
    );
  });

  it("aggregates malformed result rows and caps scan-error degradations", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(
        scan([finding()], {
          malformedResultCount: 2,
          errors: Array.from({ length: 7 }, (_, index) => ({
            message: `boom ${index}`,
            level: "warn",
            type: "PartialParsing",
            path: `src/${index}.ts`,
          })),
        }),
      ),
    });

    expect(advisory.degradations[0]).toBe(
      "semgrep returned 2 malformed result rows; they are not in the candidate groups",
    );
    expect(
      advisory.degradations.filter((line) => line.startsWith("semgrep scan error")),
    ).toHaveLength(5);
    expect(advisory.degradations.at(-1)).toBe("...and 2 more semgrep scan errors");
  });

  it("discloses Semgrep's own target filters as section data and a scan-scope fact", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(scan([finding()])),
    });

    expect(advisory.sections[0]?.scanScope).toEqual({
      semgrepTargetFilters: "default",
      targetSemgrepignore: false,
    });
    expect(formatSemgrepAdvisoryText(advisory)).toContain(
      "scan scope: Semgrep target filters applied (default patterns plus target .gitignore/.semgrepignore)",
    );
    expect(advisory.degradations).toEqual([]);
  });

  it("discloses a target-supplied .semgrepignore as a scan-shaping degradation", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: true,
      run: okRun(scan([finding()])),
    });

    expect(advisory.sections[0]?.scanScope).toEqual({
      semgrepTargetFilters: "default",
      targetSemgrepignore: true,
    });
    expect(advisory.degradations).toContain(
      "the target's own .semgrepignore file(s) further excluded paths from this scan, " +
        "beyond the drift ignore --exclude flags",
    );
  });

  it("makes no scan-scope claims when no completed scan backs the section", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: true,
      run: {
        ok: false,
        reason: "run-failed",
        error: "semgrep exited 2: bad config",
        tool: TOOL,
        caps: CAPS,
      },
    });

    expect(advisory.sections[0]?.scanScope).toBeNull();
    expect(formatSemgrepAdvisoryText(advisory)).not.toContain("scan scope:");
    expect(advisory.degradations.some((line) => line.includes(".semgrepignore"))).toBe(false);
  });

  it("explains an empty completed scan without pretending the repo was clear", () => {
    const advisory = buildSemgrepAdvisory({
      ruleSources: gate([MIT_PINNED]),
      targetHasSemgrepignore: false,
      run: okRun(scan([])),
    });

    expect(advisory.sections[0]).toMatchObject({
      totalCandidates: 0,
      entries: [],
      emptyReason: "semgrep reported no matches from the allowed rule sources.",
    });
    expect(advisory.prerequisites[0]).toMatchObject({ name: "semgrep engine", satisfied: true });
  });
});

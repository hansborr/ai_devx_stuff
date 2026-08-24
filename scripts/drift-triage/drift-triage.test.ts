import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DRIFT_SCHEMA_VERSION } from "../drift-ai/types.js";
import { parseArgs, runDriftTriage } from "../drift-triage.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { CLI_OPTIONS, cliOptionsSchema, DriftTriageHelp } from "./drift-triage-options.js";
import { resolveRepoProvenance } from "./drift-triage-packet-io.js";

const tmpRepo = registerTempRootCleanup();

const CLEAN_DRIFT_REPORT = JSON.stringify({
  schemaVersion: DRIFT_SCHEMA_VERSION,
  skippedChecks: [],
  findings: [
    {
      check: "module-doc-paths",
      file: "src/MODULE.md:10",
      message: "stale path",
      hint: "update it",
    },
  ],
});

describe("parseArgs", () => {
  it("parses report inputs and triage policy flags", () => {
    expect(
      parseArgs([
        "--format",
        "json",
        "--output",
        "triage.json",
        "--include-literals",
        "--include-type-only-cycles",
        "--min-clone-fragment",
        "30",
        "drift.json",
      ]),
    ).toEqual({
      inputs: ["drift.json"],
      format: "json",
      output: "triage.json",
      includeLiterals: true,
      includeTypeOnlyCycles: true,
      minCloneFragment: 30,
      packetDir: undefined,
      packetSize: 20,
      packetFilters: {
        priorities: [],
        categories: [],
        sources: [],
        pathPrefixes: [],
      },
    });
  });

  it("parses swarm packet output and selection filters", () => {
    expect(
      parseArgs([
        "--packet-dir",
        "packets",
        "--packet-size",
        "12",
        "--priority",
        "review-first",
        "--category",
        "security",
        "--source",
        "semgrep",
        "--path-prefix",
        "packages/server/",
        "drift.json",
      ]),
    ).toMatchObject({
      packetDir: "packets",
      packetSize: 12,
      packetFilters: {
        priorities: ["review-first"],
        categories: ["security"],
        sources: ["semgrep"],
        pathPrefixes: ["packages/server/"],
      },
    });
  });

  it("names the first packet-selection flag seen in argv order in the --packet-dir error", () => {
    expect(() =>
      parseArgs(["--category", "clone", "--priority", "review-first", "drift.json"]),
    ).toThrow("--category requires --packet-dir.");
    expect(() =>
      parseArgs(["--priority", "review-first", "--category", "clone", "drift.json"]),
    ).toThrow("--priority requires --packet-dir.");
  });

  it("declares the same option names in the parseCli array and the Zod schema", () => {
    const optionNames = CLI_OPTIONS.map((option) => option.name);
    expect(new Set(optionNames).size).toBe(optionNames.length);
    expect([...optionNames].sort()).toEqual([...Object.keys(cliOptionsSchema.shape)].sort());
  });

  it("mentions every declared option in the usage text", () => {
    const usage = new DriftTriageHelp().message;
    for (const option of CLI_OPTIONS) {
      expect(usage).toContain(option.name);
    }
  });
});

describe("runDriftTriage", () => {
  it("probes the whole repository when packet provenance is captured from a nested directory", () => {
    const repoRoot = tmpRepo.makeTmpGitRepo("drift-triage-provenance-");
    tmpRepo.writeRepoFile(repoRoot, "outside.ts", "export const value = 'clean';\n");
    execFileSync("git", ["add", "outside.ts"], { cwd: repoRoot });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base"],
      { cwd: repoRoot },
    );
    const nested = path.join(repoRoot, "packages/server");
    mkdirSync(nested, { recursive: true });
    tmpRepo.writeRepoFile(repoRoot, "outside.ts", "export const value = 'dirty';\n");
    const originalCwd = process.cwd();

    try {
      process.chdir(nested);
      const before = resolveRepoProvenance(["generated-report.json"]);
      tmpRepo.writeRepoFile(repoRoot, "outside.ts", "export const value = 'different dirt';\n");
      const after = resolveRepoProvenance(["generated-report.json"]);
      expect(before.gitDirty).toBe(true);
      expect(before.stateFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(after).toMatchObject({ gitHead: before.gitHead, gitDirty: true });
      expect(after.stateFingerprint).not.toBe(before.stateFingerprint);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("writes a machine-readable handoff report", () => {
    const writeFile = vi.fn();
    const result = runDriftTriage({
      argv: ["--format", "json", "--output", "triage.json", "drift.json"],
      readFile: () => CLEAN_DRIFT_REPORT,
      writeFile,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("drift:triage: wrote json report to triage.json");
    expect(result.report?.summary.reviewItems).toBe(1);
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      "triage.json",
      expect.stringContaining('"kind": "drift-triage"'),
    );
  });

  it("writes deterministic swarm packets and a manifest after triage", () => {
    const writeFile = vi.fn();
    const result = runDriftTriage({
      argv: ["--packet-dir", "packets", "--packet-size", "1", "drift.json"],
      readFile: () => CLEAN_DRIFT_REPORT,
      writeFile,
      repoProvenance: () => ({ gitHead: "abc123", gitDirty: false }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("drift:triage: wrote 1 swarm packet and manifest to packets");
    expect(result.packetBundle?.manifest).toMatchObject({
      provenance: {
        gitHead: "abc123",
        gitDirty: false,
      },
      selection: { totalItems: 1, selectedItems: 1, excludedItems: 0 },
    });
    expect(result.packetBundle?.manifest.provenance.inputHashes[0]).toMatchObject({
      path: "drift.json",
    });
    expect(result.packetBundle?.manifest.provenance.inputHashes[0]?.sha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(writeFile).toHaveBeenCalledWith(
      "packets/packet-001.json",
      expect.stringContaining('"kind": "drift-triage-packet"'),
    );
    expect(writeFile).toHaveBeenLastCalledWith(
      "packets/manifest.json",
      expect.stringContaining('"kind": "drift-triage-packet-manifest"'),
    );
  });

  it("excludes in-repo advisory and packet artifacts from the packet dirty-state probe", () => {
    const repoProvenance = vi.fn((excludedPaths: readonly string[] = []) => ({
      gitHead: "abc123",
      gitDirty:
        !excludedPaths.includes("drift-all.json") ||
        !excludedPaths.includes("semgrep-candidates.json") ||
        !excludedPaths.includes("dolos-candidates.json"),
    }));
    const result = runDriftTriage({
      argv: ["--packet-dir", "packets", "semgrep-candidates.json"],
      readFile: () =>
        JSON.stringify({
          kind: "advisory",
          lane: "prototype",
          subcommand: "semgrep-candidates",
          scanProvenance: {
            gitHead: "abc123",
            gitDirty: false,
            changedDuringScan: false,
          },
          prerequisites: [],
          degradations: [],
          caps: [],
          sections: [
            {
              totalCandidates: 1,
              entries: [
                {
                  rank: 1,
                  candidateSource: "semgrep",
                  checkId: "rules.example",
                  path: "src/auth.ts",
                  count: 1,
                  ranges: [{ startLine: 1, startCol: 1, endLine: 1, endCol: 10 }],
                  severity: "WARNING",
                  message: null,
                  metadata: {},
                },
              ],
            },
          ],
        }),
      readSourceFile: () => "const auth = true;\n",
      writeFile: vi.fn(),
      repoProvenance,
    });

    expect(repoProvenance).toHaveBeenCalledWith([
      "drift-all.json",
      "semgrep-candidates.json",
      "dolos-candidates.json",
      "packets",
    ]);
    expect(result.packetBundle?.packets[0]?.disclosures.staleAdvisories).toEqual([]);
  });

  it("rejects packet selection flags without a packet directory", () => {
    const result = runDriftTriage({ argv: ["--priority", "review-first", "drift.json"] });

    expect(result).toMatchObject({ exitCode: 2 });
    expect(result.stdout).toContain("--priority requires --packet-dir");
  });

  it("renders a concise text report to stdout by default", () => {
    const result = runDriftTriage({
      argv: ["drift.json"],
      readFile: () => CLEAN_DRIFT_REPORT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:triage — 1 review item from 1 displayed row");
    expect(result.stdout).toContain("[review-first] maintenance: stale path");
    expect(result.stdout).toContain("drift:module-doc-paths (drift.json row 1)");
    expect(result.stdout).not.toContain("drift:module-doc-paths (drift.json row 1): stale path");
  });

  it("keeps non-test literals in the queue with --include-literals", () => {
    const result = runDriftTriage({
      argv: ["--include-literals", "drift.json"],
      readFile: () =>
        JSON.stringify({
          schemaVersion: DRIFT_SCHEMA_VERSION,
          skippedChecks: [],
          findings: [
            {
              check: "duplicate-literals",
              file: "src/a.ts:1-1",
              message: "literal repeated",
              relatedFiles: ["src/b.ts:2-2"],
            },
          ],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report?.summary).toMatchObject({ reviewItems: 1, deferredRows: 0 });
  });

  it("keeps type-only cycles in the queue with --include-type-only-cycles", () => {
    const result = runDriftTriage({
      argv: ["--include-type-only-cycles", "drift.json"],
      readFile: () =>
        JSON.stringify({
          schemaVersion: DRIFT_SCHEMA_VERSION,
          skippedChecks: [],
          findings: [
            {
              check: "import-cycles",
              file: "src/a.ts",
              message: "type-only cycle",
              relatedFiles: ["src/b.ts"],
              details: { typeOnly: true },
            },
          ],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report?.summary).toMatchObject({ reviewItems: 1, deferredRows: 0 });
  });

  it("discloses unmet advisory prerequisites in text output", () => {
    const result = runDriftTriage({
      argv: ["semgrep.json"],
      readFile: () =>
        JSON.stringify({
          kind: "advisory",
          lane: "prototype",
          subcommand: "semgrep-candidates",
          prerequisites: [
            {
              name: "semgrep engine",
              satisfied: false,
              detail: "semgrep was not available on PATH",
            },
          ],
          degradations: [],
          caps: [],
          sections: [{ totalCandidates: 0, entries: [] }],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "unmet prerequisite semgrep engine: semgrep was not available on PATH",
    );
  });

  it("discloses skipped drift checks in text output", () => {
    const result = runDriftTriage({
      argv: ["drift.json"],
      readFile: () =>
        JSON.stringify({
          schemaVersion: DRIFT_SCHEMA_VERSION,
          skippedChecks: [{ check: "duplicates", reason: "jscpd was not installed" }],
          findings: [],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skipped check duplicates: jscpd was not installed");
  });

  it("discloses drift scope, roots, and enabled checks in text output", () => {
    const result = runDriftTriage({
      argv: ["drift.json"],
      readFile: () =>
        JSON.stringify({
          schemaVersion: DRIFT_SCHEMA_VERSION,
          scopeMode: "changed",
          roots: ["packages/server/src"],
          enabledChecks: ["duplicates"],
          skippedChecks: [],
          findings: [],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("scope changed");
    expect(result.stdout).toContain("roots packages/server/src");
    expect(result.stdout).toContain("enabled checks duplicates");
  });

  it("discloses advisory cap and degradation reasons even with zero rows", () => {
    const result = runDriftTriage({
      argv: ["dolos.json"],
      readFile: () =>
        JSON.stringify({
          kind: "advisory",
          lane: "prototype",
          subcommand: "dolos-candidates",
          prerequisites: [],
          degradations: ["Dolos timed out before returning candidates"],
          caps: [
            {
              label: "reported pairs",
              limit: 1000,
              hit: true,
              detail: "stopped at 1000 pairs",
            },
          ],
          sections: [{ totalCandidates: 0, entries: [] }],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hit cap reported pairs: stopped at 1000 pairs");
    expect(result.stdout).toContain("degradation: Dolos timed out before returning candidates");
  });

  it("returns a tool error for unreadable or malformed inputs", () => {
    const unreadable = runDriftTriage({
      argv: ["missing.json"],
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    const malformed = runDriftTriage({
      argv: ["bad.json"],
      readFile: () => "not json",
    });

    expect(unreadable).toMatchObject({ exitCode: 2 });
    expect(unreadable.stdout).toContain("missing.json: could not read");
    expect(malformed).toMatchObject({ exitCode: 2 });
    expect(malformed.stdout).toContain("bad.json: not valid JSON");
  });

  it("returns a tool error for an unsupported --format value", () => {
    const result = runDriftTriage({ argv: ["--format", "yaml", "drift.json"] });

    expect(result).toMatchObject({ exitCode: 2 });
    expect(result.stdout).toContain("--format requires text or json");
  });

  it.each(["-1", "many", "9".repeat(400)])(
    "returns a tool error for bad --min-clone-fragment value %s",
    (value) => {
      const result = runDriftTriage({
        argv: ["--min-clone-fragment", value, "drift.json"],
      });

      expect(result).toMatchObject({ exitCode: 2 });
      expect(result.stdout).toContain("--min-clone-fragment requires a non-negative number");
    },
  );

  it("returns a tool error when the output report cannot be written", () => {
    const result = runDriftTriage({
      argv: ["--output", "triage.json", "drift.json"],
      readFile: () => CLEAN_DRIFT_REPORT,
      writeFile: () => {
        throw new Error("EACCES");
      },
    });

    expect(result).toEqual({
      exitCode: 2,
      stdout: "triage.json: could not write report: EACCES",
    });
  });
});

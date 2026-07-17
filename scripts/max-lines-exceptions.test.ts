import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { maxLinesPolicy } from "../eslint-config/shared-policy.js";
import { maxLinesPolicy as validatedMaxLinesPolicy } from "./lib/max-lines-policy.js";
import { computeEffectiveLineCount } from "./max-lines-effective-lines.js";
import { runMaxLinesExceptionsCli, type SourceRead } from "./max-lines-exceptions.js";
import {
  checkMaxLinesExceptionsBaseline,
  diffMaxLinesExceptions,
  formatMaxLinesExceptionsBaseline,
  makeMaxLinesExceptionEntry,
  type MaxLinesExceptionEntry,
  maxLinesExceptionsSpec,
  parseMaxLinesEntriesForUpdate,
  readMaxLinesExceptionsBaseline,
} from "./max-lines-exceptions-core.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const repoRoot = resolve(import.meta.dirname, "..");
const committedBaselinePath = resolve(repoRoot, "eslint-config/max-lines-exceptions.baseline.json");
const tmpRepo = registerTempRootCleanup();
const DRIVER_WARN =
  "WARN: max-lines exceptions merge driver is missing or stale - run bun run lint:max-lines-exceptions:install-merge-driver";
const CONFLICT_MARKER_TRIPWIRE =
  "eslint-config/max-lines-exceptions.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:max-lines-exceptions:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours eslint-config/max-lines-exceptions.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then reconcile entries from both sides and normalize with `bun run lint:max-lines-exceptions:update`; never hand-merge conflict markers in this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.";
const SUPPRESS_DRIVER_WARN_ENV = "MUSI_SUPPRESS_MERGE_DRIVER_WARN";

function loadSharedPolicyWithBaseline(text: string): SpawnSyncReturns<string> {
  const root = tmpRepo.makeTempRepo("shared-policy-baseline-");
  tmpRepo.writeRepoFile(root, "eslint-config/max-lines-exceptions.baseline.json", text);
  copyFileSync(
    resolve(repoRoot, "eslint-config/shared-policy.js"),
    resolve(root, "eslint-config/shared-policy.js"),
  );
  copyFileSync(
    resolve(repoRoot, "eslint-config/config-surfaces.js"),
    resolve(root, "eslint-config/config-surfaces.js"),
  );
  copyFileSync(
    resolve(repoRoot, "eslint-config/max-lines-exceptions-codec.js"),
    resolve(root, "eslint-config/max-lines-exceptions-codec.js"),
  );
  copyFileSync(
    resolve(repoRoot, "eslint-config/config-surface-manifest.json"),
    resolve(root, "eslint-config/config-surface-manifest.json"),
  );
  const moduleUrl = pathToFileURL(resolve(root, "eslint-config/shared-policy.js")).href;
  return spawnSync(
    "bun",
    [
      "--eval",
      `try { await import(${JSON.stringify(moduleUrl)}); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }`,
    ],
    { encoding: "utf8" },
  );
}

function entry(
  overrides: Partial<Parameters<typeof makeMaxLinesExceptionEntry>[0]> = {},
): MaxLinesExceptionEntry {
  return makeMaxLinesExceptionEntry({
    path: "packages/a.ts",
    cap: 400,
    severity: "warn",
    reason: "example reason for the cap",
    lifecycle: "candidate-for-split",
    ratchetExcluded: true,
    ...overrides,
  });
}

describe("maxLinesExceptionsSpec format/parse", () => {
  it("sorts by path and derives the summary count", () => {
    const text = formatMaxLinesExceptionsBaseline([
      entry({ path: "packages/z.ts" }),
      entry({ path: "packages/a.ts" }),
    ]);
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toMatchObject({
      version: 2,
      tool: "eslint-max-lines",
      metric: "file-line-cap-exceptions",
      summary: { count: 2 },
    });
    const paths = readMaxLinesExceptionsBaseline(text);
    expect(paths.ok).toBe(true);
    if (paths.ok)
      expect(paths.value.map((e) => e.path)).toEqual(["packages/a.ts", "packages/z.ts"]);
  });

  it("round-trips an entry's cap and metadata", () => {
    const original = entry({
      path: "packages/b.ts",
      cap: 512,
      severity: "error",
      lifecycle: "permanent",
    });
    const parsed = readMaxLinesExceptionsBaseline(formatMaxLinesExceptionsBaseline([original]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value[0]).toEqual(original);
  });

  it.each([
    {
      name: "missing cap",
      raw: {
        path: "a.ts",
        severity: "warn",
        reason: "r",
        lifecycle: "permanent",
        ratchetExcluded: true,
      },
      error: "cap must be a positive integer",
    },
    {
      name: "bad severity",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "info",
        reason: "r",
        lifecycle: "permanent",
        ratchetExcluded: true,
      },
      error: 'severity must be "error" or "warn"',
    },
    {
      name: "empty reason",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "warn",
        reason: "  ",
        lifecycle: "permanent",
        ratchetExcluded: true,
      },
      error: "reason must be a non-empty string",
    },
    {
      name: "bad lifecycle",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "warn",
        reason: "r",
        lifecycle: "someday",
        ratchetExcluded: true,
      },
      error: "lifecycle is invalid",
    },
    {
      name: "non-bool ratchetExcluded",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "warn",
        reason: "r",
        lifecycle: "permanent",
        ratchetExcluded: "yes",
      },
      error: "ratchetExcluded must be a boolean",
    },
  ])("rejects $name", ({ raw, error }) => {
    const result = maxLinesExceptionsSpec.parseEntry(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(error);
  });
});

describe("count-aware diff (gateEntries) over caps", () => {
  it("passes when caps are identical", () => {
    const set = [entry({ path: "a.ts", cap: 400 }), entry({ path: "b.ts", cap: 300 })];
    expect(diffMaxLinesExceptions(set, set).status).toBe("ok");
  });

  it("flags a raised cap as a regression and a lowered cap as an improvement", () => {
    const baseline = [entry({ path: "a.ts", cap: 400 })];
    expect(diffMaxLinesExceptions(baseline, [entry({ path: "a.ts", cap: 450 })])).toMatchObject({
      status: "regressed",
      increased: ["a.ts"],
    });
    expect(diffMaxLinesExceptions(baseline, [entry({ path: "a.ts", cap: 350 })])).toMatchObject({
      status: "improved",
      decreased: ["a.ts"],
    });
  });

  it("flags an added or removed exception path", () => {
    const baseline = [entry({ path: "a.ts" })];
    expect(
      diffMaxLinesExceptions(baseline, [entry({ path: "a.ts" }), entry({ path: "b.ts" })]),
    ).toMatchObject({
      status: "regressed",
      added: ["b.ts"],
    });
  });
});

describe("checkMaxLinesExceptionsBaseline / --update", () => {
  function makeDriverFixture(): { readonly root: string; readonly baselinePath: string } {
    const root = tmpRepo.makeTmpGitRepo("max-lines-driver-presence-");
    const baselinePath = join(root, "eslint-config/max-lines-exceptions.baseline.json");
    tmpRepo.writeRepoFile(
      root,
      "eslint-config/max-lines-exceptions.baseline.json",
      formatMaxLinesExceptionsBaseline([entry()]),
    );
    // The entry's file must exist and stay under cap, or the cap audit would add
    // a dead-entry / cap-below warning and break the merge-driver-only assertions.
    tmpRepo.writeRepoFile(root, "packages/a.ts", "export const a = 1;\n");
    tmpRepo.writeRepoFile(root, "scripts/git/.gitkeep", "");
    copyFileSync(
      join(repoRoot, "scripts/git/baseline-merge-driver.sh"),
      join(root, "scripts/git/baseline-merge-driver.sh"),
    );
    return { root, baselinePath };
  }

  it("rejects unknown and conflicting CLI options with usage", () => {
    for (const argv of [["--updat"], ["--update", "--help"], ["--update", "--update"]]) {
      const result = runMaxLinesExceptionsCli({
        argv,
        baselinePath: "/baseline-is-not-read.json",
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("Usage:");
    }
  });

  it("prints help without reading or checking the baseline", () => {
    const result = runMaxLinesExceptionsCli({
      argv: ["--help"],
      baselinePath: "/baseline-does-not-exist.json",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).not.toContain("baseline missing");
  });

  it("accepts --check as an explicit alias for default check mode", () => {
    const fixture = makeDriverFixture();
    const implicit = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: fixture.baselinePath,
      cwd: fixture.root,
    });
    const explicit = runMaxLinesExceptionsCli({
      argv: ["--check"],
      baselinePath: fixture.baselinePath,
      cwd: fixture.root,
    });

    expect(explicit).toEqual(implicit);
    expect(explicit.exitCode).toBe(0);
  });

  it("warns once in check and update modes when the merge driver is missing", () => {
    const fixture = makeDriverFixture();
    const warnings: string[] = [];

    const check = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: fixture.baselinePath,
      cwd: fixture.root,
      warn: (line) => warnings.push(line),
    });
    expect(check.exitCode).toBe(0);
    expect(check.stdout).not.toContain(DRIVER_WARN);
    expect(warnings).toEqual([DRIVER_WARN]);

    warnings.length = 0;
    const update = runMaxLinesExceptionsCli({
      argv: ["--update"],
      baselinePath: fixture.baselinePath,
      cwd: fixture.root,
      warn: (line) => warnings.push(line),
    });
    expect(update.exitCode).toBe(0);
    expect(update.stdout).not.toContain(DRIVER_WARN);
    expect(warnings).toEqual([DRIVER_WARN]);
  });

  it("stays silent when the merge driver is installed or warning probes are suppressed", () => {
    const fixture = makeDriverFixture();
    execFileSync(
      "bash",
      [join(repoRoot, "scripts/git/install-max-lines-exceptions-merge-driver.sh")],
      { cwd: fixture.root, stdio: "ignore" },
    );
    const installedWarnings: string[] = [];
    expect(
      runMaxLinesExceptionsCli({
        argv: [],
        baselinePath: fixture.baselinePath,
        cwd: fixture.root,
        warn: (line) => installedWarnings.push(line),
      }).exitCode,
    ).toBe(0);
    expect(installedWarnings).toEqual([]);

    const ciFixture = makeDriverFixture();
    const ciWarnings: string[] = [];
    expect(
      runMaxLinesExceptionsCli({
        argv: [],
        baselinePath: ciFixture.baselinePath,
        cwd: ciFixture.root,
        env: { CI: "1" },
        warn: (line) => ciWarnings.push(line),
      }).exitCode,
    ).toBe(0);
    expect(ciWarnings).toEqual([]);

    const suppressedWarnings: string[] = [];
    expect(
      runMaxLinesExceptionsCli({
        argv: [],
        baselinePath: ciFixture.baselinePath,
        cwd: ciFixture.root,
        env: { [SUPPRESS_DRIVER_WARN_ENV]: "1" },
        warn: (line) => suppressedWarnings.push(line),
      }).exitCode,
    ).toBe(0);
    expect(suppressedWarnings).toEqual([]);
  });

  it("accepts a freshly formatted baseline", () => {
    const text = formatMaxLinesExceptionsBaseline([
      entry({ path: "a.ts" }),
      entry({ path: "b.ts" }),
    ]);
    expect(checkMaxLinesExceptionsBaseline(text)).toEqual({ ok: true });
  });

  it("prints merge-driver recovery in check and update modes for conflict markers", () => {
    const baselinePath = join(tmpRepo.makeTempRepo(), "baseline.json");
    writeFileSync(
      baselinePath,
      '<<<<<<< ours\n{"version":2}\n=======\n{"version":2}\n>>>>>>> theirs\n',
    );

    for (const argv of [[], ["--update"]]) {
      const result = runMaxLinesExceptionsCli({ argv, baselinePath });
      expect(result).toEqual({ exitCode: 2, stdout: `ERROR: ${CONFLICT_MARKER_TRIPWIRE}` });
    }
  });

  it("makes shared-policy parse failures actionable without changing fail-loud behavior", () => {
    const conflict = loadSharedPolicyWithBaseline(
      '<<<<<<< ours\n{"version":2}\n=======\n{"version":2}\n>>>>>>> theirs\n',
    );
    expect(conflict.status).toBe(1);
    expect(conflict.stderr.trim()).toBe(CONFLICT_MARKER_TRIPWIRE);

    const malformed = loadSharedPolicyWithBaseline("{");
    expect(malformed.status).toBe(1);
    expect(malformed.stderr.trim()).toBe(
      "Could not read or parse eslint-config/max-lines-exceptions.baseline.json; regenerate with `bun run lint:max-lines-exceptions:update`.",
    );
  });

  it("fails the live config load on an entry the --check gate would reject (shared codec)", () => {
    // An entry whose lifecycle is outside the permitted enum: the gate spec
    // rejects it, and now so does the config-load-time reader, because both
    // validate entries through eslint-config/max-lines-exceptions-codec.js. The
    // hand-written JS reader used to accept any string here.
    const badRawEntry = {
      path: "a.ts",
      cap: 400,
      severity: "warn",
      reason: "r",
      lifecycle: "someday",
      ratchetExcluded: true,
    };
    expect(maxLinesExceptionsSpec.parseEntry(badRawEntry).ok).toBe(false);

    const badLifecycle = JSON.stringify(
      {
        version: 2,
        tool: "eslint-max-lines",
        metric: "file-line-cap-exceptions",
        summary: { count: 1 },
        entries: [badRawEntry],
      },
      null,
      2,
    );
    const loaded = loadSharedPolicyWithBaseline(badLifecycle);
    expect(loaded.status).toBe(1);
    expect(loaded.stderr).toContain("lifecycle is invalid");
  });

  it("rejects an un-normalized baseline (stale summary) but --update tolerates and fixes it", () => {
    const staleSummary = JSON.stringify(
      {
        version: 2,
        tool: "eslint-max-lines",
        metric: "file-line-cap-exceptions",
        summary: { count: 99 },
        entries: [
          {
            path: "a.ts",
            cap: 400,
            severity: "warn",
            reason: "r",
            lifecycle: "permanent",
            ratchetExcluded: true,
          },
        ],
      },
      null,
      2,
    );
    expect(checkMaxLinesExceptionsBaseline(staleSummary).ok).toBe(false);

    const forUpdate = parseMaxLinesEntriesForUpdate(staleSummary);
    expect(forUpdate.ok).toBe(true);
    if (forUpdate.ok) {
      const normalized = formatMaxLinesExceptionsBaseline(forUpdate.value);
      expect(checkMaxLinesExceptionsBaseline(normalized)).toEqual({ ok: true });
    }
  });

  it("--update rewrites a denormalized file and --check then passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "max-lines-exceptions-"));
    const baselinePath = join(dir, "baseline.json");
    // Shuffled entries + wrong summary count: not normalized.
    writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 2,
        tool: "eslint-max-lines",
        metric: "file-line-cap-exceptions",
        summary: { count: 0 },
        entries: [
          {
            path: "z.ts",
            cap: 500,
            severity: "error",
            reason: "r",
            lifecycle: "permanent",
            ratchetExcluded: true,
          },
          {
            path: "a.ts",
            cap: 400,
            severity: "warn",
            reason: "r",
            lifecycle: "permanent",
            ratchetExcluded: true,
          },
        ],
      }),
    );

    expect(runMaxLinesExceptionsCli({ argv: [], baselinePath }).exitCode).toBe(2);
    const updated = runMaxLinesExceptionsCli({ argv: ["--update"], baselinePath });
    expect(updated.exitCode).toBe(0);
    expect(runMaxLinesExceptionsCli({ argv: [], baselinePath }).exitCode).toBe(0);
    const parsed = readMaxLinesExceptionsBaseline(readFileSync(baselinePath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.map((e) => e.path)).toEqual(["a.ts", "z.ts"]);
  });
});

describe("computeEffectiveLineCount", () => {
  const counting = maxLinesPolicy.counting;

  it("counts through the rule's own path: skips blank and comment-only lines", () => {
    const source =
      "// header comment\nconst a = 1;\n\nconst b = 2;\n/* block\n   comment */\nconst c = 3;\n";
    expect(computeEffectiveLineCount("m.ts", source, counting)).toBe(3);
  });

  it("parses .tsx (jsx) sources", () => {
    expect(computeEffectiveLineCount("m.tsx", "const x = <div>hi</div>;\n", counting)).toBe(1);
  });

  it("returns undefined for an unparseable file (ESLint itself is the gate)", () => {
    expect(computeEffectiveLineCount("m.ts", "const = ;", counting)).toBeUndefined();
  });
});

describe("cap-vs-effective audit", () => {
  const THREE_EFFECTIVE = "// c\nconst a = 1;\n\nconst b = 2;\nconst c = 3;\n";
  const ONE_EFFECTIVE = "export const a = 1;\n";
  const content = (text: string): SourceRead => ({ kind: "content", text });

  function writeBaseline(entries: readonly MaxLinesExceptionEntry[]): string {
    const dir = mkdtempSync(join(tmpdir(), "max-lines-audit-"));
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, formatMaxLinesExceptionsBaseline([...entries]));
    return baselinePath;
  }

  it("routes cap-below detail and summary through stderr, keeping stdout a clean OK", () => {
    const baselinePath = writeBaseline([entry({ path: "big.ts", cap: 1 })]);
    const warnings: string[] = [];
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath,
      sourceRoot: "/src",
      readSource: (p) => (p.endsWith("big.ts") ? content(THREE_EFFECTIVE) : { kind: "missing" }),
      warn: (line) => warnings.push(line),
    });
    expect(result.exitCode).toBe(0);
    // No warning text leaks into the nominal success output.
    expect(result.stdout).toBe(
      "OK: max-lines exceptions baseline is normalized and framework-valid",
    );
    expect(warnings).toEqual([
      "WARN: big.ts cap 1 is below its current 3 effective lines — raise the cap in eslint-config/max-lines-exceptions.baseline.json (then run 'bun run lint:max-lines-exceptions:update' to normalize) or split the file.",
      "WARN: 1 cap(s) below current effective lines — ESLint local/max-lines will fail on these files.",
    ]);
  });

  it("warns about a dead entry only for an ENOENT-missing file", () => {
    const baselinePath = writeBaseline([entry({ path: "gone.ts", cap: 400 })]);
    const warnings: string[] = [];
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath,
      sourceRoot: "/src",
      readSource: () => ({ kind: "missing" }),
      warn: (line) => warnings.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "OK: max-lines exceptions baseline is normalized and framework-valid",
    );
    expect(warnings).toEqual([
      "WARN: gone.ts has a max-lines exception but no file exists on disk — remove the dead entry (ESLint local/max-lines will never flag it).",
      "WARN: 1 exception path(s) missing on disk — remove the dead entry.",
    ]);
  });

  it("warns about a read failure (not a dead entry) for a non-ENOENT error", () => {
    const baselinePath = writeBaseline([entry({ path: "locked.ts", cap: 400 })]);
    const warnings: string[] = [];
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath,
      sourceRoot: "/src",
      readSource: () => ({ kind: "unreadable", reason: "EACCES: permission denied" }),
      warn: (line) => warnings.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(warnings).toEqual([
      "WARN: locked.ts could not be read (EACCES: permission denied) — its cap was not checked; fix access or remove the entry if the file is gone.",
      "WARN: 1 exception path(s) could not be read — their caps were not checked.",
    ]);
    // A read failure must never be reported as a removable dead entry.
    expect(warnings.join("\n")).not.toContain("no file exists on disk");
  });

  it("distinguishes ENOENT from other errors in the real default reader", () => {
    // ENOENT → missing (dead entry); reading a directory → EISDIR → unreadable.
    const missing = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: writeBaseline([entry({ path: "does/not/exist.ts", cap: 9 })]),
      warn: () => {},
    });
    expect(missing.exitCode).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), "max-lines-eisdir-"));
    mkdirSync(join(dir, "adir"));
    const dirWarnings: string[] = [];
    runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: writeBaseline([entry({ path: "adir", cap: 9 })]),
      sourceRoot: dir,
      warn: (line) => dirWarnings.push(line),
    });
    // "adir" is a real directory; reading it is EISDIR, not ENOENT.
    expect(dirWarnings.some((w) => w.includes("adir could not be read"))).toBe(true);
    expect(dirWarnings.join("\n")).not.toContain("adir has a max-lines exception but no file");
  });

  it("emits a clean, unqualified OK with no warnings when every cap covers its file", () => {
    const baselinePath = writeBaseline([entry({ path: "small.ts", cap: 400 })]);
    const warnings: string[] = [];
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath,
      sourceRoot: "/src",
      readSource: (p) => (p.endsWith("small.ts") ? content(ONE_EFFECTIVE) : { kind: "missing" }),
      warn: (line) => warnings.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "OK: max-lines exceptions baseline is normalized and framework-valid",
    );
    expect(warnings).toEqual([]);
  });

  it("runs the same audit in --update mode", () => {
    const baselinePath = writeBaseline([entry({ path: "big.ts", cap: 1 })]);
    const warnings: string[] = [];
    const result = runMaxLinesExceptionsCli({
      argv: ["--update"],
      baselinePath,
      sourceRoot: "/src",
      readSource: (p) => (p.endsWith("big.ts") ? content(THREE_EFFECTIVE) : { kind: "missing" }),
      warn: (line) => warnings.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("max-lines-exceptions -- normalized 1 exception(s)");
    expect(warnings).toContain(
      "WARN: 1 cap(s) below current effective lines — ESLint local/max-lines will fail on these files.",
    );
  });
});

describe("generated-file exemption guard", () => {
  const GENERATED = "scripts/example/generated-table.ts";
  const GENERATOR = "scripts/example/generate-table.ts";
  const exemption = { path: GENERATED, generator: GENERATOR, reason: "generated table" } as const;
  const header = `// Generated by ${GENERATOR}. Do not edit by hand.\nexport const T = [] as const;\n`;
  const content = (text: string): SourceRead => ({ kind: "content", text });

  function writeBaseline(entries: readonly MaxLinesExceptionEntry[]): string {
    const dir = mkdtempSync(join(tmpdir(), "max-lines-exempt-"));
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, formatMaxLinesExceptionsBaseline([...entries]));
    return baselinePath;
  }

  it("passes when the exempt path is generator-owned (carries its header)", () => {
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: writeBaseline([entry({ path: "a.ts", cap: 400 })]),
      sourceRoot: "/src",
      readSource: (p) =>
        p.endsWith(GENERATED) ? content(header) : content("export const a = 1;\n"),
      generatedExemptions: [exemption],
      warn: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "OK: max-lines exceptions baseline is normalized and framework-valid",
    );
  });

  it("fails when an exempt path does not carry its generator header (authored file cannot opt out)", () => {
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: writeBaseline([entry({ path: "a.ts", cap: 400 })]),
      sourceRoot: "/src",
      readSource: () => content("export const handWritten = 1;\n"),
      generatedExemptions: [exemption],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("does not carry its generator header");
    expect(result.stdout).toContain("an authored file cannot opt itself out");
  });

  it("fails when an exempt path is missing on disk", () => {
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: writeBaseline([entry({ path: "a.ts", cap: 400 })]),
      sourceRoot: "/src",
      readSource: () => ({ kind: "missing" }),
      generatedExemptions: [exemption],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("is unreachable (no file exists on disk)");
  });

  it("fails when an exempt path also carries a redundant baseline cap entry", () => {
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: writeBaseline([entry({ path: GENERATED, cap: 400 })]),
      sourceRoot: "/src",
      readSource: () => content(header),
      generatedExemptions: [exemption],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("must not also carry a cap entry");
  });

  it("runs the guard in --update mode too", () => {
    const result = runMaxLinesExceptionsCli({
      argv: ["--update"],
      baselinePath: writeBaseline([entry({ path: "a.ts", cap: 400 })]),
      sourceRoot: "/src",
      readSource: () => content("export const handWritten = 1;\n"),
      generatedExemptions: [exemption],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("does not carry its generator header");
  });

  it("passes the guard on the real committed baseline and production exemptions", () => {
    const result = runMaxLinesExceptionsCli({
      argv: [],
      baselinePath: committedBaselinePath,
      generatedExemptions: validatedMaxLinesPolicy.generatedExemptions,
      warn: () => {},
    });
    expect(result.exitCode).toBe(0);
  });
});

describe("committed baseline", () => {
  it("is normalized and valid on disk", () => {
    expect(checkMaxLinesExceptionsBaseline(readFileSync(committedBaselinePath, "utf8"))).toEqual({
      ok: true,
    });
  });

  it("carries exactly the caps shared-policy.js exposes to eslint", () => {
    const parsed = readMaxLinesExceptionsBaseline(readFileSync(committedBaselinePath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // shared-policy.js is JS, so its exceptions array widens to any[] on import.
    const policyExceptions = maxLinesPolicy.exceptions as ReadonlyArray<
      Parameters<typeof makeMaxLinesExceptionEntry>[0]
    >;
    const fromPolicy = policyExceptions.map((exception) => makeMaxLinesExceptionEntry(exception));
    // No path added/removed and no cap moved between the JSON and what the eslint
    // config layer consumes: the count-aware gate proves the migration is exact.
    expect(diffMaxLinesExceptions(fromPolicy, parsed.value).status).toBe("ok");
  });
});

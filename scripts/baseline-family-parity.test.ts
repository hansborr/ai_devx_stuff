import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BASELINE_MERGE_CLI_TABLE } from "./baseline-merge-cli-table.js";
import { BASELINE_PATH_BY_DRIVER_KEY } from "./generate-baseline-conflict-recipes.js";
import { isRecord } from "./lib/records.js";

// This verify-time gate intentionally checks hand-authored surfaces instead of
// introducing a runtime registry. Field authorities are: family keys from
// baseline-drivers.sh, labels and CLI paths from baseline-merge-driver.sh, and
// committed baseline paths from baseline-post-merge-truth-up.sh. Every key must
// have an explicit policy here, so adding a family cannot inherit a default.
const FAMILY_POLICY_BY_KEY: Readonly<Record<string, "uniform" | "package-owned">> = {
  "lint-ratchet": "package-owned",
  "knip-unused-exports": "uniform",
  "near-duplicates": "uniform",
  "max-lines-exceptions": "uniform",
};

const repoRoot = resolve(import.meta.dirname, "..");
const gitScriptsRoot = join(repoRoot, "scripts/git");
const registryPath = join(gitScriptsRoot, "baseline-drivers.sh");
const driverPath = join(gitScriptsRoot, "baseline-merge-driver.sh");
const truthUpPath = join(gitScriptsRoot, "baseline-post-merge-truth-up.sh");

const registrySource = readFileSync(registryPath, "utf8");
const driverSource = readFileSync(driverPath, "utf8");
const truthUpSource = readFileSync(truthUpPath, "utf8");

function extractShellArray(source: string, variableName: string, surface: string): string[] {
  const pattern = new RegExp(`^${variableName}=\\(\\n([\\s\\S]*?)^\\)$`, "mu");
  const body = pattern.exec(source)?.[1];
  if (body === undefined) {
    throw new Error(`${surface}: could not extract ${variableName}`);
  }
  const items = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (items.length === 0 || items.some((item) => !/^[a-z0-9-]+$/u.test(item))) {
    throw new Error(`${surface}: ${variableName} must contain unquoted kebab-case keys`);
  }
  return items;
}

function findCaseArm(
  source: string,
  caseHeader: string,
  key: string,
  surface: string,
): string[] | undefined {
  const lines = source.split("\n");
  const caseStart = lines.findIndex((line) => line.trim() === caseHeader);
  if (caseStart === -1) {
    throw new Error(`${surface}: could not find \`${caseHeader}\``);
  }
  const caseEndOffset = lines.slice(caseStart + 1).findIndex((line) => line.trim() === "esac");
  if (caseEndOffset === -1) {
    throw new Error(`${surface}: \`${caseHeader}\` has no closing esac`);
  }
  const caseLines = lines.slice(caseStart + 1, caseStart + 1 + caseEndOffset);
  const armStart = caseLines.findIndex((line) => line.trim() === `${key})`);
  if (armStart === -1) return undefined;
  const armEndOffset = caseLines.slice(armStart + 1).findIndex((line) => line.trim() === ";;");
  if (armEndOffset === -1) {
    throw new Error(`${surface}: ${key} arm has no ;; terminator`);
  }
  return caseLines.slice(armStart + 1, armStart + 1 + armEndOffset);
}

function requireCaseArm(
  source: string,
  caseHeader: string,
  key: string,
  surface: string,
): string[] {
  const arm = findCaseArm(source, caseHeader, key, surface);
  if (arm === undefined) {
    throw new Error(`${surface}: missing ${key} case arm`);
  }
  return arm;
}

function extractAssignment(arm: readonly string[], variableName: string, surface: string): string {
  const pattern = new RegExp(`^\\s*${variableName}="([^"]+)"\\s*$`, "u");
  const value = arm
    .map((line) => pattern.exec(line)?.[1])
    .find((candidate) => candidate !== undefined);
  if (value === undefined) {
    throw new Error(`${surface}: missing ${variableName}="..." assignment`);
  }
  return value;
}

function readRequiredFile(relativePath: string, surface: string): string {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`${surface}: missing ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function extractInfoAttributesBaseline(source: string, surface: string): string {
  const matches = [
    ...source.matchAll(/^[A-Z][A-Z0-9_]*_INFO_ATTRIBUTES="\/([^"]+) merge=[^"]+"$/gmu),
  ];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(`${surface}: expected exactly one *_INFO_ATTRIBUTES baseline merge line`);
  }
  return matches[0][1];
}

function extractBunRunScript(command: string, surface: string): string {
  const scriptName = /^bun run ([^ ]+)$/u.exec(command)?.[1];
  if (scriptName === undefined) {
    throw new Error(
      `${surface}: expected an exact \`bun run <script>\` command, received ${command}`,
    );
  }
  return scriptName;
}

function packageScriptNames(): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
    throw new Error("package.json: expected a scripts object");
  }
  return new Set(Object.keys(parsed.scripts));
}

const driverKeys = extractShellArray(
  registrySource,
  "MUSI_BASELINE_DRIVERS",
  "scripts/git/baseline-drivers.sh",
);
const rootScriptNames = packageScriptNames();

function expectPackageScript(command: string, surface: string): void {
  const scriptName = extractBunRunScript(command, surface);
  expect(rootScriptNames.has(scriptName), `${surface}: package.json scripts.${scriptName}`).toBe(
    true,
  );
}

function expectUniformFamilyParity(key: string): void {
  const driverSurface = `scripts/git/baseline-merge-driver.sh (${key} descriptor arm)`;
  const driverArm = requireCaseArm(driverSource, 'case "$driver_key" in', key, driverSurface);
  const driverLabel = extractAssignment(driverArm, "driver_label", driverSurface);
  const semanticDriver = extractAssignment(driverArm, "semantic_driver", driverSurface);
  const installHint = extractAssignment(driverArm, "install_hint", driverSurface);

  const truthUpSurface = `scripts/git/baseline-post-merge-truth-up.sh (${key} metadata arm)`;
  const truthUpArm = requireCaseArm(
    truthUpSource,
    'case "$_MUSI_TRUTH_UP_KEY" in',
    key,
    truthUpSurface,
  );
  const truthUpLabel = extractAssignment(truthUpArm, "_tu_label", truthUpSurface);
  const baselinePath = extractAssignment(truthUpArm, "_tu_baseline_file", truthUpSurface);
  expect(truthUpLabel, `${key}: truth-up label must match the driver descriptor`).toBe(driverLabel);

  const cliEntry = Object.entries(BASELINE_MERGE_CLI_TABLE).find(
    ([entryKey]) => entryKey === key,
  )?.[1];
  expect(cliEntry, `${key}: BASELINE_MERGE_CLI_TABLE row`).toBeDefined();
  expect(cliEntry?.displayLabel, `${key}: CLI-table displayLabel`).toBe(driverLabel);
  expect(cliEntry?.cliPath, `${key}: CLI-table cliPath`).toBe(semanticDriver);
  expect(
    BASELINE_PATH_BY_DRIVER_KEY[key],
    `${key}: BASELINE_PATH_BY_DRIVER_KEY baseline path`,
  ).toBe(baselinePath);

  const libRelativePath = `scripts/git/${key}-merge-driver-lib.sh`;
  const installRelativePath = `scripts/git/install-${key}-merge-driver.sh`;
  const checkRelativePath = `scripts/git/check-${key}-merge-driver.sh`;
  const truthUpRelativePath = `scripts/git/${key}-post-merge-baseline-truth-up.sh`;
  const libSource = readRequiredFile(libRelativePath, `${key}: merge-driver lib`);
  const installSource = readRequiredFile(installRelativePath, `${key}: install shim`);
  const checkSource = readRequiredFile(checkRelativePath, `${key}: check shim`);
  readRequiredFile(truthUpRelativePath, `${key}: truth-up handler shim`);

  expect(
    extractInfoAttributesBaseline(libSource, `${key}: ${libRelativePath}`),
    `${key}: merge-driver lib info-attributes baseline`,
  ).toBe(baselinePath);

  for (const [relativePath, source] of [
    [installRelativePath, installSource],
    [checkRelativePath, checkSource],
  ] as const) {
    const surface = `${key}: ${relativePath}`;
    expect(extractAssignment(source.split("\n"), "MERGE_DRIVER_METRIC_LABEL", surface)).toBe(
      driverLabel,
    );
    const installCommand = extractAssignment(
      source.split("\n"),
      "MERGE_DRIVER_INSTALL_COMMAND",
      surface,
    );
    expect(installCommand, `${surface}: install command parity`).toBe(installHint);
    expectPackageScript(installCommand, `${surface}: MERGE_DRIVER_INSTALL_COMMAND`);
  }
  expectPackageScript(installHint, `${driverSurface}: install_hint`);
}

function expectPackageOwnedLintRatchetPolicy(key: string): void {
  const driverSurface = `scripts/git/baseline-merge-driver.sh (${key} tombstone arm)`;
  const driverArm = requireCaseArm(driverSource, 'case "$driver_key" in', key, driverSurface);
  const tombstone = driverArm.join("\n");
  const installScript = /registration is stale; migrate it with `bun run ([^` ]+)`\./u.exec(
    tombstone,
  )?.[1];
  expect(
    installScript,
    `${key}: tombstone must name its package-owned installer script`,
  ).toBeDefined();
  expect(
    tombstone,
    `${key}: tombstone must not restore repository-owned descriptor assignments`,
  ).not.toMatch(/^\s*(?:driver_label|semantic_driver|install_hint)=/mu);
  if (installScript !== undefined) {
    expect(
      rootScriptNames.has(installScript),
      `${key}: package.json scripts.${installScript}`,
    ).toBe(true);
  }

  const installRelativePath = `scripts/git/install-${key}-merge-driver.sh`;
  const checkRelativePath = `scripts/git/check-${key}-merge-driver.sh`;
  const truthUpRelativePath = `scripts/git/${key}-post-merge-baseline-truth-up.sh`;
  const installSource = readRequiredFile(installRelativePath, `${key}: package-owned install shim`);
  const checkSource = readRequiredFile(checkRelativePath, `${key}: package-owned check shim`);
  readRequiredFile(truthUpRelativePath, `${key}: package-owned truth-up shim`);

  expect(
    findCaseArm(
      truthUpSource,
      'case "$_MUSI_TRUTH_UP_KEY" in',
      key,
      "scripts/git/baseline-post-merge-truth-up.sh metadata case",
    ),
    `${key}: package migration must not restore the shared truth-up metadata arm`,
  ).toBeUndefined();
  expect(
    existsSync(join(gitScriptsRoot, `${key}-merge-driver-lib.sh`)),
    `${key}: package migration must not restore a repository merge-driver lib`,
  ).toBe(false);
  expect(
    Object.hasOwn(BASELINE_MERGE_CLI_TABLE, key),
    `${key}: package migration must not restore a repository CLI-table row`,
  ).toBe(false);
  expect(
    BASELINE_PATH_BY_DRIVER_KEY[key],
    `${key}: BASELINE_PATH_BY_DRIVER_KEY package baseline path`,
  ).toBe("lint-ratchet.baseline.json");
  for (const [relativePath, source] of [
    [installRelativePath, installSource],
    [checkRelativePath, checkSource],
  ] as const) {
    expect(
      source,
      `${key}: ${relativePath} must not restore repository-owned shim constants`,
    ).not.toMatch(/^MERGE_DRIVER_(?:METRIC_LABEL|INSTALL_COMMAND)=/mu);
  }
}

describe("baseline family metadata parity", () => {
  it("classifies every dispatched baseline family with an explicit policy", () => {
    expect(
      driverKeys.length,
      "scripts/git/baseline-drivers.sh: discovered baseline families",
    ).toBeGreaterThan(0);
    expect(
      Object.keys(FAMILY_POLICY_BY_KEY).sort(),
      "FAMILY_POLICY_BY_KEY must classify exactly the MUSI_BASELINE_DRIVERS keys",
    ).toEqual([...driverKeys].sort());
  });

  it("keeps every dispatched family aligned with its policy-owned surfaces", () => {
    expect.hasAssertions();
    for (const key of driverKeys) {
      const policy = FAMILY_POLICY_BY_KEY[key];
      if (policy === undefined) {
        throw new Error(`${key}: missing explicit FAMILY_POLICY_BY_KEY classification`);
      }
      if (policy === "uniform") {
        expectUniformFamilyParity(key);
      } else {
        expectPackageOwnedLintRatchetPolicy(key);
      }
    }
  });
});

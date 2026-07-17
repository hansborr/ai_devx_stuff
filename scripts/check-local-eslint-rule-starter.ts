// CI drift guard for the four-file standalone starter embedded in
// docs/guides/local-eslint-rules.md. This intentionally does not install the
// declared dependencies: the check is network-free and exercises the extracted
// files with the repository's pinned ESLint/Vitest toolchain instead. The
// package fence is still contract-checked so its advertised ESLint 10 and
// Vitest 4 ranges cannot drift away from the exercised compatibility family.
// The command fence is exact: `bun install` is validated as copyable guidance
// but deliberately not executed, while the test/lint commands are both run.
// The Standalone Starter section is intentionally a fail-closed five-fence
// boundary (four labeled files plus one command block): adding an unrelated
// fence inside the section requires updating this checker deliberately.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ESLint } from "eslint";

const GUIDE_PATH = "docs/guides/local-eslint-rules.md";
const STARTER_HEADING = "## Standalone Starter";
const FENCE_PREFIX = "```";
const EXPECTED_FILES = [
  { path: "package.json", language: "json" },
  { path: "eslint-rules/no-console-log.js", language: "js" },
  { path: "eslint.config.js", language: "js" },
  { path: "eslint-rules/no-console-log.test.js", language: "js" },
] as const;
const EXPECTED_COMMAND_LANGUAGE = "sh";
const STARTER_SCRIPT_NAMES = ["test", "lint"] as const;
const ESLINT_ERROR_SEVERITY = 2;
const EXPECTED_COMMAND_FENCE = [
  "bun install",
  ...STARTER_SCRIPT_NAMES.map((script) => `bun run ${script}`),
].join("\n");
type StarterScriptName = (typeof STARTER_SCRIPT_NAMES)[number];

export interface ExtractedStarterFile {
  readonly path: string;
  readonly content: string;
}

interface Fence {
  readonly language: string;
  readonly content: string;
  readonly precedingText: string;
}

function standaloneSection(source: string): string {
  const start = source.indexOf(STARTER_HEADING);
  if (start < 0) throw new Error(`missing ${STARTER_HEADING} section`);
  const nextHeading = source.indexOf("\n## ", start + STARTER_HEADING.length);
  return source.slice(start, nextHeading < 0 ? source.length : nextHeading);
}

function fencedBlocks(section: string): Fence[] {
  const lines = section.split("\n");
  const fences: Fence[] = [];
  let precedingStart = 0;
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const opening = lines[lineIndex];
    if (opening === undefined || !opening.startsWith(FENCE_PREFIX)) {
      lineIndex += 1;
      continue;
    }
    const language = opening.slice(FENCE_PREFIX.length);
    const content: string[] = [];
    const precedingText = lines.slice(precedingStart, lineIndex).join("\n");
    lineIndex += 1;
    while (lineIndex < lines.length && lines[lineIndex] !== "```") {
      const line = lines[lineIndex];
      if (line !== undefined) content.push(line);
      lineIndex += 1;
    }
    if (lineIndex >= lines.length) throw new Error(`unterminated ${language} fence`);
    fences.push({ language, content: `${content.join("\n")}\n`, precedingText });
    lineIndex += 1;
    precedingStart = lineIndex;
  }
  return fences;
}

export function extractStandaloneStarter(source: string): ExtractedStarterFile[] {
  const fences = fencedBlocks(standaloneSection(source));
  const expectedFenceCount = EXPECTED_FILES.length + 1;
  if (fences.length !== expectedFenceCount) {
    throw new Error(
      `expected ${String(expectedFenceCount)} fenced blocks in Standalone Starter, found ${String(fences.length)}`,
    );
  }

  const files = EXPECTED_FILES.map((expected, index) => {
    const fence = fences[index];
    if (fence === undefined) throw new Error(`missing fence for ${expected.path}`);
    if (!fence.precedingText.includes(`\`${expected.path}\``)) {
      throw new Error(`fence ${String(index + 1)} is not labeled ${expected.path}`);
    }
    if (fence.language !== expected.language) {
      throw new Error(`${expected.path} must use a ${expected.language} fence`);
    }
    return { path: expected.path, content: fence.content };
  });

  const commandFence = fences.at(-1);
  if (commandFence?.language !== EXPECTED_COMMAND_LANGUAGE) {
    throw new Error(`standalone exercise commands must use a ${EXPECTED_COMMAND_LANGUAGE} fence`);
  }
  if (commandFence.content.trimEnd() !== EXPECTED_COMMAND_FENCE) {
    throw new Error(`standalone exercise commands must be:\n${EXPECTED_COMMAND_FENCE}`);
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecordValue(record: Record<string, unknown>, key: string, expected: unknown): void {
  if (record[key] !== expected) {
    throw new Error(`package.json ${key} must be ${JSON.stringify(expected)}`);
  }
}

function assertPackageContract(packageSource: string): void {
  const parsed: unknown = JSON.parse(packageSource);
  if (!isRecord(parsed)) throw new Error("package.json fence must contain an object");
  expectRecordValue(parsed, "type", "module");
  expectRecordValue(parsed, "private", true);
  if (!isRecord(parsed.scripts)) throw new Error("package.json scripts must be an object");
  expectRecordValue(parsed.scripts, "lint", "eslint .");
  expectRecordValue(parsed.scripts, "test", "vitest run");
  if (!isRecord(parsed.devDependencies)) {
    throw new Error("package.json devDependencies must be an object");
  }
  expectRecordValue(parsed.devDependencies, "@eslint/js", "^10.0.0");
  expectRecordValue(parsed.devDependencies, "eslint", "^10.0.0");
  expectRecordValue(parsed.devDependencies, "vitest", "^4.0.0");
}

function runStarterCommand(tempRoot: string, script: StarterScriptName): void {
  const result = spawnSync("bun", ["run", script], { cwd: tempRoot, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `bun run ${script} failed in extracted starter:\n${result.stdout}${result.stderr}`,
    );
  }
}

async function assertRuleActivation(tempRoot: string): Promise<void> {
  const eslint = new ESLint({ cwd: tempRoot });
  const reportingResults = await eslint.lintText("console.log('ready');\n", {
    filePath: join(tempRoot, "activation-subject.js"),
  });
  const reportsDocumentedRule = reportingResults.some((result) =>
    result.messages.some(
      (message) =>
        message.ruleId === "local/no-console-log" && message.severity === ESLINT_ERROR_SEVERITY,
    ),
  );
  if (!reportsDocumentedRule) {
    throw new Error("local/no-console-log did not report console.log through eslint.config.js");
  }

  const cleanResults = await eslint.lintText("export const ready = true;\n", {
    filePath: join(tempRoot, "clean-subject.js"),
  });
  const cleanMessages = cleanResults.flatMap((result) => result.messages);
  if (cleanMessages.length > 0) {
    throw new Error(
      `clean synthetic subject produced ${String(cleanMessages.length)} ESLint message(s)`,
    );
  }
}

export async function checkStandaloneStarter(repoRoot = process.cwd()): Promise<void> {
  const guide = readFileSync(join(repoRoot, GUIDE_PATH), "utf8");
  const files = extractStandaloneStarter(guide);
  const packageFile = files.find((file) => file.path === "package.json");
  if (packageFile === undefined) throw new Error("missing extracted package.json");
  assertPackageContract(packageFile.content);

  const tempRoot = mkdtempSync(join(tmpdir(), "musi-local-eslint-rule-starter-"));
  try {
    for (const file of files) {
      const destination = join(tempRoot, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    symlinkSync(join(repoRoot, "node_modules"), join(tempRoot, "node_modules"), "dir");
    for (const script of STARTER_SCRIPT_NAMES) runStarterCommand(tempRoot, script);
    await assertRuleActivation(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await checkStandaloneStarter();
    console.log(
      "standalone local ESLint rule starter passed (4 files; test + lint + config activation)",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

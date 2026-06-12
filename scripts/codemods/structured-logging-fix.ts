#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { CallExpression } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

import {
  createProject,
  fail as failWithName,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";
import { transformFile, type UnsupportedConsole } from "./structured-logging-fix-transforms.js";

const CODEMOD_NAME = "structured-logging-fix";
const SERVER_SRC_ROOT = path.join("packages", "server", "src");
const SERVER_PRISMA_ROOT = path.join("packages", "server", "prisma");
const SERVER_SCRIPTS_ROOT = path.join("packages", "server", "scripts");
const SCRIPT_LOGGER_RELATIVE = path.join(SERVER_SRC_ROOT, "utils", "script-logger.ts");
const MAIN_RELATIVE = path.join(SERVER_SRC_ROOT, "main.ts");
const CONSOLE_LEVELS = new Set(["log", "info", "warn", "error", "debug", "trace"]);

type CliArgs =
  | { mode: "single"; file: string; dryRun: boolean }
  | { mode: "all"; dryRun: boolean }
  | { mode: "check" };

export type StructuredLoggingFixCodemodArgs = string[];

type RunnableCliArgs = Exclude<CliArgs, { mode: "check" }>;

type ParsedCliFlags = {
  all: boolean;
  check: boolean;
  dryRun: boolean;
  positional: string[];
};

type RewritePlan = {
  path: string;
  text: string;
};

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function initialParsedFlags(): ParsedCliFlags {
  return {
    all: false,
    check: false,
    dryRun: false,
    positional: [],
  };
}

function readCliArg(parsed: ParsedCliFlags, arg: string): void {
  if (!arg) fail("Empty arguments are not supported.");
  if (arg === "--dry-run") {
    parsed.dryRun = true;
    return;
  }
  if (arg === "--all") {
    parsed.all = true;
    return;
  }
  if (arg === "--check") {
    parsed.check = true;
    return;
  }
  if (arg.startsWith("-")) fail(`Unknown argument: ${arg}`);
  parsed.positional.push(arg);
}

function checkModeArgs(parsed: ParsedCliFlags): CliArgs | undefined {
  if (!parsed.check) return undefined;
  if (parsed.all || parsed.dryRun || parsed.positional.length !== 0) {
    fail("Usage: bun run codemod:structured-logging-fix -- --check");
  }
  return { mode: "check" };
}

function allModeArgs(parsed: ParsedCliFlags): CliArgs | undefined {
  if (!parsed.all) return undefined;
  if (parsed.positional.length !== 0) {
    fail("Usage: bun run codemod:structured-logging-fix -- [--dry-run] --all");
  }
  return { mode: "all", dryRun: parsed.dryRun };
}

function singleModeArgs(parsed: ParsedCliFlags): CliArgs {
  if (parsed.positional.length !== 1) {
    fail(
      "Usage: bun run codemod:structured-logging-fix -- [--dry-run] <file> | [--dry-run] --all | --check",
    );
  }
  const file = parsed.positional[0];
  if (!file) fail("File argument is required.");
  return { mode: "single", file, dryRun: parsed.dryRun };
}

function finalizeArgs(parsed: ParsedCliFlags): CliArgs {
  return checkModeArgs(parsed) ?? allModeArgs(parsed) ?? singleModeArgs(parsed);
}

function parseArgs(args: string[]): CliArgs {
  const parsed = initialParsedFlags();
  for (const arg of args) readCliArg(parsed, arg);
  return finalizeArgs(parsed);
}

function normalizeRelativePath(root: string, filePath: string): string {
  const absolute = path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("File must be inside the current repository.");
  }
  if (!relative.endsWith(".ts")) fail("File must be a .ts file.");
  if (/\.test\.tsx?$/u.test(relative)) fail("Test files are not supported.");
  return relative;
}

function isGeneratedPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("generated");
}

function isPrismaSeedPath(relativePath: string): boolean {
  if (!relativePath.startsWith(`${SERVER_PRISMA_ROOT}${path.sep}`)) return false;
  return /^seed.*\.ts$/u.test(path.basename(relativePath));
}

function isScriptPath(relativePath: string): boolean {
  return (
    relativePath.startsWith(`${SERVER_SRC_ROOT}${path.sep}seed${path.sep}`) ||
    relativePath.startsWith(`${SERVER_SCRIPTS_ROOT}${path.sep}`) ||
    isPrismaSeedPath(relativePath)
  );
}

function isExcludedPath(relativePath: string): boolean {
  return (
    /\.test\.tsx?$/u.test(relativePath) ||
    isGeneratedPath(relativePath) ||
    relativePath === MAIN_RELATIVE ||
    relativePath === SCRIPT_LOGGER_RELATIVE
  );
}

function discoverFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile() || !currentPath.endsWith(".ts")) continue;
      const relative = path.relative(root, currentPath);
      if (isExcludedPath(relative)) continue;
      files.push(relative);
    }
  };
  visit(path.join(root, SERVER_SRC_ROOT));
  visit(path.join(root, SERVER_SCRIPTS_ROOT));
  if (existsSync(path.join(root, SERVER_PRISMA_ROOT))) {
    for (const entry of readdirSync(path.join(root, SERVER_PRISMA_ROOT), { withFileTypes: true })) {
      if (!entry.isFile() || !/^seed.*\.ts$/u.test(entry.name)) continue;
      files.push(path.join(SERVER_PRISMA_ROOT, entry.name));
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function consoleLevel(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  if (Node.isPropertyAccessExpression(expression)) {
    if (expression.getExpression().getText() !== "console") return undefined;
    const level = expression.getName();
    return CONSOLE_LEVELS.has(level) ? level : undefined;
  }
  if (Node.isElementAccessExpression(expression)) {
    if (expression.getExpression().getText() !== "console") return undefined;
    const level = staticString(expression.getArgumentExpression());
    return level && CONSOLE_LEVELS.has(level) ? level : undefined;
  }
  return undefined;
}

export function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

export function isStringConcat(node: Node): boolean {
  if (
    !Node.isBinaryExpression(node) ||
    node.getOperatorToken().getKind() !== SyntaxKind.PlusToken
  ) {
    return false;
  }
  const left = node.getLeft();
  const right = node.getRight();
  return (
    staticString(left) !== undefined ||
    staticString(right) !== undefined ||
    Node.isTemplateExpression(left) ||
    Node.isTemplateExpression(right) ||
    isStringConcat(left) ||
    isStringConcat(right)
  );
}

export function templateExpressionReason(args: Node[]): string | undefined {
  if (args.some(Node.isTemplateExpression)) return "template expressions need manual fields";
  if (args.some(isStringConcat)) return "string concatenation needs manual fields";
  return undefined;
}

export function objectLiteralHasProperty(node: Node, propertyName: string): boolean {
  if (!Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      return false;
    }
    return property.getName() === propertyName;
  });
}

export function quoted(value: string): string {
  return JSON.stringify(value);
}

function hasDirectConsole(relativePath: string, root: string): boolean {
  const text = readFileSync(path.join(root, relativePath), "utf8");
  return (
    /\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(/u.test(text) ||
    /\bconsole\[\s*["'](?:log|info|warn|error|debug|trace)["']\s*\]\s*\(/u.test(text)
  );
}

function printUnsupported(items: UnsupportedConsole[]): void {
  for (const item of items) {
    console.log(
      `${CODEMOD_NAME} codemod: unsupported ${item.file}:${String(item.line)} — ${item.reason}.`,
    );
  }
}

function runCheck(root: string): void {
  const files = discoverFiles(root).filter((file) => hasDirectConsole(file, root));
  if (files.length === 0) {
    console.log(`${CODEMOD_NAME} codemod: no direct console usage found.`);
    return;
  }
  for (const file of files)
    console.log(`${CODEMOD_NAME} codemod: ${file} has direct console usage.`);
}

function targetFiles(parsed: RunnableCliArgs, root: string): string[] {
  return parsed.mode === "all" ? discoverFiles(root) : [normalizeRelativePath(root, parsed.file)];
}

function collectRewritePlans(
  root: string,
  targets: string[],
): { plans: RewritePlan[]; unsupported: UnsupportedConsole[] } {
  const project = createProject();
  const plans: RewritePlan[] = [];
  const unsupported: UnsupportedConsole[] = [];
  for (const relativePath of targets) {
    if (isExcludedPath(relativePath) || !hasDirectConsole(relativePath, root)) continue;
    const result = transformFile(project, root, relativePath, isScriptPath(relativePath));
    unsupported.push(...result.unsupported);
    if (!result.changed) continue;
    plans.push({ path: path.join(root, relativePath), text: result.text });
  }
  return { plans, unsupported };
}

export function runStructuredLoggingFixCodemod(
  args: StructuredLoggingFixCodemodArgs,
  root = process.cwd(),
): void {
  const parsed = parseArgs(args);
  if (parsed.mode === "check") {
    runCheck(root);
    return;
  }

  const { plans, unsupported } = collectRewritePlans(root, targetFiles(parsed, root));

  printUnsupported(unsupported);
  if (plans.length === 0) {
    console.log(`${CODEMOD_NAME} codemod: no supported console rewrites found.`);
    return;
  }
  writeOrPreviewFiles(CODEMOD_NAME, root, plans, parsed.dryRun);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runStructuredLoggingFixCodemod(process.argv.slice(2));
}

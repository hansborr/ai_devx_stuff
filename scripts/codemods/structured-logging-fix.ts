#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CallExpression,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";

import {
  createProject,
  ensureNamedImport,
  fail as failWithName,
  sortImportBlocks,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";

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

type UnsupportedConsole = {
  file: string;
  line: number;
  reason: string;
};

type ReplacementResult =
  | { kind: "replacement"; text: string }
  | { kind: "unsupported"; reason: string };

type LoggerTarget = {
  expression: string;
  optional: boolean;
};

export type StructuredLoggingFixCodemodArgs = string[];

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function parseArgs(args: string[]): CliArgs {
  const positional: string[] = [];
  let dryRun = false;
  let all = false;
  let check = false;
  for (const arg of args) {
    if (!arg) fail("Empty arguments are not supported.");
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown argument: ${arg}`);
    positional.push(arg);
  }
  if (check) {
    if (all || dryRun || positional.length !== 0) {
      fail("Usage: bun run codemod:structured-logging-fix -- --check");
    }
    return { mode: "check" };
  }
  if (all) {
    if (positional.length !== 0) {
      fail("Usage: bun run codemod:structured-logging-fix -- [--dry-run] --all");
    }
    return { mode: "all", dryRun };
  }
  if (positional.length !== 1) {
    fail(
      "Usage: bun run codemod:structured-logging-fix -- [--dry-run] <file> | [--dry-run] --all | --check",
    );
  }
  const file = positional[0];
  if (!file) fail("File argument is required.");
  return { mode: "single", file, dryRun };
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

function hasDirectConsole(relativePath: string, root: string): boolean {
  const text = readFileSync(path.join(root, relativePath), "utf8");
  return (
    /\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(/u.test(text) ||
    /\bconsole\[\s*["'](?:log|info|warn|error|debug|trace)["']\s*\]\s*\(/u.test(text)
  );
}

function consoleLevel(call: CallExpression): string | undefined {
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

function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

function isStringConcat(node: Node): boolean {
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

function templateExpressionReason(args: Node[]): string | undefined {
  if (args.some(Node.isTemplateExpression)) return "template expressions need manual fields";
  if (args.some(isStringConcat)) return "string concatenation needs manual fields";
  return undefined;
}

function objectLiteralHasProperty(node: Node, propertyName: string): boolean {
  if (!Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      return false;
    }
    return property.getName() === propertyName;
  });
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function methodCall(target: LoggerTarget, level: string, fields: string, message: string): string {
  const operator = target.optional ? "?." : ".";
  return `${target.expression}${operator}${level}(${fields}, ${quoted(message)})`;
}

function runtimeLevel(consoleMethod: string): string {
  return consoleMethod === "log" ? "info" : consoleMethod;
}

function scriptLevel(consoleMethod: string): "info" | "warn" | "error" | undefined {
  if (consoleMethod === "log" || consoleMethod === "info") return "info";
  if (consoleMethod === "warn") return "warn";
  if (consoleMethod === "error") return "error";
  return undefined;
}

function scriptEvent(level: "info" | "warn" | "error"): string {
  if (level === "warn") return "script.warning";
  if (level === "error") return "script.failure";
  return "script.progress";
}

function trimColon(message: string): string {
  return message.replace(/:\s*$/u, "");
}

function scriptReplacement(levelName: string, args: Node[]): ReplacementResult {
  const level = scriptLevel(levelName);
  if (!level)
    return { kind: "unsupported", reason: `console.${levelName} is not supported by ScriptLogger` };
  const expressionReason = templateExpressionReason(args);
  if (expressionReason) return { kind: "unsupported", reason: expressionReason };

  const firstMessage = staticString(args[0]);
  if (firstMessage === undefined) {
    return { kind: "unsupported", reason: "first argument must be a static string" };
  }

  if (level === "error" && args.length === 2) {
    const errorArg = args[1];
    if (!errorArg) return { kind: "unsupported", reason: "missing error argument" };
    if (Node.isObjectLiteralExpression(errorArg) && objectLiteralHasProperty(errorArg, "err")) {
      if (!objectLiteralHasProperty(errorArg, "event")) {
        return {
          kind: "replacement",
          text: `logger.error({ event: "script.failure", ...${errorArg.getText()} }, ${quoted(trimColon(firstMessage))})`,
        };
      }
      return {
        kind: "replacement",
        text: `logger.error(${errorArg.getText()}, ${quoted(trimColon(firstMessage))})`,
      };
    }
    return {
      kind: "replacement",
      text: `logger.error({ event: "script.failure", err: ${errorArg.getText()} }, ${quoted(trimColon(firstMessage))})`,
    };
  }

  if (args.length === 1) {
    return {
      kind: "replacement",
      text: `logger.${level}({ event: ${quoted(scriptEvent(level))} }, ${quoted(firstMessage.trim())})`,
    };
  }

  if (args.length === 2 && Node.isObjectLiteralExpression(args[1])) {
    return {
      kind: "replacement",
      text: `logger.${level}({ event: ${quoted(scriptEvent(level))}, ...${args[1].getText()} }, ${quoted(firstMessage.trim())})`,
    };
  }

  if (args.length === 3 && /^ +Seeded$/u.test(firstMessage)) {
    const count = args[1];
    const unit = staticString(args[2]);
    if (!count || unit === undefined) {
      return {
        kind: "unsupported",
        reason: "seed count log must use one count and one static label",
      };
    }
    return {
      kind: "replacement",
      text: `logger.info({ event: "script.progress", count: ${count.getText()} }, ${quoted(`Seeded ${unit}`)})`,
    };
  }

  if (args.length > 3) {
    return { kind: "unsupported", reason: "multiple primitive arguments need manual fields" };
  }
  return { kind: "unsupported", reason: "unsupported console argument shape" };
}

function hasParameterNamed(call: CallExpression, name: string): boolean {
  for (const ancestor of call.getAncestors()) {
    if (
      !Node.isFunctionDeclaration(ancestor) &&
      !Node.isFunctionExpression(ancestor) &&
      !Node.isArrowFunction(ancestor) &&
      !Node.isMethodDeclaration(ancestor)
    ) {
      continue;
    }
    if (ancestor.getParameters().some((parameter) => parameter.getName() === name)) return true;
  }
  return false;
}

function lexicalContainers(call: CallExpression): Set<Node> {
  const containers = new Set<Node>();
  for (const ancestor of call.getAncestors()) {
    if (Node.isBlock(ancestor) || Node.isSourceFile(ancestor)) containers.add(ancestor);
  }
  return containers;
}

function nearestLexicalContainer(node: Node): Node | undefined {
  for (const ancestor of node.getAncestors()) {
    if (Node.isBlock(ancestor) || Node.isSourceFile(ancestor)) return ancestor;
  }
  return undefined;
}

function hasVariableNamedBefore(call: CallExpression, name: string): boolean {
  const containers = lexicalContainers(call);
  const callStart = call.getStart();
  for (const declaration of call.getSourceFile().getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (declaration.getName() !== name || declaration.getStart() >= callStart) continue;
    const container = nearestLexicalContainer(declaration);
    if (container && containers.has(container)) return true;
  }
  return false;
}

function loggerTarget(call: CallExpression): LoggerTarget | undefined {
  if (hasVariableNamedBefore(call, "logger") || hasParameterNamed(call, "logger")) {
    return { expression: "logger", optional: false };
  }
  if (hasParameterNamed(call, "ctx")) return { expression: "ctx.logger", optional: true };
  if (hasParameterNamed(call, "request")) return { expression: "request.log", optional: false };
  if (hasParameterNamed(call, "req")) return { expression: "req.log", optional: false };
  if (hasVariableNamedBefore(call, "server") || hasParameterNamed(call, "server")) {
    return { expression: "server.log", optional: false };
  }
  return undefined;
}

function hasLoggerInScope(call: CallExpression): boolean {
  return hasVariableNamedBefore(call, "logger") || hasParameterNamed(call, "logger");
}

function runtimeReplacement(
  levelName: string,
  args: Node[],
  call: CallExpression,
): ReplacementResult {
  const target = loggerTarget(call);
  if (!target) return { kind: "unsupported", reason: "no obvious logger in scope" };
  const expressionReason = templateExpressionReason(args);
  if (expressionReason) return { kind: "unsupported", reason: expressionReason };

  const message = staticString(args[0]);
  if (message === undefined) {
    return { kind: "unsupported", reason: "first argument must be a static string" };
  }
  const level = runtimeLevel(levelName);
  if (args.length === 1)
    return { kind: "replacement", text: methodCall(target, level, "{}", message) };
  const fields = args[1];
  if (args.length === 2 && fields && Node.isObjectLiteralExpression(fields)) {
    return { kind: "replacement", text: methodCall(target, level, fields.getText(), message) };
  }
  if (args.length === 2 && level === "error") {
    return { kind: "unsupported", reason: "raw errors must be moved into an err field" };
  }
  return { kind: "unsupported", reason: "unsupported console argument shape" };
}

function ensureScriptLogger(sourceFile: SourceFile, relativePath: string): void {
  const hasLogger = sourceFile.getStatements().some((statement) => {
    if (!Node.isVariableStatement(statement)) return false;
    return statement.getDeclarations().some((declaration) => declaration.getName() === "logger");
  });
  if (hasLogger) return;

  const sourceDirectory = path.dirname(relativePath);
  const importPath = path
    .relative(sourceDirectory, SCRIPT_LOGGER_RELATIVE)
    .replace(/\\/gu, "/")
    .replace(/\.ts$/u, ".js");
  const moduleSpecifier = importPath.startsWith(".") ? importPath : `./${importPath}`;
  ensureNamedImport(sourceFile, moduleSpecifier, [
    { imported: "createScriptLogger", local: "createScriptLogger" },
  ]);

  const statements = sourceFile.getStatements();
  const insertionIndex = statements.reduce((nextIndex, statement, index) => {
    return Node.isImportDeclaration(statement) ? index + 1 : nextIndex;
  }, 0);
  sourceFile.insertVariableStatement(insertionIndex, {
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "logger",
        initializer: `createScriptLogger({ command: ${quoted(path.basename(relativePath, ".ts"))} })`,
      },
    ],
  });
}

function removeNoConsoleDisable(text: string): string {
  return text.replace(
    /\/\* eslint-disable ([^*]*?) -- ([^*]*?) \*\/\n?/gu,
    (_match: string, rulesText: string, reason: string) => {
      const rules = rulesText
        .split(",")
        .map((rule) => rule.trim())
        .filter((rule) => rule && rule !== "no-console");
      if (rules.length === 0) return "";
      return `/* eslint-disable ${rules.join(", ")} -- ${reason.trim()} */\n`;
    },
  );
}

function transformFile(
  project: Project,
  root: string,
  relativePath: string,
): { text: string; changed: boolean; unsupported: UnsupportedConsole[] } {
  const sourceFile = project.addSourceFileAtPath(path.join(root, relativePath));
  const script = isScriptPath(relativePath);
  const unsupported: UnsupportedConsole[] = [];
  let changed = false;
  let needsScriptLogger = false;

  const calls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((call) => ({ call, level: consoleLevel(call) }))
    .filter((item): item is { call: CallExpression; level: string } => item.level !== undefined);
  for (const call of calls) {
    const args = call.call.getArguments();
    const result = script
      ? scriptReplacement(call.level, args)
      : runtimeReplacement(call.level, args, call.call);
    if (result.kind === "unsupported") {
      unsupported.push({
        file: relativePath,
        line: call.call.getStartLineNumber(),
        reason: result.reason,
      });
      continue;
    }
    if (script && !hasLoggerInScope(call.call)) needsScriptLogger = true;
    call.call.replaceWithText(result.text);
    changed = true;
  }

  if (changed && script && needsScriptLogger) ensureScriptLogger(sourceFile, relativePath);
  const text = changed
    ? removeNoConsoleDisable(sourceFile.getFullText())
    : sourceFile.getFullText();
  return { text: sortImportBlocks(text, path.join(root, relativePath)), changed, unsupported };
}

function printUnsupported(items: UnsupportedConsole[]): void {
  for (const item of items) {
    console.log(
      `${CODEMOD_NAME} codemod: unsupported ${item.file}:${String(item.line)} — ${item.reason}.`,
    );
  }
}

export function runStructuredLoggingFixCodemod(
  args: StructuredLoggingFixCodemodArgs,
  root = process.cwd(),
): void {
  const parsed = parseArgs(args);
  if (parsed.mode === "check") {
    const files = discoverFiles(root).filter((file) => hasDirectConsole(file, root));
    if (files.length === 0) {
      console.log(`${CODEMOD_NAME} codemod: no direct console usage found.`);
      return;
    }
    for (const file of files)
      console.log(`${CODEMOD_NAME} codemod: ${file} has direct console usage.`);
    return;
  }

  const targets =
    parsed.mode === "all" ? discoverFiles(root) : [normalizeRelativePath(root, parsed.file)];
  const project = createProject();
  const plans: { path: string; text: string }[] = [];
  const unsupported: UnsupportedConsole[] = [];

  for (const relativePath of targets) {
    if (isExcludedPath(relativePath) || !hasDirectConsole(relativePath, root)) continue;
    const result = transformFile(project, root, relativePath);
    unsupported.push(...result.unsupported);
    if (!result.changed) continue;
    plans.push({ path: path.join(root, relativePath), text: result.text });
  }

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

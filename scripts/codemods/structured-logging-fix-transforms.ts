import path from "node:path";

import {
  CallExpression,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";

import { ensureNamedImport, sortImportBlocks } from "./lib/trpc-shared-schema.js";
import {
  consoleLevel,
  objectLiteralHasProperty,
  quoted,
  staticString,
  templateExpressionReason,
} from "./structured-logging-fix.js";

const SERVER_SRC_ROOT = path.join("packages", "server", "src");
const SCRIPT_LOGGER_RELATIVE = path.join(SERVER_SRC_ROOT, "utils", "script-logger.ts");

export type UnsupportedConsole = {
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

function scriptErrorFieldsReplacement(errorArg: Node, firstMessage: string): ReplacementResult {
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

function scriptErrorReplacement(
  level: "info" | "warn" | "error",
  args: Node[],
  firstMessage: string,
): ReplacementResult | undefined {
  if (level !== "error" || args.length !== 2) return undefined;
  const errorArg = args[1];
  if (!errorArg) return { kind: "unsupported", reason: "missing error argument" };
  if (Node.isObjectLiteralExpression(errorArg) && objectLiteralHasProperty(errorArg, "err")) {
    return scriptErrorFieldsReplacement(errorArg, firstMessage);
  }
  return {
    kind: "replacement",
    text: `logger.error({ event: "script.failure", err: ${errorArg.getText()} }, ${quoted(trimColon(firstMessage))})`,
  };
}

function singleMessageScriptReplacement(
  level: "info" | "warn" | "error",
  args: Node[],
  firstMessage: string,
): ReplacementResult | undefined {
  if (args.length !== 1) return undefined;
  return {
    kind: "replacement",
    text: `logger.${level}({ event: ${quoted(scriptEvent(level))} }, ${quoted(firstMessage.trim())})`,
  };
}

function objectFieldsScriptReplacement(
  level: "info" | "warn" | "error",
  args: Node[],
  firstMessage: string,
): ReplacementResult | undefined {
  const fields = args[1];
  if (args.length !== 2 || !fields || !Node.isObjectLiteralExpression(fields)) return undefined;
  return {
    kind: "replacement",
    text: `logger.${level}({ event: ${quoted(scriptEvent(level))}, ...${fields.getText()} }, ${quoted(firstMessage.trim())})`,
  };
}

function seededCountScriptReplacement(
  args: Node[],
  firstMessage: string,
): ReplacementResult | undefined {
  if (args.length !== 3 || !/^ +Seeded$/u.test(firstMessage)) return undefined;
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

  const replacement =
    scriptErrorReplacement(level, args, firstMessage) ??
    singleMessageScriptReplacement(level, args, firstMessage) ??
    objectFieldsScriptReplacement(level, args, firstMessage) ??
    seededCountScriptReplacement(args, firstMessage);
  if (replacement) return replacement;

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
  for (const declaration of call
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
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

export function transformFile(
  project: Project,
  root: string,
  relativePath: string,
  script: boolean,
): { text: string; changed: boolean; unsupported: UnsupportedConsole[] } {
  const sourceFile = project.addSourceFileAtPath(path.join(root, relativePath));
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

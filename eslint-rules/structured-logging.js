// @ts-check

/**
 * Disallow template literals with expressions (and string concatenation) as
 * direct arguments to Pino-style logger methods, and disallow direct console
 * calls in server code that should use structured logging. Dynamic values
 * belong in the metadata object, not interpolated into the message — log
 * aggregators key on the static message string.
 *
 * Targets call sites of the shape `<expr>.log.<level>(...)` where <level> is
 * a Pino log level. Does NOT touch Error/TRPCError constructors, where
 * dynamic messages are sometimes intentional (user-facing copy).
 */

import { unwrapChain } from "./ast-helpers.js";

const PINO_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);
const WRAPPER_LEVELS = new Set(["error", "warn", "info"]);
const CONSOLE_LEVELS = new Set(["log", "info", "warn", "error", "debug", "trace"]);
const REPAIR_COMMAND = "bun run codemod:structured-logging-fix -- <file>";

/** @param {import('estree').CallExpression} node */
function isLoggerCall(node) {
  // Match `<obj>.log.<level>(...)`.
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.type !== "Identifier") return false;
  if (!PINO_LEVELS.has(callee.property.name)) return false;

  const inner = unwrapChain(callee.object);
  if (inner.type !== "MemberExpression" || inner.computed) return false;
  if (inner.property.type !== "Identifier") return false;
  return inner.property.name === "log";
}

/**
 * Match the repo's narrow logging wrappers (`logger.info(...)`,
 * `ctx.logger?.warn(...)`, etc.). These wrappers use the same static-message
 * convention as Pino, but expose `.info/.warn/.error` directly instead of
 * through `.log`.
 *
 * @param {import('estree').CallExpression} node
 */
function isWrapperLoggerCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.type !== "Identifier" || !WRAPPER_LEVELS.has(callee.property.name)) {
    return false;
  }

  const target = unwrapChain(callee.object);
  if (target.type === "Identifier") return target.name === "logger";
  if (target.type !== "MemberExpression" || target.computed) return false;
  return target.property.type === "Identifier" && target.property.name === "logger";
}

/** @param {string} filename */
function normalizedFilename(filename) {
  return filename.replaceAll("\\", "/");
}

/** @param {string} filename */
function allowsScriptLoggerImport(filename) {
  const normalized = normalizedFilename(filename);
  return (
    normalized.includes("/packages/server/src/seed/") ||
    normalized.includes("/packages/server/scripts/") ||
    /\/packages\/server\/prisma\/seed[^/]*\.ts$/u.test(normalized)
  );
}

/** @param {import('estree').ImportDeclaration} node */
function importsScriptLoggerFactory(node) {
  if (typeof node.source.value !== "string") return false;
  if (!/(?:^|\/)script-logger\.(?:js|ts)$/u.test(node.source.value)) return false;
  return node.specifiers.some((specifier) => {
    if (specifier.type !== "ImportSpecifier") return false;
    const imported = specifier.imported;
    return imported.type === "Identifier" && imported.name === "createScriptLogger";
  });
}

/**
 * @param {string} filename
 * @param {string} level
 * @param {import('estree').CallExpression} node
 */
function allowsConsole(filename, level, node) {
  const normalized = normalizedFilename(filename);
  if (normalized.endsWith("packages/server/src/utils/script-logger.ts")) return true;
  if (level !== "error" || !normalized.endsWith("packages/server/src/main.ts")) return false;
  const firstArg = node.arguments[0];
  return (
    firstArg?.type === "Literal" &&
    typeof firstArg.value === "string" &&
    firstArg.value === "Failed to start server:"
  );
}

/**
 * @param {import('estree').MemberExpression} callee
 * @returns {string | undefined}
 */
function resolveConsoleLevelProperty(callee) {
  const property = callee.property;
  if (!callee.computed && property.type === "Identifier" && CONSOLE_LEVELS.has(property.name)) {
    return property.name;
  }
  if (callee.computed && property.type === "Literal" && typeof property.value === "string") {
    return CONSOLE_LEVELS.has(property.value) ? property.value : undefined;
  }
  return undefined;
}

/** @param {import('estree').CallExpression} node */
function consoleCallLevel(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;
  if (callee.object.type !== "Identifier" || callee.object.name !== "console") return undefined;
  return resolveConsoleLevelProperty(callee);
}

/** @param {import('estree').Node} node */
function isStringConcat(node) {
  if (node.type !== "BinaryExpression" || node.operator !== "+") return false;
  /** @param {import('estree').Node} n */
  const stringy = (n) =>
    (n.type === "Literal" && typeof n.value === "string") ||
    n.type === "TemplateLiteral" ||
    isStringConcat(n);
  return stringy(node.left) || stringy(node.right);
}

/** @param {import('estree').Node} node */
function isStaticString(node) {
  return (
    (node.type === "Literal" && typeof node.value === "string") ||
    (node.type === "TemplateLiteral" && node.expressions.length === 0)
  );
}

/** @param {import('estree').Node} node */
function isMetadataObject(node) {
  return node.type === "ObjectExpression";
}

/** @param {import('estree').CallExpression} node */
function pinoMessageArg(node) {
  const [first, second] = node.arguments;
  if (!first) return undefined;
  if (second) return second;
  return isMetadataObject(first) ? undefined : first;
}

/** @param {import('estree').CallExpression} node */
function wrapperMessageArg(node) {
  return node.arguments[1];
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').Rule.RuleContext} context
 */
function reportDynamicMessageArg(node, context) {
  if (node.type === "TemplateLiteral" && node.expressions.length > 0) {
    context.report({ node, messageId: "noTemplate" });
  } else if (isStringConcat(node)) {
    context.report({ node, messageId: "noConcat" });
  } else if (!isStaticString(node)) {
    context.report({ node, messageId: "noDynamic" });
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Pino logger messages must be static; pass dynamic values via the metadata object",
      principle:
        "Logger calls must use static message strings with variable data in the metadata object so log aggregation can group identical messages. Direct console calls bypass structured fields and request context.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "codemod",
      repairCommand: "bun run codemod:structured-logging-fix",
    },
    messages: {
      noTemplate:
        "Why: Interpolated logger messages fragment log aggregation because the message text changes per value. How to fix: Move `${...}` values into the metadata object and keep the message static, for example `log.error({ userId }, 'failed')`.",
      noConcat:
        "Why: Concatenated logger messages fragment log aggregation because the message text changes per value. How to fix: Move concatenated values into the metadata object and keep the message argument static.",
      noDynamic:
        "Why: Dynamic logger message variables fragment log aggregation because the message text changes outside the call site. How to fix: Move the variable data into the metadata object and pass a static string literal as the message.",
      noConsole:
        "Why: Direct console calls bypass structured logging fields, request context, and log formatting. How to fix: Use structured logging instead, or run `" +
        REPAIR_COMMAND +
        "`.",
      noScriptLoggerImport:
        "Why: createScriptLogger is only for seed, generator, Prisma seed, and server script entry points. How to fix: Use request or server log context in runtime server code instead.",
    },
    schema: [],
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (importsScriptLoggerFactory(node) && !allowsScriptLoggerImport(context.filename)) {
          context.report({ node, messageId: "noScriptLoggerImport" });
        }
      },

      CallExpression(node) {
        const level = consoleCallLevel(node);
        if (level && !allowsConsole(context.filename, level, node)) {
          context.report({ node, messageId: "noConsole" });
          return;
        }

        if (isLoggerCall(node)) {
          const message = pinoMessageArg(node);
          if (message) reportDynamicMessageArg(message, context);
          return;
        }

        if (isWrapperLoggerCall(node)) {
          const message = wrapperMessageArg(node);
          if (message) reportDynamicMessageArg(message, context);
        }
      },
    };
  },
};

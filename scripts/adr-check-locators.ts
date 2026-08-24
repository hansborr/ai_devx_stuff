import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
import { z } from "zod";

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()).default({}) });

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function walkFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    walkFiles(resolve(path, entry.name)),
  );
}

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function descendants(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  node.forEachChild((child) => {
    found.push(child, ...descendants(child));
  });
  return found;
}

function parseSource(path: string): ts.SourceFile {
  const kind = path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

/**
 * Whether the generated `local` plugin registers `name` in its `rules` object.
 *
 * Read STRUCTURALLY, never as bytes. scripts/harness/generate-local-plugin.ts
 * quotes a plugin key only when the rule id is not already an identifier — a
 * single-word id such as `complexity` is emitted bare, because the rendered
 * bytes must also be a prettier fixed point (`quoteProps: as-needed`). Matching
 * a `"<name>"` byte pattern would therefore report a correctly generated
 * registration as unresolved, and would have to be kept in lockstep with that
 * formatting decision. A property name covers both key forms by construction.
 */
function pluginRegistersRule(pluginPath: string, name: string): boolean {
  return descendants(parseSource(pluginPath)).some(
    (node) =>
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "rules" &&
      ts.isObjectLiteralExpression(node.initializer) &&
      node.initializer.properties.some(
        (property) => ts.isPropertyAssignment(property) && propertyName(property.name) === name,
      ),
  );
}

function eslintRuleFailure(root: string, value: string): string | undefined {
  if (!value.startsWith("local/")) return "only local/* ESLint rules are supported";
  const name = value.slice("local/".length);
  if (!isFile(resolve(root, `eslint-rules/${name}.js`)))
    return "local ESLint rule file does not resolve";
  const pluginPath = resolve(root, "eslint-config/local-plugin.generated.js");
  if (!isFile(pluginPath) || !pluginRegistersRule(pluginPath, name)) {
    return "local plugin registration does not resolve";
  }
  const enabled = [resolve(root, "eslint.config.js"), ...walkFiles(resolve(root, "eslint-config"))]
    .filter((path) => path.endsWith(".js") && isFile(path))
    .some((path) =>
      new RegExp(`["']local/${name}["']\\s*:\\s*(?:["'](?:error|warn)["']|[12])`).test(
        readFileSync(path, "utf8"),
      ),
    );
  return enabled ? undefined : "enabled ESLint config entry does not resolve";
}

function countRestrictedImportPatterns(root: string, value: string): number {
  const configs = [
    resolve(root, "eslint.config.js"),
    ...walkFiles(resolve(root, "eslint-config")),
  ].filter((path) => path.endsWith(".js") && isFile(path));
  let matches = 0;
  for (const path of configs) {
    for (const node of descendants(parseSource(path))) {
      if (
        !ts.isPropertyAssignment(node) ||
        propertyName(node.name) !== "@typescript-eslint/no-restricted-imports"
      )
        continue;
      matches += descendants(node.initializer).filter((child) => {
        if (!ts.isPropertyAssignment(child) || propertyName(child.name) !== "importNames")
          return false;
        return (
          ts.isArrayLiteralExpression(child.initializer) &&
          child.initializer.elements.some(
            (element) => ts.isStringLiteral(element) && element.text === value,
          )
        );
      }).length;
    }
  }
  return matches;
}

function rootConfigUsesBoundary(root: string): boolean {
  const path = resolve(root, "eslint.config.js");
  if (!isFile(path)) return false;
  const source = parseSource(path);
  const imported = source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false;
    const bindings = statement.importClause?.namedBindings;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === "rawTxClientBoundaryConfigs")
    );
  });
  const spread = descendants(source).some(
    (node) =>
      ts.isSpreadElement(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "rawTxClientBoundaryConfigs",
  );
  return imported && spread;
}

function restrictedImportFailure(root: string, value: string): string | undefined {
  const matches = countRestrictedImportPatterns(root, value);
  if (matches !== 1)
    return `restricted import pattern does not resolve uniquely (found ${String(matches)})`;
  return rootConfigUsesBoundary(root)
    ? undefined
    : "rawTxClientBoundaryConfigs must be imported and spread into eslint.config.js";
}

function typeBoundaryFailure(root: string, value: string): string | undefined {
  const separator = value.lastIndexOf("#");
  const file = separator < 0 ? value : value.slice(0, separator);
  const symbol = separator < 0 ? "" : value.slice(separator + 1);
  const path = resolve(root, file);
  if (!isFile(path)) return "type-boundary file does not resolve";
  const exported = parseSource(path).statements.some((node) => {
    if (!ts.canHaveModifiers(node)) return false;
    const hasExport =
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true;
    return (
      hasExport &&
      "name" in node &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === symbol
    );
  });
  return exported ? undefined : `exported symbol '${symbol}' does not resolve`;
}

function packageScriptFailure(root: string, value: string): string | undefined {
  try {
    const parsed = packageSchema.safeParse(
      JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
    );
    return parsed.success && parsed.data.scripts[value] !== undefined
      ? undefined
      : `package script '${value}' does not resolve`;
  } catch {
    return `package script '${value}' does not resolve`;
  }
}

export function locatorFailure(root: string, locator: string): string | undefined {
  const separator = locator.indexOf(":");
  const kind = separator < 0 ? locator : locator.slice(0, separator);
  const value = separator < 0 ? "" : locator.slice(separator + 1);
  switch (kind) {
    case "eslint-rule":
      return eslintRuleFailure(root, value);
    case "restricted-import":
      return restrictedImportFailure(root, value);
    case "type-boundary":
      return typeBoundaryFailure(root, value);
    case "package-script":
      return packageScriptFailure(root, value);
    case "test-file":
      return isFile(resolve(root, value)) && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(value)
        ? undefined
        : "test file does not resolve";
    default:
      return `unknown locator kind '${kind}'`;
  }
}

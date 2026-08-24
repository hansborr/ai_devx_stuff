import ts from "typescript";

/**
 * Coarse, fail-closed source policy for the seed import closure (and the
 * fixture copy-set guard that shares the walker).
 *
 * Both consumers walk first-party repository code, and the worst outcome of a
 * missed input is a stale local template DB that `worktree:template-refresh`
 * rebuilds. So this is a token scan, not a scope analysis: anything that could
 * load a module outside the static ESM graph — or read the environment without
 * naming a key — is an error that tells the author to fix the code. Innocent
 * false positives (a local binding named `require`, a parameter named
 * `process`) are accepted by design; renaming the binding is cheaper than
 * teaching the analyzer to resolve it.
 */

export interface RuntimeSourceOptions {
  /** Static environment keys the closure may read. Undefined disables the environment policy. */
  readonly allowedEnvironmentVariables?: readonly string[];
  /**
   * `"throw"` (default) rejects a dynamic import without a literal specifier;
   * `"skip"` ignores it, for closure walks over code that loads runtime-configured inputs.
   */
  readonly nonStaticSpecifiers?: "throw" | "skip";
}

/** Rejected wherever they appear, including as property or member names. */
const commonJsIdentifiers: ReadonlySet<string> = new Set(["createRequire", "require"]);
const commonJsModuleSpecifiers: ReadonlySet<string> = new Set(["module", "node:module"]);
const commonJsFileExtensions = [".cjs", ".cts"] as const;
/**
 * Tokens that can reach the environment. Under the environment policy every one
 * of them must be the receiver of a direct static member access, so the only way
 * to touch the environment is the `process.env.KEY` shape the scan understands.
 * The token never has to be resolved: an unrelated binding spelled `process` is
 * rejected too, and renaming it is cheaper than teaching the analyzer scopes.
 */
const environmentGlobals: ReadonlySet<string> = new Set(["Bun", "globalThis", "process"]);
/**
 * The single sanctioned value import of the process module: it binds the same
 * name the global scan already reads, so `process.env.KEY` still applies.
 * Bun's generated Prisma client writes exactly this form.
 */
const processModuleSpecifiers: ReadonlySet<string> = new Set(["process", "node:process"]);
const processNamespaceBinding = "process";
/** `import.meta` members that can neither load a module nor hide an environment read. */
const importMetaProperties: ReadonlySet<string> = new Set([
  "dir",
  "dirname",
  "env",
  "filename",
  "main",
  "resolve",
  "url",
]);
const dynamicImportArgumentCount = 1;

const commonJsError = (sourceFile: ts.SourceFile, detail: string): Error =>
  new Error(
    `${sourceFile.fileName}: CommonJS runtime loading is not supported — ${detail}. ` +
      "Use a static ESM import so the seed import closure can follow the dependency; " +
      "fix the seed code rather than teaching the analyzer.",
  );

const policyError = (sourceFile: ts.SourceFile, detail: string): Error =>
  new Error(
    `${sourceFile.fileName}: ${detail}. The seed import closure is deliberately coarse and ` +
      "resolves no aliases; fix the seed code rather than teaching the analyzer.",
  );

/** Member name of a `a.b` / `a["b"]` access; undefined when the key is computed. */
const staticMemberName = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
};

const importDeclarationIsRuntime = (node: ts.ImportDeclaration): boolean => {
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
  if (clause.name !== undefined) return true;
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined || ts.isNamespaceImport(namedBindings)) return true;
  return (
    namedBindings.elements.length === 0 ||
    namedBindings.elements.some((element) => !element.isTypeOnly)
  );
};

const exportDeclarationIsRuntime = (node: ts.ExportDeclaration): boolean => {
  if (node.isTypeOnly) return false;
  const exportClause = node.exportClause;
  if (exportClause === undefined || ts.isNamespaceExport(exportClause)) return true;
  return (
    exportClause.elements.length === 0 ||
    exportClause.elements.some((element) => !element.isTypeOnly)
  );
};

const isJsonSpecifier = (specifier: ts.Expression | undefined): boolean =>
  specifier !== undefined && ts.isStringLiteralLike(specifier) && specifier.text.endsWith(".json");

/**
 * The one attribute the tree uses. Everything else — the legacy `assert`
 * keyword, a second attribute, a non-`type` attribute, any other loader — fails
 * closed rather than teaching the walker Bun's loader taxonomy.
 */
const checkImportAttributes = (
  sourceFile: ts.SourceFile,
  attributes: ts.ImportAttributes | undefined,
  specifier: ts.Expression | undefined,
): void => {
  if (attributes === undefined) return;
  const [attribute, ...rest] = attributes.elements;
  const supported =
    attributes.token === ts.SyntaxKind.WithKeyword &&
    rest.length === 0 &&
    attribute?.name.text === "type" &&
    ts.isStringLiteralLike(attribute.value) &&
    attribute.value.text === "json" &&
    isJsonSpecifier(specifier);
  if (!supported) {
    throw policyError(
      sourceFile,
      'the only supported import attribute is `with { type: "json" }` on a `.json` specifier',
    );
  }
};

/** True for `a.b` / `a["b"]` — the only member shape the policy follows. */
const isStaticMemberReceiver = (node: ts.Node): boolean => {
  const parent = node.parent;
  if (!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent)) return false;
  return parent.expression === node && staticMemberName(parent) !== undefined;
};

/** `<process|Bun|globalThis|import.meta>.env`, the shapes the policy reads. */
const isEnvironmentAccess = (node: ts.Node): boolean => {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  if (staticMemberName(node) !== "env") return false;
  const root = node.expression;
  return (
    (ts.isIdentifier(root) && environmentGlobals.has(root.text)) ||
    environmentGlobals.has(staticMemberName(root) ?? "") ||
    (ts.isMetaProperty(root) && root.keywordToken === ts.SyntaxKind.ImportKeyword)
  );
};

/** The one value import of the process module the policy accepts. */
const isProcessNamespaceBinding = (node: ts.Identifier): boolean => {
  const namespaceImport = node.parent;
  if (!ts.isNamespaceImport(namespaceImport)) return false;
  const declaration = namespaceImport.parent.parent;
  return (
    node.text === processNamespaceBinding &&
    ts.isImportDeclaration(declaration) &&
    ts.isStringLiteralLike(declaration.moduleSpecifier) &&
    processModuleSpecifiers.has(declaration.moduleSpecifier.text)
  );
};

/**
 * Returns the file's static runtime import specifiers, and throws on anything
 * the coarse policy refuses. Environment reads are validated, not reported: the
 * allowlist in `scripts/worktree-db.sh` is the contract, so a compliant file has
 * nothing left to say about the keys it read.
 */
export const analyzeRuntimeSource = (
  sourceFile: ts.SourceFile,
  options: RuntimeSourceOptions = {},
): readonly string[] => {
  const { allowedEnvironmentVariables } = options;
  const nonStaticSpecifiers = options.nonStaticSpecifiers ?? "throw";
  const imports: string[] = [];

  if (commonJsFileExtensions.some((extension) => sourceFile.fileName.endsWith(extension))) {
    throw commonJsError(sourceFile, "the file extension declares a CommonJS module");
  }

  const recordImport = (specifier: ts.Expression | undefined): void => {
    if (specifier === undefined) return;
    if (!ts.isStringLiteralLike(specifier)) {
      if (nonStaticSpecifiers === "skip") return;
      throw policyError(
        sourceFile,
        "a runtime import must use a static string specifier so the closure can follow it",
      );
    }
    if (commonJsModuleSpecifiers.has(specifier.text)) {
      throw commonJsError(sourceFile, `\`${specifier.text}\` is imported in value space`);
    }
    if (commonJsFileExtensions.some((extension) => specifier.text.endsWith(extension))) {
      throw commonJsError(sourceFile, `\`${specifier.text}\` names a CommonJS module`);
    }
    imports.push(specifier.text);
  };

  const checkImportMeta = (node: ts.MetaProperty): void => {
    const parent = node.parent;
    const property =
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node
        ? staticMemberName(parent)
        : undefined;
    if (property !== undefined && commonJsIdentifiers.has(property)) {
      throw commonJsError(sourceFile, `\`import.meta.${property}\` is a CommonJS loader`);
    }
    if (property === undefined || !importMetaProperties.has(property)) {
      throw policyError(
        sourceFile,
        "import.meta must be read as a direct member from the allowlist " +
          `(${[...importMetaProperties].join(", ")})`,
      );
    }
  };

  const checkEnvironmentKey = (node: ts.Node, allowed: readonly string[]): void => {
    const parent = node.parent;
    const key =
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node
        ? staticMemberName(parent)
        : undefined;
    if (key === undefined) {
      throw policyError(
        sourceFile,
        "the environment must be read through a direct static key (process.env.DATABASE_URL); " +
          "it cannot be aliased, destructured, spread, or read with a computed key",
      );
    }
    if (!allowed.includes(key)) {
      throw new Error(
        `environment key ${key} in ${sourceFile.fileName} is not allowlisted for template seeding`,
      );
    }
  };

  /**
   * The environment can only be reached through a token this scan recognizes,
   * so those tokens may only ever be read as `<token>.<static key>`. Anything
   * that hands the token itself somewhere else — an alias, an argument, a
   * re-export, a value import of the process module — is rejected instead of
   * followed, and so is an unrelated binding that happens to be spelled the
   * same way.
   */
  const checkEnvironmentToken = (node: ts.Identifier): void => {
    if (!environmentGlobals.has(node.text)) return;
    if (isStaticMemberReceiver(node) || isProcessNamespaceBinding(node)) return;
    throw policyError(
      sourceFile,
      `\`${node.text}\` must be read as a direct static member (process.env.DATABASE_URL); ` +
        "it cannot be aliased, passed, bound to another name, or reached through another object",
    );
  };

  /**
   * `import { env } from "node:process"` would bind the environment to a name
   * the token scan does not watch, so every value load of the process module
   * except the sanctioned namespace binding is rejected.
   */
  const checkProcessModuleLoad = (node: ts.ImportDeclaration | ts.ExportDeclaration): void => {
    const specifier = node.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return;
    if (!processModuleSpecifiers.has(specifier.text)) return;
    const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
    if (
      bindings !== undefined &&
      ts.isNamespaceImport(bindings) &&
      bindings.name.text === processNamespaceBinding
    ) {
      return;
    }
    throw policyError(
      sourceFile,
      'the process module may only be loaded as `import * as process from "node:process"`, ' +
        "so its environment reads keep the shape the scan understands",
    );
  };

  const checkEnvironmentPolicy = (node: ts.Node, allowed: readonly string[]): void => {
    if (ts.isIdentifier(node)) checkEnvironmentToken(node);
    else if (ts.isImportDeclaration(node) && importDeclarationIsRuntime(node)) {
      checkProcessModuleLoad(node);
    } else if (ts.isExportDeclaration(node) && exportDeclarationIsRuntime(node)) {
      checkProcessModuleLoad(node);
    } else if (isEnvironmentAccess(node)) checkEnvironmentKey(node, allowed);
  };

  const checkPolicy = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && commonJsIdentifiers.has(node.text)) {
      throw commonJsError(sourceFile, `the identifier \`${node.text}\` appears in value space`);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      throw commonJsError(sourceFile, "an import-equals declaration loads a CommonJS module");
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      checkImportMeta(node);
    }
    if (allowedEnvironmentVariables !== undefined) {
      checkEnvironmentPolicy(node, allowedEnvironmentVariables);
    }
  };

  const collectImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && importDeclarationIsRuntime(node)) {
      checkImportAttributes(sourceFile, node.attributes, node.moduleSpecifier);
      recordImport(node.moduleSpecifier);
    }
    if (ts.isExportDeclaration(node) && exportDeclarationIsRuntime(node)) {
      checkImportAttributes(sourceFile, node.attributes, node.moduleSpecifier);
      recordImport(node.moduleSpecifier);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== dynamicImportArgumentCount) {
        throw policyError(
          sourceFile,
          "a dynamic import must pass exactly one static specifier and no import attributes; " +
            "use a static import when the load needs an attribute",
        );
      }
      recordImport(node.arguments[0]);
    }
  };

  const visit = (node: ts.Node): void => {
    checkPolicy(node);
    collectImports(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return imports;
};

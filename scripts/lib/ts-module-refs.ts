// Single source of truth for "what counts as a runtime import edge" in a
// TypeScript source file — for the two analyzer stacks that consume it:
//   - scripts/drift-ai/import-cycles-graph.ts (cycle classification, offline
//     foreign-repo scanning), and
//   - scripts/code-intel/import-graph.ts (workspace import graph, runtime flag
//     and Via mapping).
// Known separate copy, deliberately not converted here:
// scripts/import-closure/runtime-imports.ts encodes the same rule in inverse
// polarity over a direct `typescript` import; a TypeScript upgrade that
// changes import-phase syntax must be checked against that copy too.
// The kernel owns only pure syntax classification over an already-parsed
// `ts.SourceFile`: the recursive visit of the three syntax families (import
// declarations, `export ... from`, dynamic `import()`), string-literal-like
// specifier acceptance, and the type-only rules. File reading, parsing,
// resolution, filtering, partiality accounting, and merge/dedup are per-stack
// policy and stay with the callers.
//
// Nesting depth is deliberate: the visit is fully recursive (drift-ai's
// historical extractor semantics, adopted by code-intel at extraction), so
// refs nested in ambient `declare module` bodies or other blocks are emitted
// like top-level ones. A caller needing statement-level-only semantics must
// filter above the kernel; none does today. Pinned by the "nesting depth" row
// in ts-module-refs.test.ts.
//
// Compiler-instance invariant (load-bearing): this module imports `ts` from
// ts-morph, NEVER from the `typescript` package. Both consumers run on
// ts-morph's bundled compiler; a direct `typescript` import could load a
// second compiler instance whose `SyntaxKind` numbering diverges from the
// nodes callers pass in, silently breaking every kind check below.
import { ts } from "ts-morph";

export type ModuleRefKind = "import" | "export-from" | "dynamic-import";

// One module reference per syntactic occurrence, in document order, no dedup.
// `typeOnly` is true only when the occurrence exists purely in the type system
// (always false for `dynamic-import`).
export type ModuleRef = {
  readonly specifier: string;
  readonly kind: ModuleRefKind;
  readonly typeOnly: boolean;
};

export function extractModuleRefs(source: ts.SourceFile): readonly ModuleRef[] {
  const out: ModuleRef[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isStringLiteralLike(node.moduleSpecifier)) {
      out.push({
        specifier: node.moduleSpecifier.text,
        kind: "import",
        typeOnly: isImportTypeOnly(node),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      out.push({
        specifier: node.moduleSpecifier.text,
        kind: "export-from",
        typeOnly: isExportTypeOnly(node),
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      isStringLiteralLike(node.arguments[0])
    ) {
      // Dynamic import() is always a runtime edge.
      out.push({ specifier: node.arguments[0].text, kind: "dynamic-import", typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function isStringLiteralLike(node: ts.Node | undefined): node is ts.StringLiteralLike {
  return (
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

// `import type ...` (whole-clause) or `import { type a, type b }` (every binding
// type-only) is a type-only edge. A default/namespace import or any value binding
// makes it a runtime edge, as does a bare side-effect `import "x"` or an empty
// named clause (the module still evaluates).
function isImportTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false; // bare `import "x"` side-effect import
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true; // `import type ...`
  if (clause.name !== undefined) return false; // default import is a value binding
  const bindings = clause.namedBindings;
  if (bindings === undefined) return false;
  if (ts.isNamespaceImport(bindings)) return false;
  if (bindings.elements.length === 0) return false;
  return bindings.elements.every((element) => element.isTypeOnly);
}

// `export type {...} from` (whole-clause) or an all-type-only named clause is a
// type-only edge; `export * from` and `export * as ns from` re-export values.
function isExportTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (clause === undefined) return false; // `export * from` re-exports values
  if (!ts.isNamedExports(clause)) return false;
  if (clause.elements.length === 0) return false;
  return clause.elements.every((element) => element.isTypeOnly);
}

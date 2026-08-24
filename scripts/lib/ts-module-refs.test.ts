import { ts } from "ts-morph";
import { describe, expect, it } from "vitest";

import { extractModuleRefs, type ModuleRef } from "./ts-module-refs.js";

// Characterization table for the shared import-edge kernel. Each row is an
// inline source snippet plus the exact refs the kernel must emit — one ref per
// syntactic occurrence, in document order, no dedup. The table doubles as the
// human-readable spec for "what counts as a runtime import edge": `typeOnly`
// is true only when the occurrence exists purely in the type system.
// Consumed by scripts/drift-ai/import-cycles-graph.ts (cycle classification)
// and scripts/code-intel/import-graph.ts (runtime flag + Via mapping).

function refsOf(code: string): readonly ModuleRef[] {
  const source = ts.createSourceFile("snippet.ts", code, ts.ScriptTarget.Latest, false);
  return extractModuleRefs(source);
}

type Row = {
  readonly name: string;
  readonly code: string;
  readonly expected: readonly ModuleRef[];
};

const importRef = (specifier: string, typeOnly: boolean): ModuleRef => ({
  specifier,
  kind: "import",
  typeOnly,
});
const exportRef = (specifier: string, typeOnly: boolean): ModuleRef => ({
  specifier,
  kind: "export-from",
  typeOnly,
});
const dynamicRef = (specifier: string): ModuleRef => ({
  specifier,
  kind: "dynamic-import",
  typeOnly: false,
});

const table: readonly Row[] = [
  // --- import declarations --------------------------------------------------
  {
    name: "whole-clause `import type` named bindings are type-only",
    code: `import type { A } from "./a";`,
    expected: [importRef("./a", true)],
  },
  {
    name: "whole-clause `import type` default binding is type-only",
    code: `import type A from "./a";`,
    expected: [importRef("./a", true)],
  },
  {
    name: "whole-clause `import type` namespace binding is type-only",
    code: `import type * as ns from "./a";`,
    expected: [importRef("./a", true)],
  },
  {
    name: "every named binding `type`-qualified is type-only",
    code: `import { type A, type B } from "./a";`,
    expected: [importRef("./a", true)],
  },
  {
    name: "a mixed value/type named clause is a runtime edge",
    code: `import { type A, b } from "./a";`,
    expected: [importRef("./a", false)],
  },
  {
    name: "a default import is a value binding (runtime)",
    code: `import a from "./a";`,
    expected: [importRef("./a", false)],
  },
  {
    name: "a default import beside all-type-only named bindings stays runtime",
    code: `import a, { type B } from "./a";`,
    expected: [importRef("./a", false)],
  },
  {
    name: "a namespace import is a value binding (runtime)",
    code: `import * as a from "./a";`,
    expected: [importRef("./a", false)],
  },
  {
    name: "a bare side-effect import is a runtime edge",
    code: `import "./a";`,
    expected: [importRef("./a", false)],
  },
  {
    name: "an empty named clause is a runtime edge (module still evaluates)",
    code: `import {} from "./a";`,
    expected: [importRef("./a", false)],
  },
  // --- export ... from ------------------------------------------------------
  {
    name: "`export * from` re-exports values (runtime)",
    code: `export * from "./a";`,
    expected: [exportRef("./a", false)],
  },
  {
    name: "`export * as ns from` re-exports values (runtime)",
    code: `export * as ns from "./a";`,
    expected: [exportRef("./a", false)],
  },
  {
    name: "whole-clause `export type {...} from` is type-only",
    code: `export type { A } from "./a";`,
    expected: [exportRef("./a", true)],
  },
  {
    name: "every named export `type`-qualified is type-only",
    code: `export { type A, type B } from "./a";`,
    expected: [exportRef("./a", true)],
  },
  {
    name: "a mixed value/type export clause is a runtime edge",
    code: `export { type A, b } from "./a";`,
    expected: [exportRef("./a", false)],
  },
  {
    name: "an empty export clause with a specifier is a runtime edge",
    code: `export {} from "./a";`,
    expected: [exportRef("./a", false)],
  },
  {
    name: "an export without a module specifier emits no ref",
    code: `const a = 1;\nexport { a };`,
    expected: [],
  },
  // --- dynamic import() -----------------------------------------------------
  {
    name: "dynamic import() with a string literal is a runtime edge",
    code: `const p = import("./a");`,
    expected: [dynamicRef("./a")],
  },
  {
    name: "dynamic import() with a no-substitution template literal is accepted",
    code: "const p = import(`./a`);",
    expected: [dynamicRef("./a")],
  },
  {
    name: "dynamic import() with a non-literal argument is ignored",
    code: `declare const x: string;\nconst p = import(x);`,
    expected: [],
  },
  {
    name: "dynamic import() with a substitution template is ignored",

    code: "declare const x: string;\nconst p = import(`./${x}`);",
    expected: [],
  },
  {
    name: "dynamic import() nested inside a function body is still found",
    code: `export async function load() {\n  return import("./a");\n}`,
    expected: [dynamicRef("./a")],
  },
  // --- nesting depth --------------------------------------------------------
  {
    // Pins the deliberately fully-recursive visit (drift-ai's historical
    // extractor semantics, adopted by code-intel at extraction): refs nested
    // in an ambient `declare module` body are emitted like top-level ones,
    // and `export * from` there still classifies as runtime even though an
    // ambient block never emits — the kernel is pure syntax with no semantic
    // context. Statement-level-only policy belongs above the kernel.
    name: "refs nested in an ambient `declare module` body are emitted",
    code: `declare module "m" {\n  import { a } from "dep";\n  export * from "dep2";\n}`,
    expected: [importRef("dep", false), exportRef("dep2", false)],
  },
  // --- occurrence semantics -------------------------------------------------
  {
    name: "one ref per occurrence, document order, no dedup",
    code: [
      `import type { A } from "./a";`,
      `const p = import("./b");`,
      `import { a } from "./a";`,
      `export * from "./c";`,
    ].join("\n"),
    expected: [
      importRef("./a", true),
      dynamicRef("./b"),
      importRef("./a", false),
      exportRef("./c", false),
    ],
  },
];

describe("extractModuleRefs", () => {
  it.each(table)("$name", ({ code, expected }) => {
    expect(refsOf(code)).toEqual(expected);
  });
});

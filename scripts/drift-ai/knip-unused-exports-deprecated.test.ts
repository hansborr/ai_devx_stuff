import { describe, expect, it } from "vitest";

import type { UnusedExportCategory, UnusedExportSymbol } from "./knip-unused-exports.js";
import { createDeprecatedExportLookup } from "./knip-unused-exports-deprecated.js";
import type { RepoFileReader } from "./repo-io.js";

// One file exercising every shape the overlay must get right: a deprecated vs live
// const, a deprecated type alias, a deprecated enum member beside a live sibling,
// and — the conservative cases — a deprecated namespace MEMBER whose container is
// not deprecated, plus a deprecated NAMESPACE whose member is not. The overlay must
// attribute `@deprecated` to the exact declaration knip points at, never bleeding
// between a container and its members in either direction.
const SOURCE = [
  "/** @deprecated use liveConst */",
  "export const oldConst = 1;",
  "export const liveConst = 2;",
  "/**",
  " * Some doc.",
  " * @deprecated removed soon",
  " */",
  "export type OldType = { a: number };",
  "export type LiveType = { b: number };",
  "export enum Color {",
  "  /** @deprecated */",
  "  Green,",
  "  Red,",
  "}",
  "export namespace Geometry {",
  "  /** @deprecated */",
  "  export const oldNs = 1;",
  "  export const liveNs = 2;",
  "}",
  "/** @deprecated whole namespace */",
  "export namespace DeadNs {",
  "  export const liveMember = 1;",
  "}",
].join("\n");

const SOURCE_FILE = "src/symbols.ts";

function readerFor(files: Readonly<Record<string, string>>): RepoFileReader {
  return (filePath) => files[filePath];
}

// Locate a symbol name at its declaration the way knip reports it: the first
// occurrence on a non-comment line, as a 1-based (line, col). Comment lines are
// skipped so a name mentioned inside a `@deprecated` note is not mistaken for the
// declaration.
function locate(source: string, name: string): { readonly line: number; readonly col: number } {
  const lines = source.split("\n");
  const wordPattern = new RegExp(`\\b${name}\\b`, "u");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const match = wordPattern.exec(line);
    if (match !== null) return { line: index + 1, col: match.index + 1 };
  }
  throw new Error(`name not found on a code line: ${name}`);
}

function sym(
  name: string,
  category: UnusedExportCategory,
  namespace?: string,
  file = SOURCE_FILE,
  source = SOURCE,
): UnusedExportSymbol {
  const { line, col } = locate(source, name);
  return { category, file, name, line, col, ...(namespace === undefined ? {} : { namespace }) };
}

describe("createDeprecatedExportLookup", () => {
  const lookup = createDeprecatedExportLookup(readerFor({ [SOURCE_FILE]: SOURCE }));

  it("flags a deprecated exported const and not a live one", () => {
    expect(lookup(sym("oldConst", "exports"))).toBe(true);
    expect(lookup(sym("liveConst", "exports"))).toBe(false);
  });

  it("flags a deprecated type alias and not a live one", () => {
    expect(lookup(sym("OldType", "types"))).toBe(true);
    expect(lookup(sym("LiveType", "types"))).toBe(false);
  });

  it("flags a deprecated enum member but not its live sibling or the enum itself", () => {
    expect(lookup(sym("Green", "enumMembers", "Color"))).toBe(true);
    expect(lookup(sym("Red", "enumMembers", "Color"))).toBe(false);
    // The enum is not annotated; a deprecated MEMBER must not bleed onto it.
    expect(lookup(sym("Color", "exports"))).toBe(false);
  });

  it("flags a deprecated namespace member without flagging the namespace", () => {
    expect(lookup(sym("oldNs", "namespaceMembers", "Geometry"))).toBe(true);
    expect(lookup(sym("liveNs", "namespaceMembers", "Geometry"))).toBe(false);
    expect(lookup(sym("Geometry", "exports"))).toBe(false);
  });

  it("does not bleed a namespace-level @deprecated onto its members", () => {
    // DeadNs itself is annotated; its member is not. Conservative: member stays
    // un-flagged even though the container is deprecated.
    expect(lookup(sym("liveMember", "namespaceMembers", "DeadNs"))).toBe(false);
    expect(lookup(sym("DeadNs", "exports"))).toBe(true);
  });

  it("returns false for a symbol with no location", () => {
    expect(lookup({ category: "exports", file: SOURCE_FILE, name: "oldConst" })).toBe(false);
  });

  it("returns false when the position matches no named declaration", () => {
    expect(
      lookup({ category: "exports", file: SOURCE_FILE, name: "phantom", line: 3, col: 99 }),
    ).toBe(false);
  });

  it("returns false for an unreadable file", () => {
    const missingLookup = createDeprecatedExportLookup(readerFor({}));
    expect(missingLookup(sym("oldConst", "exports"))).toBe(false);
  });

  it("parses a .tsx file (JSX does not break parsing)", () => {
    const tsxSource = [
      "/** @deprecated */",
      'export const OldWidget = () => <div className="x">hi</div>;',
      "export const LiveWidget = () => <span>ok</span>;",
    ].join("\n");
    const tsxLookup = createDeprecatedExportLookup(readerFor({ "src/widget.tsx": tsxSource }));
    expect(tsxLookup(sym("OldWidget", "exports", undefined, "src/widget.tsx", tsxSource))).toBe(
      true,
    );
    expect(tsxLookup(sym("LiveWidget", "exports", undefined, "src/widget.tsx", tsxSource))).toBe(
      false,
    );
  });

  it("reads and parses each file only once across many lookups (memoized)", () => {
    let reads = 0;
    const counting: RepoFileReader = (filePath) => {
      if (filePath === SOURCE_FILE) {
        reads += 1;
        return SOURCE;
      }
      return undefined;
    };
    const memoLookup = createDeprecatedExportLookup(counting);
    memoLookup(sym("oldConst", "exports"));
    memoLookup(sym("liveConst", "exports"));
    memoLookup(sym("OldType", "types"));
    expect(reads).toBe(1);
  });
});

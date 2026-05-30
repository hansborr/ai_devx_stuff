import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ALL_CHECKS,
  buildDefaultChecksConfig,
  CHECK_METADATA,
  DEFAULT_CHECKS,
} from "./check-metadata.js";
import { CHECK_PLUGINS } from "./check-registry.js";

describe("check metadata registry", () => {
  it("enumerates checks in the same canonical order as the runtime registry", () => {
    expect(CHECK_METADATA.map((meta) => meta.id)).toEqual(CHECK_PLUGINS.map((plugin) => plugin.id));
  });

  it("is the single source of per-check default config", () => {
    const defaults = buildDefaultChecksConfig();
    for (const meta of CHECK_METADATA) {
      expect(defaults[meta.id], meta.id).toEqual(meta.defaultConfig);
    }
  });

  it("keeps runtime-plugin defaults aligned with metadata defaults", () => {
    for (const plugin of CHECK_PLUGINS) {
      const meta = CHECK_METADATA.find((entry) => entry.id === plugin.id);
      expect(plugin.defaultConfig, plugin.id).toEqual(meta?.defaultConfig);
    }
  });

  it("excludes opt-in (runByDefault: false) checks from the default set", () => {
    const optIn = CHECK_METADATA.filter((meta) => meta.runByDefault === false).map(
      (meta) => meta.id,
    );
    expect(optIn.length).toBeGreaterThan(0);
    for (const id of optIn) {
      expect(DEFAULT_CHECKS).not.toContain(id);
      expect(ALL_CHECKS).toContain(id);
    }
  });
});

// Structural guard for the metadata/runtime split: the lightweight config surface
// must not import a runtime adapter (a tool runner, a graph builder, the runtime
// registry, a concrete `*-check` plugin, or a known heavy analysis package). That
// boundary is what lets `cli-args.ts`/`config-parsing.ts`/`config-defaults.ts`
// enumerate checks and parse config without loading the jscpd/knip/ts-morph
// wiring. The guard walks transitive relative value imports/re-exports and
// deliberately ignores type-only imports so metadata types can still reference
// the shared contracts without becoming runtime edges.
describe("check metadata import boundary", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const lightweightEntries = [
    "check-metadata.ts",
    "cli-args.ts",
    "config-parsing.ts",
    "config-defaults.ts",
  ];
  const heavyPackages = new Set(["ts-morph"]);

  type ImportEdge = {
    readonly from: string;
    readonly specifier: string;
    readonly target?: string;
  };

  function forbiddenRuntimeEdges(entryFile: string): string[] {
    const seen = new Set<string>();
    const pending = [entryFile];
    const offenders: string[] = [];
    for (const file of pending) {
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const edge of valueImportEdges(file, source)) {
        if (isForbiddenExternal(edge.specifier) || isForbiddenLocal(edge.target)) {
          offenders.push(formatEdge(edge));
        }
        if (edge.target !== undefined && !seen.has(edge.target)) pending.push(edge.target);
      }
    }
    return offenders;
  }

  function valueImportEdges(file: string, source: string): ImportEdge[] {
    return valueImportSpecifiers(source).map((specifier) => {
      const target = resolveRelativeModule(file, specifier);
      return target === undefined ? { from: file, specifier } : { from: file, specifier, target };
    });
  }

  function valueImportSpecifiers(source: string): string[] {
    return source.split(";").flatMap((statement) => valueImportSpecifierForStatement(statement));
  }

  function valueImportSpecifierForStatement(statement: string): string[] {
    const trimmed = stripLeadingTrivia(statement);
    const sideEffect = trimmed.match(/^import\s+"([^"]+)"$/u);
    if (sideEffect?.[1] !== undefined) return [sideEffect[1]];

    const keyword = importExportKeyword(trimmed);
    if (keyword === undefined) return [];
    const match = trimmed.match(/\bfrom\s+"([^"]+)"$/u);
    if (match === null || match[1] === undefined) return [];
    const specifier = match[1];
    const fromIndex = match.index;
    if (fromIndex === undefined) return [];
    const clause = trimmed.slice(keyword.length + 1, fromIndex);
    return isTypeOnlyClause(clause) ? [] : [specifier];
  }

  function stripLeadingTrivia(statement: string): string {
    let remaining = statement.trimStart();
    for (;;) {
      if (remaining.startsWith("//")) {
        const newline = remaining.indexOf("\n");
        if (newline < 0) return "";
        remaining = remaining.slice(newline + 1).trimStart();
        continue;
      }
      if (remaining.startsWith("/*")) {
        const end = remaining.indexOf("*/");
        if (end < 0) return "";
        remaining = remaining.slice(end + 2).trimStart();
        continue;
      }
      return remaining.trimEnd();
    }
  }

  function importExportKeyword(statement: string): "import" | "export" | undefined {
    if (statement.startsWith("import ")) return "import";
    if (statement.startsWith("export ")) return "export";
    return undefined;
  }

  function isTypeOnlyClause(clause: string): boolean {
    const trimmed = clause.trim();
    if (trimmed.startsWith("type ")) return true;
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
    const names = trimmed
      .slice(1, -1)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    return names.length > 0 && names.every((name) => name.startsWith("type "));
  }

  function resolveRelativeModule(file: string, specifier: string): string | undefined {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
    const resolved = path.resolve(dir, path.dirname(file), specifier);
    const tsPath = resolved.endsWith(".js") ? `${resolved.slice(0, -3)}.ts` : resolved;
    return path.relative(dir, tsPath).split(path.sep).join("/");
  }

  function isForbiddenLocal(target: string | undefined): boolean {
    if (target === undefined) return false;
    const name = path.basename(target, ".ts");
    return (
      name === "check-registry" ||
      name === "near-duplicates-fingerprint" ||
      name.endsWith("-runner") ||
      name.endsWith("-graph") ||
      name.endsWith("-check")
    );
  }

  function isForbiddenExternal(specifier: string): boolean {
    return heavyPackages.has(specifier);
  }

  function formatEdge(edge: ImportEdge): string {
    const target = edge.target === undefined ? edge.specifier : edge.target;
    return `${edge.from} -> ${target}`;
  }

  for (const file of lightweightEntries) {
    it(`${file} has no runtime imports in its value closure`, () => {
      const offenders = forbiddenRuntimeEdges(file);
      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  }
});

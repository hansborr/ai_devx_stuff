import path from "node:path";

import { ts } from "ts-morph";

import { toPosix } from "./path-util.js";
import { tsSysReadFile } from "./ts-source-util.js";

const MAX_DIAGNOSTICS = 3;
const TS_CANNOT_READ_FILE = 5083;

export type AliasHead = { readonly head: string; readonly exact: boolean };

type ResolvedTsconfig = {
  readonly options: ts.CompilerOptions;
  readonly aliasHeads: readonly AliasHead[];
};

export type TsconfigLoadState =
  | { readonly kind: "loaded"; readonly config: ResolvedTsconfig }
  | { readonly kind: "missing"; readonly diagnostic: string }
  | { readonly kind: "invalid"; readonly diagnostic: string };

export function loadTsconfig(
  tsconfigPath: string,
  cache: Map<string, TsconfigLoadState>,
): TsconfigLoadState {
  const cached = cache.get(tsconfigPath);
  if (cached !== undefined) return cached;

  const read = ts.readConfigFile(tsconfigPath, tsSysReadFile);
  if (read.error !== undefined) {
    return cacheTsconfig(cache, tsconfigPath, {
      kind: read.error.code === TS_CANNOT_READ_FILE ? "missing" : "invalid",
      diagnostic: formatDiagnostics([read.error]),
    });
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfigPath));
  if (parsed.errors.length > 0) {
    return cacheTsconfig(cache, tsconfigPath, {
      kind: "invalid",
      diagnostic: formatDiagnostics(parsed.errors),
    });
  }

  return cacheTsconfig(cache, tsconfigPath, {
    kind: "loaded",
    config: {
      options: parsed.options,
      aliasHeads: aliasHeadsFor(parsed.options),
    },
  });
}

export function loadedTsconfigCount(cache: ReadonlyMap<string, TsconfigLoadState>): number {
  let count = 0;
  for (const state of cache.values()) {
    if (state.kind === "loaded") count += 1;
  }
  return count;
}

export function explicitTsconfigSkipReason(
  displayPath: string,
  state: Exclude<TsconfigLoadState, { readonly kind: "loaded" }>,
): string {
  const status = state.kind === "missing" ? "could not be read" : "is invalid";
  return `explicit --tsconfig ${displayPath} ${status}: ${state.diagnostic}`;
}

function cacheTsconfig(
  cache: Map<string, TsconfigLoadState>,
  tsconfigPath: string,
  state: TsconfigLoadState,
): TsconfigLoadState {
  cache.set(tsconfigPath, state);
  return state;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  const head = diagnostics.slice(0, MAX_DIAGNOSTICS).map(formatDiagnostic);
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    head.push(`${diagnostics.length - MAX_DIAGNOSTICS} more diagnostic(s)`);
  }
  return head.join("; ");
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const location = `${toPosix(diagnostic.file.fileName)}:${position.line + 1}:${
      position.character + 1
    }`;
    return `${location} TS${diagnostic.code}: ${message}`;
  }
  return `TS${diagnostic.code}: ${message}`;
}

function aliasHeadsFor(options: ts.CompilerOptions): AliasHead[] {
  const paths = options.paths;
  if (paths === undefined) return [];
  return Object.keys(paths).map((key) =>
    key.endsWith("*") ? { head: key.slice(0, -1), exact: false } : { head: key, exact: true },
  );
}

import { readFileSync } from "node:fs";
import path from "node:path";

import { ts } from "ts-morph";

import type { DriftAiIgnoreConfig } from "./config.js";
import { toPosix } from "./path-util.js";
import { walkSourceFiles } from "./source-walk.js";
import { scriptKindFor } from "./ts-source-util.js";

export type ParsedSourceFile = {
  readonly filePath: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
};

export type ParsedSourceCollectionInput = {
  readonly repoRoot: string;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
};

export type SourceFileReader = (absolutePath: string) => string;
export type SourceFileParser = (filePath: string, source: string) => ts.SourceFile;

export type ParsedSourceFileCacheOptions = {
  readonly readFile?: SourceFileReader;
  readonly parseSourceFile?: SourceFileParser;
};

export type ParsedSourceFileCache = {
  readonly collect: (input: ParsedSourceCollectionInput) => readonly ParsedSourceFile[];
};

const REPORT_CACHE_KEY = "parsed-source-file-cache";

export function collectParsedSourceFiles(
  input: ParsedSourceCollectionInput,
  options: ParsedSourceFileCacheOptions = {},
): readonly ParsedSourceFile[] {
  const repoRoot = path.resolve(input.repoRoot);
  const readFile = options.readFile ?? defaultReadFile;
  const parseSourceFile = options.parseSourceFile ?? defaultParseSourceFile;
  return walkSourceFiles({ ...input, repoRoot }).map((filePath) => {
    const normalizedPath = toPosix(filePath);
    const source = readFile(path.join(repoRoot, normalizedPath));
    return {
      filePath: normalizedPath,
      source,
      sourceFile: parseSourceFile(normalizedPath, source),
    };
  });
}

export function createParsedSourceFileCache(
  options: ParsedSourceFileCacheOptions = {},
): ParsedSourceFileCache {
  const collections = new Map<string, readonly ParsedSourceFile[]>();
  return {
    collect: (input) => {
      const key = cacheKey(input);
      const cached = collections.get(key);
      if (cached !== undefined) return cached;
      const collected = collectParsedSourceFiles(input, options);
      collections.set(key, collected);
      return collected;
    },
  };
}

export function parsedSourceFileCacheForReport(
  reportCache: Map<string, unknown> | undefined,
): ParsedSourceFileCache {
  if (reportCache === undefined) return createParsedSourceFileCache();
  const cached = reportCache.get(REPORT_CACHE_KEY);
  if (isParsedSourceFileCache(cached)) return cached;
  const created = createParsedSourceFileCache();
  reportCache.set(REPORT_CACHE_KEY, created);
  return created;
}

function defaultReadFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

function defaultParseSourceFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
}

function cacheKey(input: ParsedSourceCollectionInput): string {
  return JSON.stringify({
    repoRoot: path.resolve(input.repoRoot),
    roots: [...input.roots],
    sourceExtensions: [...input.sourceExtensions].sort(),
    ignore: {
      segments: [...input.ignore.segments],
      prefixes: [...input.ignore.prefixes],
      globs: [...input.ignore.globs],
    },
  });
}

function isParsedSourceFileCache(value: unknown): value is ParsedSourceFileCache {
  return isObjectWithCollect(value) && typeof value.collect === "function";
}

function isObjectWithCollect(value: unknown): value is { readonly collect?: unknown } {
  return typeof value === "object" && value !== null;
}

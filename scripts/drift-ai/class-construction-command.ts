import {
  type ClassConstructionInventory,
  type ClassConstructionSourceInput,
  inventoryClasses,
} from "./class-construction.js";
import {
  buildClassConstructionAdvisory,
  formatClassConstructionAdvisoryJson,
  formatClassConstructionAdvisoryText,
} from "./class-construction-advisory.js";
import {
  parseClassConstructionArgs,
  type ParsedClassConstructionArgs,
} from "./class-construction-args.js";
import type { BufferGitRunner, StatRunner } from "./current-inventory.js";
import type { GitRunner } from "./git-changed-scope.js";
import { loadKnipUnusedExportsReport } from "./knip-unused-exports-report.js";
import { configuredRootFor, toPosix } from "./path-util.js";
import { prepareCurrentRun } from "./prepare-run.js";
import {
  currentPrototypeCliOptions,
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  runPrototypeCommand,
} from "./prototype-command.js";
import { defaultFileReader, type RepoFileReader } from "./repo-io.js";
import type { ReportWriter } from "./report-output.js";

export type ClassConstructionRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  readonly readFile?: RepoFileReader;
  readonly writer?: ReportWriter;
};

export type ClassConstructionRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runClassConstruction(
  options: ClassConstructionRunOptions,
): ClassConstructionRunResult {
  return runPrototypeCommand(options, {
    parse: parseClassConstructionArgs,
    run: runParsedClassConstruction,
  });
}

function runParsedClassConstruction(
  options: ClassConstructionRunOptions,
  parsed: ParsedClassConstructionArgs,
): ClassConstructionRunResult {
  const prepared = prepareCurrentRun(currentPrototypeCliOptions(parsed), options);
  const loadedSources = readCurrentSources(
    prepared.detectorScope.files.map((file) => file.path),
    options.readFile ?? defaultFileReader(prepared.repoRoot),
  );
  const report = loadKnipUnusedExportsReport(prepared.repoRoot, parsed.unusedExportsReportPath);
  const inventory = inventoryClassesByScope(loadedSources.sources, prepared.roots);
  const advisory = buildClassConstructionAdvisory({
    inventory,
    sourceFileCount: loadedSources.sources.length,
    unreadableSourceFiles: loadedSources.unreadableFiles,
    unusedExportsReport: report.status,
    unusedExportSymbols: report.symbols,
    top: parsed.top,
  });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatClassConstructionAdvisoryJson,
      text: formatClassConstructionAdvisoryText,
    }),
    options.writer,
  );
}

function inventoryClassesByScope(
  sources: readonly ClassConstructionSourceInput[],
  roots: readonly string[],
): ClassConstructionInventory {
  return {
    classes: [...groupSourcesByScope(sources, roots).values()]
      .flatMap((bucket) => inventoryClasses(bucket).classes)
      .sort(
        (left, right) =>
          left.filePath.localeCompare(right.filePath, "en") ||
          left.startLine - right.startLine ||
          left.displayName.localeCompare(right.displayName, "en"),
      ),
  };
}

function groupSourcesByScope(
  sources: readonly ClassConstructionSourceInput[],
  roots: readonly string[],
): Map<string, ClassConstructionSourceInput[]> {
  const byScope = new Map<string, ClassConstructionSourceInput[]>();
  for (const source of sources) {
    const key = scopeKeyFor(source.filePath, roots);
    const bucket = byScope.get(key);
    if (bucket === undefined) byScope.set(key, [source]);
    else bucket.push(source);
  }
  return byScope;
}

function scopeKeyFor(filePath: string, roots: readonly string[]): string {
  const configuredRoot = configuredRootFor(filePath, roots);
  if (configuredRoot !== undefined && configuredRoot !== ".") return configuredRoot;
  const parts = toPosix(filePath).split("/");
  if (parts[0] === "packages" && parts[1] !== undefined) return `packages/${parts[1]}`;
  return parts[0] ?? ".";
}

type LoadedClassSources = {
  readonly sources: readonly ClassConstructionSourceInput[];
  readonly unreadableFiles: readonly string[];
};

function readCurrentSources(
  filePaths: readonly string[],
  readFile: RepoFileReader,
): LoadedClassSources {
  const sources: ClassConstructionSourceInput[] = [];
  const unreadableFiles: string[] = [];
  for (const filePath of filePaths) {
    const source = readFile(filePath);
    if (source === undefined) unreadableFiles.push(filePath);
    else sources.push({ filePath, source });
  }
  return { sources, unreadableFiles };
}

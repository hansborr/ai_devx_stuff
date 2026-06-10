// Command wiring for the `semgrep-candidates` prototype subcommand (semgrep
// plan, slice 4). Slices 1-3 own the parts; this module owns the order: parse
// args, prepare the current-scope run (repo root, root validation, config
// discovery — Semgrep does its own file discovery per plan decision 7), read
// the manifest (the command owns file IO), gate every declared rule source,
// scan ONLY when at least one source survived the gate, and render the
// prototype advisory. Expected absences — no semgrep binary, no/blocked rule
// sources — exit 0 as unmet prerequisites; only usage/config defects exit 2.

import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { matchesAnyGlob } from "./config-match.js";
import type { BufferGitRunner, StatRunner } from "./current-inventory.js";
import { DriftAiError } from "./errors.js";
import type { GitRunner } from "./git-changed-scope.js";
import { prepareCurrentRun } from "./prepare-run.js";
import {
  currentPrototypeCliOptions,
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";
import {
  buildSemgrepAdvisory,
  formatSemgrepAdvisoryJson,
  formatSemgrepAdvisoryText,
} from "./semgrep-advisory.js";
import {
  type ParsedSemgrepCandidatesArgs,
  parseSemgrepCandidatesArgs,
} from "./semgrep-candidates-args.js";
import { parseRuleSourceManifest } from "./semgrep-rule-manifest.js";
import {
  evaluateRuleSources,
  type RuleSourceDecision,
  type SemgrepRuleSource,
} from "./semgrep-rule-sources.js";
import {
  defaultSemgrepRunner,
  excludeGlobsCoverPath,
  type SemgrepRunner,
  type SemgrepRunnerResult,
  semgrepScanExcludeGlobs,
} from "./semgrep-runner.js";

export type SemgrepCandidatesRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  // Injectable Semgrep runner so a CLI smoke test never needs the binary installed.
  readonly semgrep?: SemgrepRunner;
  // Injectable local-rule-config existence probe (defaults to fs.existsSync) so
  // command tests can declare rule sources without touching disk.
  readonly ruleConfigExists?: (absolutePath: string) => boolean;
  readonly writer?: ReportWriter;
};

export type SemgrepCandidatesRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runSemgrepCandidates(
  options: SemgrepCandidatesRunOptions,
): SemgrepCandidatesRunResult {
  return runPrototypeCommand(options, {
    parse: parseSemgrepCandidatesArgs,
    run: runParsedSemgrepCandidates,
  });
}

function runParsedSemgrepCandidates(
  options: SemgrepCandidatesRunOptions,
  parsed: ParsedSemgrepCandidatesArgs,
): SemgrepCandidatesRunResult {
  const prepared = prepareCurrentRun(currentPrototypeCliOptions(parsed), options);
  const ruleConfigExists = options.ruleConfigExists ?? existsSync;
  const ruleSources = evaluateRuleSources(declaredRuleSources(prepared.repoRoot, parsed), {
    allowedRuleLicenses: parsed.allowedRuleLicenses,
    allowLiveRegistry: parsed.allowLiveRegistry,
    // Declared-but-missing local configs are unmet prerequisites (the
    // documented contract), not late semgrep run failures. Relative paths
    // resolve from the repo root, exactly like the runner's spawn cwd.
    localConfigExists: (config) => ruleConfigExists(path.resolve(prepared.repoRoot, config)),
  });
  const run = runSemgrepEngine(options, prepared, parsed, ruleSources);
  const advisory = buildSemgrepAdvisory(
    {
      ruleSources,
      run,
      // The command owns file IO: probe for target-supplied .semgrepignore
      // files, which Semgrep honors silently, so the advisory can disclose
      // them. Probed only behind a completed scan — the only outcome whose
      // advisory reads the flag — only inside the scan roots (a nested
      // .semgrepignore governs only its own subtree, so one outside the roots
      // cannot have shaped the scan), and only outside the scan's own
      // --exclude scope, so an excluded vendor tree never reads as target
      // scan shaping.
      targetHasSemgrepignore:
        run !== null &&
        run.ok &&
        hasTargetSemgrepignore(
          prepared.repoRoot,
          prepared.roots,
          semgrepScanExcludeGlobs({ roots: prepared.roots, ignore: prepared.config.ignore }),
        ),
    },
    { top: parsed.top, includeRuleMessages: parsed.includeRuleMessages },
  );
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatSemgrepAdvisoryJson,
      text: formatSemgrepAdvisoryText,
    }),
    options.writer,
  );
}

// Manifest sources scan ahead of CLI sources; each mechanism keeps its own
// declaration order. The manifest is read here — slice 1's parser deliberately
// takes text, not a path.
function declaredRuleSources(
  repoRoot: string,
  parsed: ParsedSemgrepCandidatesArgs,
): readonly SemgrepRuleSource[] {
  if (parsed.ruleSourceManifestPath === null) return parsed.cliRuleSources;
  return [
    ...parseRuleSourceManifest(
      readManifestText(repoRoot, parsed.ruleSourceManifestPath),
      parsed.ruleSourceManifestPath,
    ),
    ...parsed.cliRuleSources,
  ];
}

// An unreadable manifest is a usage/config error (exit 2) like a malformed
// one: the operator named the path explicitly, unlike a missing binary or a
// blocked source, which stay unmet prerequisites at exit 0.
function readManifestText(repoRoot: string, manifestPath: string): string {
  try {
    return readFileSync(path.resolve(repoRoot, manifestPath), "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DriftAiError(
      `semgrep rule-source manifest '${manifestPath}' cannot be read: ${detail}.`,
    );
  }
}

// `run: null` means the scan was skipped because no source survived the gate;
// the advisory then renders the engine prerequisite as "not probed" instead of
// claiming anything about the binary.
function runSemgrepEngine(
  options: SemgrepCandidatesRunOptions,
  prepared: ReturnType<typeof prepareCurrentRun>,
  parsed: ParsedSemgrepCandidatesArgs,
  ruleSources: readonly RuleSourceDecision[],
): SemgrepRunnerResult | null {
  const allowed = ruleSources.filter((decision) => decision.allowed);
  if (allowed.length === 0) return null;
  const runner =
    options.semgrep ??
    defaultSemgrepRunner(parsed.semgrepBin === null ? {} : { bin: parsed.semgrepBin });
  // Roots pass through unfiltered (plan decision 7): no detectorScope.files, no
  // sourceExtensions gating — Semgrep's own language detection picks files, and
  // the drift ignore config travels as --exclude flags inside the runner.
  return runner({
    repoRoot: prepared.repoRoot,
    roots: prepared.roots,
    ignore: prepared.config.ignore,
    ruleConfigs: uniqueRuleConfigs(
      allowed.map((decision) =>
        decision.source.kind === "local" ? decision.source.config : decision.source.pack,
      ),
    ),
  });
}

function uniqueRuleConfigs(configs: readonly string[]): string[] {
  const seen = new Set<string>();
  return configs.filter((config) => {
    if (seen.has(config)) return false;
    seen.add(config);
    return true;
  });
}

function hasTargetSemgrepignore(
  repoRoot: string,
  roots: readonly string[],
  excludeGlobs: readonly string[],
): boolean {
  const scoped = scopedProbeDirs(roots);
  if (scoped === null) return hasTargetSemgrepignoreInDir(repoRoot, "", excludeGlobs, new Set());
  const seen = new Set<string>();
  return (
    scoped.ancestorDirs.some((relativeDir) =>
      dirHasSemgrepignoreFile(repoRoot, relativeDir, excludeGlobs),
    ) ||
    scoped.subtreeRoots.some((relativeDir) =>
      hasTargetSemgrepignoreInDir(
        path.join(repoRoot, relativeDir),
        relativeDir,
        excludeGlobs,
        seen,
      ),
    )
  );
}

// Which directories a root-scoped scan's .semgrepignore files can live in: a
// nested .semgrepignore governs only its own subtree (Semgrepignore v2
// gitignore semantics), so only files inside the requested roots — plus the
// repo root and each root's ancestor directories, whose files govern subtrees
// that include the root — can have shaped the scan. Whole-repo scans (no
// roots, or a "." root; roots arrive collapsed from prepareCurrentRun) keep
// the full-tree probe and return null.
function scopedProbeDirs(roots: readonly string[]): {
  readonly ancestorDirs: readonly string[];
  readonly subtreeRoots: readonly string[];
} | null {
  const subtreeRoots = [...new Set(roots)].filter((root) => root.trim().length > 0);
  if (subtreeRoots.length === 0 || subtreeRoots.includes(".")) return null;
  const ancestorDirs = new Set<string>([""]);
  for (const root of subtreeRoots) {
    const segments = root.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      ancestorDirs.add(segments.slice(0, depth).join("/"));
    }
  }
  return { ancestorDirs: [...ancestorDirs], subtreeRoots };
}

// File-only probe for the repo root and a scan root's ancestor directories:
// their own .semgrepignore governs subtrees that include the root, but their
// other children sit outside the scan.
function dirHasSemgrepignoreFile(
  repoRoot: string,
  relativeDir: string,
  excludeGlobs: readonly string[],
): boolean {
  const relPath = relativeDir === "" ? ".semgrepignore" : `${relativeDir}/.semgrepignore`;
  if (matchesAnyGlob(relPath, excludeGlobs)) return false;
  return readDirSafe(path.join(repoRoot, relativeDir)).some(
    (entry) => entry.name === ".semgrepignore" && entry.isFile(),
  );
}

function hasTargetSemgrepignoreInDir(
  absoluteDir: string,
  relativeDir: string,
  excludeGlobs: readonly string[],
  seen: Set<string>,
): boolean {
  if (seen.has(absoluteDir)) return false;
  seen.add(absoluteDir);
  return readDirSafe(absoluteDir).some((entry) => {
    const relPath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    return entry.isDirectory()
      ? probeSemgrepignoreSubdir(
          entry.name,
          path.join(absoluteDir, entry.name),
          relPath,
          excludeGlobs,
          seen,
        )
      : entry.name === ".semgrepignore" && entry.isFile() && !matchesAnyGlob(relPath, excludeGlobs);
  });
}

function probeSemgrepignoreSubdir(
  name: string,
  absoluteDir: string,
  relativeDir: string,
  excludeGlobs: readonly string[],
  seen: Set<string>,
): boolean {
  if (isSkippedSemgrepignoreProbeDir(name)) return false;
  // The scan --excludes this subtree, so a .semgrepignore inside it cannot
  // have shaped the scan (a nested file only governs its own subtree).
  if (excludeGlobsCoverPath(excludeGlobs, relativeDir)) return false;
  return hasTargetSemgrepignoreInDir(absoluteDir, relativeDir, excludeGlobs, seen);
}

function readDirSafe(absoluteDir: string): Dirent[] {
  try {
    return readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// .git and node_modules are never Semgrep targets. .tools is the drift:ai
// tools-checkout convention (slice 0 installs the engine and rules there, in
// the checkout the command itself runs from), so anything vendored under it —
// e.g. a .semgrepignore inside an engine venv — is not target scan shaping.
function isSkippedSemgrepignoreProbeDir(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === ".tools";
}

// Single source of truth for expanding scripts/lint-ratchet/portable-manifest.json
// into the concrete portable file set. The manifest data is authoritative; this
// module is the one place the expansion *semantics* (pattern matching, directory
// expansion) live, so the demo-sync checker, the portability output test, and the
// shell smoke cannot drift apart.
//
// LEAF module: imports only node builtins so it rides along in the portable copy
// set without pulling foreign dependencies into an adopter's checkout.

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORTABLE_MANIFEST_PATH = "scripts/lint-ratchet/portable-manifest.json";

interface DirectoryExpansion {
  readonly path: string;
  readonly include: string;
  readonly exclude: readonly string[];
}

export interface PortableManifest {
  readonly version: number;
  readonly runtimeFiles: readonly string[];
  readonly expandDirectories: readonly DirectoryExpansion[];
  readonly mergeDriverFiles: readonly string[];
}

export interface ExpandedPortableManifest {
  // manifest.runtimeFiles plus every file selected by expandDirectories,
  // deduplicated and sorted.
  readonly runtimeFiles: string[];
  // manifest.mergeDriverFiles verbatim (the shell smoke omits these).
  readonly mergeDriverFiles: string[];
}

export function matchesManifestPattern(name: string, pattern: string): boolean {
  return pattern.startsWith("*") ? name.endsWith(pattern.slice(1)) : name === pattern;
}

export function loadPortableManifest(repoRoot: string): PortableManifest {
  const text = readFileSync(join(repoRoot, PORTABLE_MANIFEST_PATH), "utf8");
  // type-assertion-boundary: json - portable-manifest.json validated shape below
  const manifest = JSON.parse(text) as PortableManifest;
  if (manifest.version !== 1) {
    throw new Error(`unsupported portable manifest version: ${String(manifest.version)}`);
  }
  return manifest;
}

// Flat, non-recursive expansion. A subdirectory under an expandDirectories path
// (or an include that matches nothing) is treated as an error rather than being
// silently skipped, so a module moved into a new subdirectory cannot narrow the
// copy set behind a green check.
function expandDirectory(repoRoot: string, expansion: DirectoryExpansion): string[] {
  const matched: string[] = [];
  for (const entry of readdirSync(join(repoRoot, expansion.path), { withFileTypes: true })) {
    // The directory guard must precede the include/exclude name filters: with
    // a production include like `*.ts`, a plainly named subdirectory fails the
    // name match, and filtering it out first would skip this error — exactly
    // the silent copy-set narrowing the guard exists to prevent. Because the
    // guard runs first, an exclude pattern for the directory never gets a chance
    // to fire, so the message must not advertise one: the only working remedy is
    // an explicit runtimeFiles entry per file.
    if (entry.isDirectory()) {
      throw new Error(
        `portable manifest expandDirectories '${expansion.path}' contains subdirectory ` +
          `'${entry.name}'; flat expansion cannot copy it. Add an explicit runtimeFiles entry ` +
          `for each file the subdirectory should contribute.`,
      );
    }
    if (!matchesManifestPattern(entry.name, expansion.include)) continue;
    if (expansion.exclude.some((pattern) => matchesManifestPattern(entry.name, pattern))) continue;
    matched.push(`${expansion.path}/${entry.name}`);
  }
  if (matched.length === 0) {
    throw new Error(
      `portable manifest expandDirectories '${expansion.path}' include '${expansion.include}' ` +
        `matched no entries`,
    );
  }
  return matched;
}

export function expandPortableManifest(
  manifest: PortableManifest,
  repoRoot: string,
): ExpandedPortableManifest {
  const runtimeFiles = [...manifest.runtimeFiles];
  for (const expansion of manifest.expandDirectories) {
    runtimeFiles.push(...expandDirectory(repoRoot, expansion));
  }
  return {
    runtimeFiles: [...new Set(runtimeFiles)].sort(),
    mergeDriverFiles: [...manifest.mergeDriverFiles],
  };
}

// classifyScriptEntry-style loud entry guard: run the CLI only when this module
// is the process entry point. Node's ESM loader realpaths the entry URL while a
// raw resolve does not, so probe both. When argv[1] names this file yet the
// identity check still fails, that is a wiring anomaly — fail loud (exit 2)
// rather than silently print nothing.
function shouldRunAsCli(argvPath: string | undefined, importMetaUrl: string): boolean {
  if (argvPath === undefined) return false;
  const target = fileURLToPath(importMetaUrl);
  const resolved = resolve(argvPath);
  const candidates = [resolved];
  try {
    candidates.push(realpathSync(resolved));
  } catch {
    // realpath throws if the path vanished mid-run; the unresolved form stands.
  }
  if (candidates.includes(target)) return true;
  if (basename(argvPath) === basename(target)) {
    console.error(
      `portable-manifest-expand: invoked as a script but the entry-point identity check failed — ` +
        `nothing was printed. import.meta.url=${importMetaUrl} did not match argv[1]=${argvPath} ` +
        `(resolved or realpathed).`,
    );
    process.exitCode = 2;
  }
  return false;
}

if (shouldRunAsCli(process.argv[1], import.meta.url)) {
  // Newline-separated runtime file list (merge-driver files intentionally
  // omitted) for the shell smoke's portable fixture copy.
  const { runtimeFiles } = expandPortableManifest(
    loadPortableManifest(process.cwd()),
    process.cwd(),
  );
  process.stdout.write(`${runtimeFiles.join("\n")}\n`);
}

// Drift guard for examples/lint-ratchet-demo: the demo's copied runtime must
// stay byte-identical to the portable file set declared in
// scripts/lint-ratchet/portable-manifest.json — the same manifest the two
// in-repo fixtures consume. This never hand-maintains a second file list; it
// expands the manifest and diffs. Run from the repo root (the demo CI job does).
//
// Full `bun run verify` owns this whole-tree byte-parity check. The changed gate
// deliberately omits it because manifest expansion, not a second path list,
// determines whether any copied source drifted.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";

import {
  expandPortableManifest,
  loadPortableManifest,
} from "./lint-ratchet/portable-manifest-expand.js";

const REPO_ROOT = process.cwd();
const DEMO_DIR = "examples/lint-ratchet-demo";
const PORTABLE_MANIFEST_PATH = "scripts/lint-ratchet/portable-manifest.json";
// Demo-owned adoption surfaces are deliberately not copied from the portable
// manifest. Keep the list explicit so they are neither deleted as stale runtime
// copies nor allowed to disappear behind a green sync check.
const DEMO_AUTHORED_FILES = new Set([
  "eslint-rules/no-console-log.js",
  "scripts/lint-ratchet/lint-ratchet-config.ts",
]);

// The guide-mandated portable script surface (docs/guides/lint-ratchet.md,
// "Substitutable bits"). The demo package.json is authored, not copied, so the
// tree diff cannot see it drift; assert the reference adopter keeps exposing
// every portable command. Check-only: --write never edits the authored file.
const REQUIRED_DEMO_SCRIPTS = [
  "lint:ratchet",
  "lint:ratchet:check-baseline",
  "lint:ratchet:check-registry",
  "lint:ratchet:debt-log",
  "lint:ratchet:install-merge-driver",
  "lint:ratchet:summary",
  "lint:ratchet:trend",
  "lint:ratchet:update",
  "lint:ratchet:zero-baseline",
];

// The top-level demo trees to scan for stale copies are derived from the
// expanded manifest itself, never a hand-maintained inventory: a manifest that
// grows files under a new top-level tree must not leave stale copies there
// unscanned behind a green check.
function demoRuntimeTrees(expected: readonly string[]): string[] {
  return [...new Set(expected.map((rel) => rel.split("/")[0] ?? rel))].sort();
}

// The full expected copy set: expanded runtime files plus merge-driver files,
// deduplicated and sorted. The shared expander is the single source of the
// expansion semantics (see portable-manifest-expand.ts).
function expandedManifestFiles(): string[] {
  const expanded = expandPortableManifest(loadPortableManifest(REPO_ROOT), REPO_ROOT);
  return [...new Set([...expanded.runtimeFiles, ...expanded.mergeDriverFiles])].sort();
}

function walkFiles(root: string): string[] {
  // A demo tree absent from disk is a finding for the check path (see
  // findMissingTrees), not a crash: readdirSync on a missing root throws a raw
  // ENOENT that would mask the checker's own diagnosis.
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(relative(join(REPO_ROOT, DEMO_DIR), full).replaceAll("\\", "/"));
      }
    }
  }
  return out;
}

// Every manifest file exists in the demo and is byte-identical to source.
function collectMissingOrDriftedFiles(expected: readonly string[]): string[] {
  const failures: string[] = [];
  for (const rel of expected) {
    let source: string;
    try {
      source = readFileSync(join(REPO_ROOT, rel), "utf8");
    } catch {
      failures.push(`missing source: ${rel}`);
      continue;
    }
    let copied: string;
    try {
      copied = readFileSync(join(REPO_ROOT, DEMO_DIR, rel), "utf8");
    } catch {
      failures.push(`missing in demo: ${rel}`);
      continue;
    }
    if (copied !== source) failures.push(`out of sync with source: ${rel}`);
  }
  return failures;
}

function findMissingSources(expected: readonly string[]): string[] {
  return expected
    .filter((rel) => !existsSync(join(REPO_ROOT, rel)))
    .map((rel) => `missing source: ${rel}`);
}

function findDemoAuthoredManifestOverlaps(expected: readonly string[]): string[] {
  return expected
    .filter((rel) => DEMO_AUTHORED_FILES.has(rel))
    .map((rel) => `demo-authored file also appears in portable manifest: ${rel}`);
}

function findNonCanonicalManifestPaths(expected: readonly string[]): string[] {
  return expected.flatMap((rel) => {
    const canonical = normalize(rel.replaceAll("\\", "/")).replaceAll("\\", "/");
    const isCanonicalRepoRelativePath =
      rel === canonical &&
      canonical !== "." &&
      !isAbsolute(canonical) &&
      canonical !== ".." &&
      !canonical.startsWith("../");
    return isCanonicalRepoRelativePath
      ? []
      : [`non-canonical portable manifest path: ${rel} (use ${canonical})`];
  });
}

// Copied runtime files in the demo that are absent from the manifest (stale
// leftovers), except the adopter-authored registry.
function findStaleCopies(expected: readonly string[]): string[] {
  const expectedSet = new Set(expected);
  const stale: string[] = [];
  for (const tree of demoRuntimeTrees(expected)) {
    for (const rel of walkFiles(join(REPO_ROOT, DEMO_DIR, tree))) {
      if (DEMO_AUTHORED_FILES.has(rel)) continue;
      if (!expectedSet.has(rel)) stale.push(rel);
    }
  }
  return stale;
}

// Manifest-derived demo trees absent from disk. Reported as findings so a
// partially deleted demo yields the checker's diagnosis, not an ENOENT stack;
// write mode recreates the trees, so only the check path surfaces these.
function findMissingTrees(expected: readonly string[]): string[] {
  return demoRuntimeTrees(expected).filter((tree) => !existsSync(join(REPO_ROOT, DEMO_DIR, tree)));
}

function findMissingDemoScripts(): string[] {
  const packageJsonPath = join(REPO_ROOT, DEMO_DIR, "package.json");
  if (!existsSync(packageJsonPath)) return ["missing demo package.json"];
  // A malformed package.json throws loudly, same as a malformed manifest.
  const raw: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts =
    typeof raw === "object" && raw !== null && "scripts" in raw ? raw.scripts : undefined;
  const names = new Set(
    typeof scripts === "object" && scripts !== null ? Object.keys(scripts) : [],
  );
  return REQUIRED_DEMO_SCRIPTS.filter((name) => !names.has(name)).map(
    (name) => `missing demo package.json script: ${name}`,
  );
}

function findMissingDemoAuthoredFiles(): string[] {
  return [...DEMO_AUTHORED_FILES]
    .filter((rel) => !existsSync(join(REPO_ROOT, DEMO_DIR, rel)))
    .map((rel) => `missing demo-authored file: ${rel}`);
}

function collectStaleCopies(expected: readonly string[]): string[] {
  return [
    ...findMissingTrees(expected).map((tree) => `missing tree in demo: ${tree}`),
    ...findStaleCopies(expected).map((rel) => `not in manifest (stale copy?): ${rel}`),
  ];
}

// --write mode: copy every manifest-expanded source into the demo and delete any
// stale copy, so a drifted/missing/stale demo is restored to byte-parity in one
// command. Never touches demo-authored files.
function writeDemoFromManifest(expected: readonly string[]): void {
  let copied = 0;
  for (const rel of expected) {
    const target = join(REPO_ROOT, DEMO_DIR, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(REPO_ROOT, rel), target);
    copied += 1;
  }
  const stale = findStaleCopies(expected);
  for (const rel of stale) rmSync(join(REPO_ROOT, DEMO_DIR, rel), { force: true });
  console.error(
    `lint-ratchet demo sync written — ${String(copied)} file(s) copied, ` +
      `${String(stale.length)} stale copy(ies) removed.`,
  );
}

function reportFailures(failures: readonly string[]): void {
  console.error("lint-ratchet demo is out of sync with the portable manifest:");
  for (const failure of [...failures].sort()) console.error(`  - ${failure}`);

  const missingSources = failures.some((failure) => failure.startsWith("missing source: "));
  const missingAuthoredScripts = failures.some((failure) =>
    failure.startsWith("missing demo package.json"),
  );
  const missingDemoAuthoredFiles = failures.some((failure) =>
    failure.startsWith("missing demo-authored file: "),
  );
  const ownershipOverlap = failures.some((failure) =>
    failure.startsWith("demo-authored file also appears in portable manifest: "),
  );
  const nonCanonicalManifestPath = failures.some((failure) =>
    failure.startsWith("non-canonical portable manifest path: "),
  );
  const copyDrift = failures.some(
    (failure) =>
      !failure.startsWith("missing source: ") &&
      !failure.startsWith("missing demo package.json") &&
      !failure.startsWith("missing demo-authored file: ") &&
      !failure.startsWith("demo-authored file also appears in portable manifest: ") &&
      !failure.startsWith("non-canonical portable manifest path: "),
  );
  if (missingSources) {
    console.error("\nRestore the missing source file(s), or update the portable manifest.");
  }
  if (missingAuthoredScripts) {
    console.error(
      "\nUpdate examples/lint-ratchet-demo/package.json; --write does not edit authored files.",
    );
  }
  if (missingDemoAuthoredFiles) {
    console.error(
      "\nRestore the demo-authored file(s); --write only repairs manifest-copied runtime files.",
    );
  }
  if (ownershipOverlap) {
    console.error(
      "\nChoose exactly one ownership class for each path before running --write: " +
        "remove it from DEMO_AUTHORED_FILES or from the portable manifest.",
    );
  }
  if (nonCanonicalManifestPath) {
    console.error(
      "\nUse normalized repo-relative paths in the portable manifest before running --write.",
    );
  }
  if (copyDrift) {
    console.error(
      "\nRun `bun run lint:ratchet:demo-sync:update` to repair copied demo files; " +
        "it does not repair missing sources or authored package.json scripts.",
    );
  }
  process.exitCode = 1;
}

function main(): void {
  const write = process.argv.includes("--write");

  // The manifest read resolves against process.cwd(); running the checker from
  // anywhere but the repo root leaves it absent. Fail fast with one diagnostic
  // line rather than the raw Bun ENOENT stack that expansion would otherwise
  // throw. A present-but-malformed manifest still throws loudly (its own error).
  if (!existsSync(join(REPO_ROOT, PORTABLE_MANIFEST_PATH))) {
    console.error(
      `lint-ratchet portable manifest not found at ` +
        `${join(REPO_ROOT, PORTABLE_MANIFEST_PATH)}; run the checker from the repo root.`,
    );
    process.exitCode = 1;
    return;
  }
  const expected = expandedManifestFiles();
  const nonCanonicalManifestPaths = findNonCanonicalManifestPaths(expected);
  if (nonCanonicalManifestPaths.length > 0) {
    reportFailures(nonCanonicalManifestPaths);
    return;
  }
  const ownershipOverlaps = findDemoAuthoredManifestOverlaps(expected);
  if (ownershipOverlaps.length > 0) {
    reportFailures(ownershipOverlaps);
    return;
  }

  if (write) {
    // Preflight every surface --write cannot repair before copying anything.
    // This avoids both a partial demo update when a source is absent and a
    // successful write whose immediate check still fails on authored scripts.
    const blockers = [
      ...findMissingSources(expected),
      ...findMissingDemoScripts(),
      ...findMissingDemoAuthoredFiles(),
    ];
    if (blockers.length > 0) {
      reportFailures(blockers);
      return;
    }
    writeDemoFromManifest(expected);
    return;
  }

  const failures = [
    ...collectMissingOrDriftedFiles(expected),
    ...collectStaleCopies(expected),
    ...findMissingDemoScripts(),
    ...findMissingDemoAuthoredFiles(),
  ];

  if (failures.length > 0) {
    reportFailures(failures);
    return;
  }
  console.error(
    `lint-ratchet demo sync OK — ${String(expected.length)} manifest file(s) verified.`,
  );
}

main();

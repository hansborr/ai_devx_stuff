// No-direct-read tripwire for harness.controls.json (typed-parser phase 1
// acceptance criterion): the manifest's TS read seam used to be bypassed
// freely — many independent, partial, cast-backed pictures of its shape.
// harness-manifest-schema.ts is now the typed contract, and this check keeps
// the direct-reader population frozen so the remaining readers can migrate
// gradually instead of regrowing.
//
// Detection is import-based on the read-capable exports of the leaf reader
// (readHarnessManifest, loadHarnessManifest, harnessManifestPath) in
// non-test walkable source files (TS/JS family) under scripts/. Guards
// cooperative agents against the
// accidental new bypass, not adversaries: prose mentions of the filename,
// shell/jq consumers, and hand-rolled fs reads are out of scope. New readers
// should compose readHarnessManifest with the typed parser
// (harness-manifest-schema.ts); a genuinely new sanctioned reader is added
// here with a category and reason.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { WALKABLE_SOURCE_PATTERN } from "./generated-surfaces.js";
import { type ControlFailures, pushFailure } from "./harness-check-validation.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";

/** Why an allowlisted file is permitted to read the manifest directly. */
type DirectReaderCategory =
  // Reads and content-parses the manifest today; migration target for the
  // typed-parser phase 2 bypass drain.
  | "reader-pending-migration"
  // The typed seam itself, or a consumer already going through it.
  | "sanctioned-reader";

// The read-capable named exports of scripts/harness/harness-manifest.ts —
// the only module in the tree that sources these symbols (verified 2026-07-19;
// harness-manifest-schema.ts is IO-free and exports no read symbol).
const READ_SYMBOLS = "readHarnessManifest|loadHarnessManifest|harnessManifestPath";
// Module specifier for the leaf reader in any quote style (including a
// static-string backtick template, ` — dynamic import()/require() accept
// those too), any relative prefix, and .js/.ts/extensionless form. The
// closing quote must follow the basename directly, so
// harness-manifest-schema.js never matches. ` is the backtick, spelled
// as a regex escape because a literal one would close the template literal.
const SPECIFIER = String.raw`(?<q>["'\u0060])[^"'\u0060\n]*harness-manifest(?:\.[jt]s)?\k<q>`;
const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;
// A read symbol inside an import/export brace list, excluding the erased
// inline type-specifier spelling (`{ type readHarnessManifest }`); a runtime
// specifier alongside an inline type one still matches on its own occurrence.
const RUNTIME_READ_SYMBOL = String.raw`(?<!\btype\s)\b(?:${READ_SYMBOLS})\b`;

/**
 * Cooperative-accident coverage of the ordinary TypeScript forms that grant
 * runtime access to a read-capable symbol. `import type` / `export type` and
 * inline type specifiers (`{ type readHarnessManifest }`) are erased and stay
 * exempt, as do named imports/re-exports of path-only
 * constants. Namespace, default, dynamic `import()`, `require()`, and
 * `export *` forms hand over the whole module object (or would only compile
 * against read symbols), so they always trip the wire. Importing a
 * re-export intermediary is covered transitively: the intermediary is itself
 * a scanned non-test file under scripts/ and its `export ... from` trips the
 * wire, so the indirection cannot exist without a conscious
 * MANIFEST_DIRECT_READERS entry for the intermediary.
 */
const READ_CAPABLE_PATTERNS: readonly RegExp[] = [
  // import { readHarnessManifest } from "..." / import def, { ... } from '...'
  new RegExp(
    String.raw`import\s*(?:${IDENTIFIER}\s*,\s*)?\{[^}]*${RUNTIME_READ_SYMBOL}[^}]*\}\s*from\s*${SPECIFIER}`,
    "u",
  ),
  // import * as manifest from "..." / import def, * as manifest from "..."
  new RegExp(
    String.raw`import\s+(?:${IDENTIFIER}\s*,\s*)?\*\s*as\s+${IDENTIFIER}\s+from\s*${SPECIFIER}`,
    "u",
  ),
  // import manifest from "..."
  new RegExp(String.raw`import\s+${IDENTIFIER}\s+from\s*${SPECIFIER}`, "u"),
  // export { readHarnessManifest } from "..."
  new RegExp(String.raw`export\s*\{[^}]*${RUNTIME_READ_SYMBOL}[^}]*\}\s*from\s*${SPECIFIER}`, "u"),
  // export * from "..." / export * as manifest from "..."
  new RegExp(String.raw`export\s*\*\s*(?:as\s+${IDENTIFIER}\s+)?from\s*${SPECIFIER}`, "u"),
  // await import("...")
  new RegExp(String.raw`\bimport\s*\(\s*${SPECIFIER}\s*\)`, "u"),
  // require("...")
  new RegExp(String.raw`\brequire\s*\(\s*${SPECIFIER}\s*\)`, "u"),
];

// A commented-out import must neither trip the wire nor keep an allowlist
// entry alive. Only line-leading comments are stripped: `/*` or `//` opening
// mid-line can occur inside string literals (glob patterns contain `/*`), and
// stripping those could mask a real import — false negatives are worse than
// false trips for a tripwire. Strings themselves are not modelled.
const LINE_LEADING_BLOCK_COMMENT_PATTERN = /^\s*\/\*[\s\S]*?\*\//gmu;
const LINE_COMMENT_PATTERN = /^\s*\/\/.*$/gmu;

function stripLineLeadingComments(source: string): string {
  return source
    .replaceAll(LINE_LEADING_BLOCK_COMMENT_PATTERN, "")
    .replaceAll(LINE_COMMENT_PATTERN, "");
}

function importsReadCapableSymbol(source: string): boolean {
  const stripped = stripLineLeadingComments(source);
  return READ_CAPABLE_PATTERNS.some((pattern) => pattern.test(stripped));
}

/**
 * The frozen direct-reader population, verified 2026-07-19. Shrink-only:
 * migrating a reader to the typed parser removes its entry; adding one is a
 * conscious design decision, not a hot add.
 */
export const MANIFEST_DIRECT_READERS: ReadonlyMap<string, DirectReaderCategory> = new Map([
  // harness-check parses the whole manifest through the typed schema and
  // additionally runs the granular per-control live-tree validation.
  ["scripts/harness-check.ts", "sanctioned-reader"],
  ["scripts/harness/generate-harness-controls.ts", "reader-pending-migration"],
  ["scripts/harness/generate-hook-timeout-constants.ts", "reader-pending-migration"],
  ["scripts/harness/generate-hook-wiring.ts", "reader-pending-migration"],
  ["scripts/harness/generate-verify-steps.ts", "reader-pending-migration"],
  ["scripts/harness/generated-surfaces.ts", "reader-pending-migration"],
  ["scripts/lint-ratchet/check-registry.ts", "reader-pending-migration"],
]);

const SKIPPED_DIRECTORY_NAMES = new Set(["fixtures", "node_modules", "tests"]);
// Test files across all walkable extensions (probe.test.ts, probe.test.mjs, …).
const TEST_FILE_PATTERN = /\.test\.[^.]+$/u;

function isScannedSourceFile(name: string): boolean {
  return WALKABLE_SOURCE_PATTERN.test(name) && !TEST_FILE_PATTERN.test(name);
}

function collectTsSources(root: string, directory: string, sources: Map<string, string>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        collectTsSources(root, join(directory, entry.name), sources);
      }
      continue;
    }
    if (!entry.isFile() || !isScannedSourceFile(entry.name)) continue;
    const path = join(directory, entry.name);
    sources.set(relative(root, path).replaceAll("\\", "/"), readFileSync(path, "utf8"));
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Scan non-test TS files under `scripts/` for read-capable imports of the
 * manifest leaf reader. Two failure modes: an unlisted importer (the bypass
 * regrowth this tripwire exists to stop), and an allowlisted file that still
 * exists but no longer imports a read symbol (a stale entry — the list only
 * shrinks). Allowlisted files missing from the tree are skipped so reduced
 * fixture trees stay valid.
 */
/**
 * harness-check entry point for the typed-manifest contract: whole-manifest
 * schema failures (additive to the granular per-control validation, which
 * keeps its pinned diagnostics) plus the no-direct-read tripwire below.
 */
export function checkManifestContract(
  repoRoot: string,
  rawManifest: unknown,
  failures: Map<string, ControlFailures>,
): void {
  const schemaResult = safeParseHarnessManifest(rawManifest);
  for (const failure of schemaResult.failures ?? []) {
    pushFailure(failures, "(manifest schema)", failure);
  }
  for (const failure of checkManifestReadTripwire(repoRoot)) {
    pushFailure(failures, "harness.controls.json read tripwire", failure);
  }
}

export function checkManifestReadTripwire(repoRoot: string): readonly string[] {
  const scriptsRoot = join(repoRoot, "scripts");
  if (!isDirectory(scriptsRoot)) return [];
  const sources = new Map<string, string>();
  collectTsSources(repoRoot, scriptsRoot, sources);

  const failures: string[] = [];
  for (const [path, source] of [...sources].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const reads = importsReadCapableSymbol(source);
    const allowlisted = MANIFEST_DIRECT_READERS.has(path);
    if (reads && !allowlisted) {
      failures.push(
        `${path} imports a read-capable harness-manifest symbol but is not a sanctioned direct reader; parse the manifest through scripts/harness/harness-manifest-schema.ts instead, or add a categorized entry to MANIFEST_DIRECT_READERS with a design reason`,
      );
    }
  }
  for (const path of MANIFEST_DIRECT_READERS.keys()) {
    const source = sources.get(path);
    if (source === undefined) continue;
    if (!importsReadCapableSymbol(source)) {
      failures.push(
        `${path} is allowlisted as a direct manifest reader but no longer imports a read-capable symbol; remove its MANIFEST_DIRECT_READERS entry (the list only shrinks)`,
      );
    }
  }
  return failures;
}

/**
 * Render one baseline driver's desired `.git/info/attributes` block.
 *
 * This replaces the awk block-rewriting that lived in
 * scripts/git/baseline-merge-driver-lib.sh. The installer and checker (which run
 * from the repo tree, where bun is available) shell out here; the git-invoked
 * merge driver stays dependency-free and never calls this.
 *
 * Behavior mirrors the previous awk exactly:
 *  - Legacy shared and old single-driver marker blocks are migrated in place:
 *    their markers are dropped and each interior row falls through to the
 *    per-path rules below, so a sibling driver's rows survive as loose lines
 *    rather than being reverted by a standalone single-installer run.
 *  - An existing managed block is refreshed at its original position (not moved
 *    to the end), so re-rendering is position-stable and sibling installers do
 *    not invalidate each other's staleness checks.
 *  - Rows this driver manages (by path, matched with and without a leading
 *    slash) are dropped from loose lines and re-emitted only inside the managed
 *    block.
 *  - An unterminated managed or legacy block is a fail-loud error (exit 2): the
 *    caller must leave the attributes file untouched rather than risk silently
 *    dropping unrelated rules after the dangling marker.
 *
 * Usage:
 *   bun run scripts/git/baseline-info-attributes.ts \
 *     <current-attributes> <rendered-out> <managed-begin> <managed-end> \
 *     <managed-attributes>
 * where <managed-attributes> is a newline-delimited list of attribute rows.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Legacy shared and old single-driver block markers, migrated away on sight.
const LEGACY_BLOCK_BEGINS = new Set([
  "# BEGIN musi baseline merge attributes",
  "# BEGIN musi lint-ratchet merge attributes",
]);
const LEGACY_BLOCK_ENDS = new Set([
  "# END musi baseline merge attributes",
  "# END musi lint-ratchet merge attributes",
]);

const CLI_ARG_OFFSET = 2;
const EXIT_UNTERMINATED_BLOCK = 2;
const EXIT_USAGE = 3;

class UnterminatedBlockError extends Error {}

function stripCr(line: string): string {
  return line.replace(/\r$/u, "");
}

// The first whitespace-delimited field, matching awk's `$1` (which skips any
// leading whitespace before the first token).
function firstToken(line: string): string {
  return line.trimStart().split(/\s+/u)[0] ?? "";
}

function managedPathSet(attributeRows: readonly string[]): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const row of attributeRows) {
    const path = firstToken(row);
    if (path === "") {
      continue;
    }
    paths.add(path);
    // A driver's own rows are matched with and without a leading slash so an
    // anchored managed row also drops the un-anchored loose variant, and vice
    // versa.
    paths.add(path.startsWith("/") ? path.slice(1) : `/${path}`);
  }
  return paths;
}

interface FoldState {
  readonly kept: string[];
  legacy: boolean;
  skip: boolean;
  managedEmitted: boolean;
}

interface ManagedBlock {
  readonly begin: string;
  readonly end: string;
  readonly rows: readonly string[];
  readonly paths: ReadonlySet<string>;
}

/**
 * Classify one attribute line against the managed/legacy block markers,
 * mutating the fold state. Extracted so the top-level render stays under the
 * complexity budget; the branch set matches the previous awk rules line for
 * line.
 */
function foldAttributeLine(state: FoldState, rawLine: string, block: ManagedBlock): void {
  const line = stripCr(rawLine);
  if (LEGACY_BLOCK_BEGINS.has(line)) {
    state.legacy = true;
    return;
  }
  if (LEGACY_BLOCK_ENDS.has(line)) {
    state.legacy = false;
    return;
  }
  if (line === block.begin) {
    if (!state.managedEmitted) {
      state.kept.push(block.begin, ...block.rows, block.end);
      state.managedEmitted = true;
    }
    state.skip = true;
    return;
  }
  if (line === block.end) {
    state.skip = false;
    return;
  }
  if (state.skip || block.paths.has(firstToken(line))) {
    return;
  }
  state.kept.push(line);
}

function foldExistingAttributes(currentAttributes: string, block: ManagedBlock): string[] {
  const state: FoldState = { kept: [], legacy: false, skip: false, managedEmitted: false };
  // A trailing newline yields a final empty element from split(); the awk read
  // loop never saw that phantom line, so drop it before iterating.
  const lines = currentAttributes.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  for (const rawLine of lines) {
    foldAttributeLine(state, rawLine, block);
  }
  if (state.skip || state.legacy) {
    throw new UnterminatedBlockError();
  }
  while (state.kept.length > 0 && state.kept[state.kept.length - 1] === "") {
    state.kept.pop();
  }
  return state.kept;
}

/**
 * Render the attributes body. Returns the rendered file contents (with trailing
 * newline). Throws UnterminatedBlockError when a managed or legacy block never
 * closes.
 */
export function renderBaselineMergeAttributes(input: {
  readonly currentAttributes: string | undefined;
  readonly managedBegin: string;
  readonly managedEnd: string;
  readonly managedAttributes: string;
}): string {
  const { currentAttributes, managedBegin, managedEnd, managedAttributes } = input;
  const rows = managedAttributes.split("\n");
  const block: ManagedBlock = {
    begin: managedBegin,
    end: managedEnd,
    rows,
    paths: managedPathSet(rows),
  };

  const blockPresent =
    currentAttributes !== undefined &&
    currentAttributes
      .split("\n")
      .map(stripCr)
      .some((line) => line === managedBegin);

  const kept =
    currentAttributes === undefined ? [] : foldExistingAttributes(currentAttributes, block);

  if (blockPresent) {
    return kept.length > 0 ? `${kept.join("\n")}\n` : "";
  }

  const trailer = [managedBegin, managedAttributes, managedEnd].join("\n");
  if (kept.length > 0) {
    // A blank separator line between the preserved rows and the appended block,
    // matching the awk `printf '\n'` before the block.
    return `${kept.join("\n")}\n\n${trailer}\n`;
  }
  return `${trailer}\n`;
}

function main(argv: readonly string[]): number {
  const [currentAttributesPath, renderedPath, managedBegin, managedEnd, managedAttributes] = argv;
  if (
    currentAttributesPath === undefined ||
    renderedPath === undefined ||
    managedBegin === undefined ||
    managedEnd === undefined ||
    managedAttributes === undefined
  ) {
    process.stderr.write(
      "usage: bun run scripts/git/baseline-info-attributes.ts <current-attributes> <rendered-out> <managed-begin> <managed-end> <managed-attributes>\n",
    );
    return EXIT_USAGE;
  }

  const currentAttributes = existsSync(currentAttributesPath)
    ? readFileSync(currentAttributesPath, "utf8")
    : undefined;

  let rendered: string;
  try {
    rendered = renderBaselineMergeAttributes({
      currentAttributes,
      managedBegin,
      managedEnd,
      managedAttributes,
    });
  } catch (error) {
    if (error instanceof UnterminatedBlockError) {
      return EXIT_UNTERMINATED_BLOCK;
    }
    throw error;
  }

  writeFileSync(renderedPath, rendered);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(CLI_ARG_OFFSET));
}

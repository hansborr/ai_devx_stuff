/**
 * CLI wrapper for the baseline `.git/info/attributes` rewriter. The pure render
 * lives in `@musi/lint-ratchet/git-rail/info-attributes.js`; this wrapper reads
 * the current attributes file, renders the managed block, and writes the result.
 *
 * The installer and checker (which run from the repo tree, where bun is
 * available) shell out here; the git-invoked merge driver stays dependency-free
 * and never calls this.
 *
 * Usage:
 *   bun run scripts/git/baseline-info-attributes.ts \
 *     <current-attributes> <rendered-out> <managed-begin> <managed-end> \
 *     <managed-attributes>
 * where <managed-attributes> is a newline-delimited list of attribute rows.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  renderBaselineMergeAttributes,
  UnterminatedBlockError,
} from "@musi/lint-ratchet/git-rail/info-attributes.js";

const CLI_ARG_OFFSET = 2;
const EXIT_UNTERMINATED_BLOCK = 2;
const EXIT_USAGE = 3;

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

import type { CoveragePattern } from "./lint-coverage-map-check-types.js";

export interface BuildSuggestionsOptions {
  readonly unaccountedFiles: readonly string[];
  readonly patterns: readonly CoveragePattern[];
  /** Whether a tracked file is covered by at least one lint ratchet. */
  readonly isRatchetCovered: (file: string) => boolean | Promise<boolean>;
  /** Whether ESLint resolves a config for the file (normal-lint reach). */
  readonly isEslintReachable: (file: string) => boolean | Promise<boolean>;
}

const GLOB_META_PATTERN = /[*?{}[\]]/u;

function directoryOf(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash < 0 ? "" : file.slice(0, slash);
}

function fileExtension(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot < 0 ? "" : file.slice(dot);
}

function entryIdFor(file: string): string {
  return (
    file
      .replaceAll(/[^A-Za-z0-9]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "")
      .toLowerCase() || "new-entry"
  );
}

/**
 * The entry a new file most likely belongs to: one that already lists a literal
 * (non-glob) path in the same directory. Extending that entry's `globs` keeps
 * related files on one row instead of scattering near-duplicate rows.
 */
function findSameDirectoryEntry(
  file: string,
  patterns: readonly CoveragePattern[],
): string | undefined {
  const dir = directoryOf(file);
  if (dir === "") return undefined;
  for (const pattern of patterns) {
    if (GLOB_META_PATTERN.test(pattern.glob)) continue;
    if (directoryOf(pattern.glob) === dir) return pattern.entryId;
  }
  return undefined;
}

interface DerivedFields {
  readonly normalLintCovered: boolean;
  readonly ratchets: string;
  readonly status: string;
}

async function deriveFields(
  file: string,
  isRatchetCovered: (file: string) => boolean | Promise<boolean>,
  isEslintReachable: (file: string) => boolean | Promise<boolean>,
): Promise<DerivedFields> {
  const reachable = await isEslintReachable(file);
  const ratcheted = await isRatchetCovered(file);
  if (reachable) {
    return {
      normalLintCovered: true,
      ratchets: ratcheted ? "`ratchet/<id>`" : "none",
      status: ratcheted ? '["linted", "ratcheted"]' : '["linted"]',
    };
  }
  if (ratcheted) {
    return { normalLintCovered: false, ratchets: "`ratchet/<id>`", status: '["ratcheted"]' };
  }
  // Neither linted nor ratcheted: the agent must classify (excluded / not-code /
  // proposed). Emit a placeholder rather than asserting a coverage status.
  return { normalLintCovered: false, ratchets: "none", status: '["excluded" | "not-code"]' };
}

export async function buildSuggestions(options: BuildSuggestionsOptions): Promise<string[]> {
  const { unaccountedFiles, patterns, isRatchetCovered, isEslintReachable } = options;
  if (unaccountedFiles.length === 0) return [];
  const lines: string[] = [
    "",
    "Suggested coverage-manifest edits (paste into the matching",
    "`scripts/lint-coverage-map-manifest-<area>.ts` module):",
    'For `["excluded" | "not-code"]`, choose `excluded` for intentional non-lint code,',
    "`not-code` for docs/generated/binary/vendor, or a `proposed` floor when one should be added.",
  ];
  for (const file of unaccountedFiles) {
    const entryId = findSameDirectoryEntry(file, patterns);
    if (entryId !== undefined) {
      // The glob alone is an edit `:check` rejects: it gates every entry's
      // `Files` count against the tracked files that entry's globs match, so
      // the count has to move with the glob.
      lines.push(
        "",
        `- ${file}: add \`"${file}"\` to the \`globs\` of entry \`${entryId}\`,`,
        `  then count one more \`${fileExtension(file)}\` in that entry's \`files\` cell`,
        "  (unless it carries a `filesCountNote`, which opts it out of the count check).",
      );
      continue;
    }
    const derived = await deriveFields(file, isRatchetCovered, isEslintReachable);
    lines.push(
      "",
      `- ${file}: new entry —`,
      "  {",
      `    id: "${entryIdFor(file)}",`,
      `    globs: ["${file}"],`,
      `    files: "1 ${fileExtension(file)}",`,
      `    normalLint: { covered: ${String(derived.normalLintCovered)} },`,
      `    ratchets: "${derived.ratchets}",`,
      '    parser: "ESLint",',
      '    proposed: "none",',
      `    status: ${derived.status},`,
      '    followUp: "—",',
      "  },",
    );
  }
  return lines;
}

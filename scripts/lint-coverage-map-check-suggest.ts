import type { PathPattern } from "./lint-coverage-map-check-types.js";

export interface BuildSuggestionsOptions {
  readonly unaccountedFiles: readonly string[];
  readonly pathPatterns: readonly PathPattern[];
  /** Whether a tracked file is covered by at least one lint ratchet. */
  readonly isRatchetCovered: (file: string) => boolean | Promise<boolean>;
  /** Whether ESLint resolves a config for the file (normal-lint reach). */
  readonly isEslintReachable: (file: string) => boolean | Promise<boolean>;
}

const HEADER =
  "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |";

function directoryOf(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash < 0 ? "" : file.slice(0, slash);
}

function fileExtension(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot < 0 ? "" : file.slice(dot);
}

function baseNameOf(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash < 0 ? file : file.slice(slash + 1);
}

/**
 * The directory a non-glob pattern roots a row at: the convention is that the
 * first rooted full path in a `Path / group` cell sets the base dir for later
 * bare filenames. A pattern with no glob metacharacters whose directory equals
 * the new file's directory is the row to extend.
 */
function patternBaseDir(pattern: PathPattern): string | undefined {
  if (/[*?{}[\]]/u.test(pattern.pattern)) return undefined;
  return directoryOf(pattern.pattern);
}

function findBaseDirRow(
  file: string,
  pathPatterns: readonly PathPattern[],
): { readonly line: number } | undefined {
  const dir = directoryOf(file);
  if (dir === "") return undefined;
  for (const pattern of pathPatterns) {
    if (patternBaseDir(pattern) === dir) return { line: pattern.line };
  }
  return undefined;
}

interface DerivedColumns {
  readonly normalLint: string;
  readonly ratchet: string;
  readonly status: string;
}

async function deriveColumns(
  file: string,
  isRatchetCovered: (file: string) => boolean | Promise<boolean>,
  isEslintReachable: (file: string) => boolean | Promise<boolean>,
): Promise<DerivedColumns> {
  const reachable = await isEslintReachable(file);
  const ratcheted = await isRatchetCovered(file);
  if (reachable) {
    return {
      normalLint: "yes",
      ratchet: ratcheted ? "`ratchet/<id>`" : "none",
      status: ratcheted ? "linted + ratcheted" : "linted",
    };
  }
  if (ratcheted) {
    return { normalLint: "no", ratchet: "`ratchet/<id>`", status: "ratcheted" };
  }
  // Neither linted nor ratcheted: the agent must classify (excluded / not-code /
  // proposed). Emit a placeholder rather than asserting a coverage status.
  return { normalLint: "no", ratchet: "none", status: "<excluded|not-code|proposed>" };
}

export async function buildSuggestions(options: BuildSuggestionsOptions): Promise<string[]> {
  const { unaccountedFiles, pathPatterns, isRatchetCovered, isEslintReachable } = options;
  if (unaccountedFiles.length === 0) return [];
  const lines: string[] = [
    "",
    "Suggested coverage-map edits (paste into docs/agent_notes/lint-coverage-map.md):",
    "First rooted full path in a `Path / group` cell sets the base dir; later bare",
    "filenames in the same cell resolve against it.",
  ];
  let headerEmitted = false;
  for (const file of unaccountedFiles) {
    const baseRow = findBaseDirRow(file, pathPatterns);
    if (baseRow !== undefined) {
      lines.push(
        "",
        `- ${file}: append the bare filename \`${baseNameOf(file)}\` to the ` +
          `\`Path / group\` cell of the existing row at line ${String(baseRow.line)}.`,
      );
      continue;
    }
    const { normalLint, ratchet, status } = await deriveColumns(
      file,
      isRatchetCovered,
      isEslintReachable,
    );
    if (!headerEmitted) {
      lines.push("", "New row(s):", HEADER, "| --- | --- | --- | --- | --- | --- | --- | --- |");
      headerEmitted = true;
    }
    lines.push(
      `| \`${file}\` | 1 ${fileExtension(file)} | ${normalLint} | ${ratchet} | ESLint | none | ${status} | — |`,
    );
  }
  return lines;
}

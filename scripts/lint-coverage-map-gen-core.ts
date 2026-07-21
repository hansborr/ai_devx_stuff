import { compareByCodepoint } from "./lib/codepoint-compare.js";

export const DRIFT_AI_START_MARKER = "<!-- BEGIN generated: lint-coverage-map drift-ai -->";
export const DRIFT_AI_END_MARKER = "<!-- END generated: lint-coverage-map drift-ai -->";

const DRIFT_AI_DIRECT_CHILD_TYPESCRIPT = /^scripts\/drift-ai\/[^/]+\.ts$/u;
const TABLE_HEADER =
  "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- | --- |";
const CRLF_LENGTH = 2;

export interface CoverageRatchet {
  readonly id: string;
  readonly matches: (file: string) => boolean;
}

interface DeriveDriftAiCoverageBlockOptions {
  readonly trackedFiles: readonly string[];
  readonly isEslintReachable: (file: string) => boolean | Promise<boolean>;
  readonly ratchets: readonly CoverageRatchet[];
}

interface RatchetMembershipCount {
  readonly id: string;
  readonly count: number;
}

function directChildTypescriptFiles(trackedFiles: readonly string[]): string[] {
  return [
    ...new Set(trackedFiles.filter((file) => DRIFT_AI_DIRECT_CHILD_TYPESCRIPT.test(file))),
  ].sort(compareByCodepoint);
}

async function missingEslintReach(
  files: readonly string[],
  isEslintReachable: DeriveDriftAiCoverageBlockOptions["isEslintReachable"],
): Promise<string[]> {
  const results = await Promise.all(
    files.map(async (file) => ({ file, reachable: await isEslintReachable(file) })),
  );
  return results.filter((result) => !result.reachable).map((result) => result.file);
}

function ratchetMembershipCounts(
  files: readonly string[],
  ratchets: readonly CoverageRatchet[],
): RatchetMembershipCount[] {
  return ratchets
    .map((ratchet) => ({
      id: ratchet.id,
      count: files.filter((file) => ratchet.matches(file)).length,
    }))
    .filter((membership) => membership.count > 0)
    .sort((left, right) => compareByCodepoint(left.id, right.id));
}

function renderRatchets(memberships: readonly RatchetMembershipCount[], fileCount: number): string {
  if (memberships.length === 0) return "none";
  return memberships
    .map(
      (membership) =>
        `\`${membership.id}\` (${String(membership.count)}/${String(fileCount)} files)`,
    )
    .join("; ");
}

export async function deriveDriftAiCoverageBlock({
  trackedFiles,
  isEslintReachable,
  ratchets,
}: DeriveDriftAiCoverageBlockOptions): Promise<string> {
  const files = directChildTypescriptFiles(trackedFiles);
  if (files.length === 0) {
    throw new Error(
      "lint coverage-map generation found no tracked direct-child TypeScript files in scripts/drift-ai/",
    );
  }

  const missing = await missingEslintReach(files, isEslintReachable);
  if (missing.length > 0) {
    throw new Error(
      `lint coverage-map generation requires ESLint reach for every scripts/drift-ai/*.ts file; missing:\n${missing.map((file) => `- ${file}`).join("\n")}`,
    );
  }

  const memberships = ratchetMembershipCounts(files, ratchets);
  const status = memberships.length === 0 ? "linted" : "linted + ratcheted";
  const row = [
    "| `scripts/drift-ai/*.ts`",
    `${String(files.length)} .ts`,
    "yes",
    renderRatchets(memberships, files.length),
    "ESLint via `tsconfig.scripts.json`",
    "none — derived from tracked files, ESLint reach, and ratchet membership",
    status,
    "— |",
  ].join(" | ");

  return [DRIFT_AI_START_MARKER, TABLE_HEADER, TABLE_SEPARATOR, row, DRIFT_AI_END_MARKER, ""].join(
    "\n",
  );
}

function occurrenceCount(text: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function markerLineEnd(text: string, markerIndex: number, marker: string): number {
  const before = markerIndex === 0 ? "" : text[markerIndex - 1];
  const afterIndex = markerIndex + marker.length;
  const after = text.slice(afterIndex, afterIndex + CRLF_LENGTH);
  if (before !== "" && before !== "\n") {
    throw new Error(`lint coverage-map ${marker} marker must occupy its own line`);
  }
  if (afterIndex === text.length) return afterIndex;
  if (after.startsWith("\r\n")) return afterIndex + CRLF_LENGTH;
  if (after.startsWith("\n")) return afterIndex + 1;
  throw new Error(`lint coverage-map ${marker} marker must occupy its own line`);
}

export function spliceDriftAiCoverageBlock(source: string, block: string): string {
  const startCount = occurrenceCount(source, DRIFT_AI_START_MARKER);
  const endCount = occurrenceCount(source, DRIFT_AI_END_MARKER);
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(
      `lint coverage-map marker count invalid: start=${String(startCount)}, end=${String(endCount)}`,
    );
  }

  const startIndex = source.indexOf(DRIFT_AI_START_MARKER);
  const endIndex = source.indexOf(DRIFT_AI_END_MARKER);
  if (startIndex > endIndex) {
    throw new Error("lint coverage-map markers are reversed");
  }
  markerLineEnd(source, startIndex, DRIFT_AI_START_MARKER);
  const suffixIndex = markerLineEnd(source, endIndex, DRIFT_AI_END_MARKER);
  return source.slice(0, startIndex) + block + source.slice(suffixIndex);
}

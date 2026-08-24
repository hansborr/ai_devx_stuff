import { matchesAny } from "@musi/lint-ratchet/kernel/ratchet-globs.js";

import { compareByCodepoint } from "./lib/codepoint-compare.js";
import { DOCUMENT_POSTAMBLE, DOCUMENT_PREAMBLE } from "./lint-coverage-map-manifest-prose.js";
import type {
  CoverageEntry,
  CoverageSection,
  CoverageStatusPart,
} from "./lint-coverage-map-manifest-schema.js";

// Renders `docs/generated/lint-coverage-map.md` end to end from the typed
// coverage manifest. The document has no hand-maintained span left: static
// narrative lives in `-manifest-prose.ts`, every table is a manifest section,
// and each `derived` row is computed from the live tree here.

const TABLE_HEADER =
  "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- | --- |";
const HEADING_MARKERS: Record<CoverageSection["level"], string> = { 2: "##", 3: "###" };

export interface CoverageRatchet {
  readonly id: string;
  readonly matches: (file: string) => boolean;
}

interface TreeInputs {
  readonly trackedFiles: readonly string[];
  readonly isEslintReachable: (file: string) => boolean | Promise<boolean>;
  readonly ratchets: readonly CoverageRatchet[];
}

export interface RenderCoverageMapOptions extends TreeInputs {
  readonly sections: readonly CoverageSection[];
}

/** The cells a `derived` row renders from the tree instead of asserting. */
export interface DerivedCells {
  readonly files: string;
  readonly ratchets: string;
  readonly status: readonly CoverageStatusPart[];
}

interface RatchetMembershipCount {
  readonly id: string;
  readonly count: number;
}

/** The identity and membership a `derived` row needs; the rest is asserted. */
type DerivableEntry = Pick<CoverageEntry, "id" | "globs">;

function matchedFiles(entry: DerivableEntry, trackedFiles: readonly string[]): string[] {
  return [...new Set(trackedFiles.filter((file) => matchesAny(file, entry.globs)))].sort(
    compareByCodepoint,
  );
}

function fileExtension(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "(no extension)" : base.slice(dot);
}

// Same `N .ext [+ N .ext]` shape the hand-maintained rows assert and `:check`
// lexes, so a derived cell and an asserted one read alike.
function renderFilesCell(files: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = fileExtension(file);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareByCodepoint(left, right))
    .map(([extension, count]) => `${String(count)} ${extension}`)
    .join(" + ");
}

async function missingEslintReach(
  files: readonly string[],
  isEslintReachable: TreeInputs["isEslintReachable"],
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

// A `derived` row's cells come from the same globs the row renders, resolved by
// the canonical matcher — so widening or narrowing those globs moves the file
// count, the ratchet fractions, and the path cell together. Deriving membership
// from anything else would let a good-faith glob edit render cells that describe
// the old scope with every gate green.
export async function deriveEntryCells(
  entry: DerivableEntry,
  { trackedFiles, isEslintReachable, ratchets }: TreeInputs,
): Promise<DerivedCells> {
  const files = matchedFiles(entry, trackedFiles);
  if (files.length === 0) {
    throw new Error(
      `lint coverage-map entry \`${entry.id}\` is derived, but its globs (${entry.globs.join(", ")}) match no tracked files`,
    );
  }

  const missing = await missingEslintReach(files, isEslintReachable);
  if (missing.length > 0) {
    throw new Error(
      `lint coverage-map entry \`${entry.id}\` is derived, so ESLint must reach every file it matches; missing:\n${missing.map((file) => `- ${file}`).join("\n")}`,
    );
  }

  const memberships = ratchetMembershipCounts(files, ratchets);
  return {
    files: renderFilesCell(files),
    ratchets: renderRatchets(memberships, files.length),
    status: memberships.length === 0 ? ["linted"] : ["linted", "ratcheted"],
  };
}

function renderPathCell(entry: CoverageEntry): string {
  const globs = entry.globs.map((glob) => `\`${glob}\``).join(", ");
  return entry.pathNote === undefined ? globs : `${globs} ${entry.pathNote}`;
}

function renderNormalLintCell(entry: CoverageEntry): string {
  const verdict = entry.normalLint.covered ? "yes" : "no";
  return entry.normalLint.note === undefined ? verdict : `${verdict} (${entry.normalLint.note})`;
}

// A `derived` row asserts its status even though its data comes from the tree,
// so the two must agree: a drift-ai family that lost every ratchet would
// otherwise silently render `linted` under a `linted + ratcheted` claim.
function cellsFor(
  entry: CoverageEntry,
  derivedById: ReadonlyMap<string, DerivedCells>,
): DerivedCells {
  if (entry.derived === undefined) {
    return { files: entry.files ?? "", ratchets: entry.ratchets ?? "", status: entry.status };
  }
  const derived = derivedById.get(entry.id);
  if (derived === undefined) {
    throw new Error(`lint coverage-map entry \`${entry.id}\` is derived but nothing derived it`);
  }
  if (derived.status.join(" + ") !== entry.status.join(" + ")) {
    throw new Error(
      `lint coverage-map entry \`${entry.id}\` asserts status \`${entry.status.join(" + ")}\` but the tree derives \`${derived.status.join(" + ")}\``,
    );
  }
  return derived;
}

function renderRow(entry: CoverageEntry, derivedById: ReadonlyMap<string, DerivedCells>): string {
  const cells = cellsFor(entry, derivedById);
  return `| ${[
    renderPathCell(entry),
    cells.files,
    renderNormalLintCell(entry),
    cells.ratchets,
    entry.parser,
    entry.proposed,
    cells.status.join(" + "),
    entry.followUp,
  ].join(" | ")} |`;
}

function renderSection(
  section: CoverageSection,
  derivedById: ReadonlyMap<string, DerivedCells>,
): string[] {
  const blocks: string[] = [`${HEADING_MARKERS[section.level]} ${section.heading}`];
  if (section.intro !== undefined) blocks.push(section.intro);
  for (const group of section.groups) {
    if (group.note !== undefined) blocks.push(group.note);
    blocks.push(
      [
        TABLE_HEADER,
        TABLE_SEPARATOR,
        ...group.entries.map((entry) => renderRow(entry, derivedById)),
      ].join("\n"),
    );
  }
  return blocks;
}

async function deriveCellsByEntryId(
  sections: readonly CoverageSection[],
  tree: TreeInputs,
): Promise<ReadonlyMap<string, DerivedCells>> {
  const derivedEntries = sections.flatMap((section) =>
    section.groups.flatMap((group) => group.entries.filter((entry) => entry.derived !== undefined)),
  );
  const cells = await Promise.all(
    derivedEntries.map(async (entry) => [entry.id, await deriveEntryCells(entry, tree)] as const),
  );
  return new Map(cells);
}

export async function renderCoverageMapDocument(
  options: RenderCoverageMapOptions,
): Promise<string> {
  const { sections, ...tree } = options;
  const derivedById = await deriveCellsByEntryId(sections, tree);
  const body = sections.flatMap((section) => renderSection(section, derivedById));
  const blocks = [DOCUMENT_PREAMBLE.trimEnd(), ...body, DOCUMENT_POSTAMBLE.trimEnd()];
  return `${blocks.join("\n\n")}\n`;
}

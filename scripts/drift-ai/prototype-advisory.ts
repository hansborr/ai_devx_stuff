// Shared output contract for drift:ai PROTOTYPE/HEAVY advisory subcommands (backlog
// tasks 41-48). Prototype lenses are noisier than the already-firewalled
// hotspots/coldspots advisories — they have no field-calibrated precision yet — so
// they need an even firmer brand firewall:
//
//   - the SAME `kind: "advisory"` top level the promoted advisories use, so a reader
//     and a machine consumer already know it is NOT the `findings` stream (NEVER a
//     `findings` key, NEVER WARN/FIX language);
//   - an explicit `lane: "prototype"` discriminant so a consumer can tell a prototype
//     advisory apart from the promoted hotspots/coldspots advisories. This lane marker
//     lives ONLY on the advisory envelope; per `01-shared-context.md` contract #6 it is
//     deliberately NOT added to `DriftFinding`, whose stream stays reserved for promoted
//     checks;
//   - a mandatory candidate banner and explicit prerequisite / cap / degradation
//     disclosure so a noisy, capped, or partial research run can never be mistaken for a
//     promoted finding or a complete scan.
//
// This module is the TYPE HOME + shared wording for that envelope. It owns no lens math:
// a prototype subcommand imports these types/helpers, supplies its own row and section
// shapes, and renders through the shared header + section frame so every prototype
// surface discloses prerequisites, caps/timeouts, partial runs, and degradations the
// same way. Task 39 owns this contract; task 38 owns the full-history scanned-range/
// stopped-reason DATA that a history-backed lens feeds into `PrototypeCap`.

// The advisory `lane` discriminant value. Stable so a fusion/diagnostics consumer can
// route prototype advisories without string-matching the subcommand name.
import { plural } from "./advisory-format-helpers.js";

export const PROTOTYPE_ADVISORY_LANE = "prototype";

// The mandatory candidate banner. Deliberately stronger than the hotspots/coldspots
// "areas to check, not defects" banner: a prototype lens has no precision evidence yet,
// so its rows are explicitly unvalidated leads. Contains no WARN/FIX language by design.
export const PROTOTYPE_ADVISORY_BANNER =
  "Experimental candidate signal, NOT defects or verdicts. This prototype lens has no " +
  "field-calibrated precision yet; treat every row as an unranked lead to confirm or discard.";

export type PrototypeScanProvenance = {
  readonly gitHead: string | null;
  readonly gitDirty: boolean | null;
  readonly stateFingerprint?: string | null;
  readonly changedDuringScan?: boolean | null;
};

// A prerequisite a prototype lens needs before it can compute (a tool on PATH, a
// coverage artifact, a resolved graph). Disclosed so an UNMET prerequisite never reads
// as "checked and clear" — the row says what was looked for and what was found.
export type PrototypePrerequisite = {
  readonly name: string; // e.g. "coverage artifact", "dolos binary"
  readonly satisfied: boolean;
  readonly detail: string; // what was found, or why it is missing
};

// A disclosed cost bound (a candidate cap, a scan timeout, a bounded history range) and
// whether the run actually hit it. When `hit` is true the run is PARTIAL: the renderers
// say so, with the stopped-after count in `detail`, so a capped run is never presented
// as exhaustive. A history-backed lens feeds task 38's scanned-range / stopped-reason
// data into `detail` here rather than inventing its own disclosure wording.
export type PrototypeCap = {
  readonly label: string; // e.g. "candidate pairs", "scan timeout (ms)"
  readonly limit: number; // the configured bound (a count, or a duration in ms)
  readonly hit: boolean; // true => the run stopped at the cap and is PARTIAL
  readonly detail: string | null; // e.g. "stopped after 5000 of ~12000 pairs"
};

// One candidate section. Generic over its row type so each lens supplies its own
// evidence shape; the shared fields carry the candidate framing and the truncation
// disclosure every prototype section needs.
export type PrototypeSection<TRow> = {
  readonly candidateKind: string; // names the candidate, e.g. "near-duplicate clusters"
  // Total candidates that passed this section's gate, BEFORE the display cap.
  // `entries.length` is the shown subset; the renderers disclose the gap so a capped
  // list never reads as complete.
  readonly totalCandidates: number;
  readonly emptyReason: string | null;
  readonly entries: readonly TRow[];
};

// The prototype advisory envelope. Generic over its section union so a lens with several
// candidate kinds (mirroring how coldspots carries coldspot + stale-markers sections)
// keeps a single typed top level.
export type PrototypeAdvisory<TSection> = {
  readonly kind: "advisory";
  readonly lane: typeof PROTOTYPE_ADVISORY_LANE;
  readonly subcommand: string; // the requested prototype subcommand/lens name
  readonly banner: string;
  readonly scanProvenance?: PrototypeScanProvenance;
  readonly prerequisites: readonly PrototypePrerequisite[];
  readonly caps: readonly PrototypeCap[];
  readonly degradations: readonly string[];
  readonly sections: readonly TSection[];
};

// Stamp the invariant envelope fields (`kind` / `lane` / `banner`) so a prototype
// subcommand cannot forget the firewall or drift the banner wording. The caller supplies
// only the variable parts; the optional disclosure arrays default to empty.
export function buildPrototypeAdvisory<TSection>(input: {
  readonly subcommand: string;
  readonly scanProvenance?: PrototypeScanProvenance;
  readonly prerequisites?: readonly PrototypePrerequisite[];
  readonly caps?: readonly PrototypeCap[];
  readonly degradations?: readonly string[];
  readonly sections: readonly TSection[];
}): PrototypeAdvisory<TSection> {
  return {
    kind: "advisory",
    lane: PROTOTYPE_ADVISORY_LANE,
    subcommand: input.subcommand,
    banner: PROTOTYPE_ADVISORY_BANNER,
    ...(input.scanProvenance === undefined ? {} : { scanProvenance: input.scanProvenance }),
    prerequisites: input.prerequisites ?? [],
    caps: input.caps ?? [],
    degradations: input.degradations ?? [],
    sections: input.sections,
  };
}

// Serialize a prototype advisory. Trivial today, but the single chokepoint guarantees
// every prototype subcommand emits the same `kind`/`lane` top level (and never a
// `findings` key) instead of each hand-rolling `JSON.stringify`.
export function formatPrototypeAdvisoryJson<TSection>(
  advisory: PrototypeAdvisory<TSection>,
): string {
  return JSON.stringify(advisory, null, 2);
}

// Render the shared prototype header lines every subcommand prints above its
// lens-specific sections: the legible title, the candidate banner, then one line per
// prerequisite, cap, and degradation. Returns lines so the caller can append its
// sections (mirroring the hotspots/coldspots `lines.push(...)` then `join("\n")` shape).
export function formatPrototypeHeader<TSection>(advisory: PrototypeAdvisory<TSection>): string[] {
  const lines = [
    `drift:ai ${advisory.subcommand} (advisory, ${advisory.lane} lane) -- candidate signal`,
    `  ${advisory.banner}`,
  ];
  if (advisory.scanProvenance !== undefined) {
    lines.push(
      `  scan provenance: git ${advisory.scanProvenance.gitHead ?? "unknown"}; ` +
        `working tree ${dirtyState(advisory.scanProvenance.gitDirty)}`,
    );
  }
  for (const prereq of advisory.prerequisites) {
    const state = prereq.satisfied ? "ok" : "unmet";
    lines.push(`  prerequisite ${prereq.name}: ${state} -- ${prereq.detail}`);
  }
  for (const cap of advisory.caps) lines.push(`  ${formatCap(cap)}`);
  for (const note of advisory.degradations) lines.push(`  degraded: ${note}`);
  return lines;
}

function dirtyState(gitDirty: boolean | null): string {
  if (gitDirty === null) return "state unknown";
  return gitDirty ? "dirty" : "clean";
}

// One cap line. An un-hit cap discloses the bound (so a reader knows a limit exists); a
// hit cap shouts PARTIAL and carries the stopped-after detail so the run is never read
// as exhaustive.
function formatCap(cap: PrototypeCap): string {
  if (!cap.hit) return `cap ${cap.label}: within limit ${cap.limit}`;
  const detail = cap.detail ?? `stopped at the limit (${cap.limit})`;
  return `cap ${cap.label}: HIT -- PARTIAL run: ${detail}`;
}

// Append one prototype section's shared frame to `lines`: the candidate-kind line, then
// either the empty reason or the rows (via the caller's per-row renderer) with a
// display-cap disclosure when the shown subset is smaller than `totalCandidates`.
//
// This frames the section; it does NOT police row TEXT. The shared header/banner keep
// the envelope free of WARN/FIX, but a lens that writes "WARN" into its own row strings
// re-breaks the firewall — keeping per-row text evidence-shaped is each lens's job.
export function appendPrototypeSection<
  TRow,
  TSection extends PrototypeSection<TRow> = PrototypeSection<TRow>,
>(
  lines: string[],
  section: TSection,
  renderRow: (row: TRow) => readonly string[],
  options: {
    readonly preludeLines?: (section: TSection) => readonly string[];
  } = {},
): void {
  lines.push(`  candidate: ${section.candidateKind}`);
  for (const line of options.preludeLines?.(section) ?? []) lines.push(`    ${line}`);
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no candidates this run."}`);
    return;
  }
  const truncation = prototypeTruncationNote(section.entries.length, section.totalCandidates);
  if (truncation !== null) lines.push(`    ${truncation}`);
  for (const row of section.entries) {
    for (const line of renderRow(row)) lines.push(`    ${line}`);
  }
}

// Shared display-cap disclosure: when fewer rows are shown than qualified, say so.
// drift:ai never presents a capped subset as if complete. Returns null when nothing is
// hidden. Mirrors the coldspots truncation wording so the disclosure reads the same
// across surfaces. Callers are expected to uphold `totalCandidates >= shown` (the gate
// count is never below the shown subset); an inconsistent `totalCandidates < shown` is
// treated as "nothing hidden" rather than emitting a negative remainder.
export function prototypeTruncationNote(shown: number, totalCandidates: number): string | null {
  if (totalCandidates <= shown) return null;
  const more = totalCandidates - shown;
  return `showing ${shown} of ${totalCandidates} candidates (${more} more; raise --top to see them)`;
}

// Shared per-section display-cap builder. Several prototype lenses split their rows into
// sections and cap each section's shown rows at `--top`; this counts the sections that
// were truncated (`totalCandidates > entries.length`) and discloses the row cap the same
// way across surfaces, so a partial per-section run never reads as exhaustive and the
// truncation-disclosure wording lives in one place. The cap is HIT (the run is PARTIAL)
// when any section was truncated. Reads only the `PrototypeSection` fields it needs, so a
// lens passes its own section type (which extends `PrototypeSection`) directly.
export function rowsPerSectionCap(
  top: number,
  sections: readonly PrototypeSection<unknown>[],
  opts: { readonly label: string; readonly noun: string; readonly rowNoun?: string },
): PrototypeCap {
  const hitCount = sections.filter(
    (section) => section.totalCandidates > section.entries.length,
  ).length;
  const rowNoun = opts.rowNoun ?? "candidate rows";
  return {
    label: opts.label,
    limit: top,
    hit: hitCount > 0,
    detail:
      hitCount > 0
        ? `${hitCount} ${plural(opts.noun, hitCount)} had more than ${top} ${rowNoun}`
        : null,
  };
}

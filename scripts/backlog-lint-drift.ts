/**
 * Index-vs-leaf consistency checks for a pack that has a canonical 00-index.md.
 *
 * Three failure modes are reported: a task-table row whose completion state
 * disagrees with the leaf it links to (index-leaf-drift), a same-directory link
 * that points at a file the pack does not contain (dangling-index-link), and a
 * leaf note the index never links (unlisted-leaf). Completion is judged with
 * the shared terminal-status vocabulary so the index and the leaf are read the
 * same way.
 */

import { indexLinkedBases, parseIndexTaskTable } from "./backlog-lint-index-table.js";
import { terminalStatus } from "./backlog-lint-status.js";
import type { BacklogLintFinding } from "./backlog-lint-types.js";

export interface DriftLeaf {
  readonly base: string;
  readonly path: string;
  readonly statusValue?: string;
}

interface PackDriftInput {
  readonly indexPath: string;
  readonly indexBase: string;
  readonly indexText: string;
  readonly memberBases: ReadonlySet<string>;
  readonly leaves: readonly DriftLeaf[];
}

/** A drift finding plus how it becomes relevant in `--file` mode. */
interface DriftFinding {
  readonly finding: BacklogLintFinding;
  readonly reveal: "leaf" | "index";
  readonly leafPath?: string;
}

const STATUS_SNIPPET_MAX = 48;

function statusSnippet(value: string): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= STATUS_SNIPPET_MAX) return collapsed;
  return `${collapsed.slice(0, STATUS_SNIPPET_MAX - 1)}…`;
}

function rowDrift(
  indexPath: string,
  leaf: DriftLeaf,
  statusText: string,
  line: number,
): DriftFinding | undefined {
  if (leaf.statusValue === undefined) return undefined;
  const indexTerminal = terminalStatus(statusText);
  if (indexTerminal === terminalStatus(leaf.statusValue)) return undefined;
  const indexState = indexTerminal ? "terminal" : "active";
  return {
    finding: {
      kind: "index-leaf-drift",
      path: indexPath,
      line,
      message: `index row marks ${leaf.path} ${indexState} (Status "${statusSnippet(statusText)}") but the leaf Status is "${statusSnippet(leaf.statusValue)}"`,
    },
    reveal: "leaf",
    leafPath: leaf.path,
  };
}

function driftFindings(
  input: PackDriftInput,
  leafByBase: ReadonlyMap<string, DriftLeaf>,
): DriftFinding[] {
  const table = parseIndexTaskTable(input.indexText);
  if (table === undefined) return [];
  const findings: DriftFinding[] = [];
  for (const row of table.rows) {
    if (row.leafBase === undefined || row.leafBase === input.indexBase) continue;
    const leaf = leafByBase.get(row.leafBase);
    if (leaf === undefined) continue;
    const drift = rowDrift(input.indexPath, leaf, row.statusText, row.line);
    if (drift !== undefined) findings.push(drift);
  }
  return findings;
}

function danglingFindings(input: PackDriftInput, linked: ReadonlySet<string>): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const base of linked) {
    if (base === input.indexBase || input.memberBases.has(base)) continue;
    findings.push({
      finding: {
        kind: "dangling-index-link",
        path: input.indexPath,
        message: `index links ${base}, which is not present in the pack`,
      },
      reveal: "index",
    });
  }
  return findings;
}

function unlistedFindings(input: PackDriftInput, linked: ReadonlySet<string>): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const leaf of input.leaves) {
    if (leaf.base === input.indexBase || linked.has(leaf.base)) continue;
    findings.push({
      finding: {
        kind: "unlisted-leaf",
        path: leaf.path,
        message: "leaf note is present in the pack but not linked from the index",
      },
      reveal: "index",
    });
  }
  return findings;
}

export function collectDriftFindings(input: PackDriftInput): DriftFinding[] {
  const leafByBase = new Map(input.leaves.map((leaf) => [leaf.base, leaf]));
  const linked = indexLinkedBases(input.indexText);
  return [
    ...driftFindings(input, leafByBase),
    ...danglingFindings(input, linked),
    ...unlistedFindings(input, linked),
  ];
}

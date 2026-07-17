import { existsSync, readFileSync } from "node:fs";

import { parseLintRatchetBaselineStructure } from "./baseline.js";
import { baselinePath, relativePath } from "./paths.js";
import { matchesRatchet } from "./ratchet-globs.js";

// One edited path and the committed-baseline rule(s) that track it. The hook
// only ever shows the rule ids, but the path round-trips so a multi-path query
// can be split back apart by the caller.
export interface RatchetCoverageRow {
  readonly path: string;
  readonly ruleIds: readonly string[];
}

const COVERAGE_KIND = "ratchet-covered";

// Single owner of the ratchet-coverage wire row consumed by
// scripts/ai-hooks/lint-coverage-check.sh. The rule ids are joined the way the
// hook renders them in `(<rules>)`, so the shell can pass the field straight
// through without re-formatting. The path/rules fields never contain a tab.
export function formatRatchetCoverageRow(row: RatchetCoverageRow): string {
  return [COVERAGE_KIND, row.path, row.ruleIds.join(", ")].join("\t");
}

// Report which committed-baseline ratchets track each edited path, reusing the
// canonical ratchet glob matcher so the lint-coverage hook no longer carries its
// own copy of the glob semantics. Matching is baseline-driven (the test's own
// `files`/`ignores`), not registry-driven, so it mirrors exactly what the hook
// read before and stays meaningful even when the live registry has drifted from
// the committed floor. A missing or structurally-invalid baseline yields no rows
// so the advisory hook degrades to its uncovered behavior rather than guessing.
export function ratchetCoverageForPaths(paths: readonly string[]): RatchetCoverageRow[] {
  if (paths.length === 0) return [];
  if (!existsSync(baselinePath)) return [];
  const structural = parseLintRatchetBaselineStructure(readFileSync(baselinePath, "utf8"));
  if (structural.baseline === undefined) return [];
  const tests = Object.values(structural.baseline.tests);

  const rows: RatchetCoverageRow[] = [];
  const seen = new Set<string>();
  for (const rawPath of paths) {
    const path = relativePath(rawPath);
    if (seen.has(path)) continue;
    seen.add(path);
    const ruleIds = new Set<string>();
    for (const test of tests) {
      if (matchesRatchet(test, path)) ruleIds.add(test.ruleId);
    }
    if (ruleIds.size > 0) rows.push({ path, ruleIds: [...ruleIds].sort() });
  }
  return rows;
}

// Scripts-local indirection over the kernel's flat baseline parser, mirroring
// `scripts/lib/codepoint-compare.ts`. Every sensor that commits an identity
// ledger wants the same thing from `parseBaseline`: the entries, with parse
// warnings forwarded untouched so the caller can decide whether a derived-
// summary mismatch is fatal. Keeping that unwrap in one place is what stops
// each new sensor from landing another copy of it — the near-duplicate floor
// had already recorded the knip/near-duplicates pair before this extraction.

import {
  type BaselineEntry,
  type BaselineMetricSpec,
  parseBaseline,
  type ParseResult,
} from "@musi/lint-ratchet/kernel/entry-baseline.js";

export function parseBaselineEntries<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  text: string,
): ParseResult<readonly Entry[]> {
  const parsed = parseBaseline(spec, text);
  if (!parsed.ok) return parsed;
  if (parsed.warnings !== undefined) {
    return { ok: true, value: parsed.value.entries, warnings: parsed.warnings };
  }
  return { ok: true, value: parsed.value.entries };
}

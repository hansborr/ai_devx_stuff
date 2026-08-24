import { errorMessage } from "../lib/error-message.js";
import { isRecord } from "../lib/records.js";

export type KnipReportIssueRows = readonly unknown[];

export type KnipReportParseFailure = { readonly ok: false; readonly error: string };

export type KnipReportSymbol = {
  readonly name: string;
  readonly line?: number;
  readonly col?: number;
};

export type KnipReportEnvelope =
  | { readonly ok: true; readonly issues: KnipReportIssueRows }
  | KnipReportParseFailure;

// Parse the shared `knip --reporter json` envelope from the pinned knip 6.26.0
// contract. Knip always prints `{"issues":[]}` even when clean, so empty output
// means the run never produced a report (attempted-and-failed), not a clean run.
export function parseKnipReportEnvelope(jsonText: string): KnipReportEnvelope {
  if (jsonText.trim().length === 0) return { ok: false, error: "knip produced no JSON output" };
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "expected a JSON object with an 'issues' array" };
  }
  const issues = raw["issues"];
  return { ok: true, issues: Array.isArray(issues) ? issues : [] };
}

export function knipSymbolFromItem(item: unknown): KnipReportSymbol | undefined {
  if (!isRecord(item)) return undefined;
  const name = item["name"];
  if (typeof name !== "string" || name.length === 0) return undefined;
  return { name, ...locationFromItem(item) };
}

export function fullKnipLocation(
  symbol: Pick<KnipReportSymbol, "line" | "col">,
): { readonly line: number; readonly col: number } | undefined {
  const line = positiveIntegerOrUndefined(symbol.line);
  const col = positiveIntegerOrUndefined(symbol.col);
  return line === undefined || col === undefined ? undefined : { line, col };
}

function locationFromItem(
  item: Record<string, unknown>,
): { readonly line: number; readonly col: number } | undefined {
  const line = positiveIntegerOrUndefined(item["line"]);
  const col = positiveIntegerOrUndefined(item["col"]);
  return line === undefined || col === undefined ? undefined : { line, col };
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

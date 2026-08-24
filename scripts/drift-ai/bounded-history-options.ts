import { nonEmptyValue, positiveIntValue } from "./arg-readers.js";
import {
  type BoundedFullHistory,
  type BoundedFullHistoryOptions,
  type BoundedHistoryGitRunner,
  collectBoundedFullHistory,
} from "./bounded-full-history.js";
import type { DriftAiIgnoreConfig } from "./config.js";

export type ParsedBoundedHistoryArgs = {
  readonly since: string | null;
  readonly maxCommits: number | null;
  readonly maxFiles: number | null;
  readonly maxOutputBytes: number | null;
  readonly timeoutMs: number | null;
};

// parseCli option fragment for the shared bounded-history flag surface; spread
// it into a consuming subcommand's option array next to its own options.
export const BOUNDED_HISTORY_CLI_OPTIONS = [
  { name: "--since", kind: "value" },
  { name: "--max-commits", kind: "value" },
  { name: "--max-files", kind: "value" },
  { name: "--max-output-bytes", kind: "value" },
  { name: "--timeout-ms", kind: "value" },
] as const;

// Zod shape fragment for the same five options; spread into the consuming
// subcommand's `z.object` so the five-field contract is declared once.
export const boundedHistorySchemaShape = {
  "--since": nonEmptyValue("--since").optional(),
  "--max-commits": positiveIntValue("--max-commits").optional(),
  "--max-files": positiveIntValue("--max-files").optional(),
  "--max-output-bytes": positiveIntValue("--max-output-bytes").optional(),
  "--timeout-ms": positiveIntValue("--timeout-ms").optional(),
};

type BoundedHistoryParsedOptions = {
  readonly "--since"?: string | undefined;
  readonly "--max-commits"?: number | undefined;
  readonly "--max-files"?: number | undefined;
  readonly "--max-output-bytes"?: number | undefined;
  readonly "--timeout-ms"?: number | undefined;
};

// Hand-written, compiler-checked assembly from a parsed record to the shared
// five-field contract (no table-derived mapping; unit-120 binding rulings).
export function boundedHistoryArgsFromOptions(
  options: BoundedHistoryParsedOptions,
): ParsedBoundedHistoryArgs {
  return {
    since: options["--since"] ?? null,
    maxCommits: options["--max-commits"] ?? null,
    maxFiles: options["--max-files"] ?? null,
    maxOutputBytes: options["--max-output-bytes"] ?? null,
    timeoutMs: options["--timeout-ms"] ?? null,
  };
}

export type BoundedHistoryRunContext = {
  readonly boundedGit: BoundedHistoryGitRunner;
  readonly ignore: DriftAiIgnoreConfig;
};

function boundedHistoryOptionFields(
  parsed: ParsedBoundedHistoryArgs,
): Omit<BoundedFullHistoryOptions, "git" | "ignore"> {
  return {
    ...(parsed.since === null ? {} : { since: parsed.since }),
    ...(parsed.maxCommits === null ? {} : { maxCommits: parsed.maxCommits }),
    ...(parsed.maxFiles === null ? {} : { maxFiles: parsed.maxFiles }),
    ...(parsed.maxOutputBytes === null ? {} : { maxOutputBytes: parsed.maxOutputBytes }),
    ...(parsed.timeoutMs === null ? {} : { timeoutMs: parsed.timeoutMs }),
  };
}

export function collectConfiguredBoundedFullHistory(
  parsed: ParsedBoundedHistoryArgs,
  context: BoundedHistoryRunContext,
): BoundedFullHistory {
  return collectBoundedFullHistory({
    git: context.boundedGit,
    ignore: context.ignore,
    ...boundedHistoryOptionFields(parsed),
  });
}

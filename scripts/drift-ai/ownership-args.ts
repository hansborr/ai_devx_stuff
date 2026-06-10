import { readNonEmpty, readPositiveInt } from "./arg-readers.js";
import { DriftAiError } from "./errors.js";
import {
  DEFAULT_AGENT_IDENTITY_PATTERNS,
  DEFAULT_OWNERSHIP_TOP,
  OWNERSHIP_SUBCOMMAND,
} from "./ownership-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const OWNERSHIP_USAGE = [
  "Usage:",
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND}`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --since <git-date>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --max-commits <N> --max-files <N>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --max-output-bytes <N> --timeout-ms <N>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --agent-identity-pattern <regex>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). File-level ownership / DOA archaeology",
  "from bounded full git history; not findings, defects, or a default --check all surface.",
].join("\n");

export type ParsedOwnershipArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
  readonly since: string | null;
  readonly maxCommits: number | null;
  readonly maxFiles: number | null;
  readonly maxOutputBytes: number | null;
  readonly timeoutMs: number | null;
  readonly agentIdentityPatterns: readonly string[];
};

export function parseOwnershipArgs(argv: readonly string[]): ParsedOwnershipArgs {
  let top = DEFAULT_OWNERSHIP_TOP;
  let since: string | null = null;
  let maxCommits: number | null = null;
  let maxFiles: number | null = null;
  let maxOutputBytes: number | null = null;
  let timeoutMs: number | null = null;
  const extraAgentPatterns: string[] = [];
  const base = parseSubcommandArgs(argv, {
    usage: OWNERSHIP_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--since": (value) => {
        since = readNonEmpty(value, "--since");
      },
      "--max-commits": (value) => {
        maxCommits = readPositiveInt(value, "--max-commits");
      },
      "--max-files": (value) => {
        maxFiles = readPositiveInt(value, "--max-files");
      },
      "--max-output-bytes": (value) => {
        maxOutputBytes = readPositiveInt(value, "--max-output-bytes");
      },
      "--timeout-ms": (value) => {
        timeoutMs = readPositiveInt(value, "--timeout-ms");
      },
      "--agent-identity-pattern": (value) => {
        extraAgentPatterns.push(parseRegexPattern(value, "--agent-identity-pattern"));
      },
    },
  });
  return {
    base,
    top,
    since,
    maxCommits,
    maxFiles,
    maxOutputBytes,
    timeoutMs,
    agentIdentityPatterns:
      extraAgentPatterns.length === 0
        ? DEFAULT_AGENT_IDENTITY_PATTERNS
        : [...DEFAULT_AGENT_IDENTITY_PATTERNS, ...extraAgentPatterns],
  };
}

function parseRegexPattern(value: string, flag: string): string {
  try {
    new RegExp(value, "iu");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DriftAiError(`${flag} must be a valid regular expression: ${detail}`);
  }
  return value;
}

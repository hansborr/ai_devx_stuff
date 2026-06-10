import { readPositiveInt } from "./arg-readers.js";
import {
  COVERAGE_EVIDENCE_SUBCOMMAND,
  DEFAULT_COVERAGE_EVIDENCE_TOP,
} from "./coverage-evidence-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const COVERAGE_EVIDENCE_USAGE = [
  "Usage:",
  `  bun run drift:ai ${COVERAGE_EVIDENCE_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${COVERAGE_EVIDENCE_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${COVERAGE_EVIDENCE_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Reads configured coverage artifacts",
  "from coverage.artifacts and reports raw hit evidence; not findings or gates.",
].join("\n");

export type ParsedCoverageEvidenceArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
};

export function parseCoverageEvidenceArgs(argv: readonly string[]): ParsedCoverageEvidenceArgs {
  let top = DEFAULT_COVERAGE_EVIDENCE_TOP;
  const base = parseSubcommandArgs(argv, {
    usage: COVERAGE_EVIDENCE_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
    },
  });
  return { base, top };
}

import { readNonEmptyPath, readPositiveInt } from "./arg-readers.js";
import {
  COVERAGE_UNUSED_SUBCOMMAND,
  DEFAULT_COVERAGE_UNUSED_TOP,
} from "./coverage-unused-correlation-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const COVERAGE_UNUSED_USAGE = [
  "Usage:",
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --unused-exports-report <knip.json>`,
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --config <path> --unused-exports-report <knip.json>`,
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Overlays a supplied knip unused-exports",
  "report (--reporter json) onto configured coverage.artifacts and reports where the",
  "two signals agree, conflict, or have no coverage. Never runs tests, knip, or a",
  "coverage gate; keeps 'uncovered' and 'unused' as separate signals, not a verdict.",
].join("\n");

export type ParsedCoverageUnusedArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
  readonly reportPath: string | null;
};

export function parseCoverageUnusedArgs(argv: readonly string[]): ParsedCoverageUnusedArgs {
  let top = DEFAULT_COVERAGE_UNUSED_TOP;
  let reportPath: string | null = null;
  const base = parseSubcommandArgs(argv, {
    usage: COVERAGE_UNUSED_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--unused-exports-report": (value) => {
        reportPath = readNonEmptyPath(value, "--unused-exports-report");
      },
    },
  });
  return { base, top, reportPath };
}

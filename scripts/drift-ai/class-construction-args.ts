import { readNonEmptyPath, readPositiveInt } from "./arg-readers.js";
import {
  CLASS_CONSTRUCTION_SUBCOMMAND,
  DEFAULT_CLASS_CONSTRUCTION_TOP,
} from "./class-construction-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const CLASS_CONSTRUCTION_USAGE = [
  "Usage:",
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --root <path>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --unused-exports-report <path>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Experimental class-construction",
  "evidence for classes with no direct construction signal; not findings, defects,",
  "or a default --check all surface.",
].join("\n");

export type ParsedClassConstructionArgs = {
  readonly base: SubcommandBaseOptions;
  readonly roots: readonly string[];
  readonly top: number;
  readonly unusedExportsReportPath: string | null;
};

export function parseClassConstructionArgs(argv: readonly string[]): ParsedClassConstructionArgs {
  const roots: string[] = [];
  let top = DEFAULT_CLASS_CONSTRUCTION_TOP;
  let unusedExportsReportPath: string | null = null;
  const base = parseSubcommandArgs(argv, {
    usage: CLASS_CONSTRUCTION_USAGE,
    acceptsConfig: true,
    pathValueOptions: {
      "--root": (value) => {
        roots.push(value);
      },
    },
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--unused-exports-report": (value) => {
        unusedExportsReportPath = readNonEmptyPath(value, "--unused-exports-report");
      },
    },
  });
  return { base, roots, top, unusedExportsReportPath };
}

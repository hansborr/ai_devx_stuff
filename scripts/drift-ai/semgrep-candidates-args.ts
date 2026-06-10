import { readNonEmpty, readPositiveInt } from "./arg-readers.js";
import {
  DEFAULT_SEMGREP_CANDIDATES_TOP,
  SEMGREP_CANDIDATES_SUBCOMMAND,
} from "./semgrep-advisory.js";
import { createCliRuleSourceCollector, type SemgrepRuleSource } from "./semgrep-rule-sources.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const SEMGREP_CANDIDATES_USAGE = [
  "Usage:",
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --root <path>`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --rule-source-manifest <path>`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --semgrep-config <path> [--rule-license <license>]`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --registry-pack <p/pack> --allow-live-registry`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --allow-rule-license <license>`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --semgrep-bin <path>`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --include-rule-messages`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --format <text|json> [--output <path>]`,
  `  bun run drift:ai ${SEMGREP_CANDIDATES_SUBCOMMAND} --config <path>`,
  "",
  "Report-only prototype advisory (exit 0). Experimental Semgrep candidate scan; not",
  "findings, defects, or a default --check all surface. Semgrep is opt-in: a missing",
  "binary or a blocked/missing rule source is reported as an unmet prerequisite, not",
  "a failure. Non-permissive or undeclared rule licenses need an explicit",
  "--allow-rule-license opt-in; live registry packs also need --allow-live-registry.",
  "Semgrep renders matched source into rule messages (metavariable interpolation),",
  "so messages are withheld unless --include-rule-messages is passed.",
].join("\n");

export type ParsedSemgrepCandidatesArgs = {
  readonly base: SubcommandBaseOptions;
  readonly roots: readonly string[];
  readonly top: number;
  // `--semgrep-bin` explicit override; null falls back to the tools-checkout
  // path and then PATH (resolution order in the plan's decision 2, slice 2).
  readonly semgrepBin: string | null;
  readonly ruleSourceManifestPath: string | null;
  // Rule sources declared directly on the CLI (--semgrep-config/--rule-license,
  // --registry-pack), in argv order. Manifest sources are read by the command.
  readonly cliRuleSources: readonly SemgrepRuleSource[];
  readonly allowedRuleLicenses: readonly string[];
  readonly allowLiveRegistry: boolean;
  // `--include-rule-messages`: rendered messages can embed matched source via
  // metavariable interpolation, so default output withholds them.
  readonly includeRuleMessages: boolean;
};

export function parseSemgrepCandidatesArgs(argv: readonly string[]): ParsedSemgrepCandidatesArgs {
  const roots: string[] = [];
  let top = DEFAULT_SEMGREP_CANDIDATES_TOP;
  let semgrepBin: string | null = null;
  let ruleSourceManifestPath: string | null = null;
  const allowedRuleLicenses: string[] = [];
  let allowLiveRegistry = false;
  let includeRuleMessages = false;
  const ruleSources = createCliRuleSourceCollector();
  const base = parseSubcommandArgs(argv, {
    usage: SEMGREP_CANDIDATES_USAGE,
    acceptsConfig: true,
    pathValueOptions: {
      "--root": (value) => {
        roots.push(value);
      },
      "--rule-source-manifest": (value) => {
        ruleSourceManifestPath = value;
      },
      "--semgrep-config": (value) => {
        ruleSources.addConfig(value);
      },
    },
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--rule-license": (value) => {
        ruleSources.addLicense(readNonEmpty(value, "--rule-license"));
      },
      "--registry-pack": (value) => {
        ruleSources.addPack(readNonEmpty(value, "--registry-pack"));
      },
      "--allow-rule-license": (value) => {
        allowedRuleLicenses.push(readNonEmpty(value, "--allow-rule-license"));
      },
      "--semgrep-bin": (value) => {
        semgrepBin = readNonEmpty(value, "--semgrep-bin");
      },
    },
    flagOptions: {
      "--allow-live-registry": () => {
        allowLiveRegistry = true;
      },
      "--include-rule-messages": () => {
        includeRuleMessages = true;
      },
    },
  });
  return {
    base,
    roots,
    top,
    semgrepBin,
    ruleSourceManifestPath,
    cliRuleSources: ruleSources.sources(),
    allowedRuleLicenses,
    allowLiveRegistry,
    includeRuleMessages,
  };
}

import { z } from "zod";

import type { CliOptionEvent } from "../lib/cli.js";
import { nonEmptyValue, positiveIntValue, readNonEmpty } from "./arg-readers.js";
import {
  DEFAULT_SEMGREP_CANDIDATES_TOP,
  SEMGREP_CANDIDATES_SUBCOMMAND,
} from "./semgrep-advisory.js";
import { createCliRuleSourceCollector, type SemgrepRuleSource } from "./semgrep-rule-sources.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
  subcommandBooleanFlag,
} from "./subcommand-args.js";

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

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--root", kind: "value", repeatable: true },
  { name: "--rule-source-manifest", kind: "value" },
  { name: "--semgrep-config", kind: "value", repeatable: true },
  { name: "--rule-license", kind: "value", repeatable: true },
  { name: "--registry-pack", kind: "value", repeatable: true },
  { name: "--allow-rule-license", kind: "value", repeatable: true },
  { name: "--top", kind: "value" },
  { name: "--semgrep-bin", kind: "value" },
  subcommandBooleanFlag("--allow-live-registry"),
  subcommandBooleanFlag("--include-rule-messages"),
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--root": z.array(z.string()).default([]),
  "--rule-source-manifest": z.string().optional(),
  // The three rule-source options are validated and consumed through the
  // parse's optionEvents below (their pairing is argv-order-sensitive across
  // different flags); these entries keep the option/schema registries aligned.
  "--semgrep-config": z.array(z.string()).default([]),
  "--rule-license": z.array(z.string()).default([]),
  "--registry-pack": z.array(z.string()).default([]),
  "--allow-rule-license": z.array(nonEmptyValue("--allow-rule-license")).default([]),
  "--top": positiveIntValue("--top").default(DEFAULT_SEMGREP_CANDIDATES_TOP),
  "--semgrep-bin": nonEmptyValue("--semgrep-bin").optional(),
  "--allow-live-registry": z.boolean().default(false),
  "--include-rule-messages": z.boolean().default(false),
});

// `--rule-license` licenses the `--semgrep-config` it FOLLOWS and
// `--registry-pack` closes any open config, so the three options are
// order-sensitive across different flag names. The flattened options record
// cannot carry that interleaving; replay the parser-observed option events
// (every occurrence, argv order) through the collector, which owns the
// pairing rules and their exact diagnostics.
function collectRuleSources(events: readonly CliOptionEvent[]): readonly SemgrepRuleSource[] {
  const collector = createCliRuleSourceCollector();
  for (const event of events) {
    if (typeof event.value !== "string") continue;
    if (event.name === "--semgrep-config") collector.addConfig(event.value);
    else if (event.name === "--rule-license") {
      collector.addLicense(readNonEmpty(event.value, "--rule-license"));
    } else if (event.name === "--registry-pack") collector.addPack(event.value);
  }
  return collector.sources();
}

export function parseSemgrepCandidatesArgs(argv: readonly string[]): ParsedSemgrepCandidatesArgs {
  const parsed = parseSubcommandCli({
    argv,
    usage: SEMGREP_CANDIDATES_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  const options = parsed.options;
  return {
    base: subcommandBaseFromOptions(options),
    roots: options["--root"],
    top: options["--top"],
    semgrepBin: options["--semgrep-bin"] ?? null,
    ruleSourceManifestPath: options["--rule-source-manifest"] ?? null,
    cliRuleSources: collectRuleSources(parsed.optionEvents ?? []),
    allowedRuleLicenses: options["--allow-rule-license"],
    allowLiveRegistry: options["--allow-live-registry"],
    includeRuleMessages: options["--include-rule-messages"],
  };
}

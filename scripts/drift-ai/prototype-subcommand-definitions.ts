export type PrototypeSubcommandDefinition = {
  readonly id: string;
  readonly rootUsage: string;
};

export const PROTOTYPE_SUBCOMMAND_DEFINITIONS = [
  {
    id: "env-branches",
    rootUsage: "env-branches --config <path> [--top <count>]",
  },
  {
    id: "coverage-evidence",
    rootUsage: "coverage-evidence --config <path> [--top <count>]",
  },
  {
    id: "coverage-unused-exports",
    rootUsage:
      "coverage-unused-exports --config <path> --unused-exports-report <path> [--top <count>]",
  },
  {
    id: "clone-candidates",
    rootUsage: "clone-candidates --root <path> [--top <count>]",
  },
  {
    id: "dolos-candidates",
    rootUsage: "dolos-candidates --root <path> [--top <count>] [--dolos-bin <path>]",
  },
  {
    id: "semgrep-candidates",
    rootUsage:
      "semgrep-candidates [--root <path>] [--rule-source-manifest <path>] [--semgrep-bin <path>]",
  },
  {
    id: "ownership",
    rootUsage: "ownership [--top <count>] [--max-commits <count>]",
  },
  {
    id: "test-orphaning",
    rootUsage: "test-orphaning [--top <count>] [--max-commits <count>]",
  },
  {
    id: "birth-size-delta",
    rootUsage: "birth-size-delta [--top <count>] [--max-commits <count>]",
  },
  {
    id: "class-construction",
    rootUsage:
      "class-construction [--root <path>] [--unused-exports-report <path>] [--top <count>]",
  },
] as const satisfies readonly PrototypeSubcommandDefinition[];

export type PrototypeSubcommandId = (typeof PROTOTYPE_SUBCOMMAND_DEFINITIONS)[number]["id"];

export const PROTOTYPE_SUBCOMMAND_IDS: readonly PrototypeSubcommandId[] =
  PROTOTYPE_SUBCOMMAND_DEFINITIONS.map((definition) => definition.id);

export const PROTOTYPE_ROOT_USAGE_LINES: readonly string[] = PROTOTYPE_SUBCOMMAND_DEFINITIONS.map(
  (definition) => `  bun run drift:ai ${definition.rootUsage}`,
);

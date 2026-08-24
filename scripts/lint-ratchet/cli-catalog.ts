import type {
  CommandHandler,
  CommandHandlerArgs,
  PreflightTier,
  ValidationHook,
} from "./cli-handler-types.js";
import {
  validateEditCheckCrossFields,
  validateEditCheckTargetsCrossFields,
  validateEditRatchetCoverageCrossFields,
  validateNoCrossFields,
  validateProposeCrossFields,
  validateUpdateCrossFields,
} from "./cli-validation-hooks.js";
import {
  runCheckBaselineMode,
  runCheckDebtAccountingMode,
  runCheckRegistry,
  runDebtLogReport,
  runDefaultMode,
  runEditCheck,
  runEditCheckTargets,
  runEditRatchetCoverage,
  runPropose,
  runReport,
  runSummaryMode,
  runTrendMode,
  runUpdate,
  runZeroBaseline,
} from "./modes.js";

export type CommandOption = {
  readonly name: string;
  readonly stateKey: keyof CommandHandlerArgs;
  readonly type: "boolean" | "string";
  readonly inlineValue: boolean;
  readonly valueParser?: "directory-depth" | "positive-integer";
  readonly missingValueMessage?: string;
  readonly scopeMessage: string;
};

type CommandDescriptor = {
  readonly mode: string;
  readonly selection:
    | { readonly kind: "default" }
    | { readonly kind: "head-flag"; readonly flag: string }
    | { readonly kind: "terminal"; readonly flag: `--${string}`; readonly tail: "propose" }
    | {
        readonly kind: "terminal";
        readonly flag: `--${string}`;
        readonly tail: "paths";
        readonly stateKey: keyof CommandHandlerArgs;
      };
  readonly options: readonly CommandOption[];
  readonly preflight: PreflightTier;
  readonly usageFragment: string;
  readonly helpProse: readonly string[];
  readonly validate: ValidationHook;
  readonly handler: CommandHandler;
};

export const COMMAND_CATALOG = [
  {
    mode: "default",
    selection: { kind: "default" },
    options: [],
    preflight: "registry-preflight",
    usageFragment: "",
    helpProse: [
      "Default mode emits a harness-diagnostics envelope and fails on ratchet regressions or uncommitted improvements.",
      "Exit codes: 0 clean; 1 generic default-mode gate or unclassified runtime failure; 2 usage or configuration failure; 3 any WorseBaselineError verdict, including a --check-baseline mismatch, a refused worse --update, or a --check-debt-accounting mismatch. Truth-up consumers classify by exit code, never diagnostic text.",
    ],
    validate: validateNoCrossFields,
    handler: runDefaultMode,
  },
  {
    mode: "update",
    selection: { kind: "head-flag", flag: "update" },
    options: [
      {
        name: "allow-worse",
        stateKey: "allowWorse",
        type: "boolean",
        inlineValue: false,
        scopeMessage: "--allow-worse is only valid with --update",
      },
      {
        name: "reason",
        stateKey: "reason",
        type: "string",
        inlineValue: true,
        missingValueMessage: "--reason requires a non-empty argument",
        scopeMessage: "--reason is only valid with --update",
      },
      {
        name: "migration-reason",
        stateKey: "migrationReason",
        type: "string",
        inlineValue: true,
        missingValueMessage: "--migration-reason requires a non-empty argument",
        scopeMessage: "--migration-reason is only valid with --update",
      },
      {
        name: "retire-ratchet",
        stateKey: "retireRatchetId",
        type: "string",
        inlineValue: false,
        missingValueMessage: "--retire-ratchet requires a ratchet id argument",
        scopeMessage: "--retire-ratchet is only valid with --update",
      },
      {
        name: "accept-different-options",
        stateKey: "acceptDifferentOptions",
        type: "boolean",
        inlineValue: false,
        scopeMessage: "--accept-different-options is only valid with --update",
      },
    ],
    preflight: "update-registry-clean",
    usageFragment:
      "--update [--allow-worse --reason <why>] [--migration-reason <why>] [--retire-ratchet <id> [--accept-different-options --reason <why>]]",
    helpProse: [
      "--migration-reason <why> records why a changed ratchet metric is the right measure on the metric-migration debt-log entry; without it a lone --reason answers both the migration and any --allow-worse acceptance in the same update.",
      "--retire-ratchet <id> drops a zero-finding orphan baseline floor without --allow-worse and appends a non-debt retirement record, but only when normal lint now errors on the retired scope (proven promotion).",
      "--accept-different-options requires --retire-ratchet and --reason; it human-attests an all-error normal-lint replacement whose options differ, prints the option delta, and records the attestation.",
    ],
    validate: validateUpdateCrossFields,
    handler: runUpdate,
  },
  {
    mode: "check-baseline",
    selection: { kind: "head-flag", flag: "check-baseline" },
    options: [],
    preflight: "registry-preflight",
    usageFragment: "--check-baseline",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runCheckBaselineMode,
  },
  {
    mode: "check-debt-accounting",
    selection: { kind: "head-flag", flag: "check-debt-accounting" },
    options: [
      {
        name: "staged",
        stateKey: "debtAccountingStaged",
        type: "boolean",
        inlineValue: false,
        scopeMessage: "--staged and --base-ref are only valid with --check-debt-accounting",
      },
      {
        name: "base-ref",
        stateKey: "debtAccountingBaseRef",
        type: "string",
        inlineValue: false,
        missingValueMessage: "--base-ref requires a git ref",
        scopeMessage: "--staged and --base-ref are only valid with --check-debt-accounting",
      },
    ],
    preflight: "validate-registry",
    usageFragment: "--check-debt-accounting",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runCheckDebtAccountingMode,
  },
  {
    mode: "check-registry",
    selection: { kind: "head-flag", flag: "check-registry" },
    options: [],
    preflight: "none",
    usageFragment: "--check-registry",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runCheckRegistry,
  },
  {
    mode: "summary",
    selection: { kind: "head-flag", flag: "summary" },
    options: [
      {
        name: "by-directory",
        stateKey: "summaryByDirectoryDepth",
        type: "boolean",
        inlineValue: false,
        valueParser: "directory-depth",
        scopeMessage: "--by-directory is only valid with --summary",
      },
    ],
    preflight: "validate-registry",
    usageFragment: "--summary [--by-directory [depth]]",
    helpProse: [
      "--summary prints committed baseline totals without running ESLint; add --by-directory [depth] to group remaining findings by directory. --trend reads committed baseline history and defaults to active ratchets; add --all for retired series too. It prints active/retired status plus first/last/min/max totals. --zero-baseline audits drained ratchets against normal ESLint; --check-debt-accounting compares baseline increases to same-range debt-log entries, with --staged for index blobs and --base-ref <ref> for a custom comparison branch; --report formats a diagnostics envelope from stdin; --debt-log renders accepted debt, retirements/removals, migrations, and coverage changes from committed history.",
    ],
    validate: validateNoCrossFields,
    handler: runSummaryMode,
  },
  {
    mode: "trend",
    selection: { kind: "head-flag", flag: "trend" },
    options: [
      {
        name: "since",
        stateKey: "trendSince",
        type: "string",
        inlineValue: false,
        missingValueMessage: "--since requires a non-empty argument",
        scopeMessage: "--since is only valid with --trend",
      },
      {
        name: "max",
        stateKey: "trendMax",
        type: "string",
        inlineValue: false,
        valueParser: "positive-integer",
        missingValueMessage: "--max requires a positive integer",
        scopeMessage: "--max is only valid with --trend",
      },
      {
        name: "all",
        stateKey: "trendAll",
        type: "boolean",
        inlineValue: false,
        scopeMessage: "--all is only valid with --trend",
      },
    ],
    preflight: "none",
    usageFragment: "--trend [--since <date>] [--max <n>] [--all]",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runTrendMode,
  },
  {
    mode: "zero-baseline",
    selection: { kind: "head-flag", flag: "zero-baseline" },
    options: [],
    preflight: "validate-registry",
    usageFragment: "--zero-baseline",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runZeroBaseline,
  },
  {
    mode: "report",
    selection: { kind: "head-flag", flag: "report" },
    options: [],
    preflight: "none",
    usageFragment: "--report",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runReport,
  },
  {
    mode: "debt-log",
    selection: { kind: "head-flag", flag: "debt-log" },
    options: [],
    preflight: "none",
    usageFragment: "--debt-log",
    helpProse: [],
    validate: validateNoCrossFields,
    handler: runDebtLogReport,
  },
  {
    mode: "propose",
    selection: { kind: "terminal", flag: "--propose", tail: "propose" },
    // The terminal tail belongs to propose-cli-options.ts and intentionally is
    // not projected into the head parser's option tables.
    options: [],
    preflight: "none",
    usageFragment: "--propose <ruleId> <glob...>",
    helpProse: [
      "--propose <ruleId> <glob...> runs one core, local, or third-party rule as a dry run and prints the would-be ratchet baseline without touching the registry or committed baseline. For third-party rules, use --plugin <package> when the namespace is not already allowlisted, optional --plugin-export <default|plugin>, and optional --parser-profile <minimal-ts|type-aware-ts>.",
    ],
    validate: validateProposeCrossFields,
    handler: runPropose,
  },
  {
    mode: "edit-check-targets",
    selection: {
      kind: "terminal",
      flag: "--edit-check-targets",
      tail: "paths",
      stateKey: "editCheckTargets",
    },
    options: [],
    preflight: "none",
    usageFragment: "--edit-check-targets <relpath>...",
    helpProse: [
      "--edit-check-targets lists matching minimal-TS ratchets for edited paths (no ESLint); --edit-check lints the targets in <file> and prints only fresh ratchet regressions, for the edit-time advisory hook.",
    ],
    validate: validateEditCheckTargetsCrossFields,
    handler: runEditCheckTargets,
  },
  {
    mode: "edit-check",
    selection: { kind: "head-flag", flag: "edit-check" },
    options: [
      {
        name: "targets-file",
        stateKey: "targetsFile",
        type: "string",
        inlineValue: false,
        missingValueMessage: "--targets-file requires a non-empty argument",
        scopeMessage: "--targets-file is only valid with --edit-check",
      },
    ],
    preflight: "none",
    usageFragment: "--edit-check --targets-file <file>",
    helpProse: [],
    validate: validateEditCheckCrossFields,
    handler: runEditCheck,
  },
  {
    mode: "edit-ratchet-coverage",
    selection: {
      kind: "terminal",
      flag: "--edit-ratchet-coverage",
      tail: "paths",
      stateKey: "editRatchetCoveragePaths",
    },
    options: [],
    preflight: "none",
    usageFragment: "--edit-ratchet-coverage <relpath>...",
    helpProse: [
      "--edit-ratchet-coverage prints, per edited path, the committed-baseline ratchet rule ids tracking it (no ESLint), for the lint-coverage advisory hook.",
    ],
    validate: validateEditRatchetCoverageCrossFields,
    handler: runEditRatchetCoverage,
  },
] as const satisfies readonly CommandDescriptor[];

export type Mode = (typeof COMMAND_CATALOG)[number]["mode"];

export function deriveModeLookup(): ReadonlyMap<string, Exclude<Mode, "default">> {
  const result = new Map<string, Exclude<Mode, "default">>();
  for (const command of COMMAND_CATALOG) {
    if (command.mode !== "default" && command.selection.kind === "head-flag") {
      result.set(command.selection.flag, command.mode);
    }
  }
  return result;
}

export type TerminalCommand =
  | { readonly mode: Exclude<Mode, "default">; readonly tail: "propose" }
  | {
      readonly mode: Exclude<Mode, "default">;
      readonly tail: "paths";
      readonly stateKey: keyof CommandHandlerArgs;
    };

export function deriveTerminalLookup(): ReadonlyMap<string, TerminalCommand> {
  const result = new Map<string, TerminalCommand>();
  for (const command of COMMAND_CATALOG) {
    if (command.mode === "default" || command.selection.kind !== "terminal") continue;
    result.set(
      command.selection.flag,
      command.selection.tail === "paths"
        ? { mode: command.mode, tail: "paths", stateKey: command.selection.stateKey }
        : { mode: command.mode, tail: "propose" },
    );
  }
  return result;
}

export function deriveOptionLookup(): ReadonlyMap<string, CommandOption> {
  const result = new Map<string, CommandOption>();
  for (const command of COMMAND_CATALOG) {
    for (const option of command.options) result.set(option.name, option);
  }
  return result;
}

export function deriveHeadOptions(): Readonly<
  Record<string, { readonly type: "boolean" | "string" }>
> {
  const result: Record<string, { readonly type: "boolean" | "string" }> = {};
  for (const command of COMMAND_CATALOG) {
    if (command.selection.kind === "head-flag") {
      result[command.selection.flag] = { type: "boolean" };
    }
  }
  for (const command of COMMAND_CATALOG) {
    for (const option of command.options) result[option.name] = { type: option.type };
  }
  return result;
}

export function deriveInlineValueFlags(): ReadonlySet<string> {
  return new Set(
    COMMAND_CATALOG.flatMap((command) =>
      command.options.filter((option) => option.inlineValue).map((option) => option.name),
    ),
  );
}

export function deriveStringFlagMessages(): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const command of COMMAND_CATALOG) {
    for (const option of command.options) {
      if ("missingValueMessage" in option && !("valueParser" in option)) {
        result[option.name] = option.missingValueMessage;
      }
    }
  }
  return result;
}

export function deriveModeHandlers(): Readonly<Record<Mode, CommandHandler>> {
  return Object.fromEntries(
    COMMAND_CATALOG.map(({ mode, handler }) => [mode, handler]),
  ) as Readonly<Record<Mode, CommandHandler>>; // type-assertion-boundary: interop - Object.fromEntries cannot retain the catalog's exhaustive literal keys
}

export function derivePreflightTiers(): Readonly<Record<Mode, PreflightTier>> {
  return Object.fromEntries(
    COMMAND_CATALOG.map(({ mode, preflight }) => [mode, preflight]),
  ) as Readonly<Record<Mode, PreflightTier>>; // type-assertion-boundary: interop - Object.fromEntries cannot retain the catalog's exhaustive literal keys
}

export function ownedOptions(): readonly {
  readonly mode: Mode;
  readonly option: CommandOption;
}[] {
  return COMMAND_CATALOG.flatMap((command) =>
    command.options.map((option) => ({ mode: command.mode, option })),
  );
}

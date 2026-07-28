// CLI behind the suppression identity ledger gate (leaf 50 step 2).
//
// It owns no scanning of its own: it runs the two register scanners with
// `--identities-out`, turns their directive records into identities, and either
// regenerates `suppression-ledger.json` (--update) or gates the tree against
// it. Policy — which suppressions are allowed at all — stays entirely in the
// registers and their two data allowlists; this gate only asks whether the set
// of suppressions in the tree is the set the ledger records.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";

import { writeFileAtomicallySync } from "./lib/atomic-write.js";
import {
  compareSuppressionLedger,
  formatSuppressionLedger,
  readSuppressionLedger,
  SUPPRESSION_LEDGER_PATH,
  SUPPRESSION_LEDGER_UPDATE_COMMAND,
} from "./suppression-ledger-baseline.js";
import {
  type IdentityEmission,
  mergeEmissionScopes,
  parseIdentityEmission,
} from "./suppression-ledger-emission.js";
import {
  type DirectiveRecord,
  suppressionEntriesFromDirectives,
  type SuppressionEntry,
} from "./suppression-ledger-identity.js";
import { runRegisterForIdentities } from "./suppression-ledger-runner.js";

export const ESLINT_DISABLE_REGISTER = "scripts/eslint-disable-register.sh";
export const SUPPRESSION_REGISTER = "scripts/suppression-register.sh";
const REGISTERS = [ESLINT_DISABLE_REGISTER, SUPPRESSION_REGISTER] as const;

// A register exits 1 for policy findings (a missing reason, a disallowed broad
// disable) and 2 when it could not scan at all. Only the latter invalidates the
// emission: a policy failure is the `suppressions` slot's verdict to report,
// and its identity records are still complete.
const REGISTER_UNCHECKED_EXIT = 2;
const DEFAULT_CHANGED_BASE = "main";
const HELP_FLAGS = new Set(["--help", "-h"]);

export interface RegisterRunResult {
  readonly exitCode: number;
  readonly identities: string;
  readonly stderr: string;
}

export type RegisterRunner = (options: {
  readonly script: string;
  readonly cwd: string;
  readonly changedBase: string | undefined;
}) => Promise<RegisterRunResult>;

export interface RunSuppressionLedgerCliOptions {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly runner?: RegisterRunner;
}

export interface SuppressionLedgerRunResult {
  readonly exitCode: number;
  readonly stdout: string;
}

interface CliOptions {
  readonly ledgerPath: string;
  readonly update: boolean;
  readonly changedBase: string | undefined;
}

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/suppression-ledger.ts",
    "  bun scripts/suppression-ledger.ts --changed [base]",
    `  ${SUPPRESSION_LEDGER_UPDATE_COMMAND}`,
    "  bun scripts/suppression-ledger.ts --ledger=<path>",
    "",
    `Fails when the tree's suppression identities differ from ${SUPPRESSION_LEDGER_PATH}.`,
    "Suppression policy itself stays in the two register scripts; this gate only",
    "tracks which suppressions exist, so new ones cannot land unreviewed and",
    "removed ones get locked in.",
  ].join("\n");
}

type ArgOutcome =
  | { readonly kind: "update" }
  | { readonly kind: "changed"; readonly base: string; readonly consumed: number }
  | { readonly kind: "ledger"; readonly path: string }
  | { readonly kind: "error"; readonly error: string };

function classifyArg(arg: string, next: string | undefined): ArgOutcome {
  if (arg === "--update") return { kind: "update" };
  if (arg === "--changed") {
    if (next === undefined || next.startsWith("--")) {
      return { kind: "changed", base: DEFAULT_CHANGED_BASE, consumed: 0 };
    }
    return { kind: "changed", base: next, consumed: 1 };
  }
  if (arg.startsWith("--ledger=")) {
    const path = arg.slice("--ledger=".length);
    if (path.length === 0) return { kind: "error", error: "--ledger requires a path." };
    return { kind: "ledger", path };
  }
  return { kind: "error", error: `Unknown argument: ${arg}\n${usage()}` };
}

function parseArgs(argv: readonly string[]): ParseResult<CliOptions> {
  let ledgerPath = SUPPRESSION_LEDGER_PATH;
  let update = false;
  let changedBase: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    const outcome = classifyArg(arg, argv[index + 1]);
    if (outcome.kind === "error") return { ok: false, error: outcome.error };
    if (outcome.kind === "update") update = true;
    else if (outcome.kind === "ledger") ledgerPath = outcome.path;
    else {
      changedBase = outcome.base;
      index += outcome.consumed;
    }
  }

  if (update && changedBase !== undefined) {
    return {
      ok: false,
      error:
        "--update cannot be combined with --changed; the ledger is regenerated from a full scan.",
    };
  }
  return { ok: true, value: { ledgerPath, update, changedBase } };
}

interface Collected {
  readonly entries: readonly SuppressionEntry[];
  readonly scopePaths: readonly string[] | undefined;
}

async function collect(
  options: CliOptions,
  cwd: string,
  runner: RegisterRunner,
): Promise<ParseResult<Collected>> {
  // Both registers walk the same file set, so running them concurrently halves
  // the wall time of a full collection.
  const runs = await Promise.all(
    REGISTERS.map(async (script) => runner({ script, cwd, changedBase: options.changedBase })),
  );

  const emissions: IdentityEmission[] = [];
  const records: DirectiveRecord[] = [];
  for (const [index, run] of runs.entries()) {
    const script = REGISTERS[index] ?? "register";
    if (run.exitCode >= REGISTER_UNCHECKED_EXIT) {
      return {
        ok: false,
        error: `${script} could not scan (exit ${String(run.exitCode)}): ${run.stderr.trim()}`,
      };
    }
    const parsed = parseIdentityEmission(run.identities);
    if (!parsed.ok) return { ok: false, error: `${script}: ${parsed.error}` };
    emissions.push(parsed.value);
    records.push(...parsed.value.records);
  }

  const entries = suppressionEntriesFromDirectives(records);
  if (!entries.ok) return entries;

  return {
    ok: true,
    value: { entries: entries.value, scopePaths: mergeEmissionScopes(emissions) },
  };
}

function readLedger(ledgerPath: string): ParseResult<readonly SuppressionEntry[]> {
  if (!existsSync(ledgerPath)) {
    return {
      ok: false,
      error: `ledger missing at ${ledgerPath}; run ${SUPPRESSION_LEDGER_UPDATE_COMMAND}`,
    };
  }
  return readSuppressionLedger(readFileSync(ledgerPath, "utf8"));
}

function gate(collected: Collected, ledgerPath: string): SuppressionLedgerRunResult {
  const ledger = readLedger(ledgerPath);
  if (!ledger.ok) return { exitCode: 2, stdout: `ERROR: ${ledger.error}` };

  const comparison = compareSuppressionLedger(ledger.value, collected.entries, {
    scopePaths: collected.scopePaths,
  });
  // A derived-summary mismatch parses as a warning; the ledger is still
  // enforceable through its entries, but leaving it committed lets the human
  // -readable summary lie, so it fails with the regeneration command.
  const warnings = ledger.warnings?.map((warning) => `WARN: ${warning}`) ?? [];
  if (comparison.exitCode === 0 && warnings.length > 0) {
    return {
      exitCode: 1,
      stdout: [...warnings, comparison.stdout, `run: ${SUPPRESSION_LEDGER_UPDATE_COMMAND}`].join(
        "\n",
      ),
    };
  }
  return {
    exitCode: comparison.exitCode,
    stdout: [...warnings, comparison.stdout].join("\n"),
  };
}

export async function runSuppressionLedgerCli(
  options: RunSuppressionLedgerCliOptions,
): Promise<SuppressionLedgerRunResult> {
  if (options.argv.some((arg) => HELP_FLAGS.has(arg))) return { exitCode: 0, stdout: usage() };

  const parsed = parseArgs(options.argv);
  if (!parsed.ok) return { exitCode: 2, stdout: `ERROR: ${parsed.error}` };

  const cwd = options.cwd ?? process.cwd();
  const runner = options.runner ?? runRegisterForIdentities;
  const collected = await collect(parsed.value, cwd, runner);
  if (!collected.ok) return { exitCode: 2, stdout: `ERROR: ${collected.error}` };

  const ledgerPath = resolve(cwd, parsed.value.ledgerPath);
  if (parsed.value.update) {
    writeFileAtomicallySync(ledgerPath, formatSuppressionLedger(collected.value.entries));
    return {
      exitCode: 0,
      stdout: [
        `lint:suppressions:ledger -- wrote ${parsed.value.ledgerPath}`,
        `current: ${String(collected.value.entries.length)} identities`,
      ].join("\n"),
    };
  }
  return gate(collected.value, ledgerPath);
}

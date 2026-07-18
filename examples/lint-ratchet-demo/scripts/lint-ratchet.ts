// The demo's minimal CLI adapter for the portable lint-ratchet engine.
//
// It wires the demo's registry/binding/context (see scripts/lint-ratchet/adapter.ts)
// to the package's pure kernel + governance operations and renders its OWN tiny
// result envelope — deliberately a different shape from the Musi diagnostics
// envelope — to prove the engine dictates neither the CLI surface nor the output
// format. Supported invocations:
//
//   bun scripts/lint-ratchet.ts                      # gate (default)
//   bun scripts/lint-ratchet.ts --check-registry     # validate the registry
//   bun scripts/lint-ratchet.ts --check-baseline     # gate + missing-driver warning
//   bun scripts/lint-ratchet.ts --update [--allow-worse --reason "<why>"]
//   bun scripts/lint-ratchet.ts --propose <ruleId> <glob...>  # preview a baseline
import { resolve } from "node:path";

import { forwardMissingMergeDriverWarning } from "@musi/lint-ratchet/git-rail/merge-driver-presence.js";
import { applyLintRatchetUpdate } from "@musi/lint-ratchet/governance/baseline-update-apply.js";
import { WorseBaselineError } from "@musi/lint-ratchet/governance/errors.js";
import { runLintRatchetProposeCli } from "@musi/lint-ratchet/governance/propose.js";
import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  formatLintRatchetBaseline,
  parseLintRatchetBaseline,
  validateLintRatchetRegistry,
} from "@musi/lint-ratchet/kernel/baseline.js";
import {
  collectCurrentById,
  totalCurrentCount,
} from "@musi/lint-ratchet/kernel/current-collector.js";
import { buildRuleSourceHashesById } from "@musi/lint-ratchet/kernel/rule-source.js";

import {
  demoBinding,
  demoContext,
  demoProposeEngine,
  demoRatchets,
  readBaselineText,
  repoRoot,
} from "./lint-ratchet/adapter.js";

const PROCESS_ARG_OFFSET = 2;
// The demo defines exactly one local rule; check-registry validates the registry
// against this set the same way the Musi adapter validates against its wired rules.
const DEMO_LOCAL_RULE_IDS = new Set(["local/no-console-log"]);

type Mode = "gate" | "check-registry" | "check-baseline" | "update" | "propose";

interface DemoArgs {
  readonly mode: Mode;
  readonly allowWorse: boolean;
  readonly reason?: string;
  // Populated only for --propose <ruleId> <glob...>.
  readonly proposeRuleId?: string;
  readonly proposeFiles?: readonly string[];
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): DemoArgs {
  let mode: Mode = "gate";
  let allowWorse = false;
  let reason: string | undefined;
  let proposeRuleId: string | undefined;
  const proposeFiles: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--check-registry":
        mode = "check-registry";
        break;
      case "--check-baseline":
        mode = "check-baseline";
        break;
      case "--update":
        mode = "update";
        break;
      case "--propose": {
        // --propose <ruleId> <glob...>: the ruleId then one or more file globs,
        // consumed up to the next flag.
        mode = "propose";
        proposeRuleId = argv[index + 1];
        index += 1;
        while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
          index += 1;
          proposeFiles.push(argv[index]);
        }
        break;
      }
      case "--allow-worse":
        allowWorse = true;
        break;
      case "--reason": {
        index += 1;
        const value = argv[index];
        if (value === undefined) throw new UsageError("--reason requires a value");
        reason = value;
        break;
      }
      default:
        throw new UsageError(`unknown argument: ${arg ?? "(none)"}`);
    }
  }
  return {
    mode,
    allowWorse,
    ...(reason === undefined ? {} : { reason }),
    ...(proposeRuleId === undefined ? {} : { proposeRuleId }),
    ...(proposeFiles.length === 0 ? {} : { proposeFiles }),
  };
}

const RECOVERY_COMMAND =
  'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this debt beats a rushed fix>"';

/**
 * The demo's own result envelope. Intentionally minimal and distinct from the
 * Musi diagnostics envelope: a status plus the blocking key deltas, printed as
 * one-line JSON so a consumer (and the smoke) can assert on it without the demo
 * inheriting a Musi output contract.
 */
function renderEnvelope(payload: {
  readonly status: "ok" | "regressed" | "improved";
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  readonly recovery?: string;
}): string {
  return JSON.stringify({ tool: "lint-ratchet-demo", ...payload });
}

async function collectCurrent(): Promise<Awaited<ReturnType<typeof collectCurrentById>>> {
  const ruleSourceHashesById = buildRuleSourceHashesById(demoRatchets, demoBinding);
  return collectCurrentById({
    ruleSourceHashesById,
    ratchets: demoRatchets,
    binding: demoBinding,
  });
}

function parseCommittedBaseline(): NonNullable<
  ReturnType<typeof parseLintRatchetBaseline>["baseline"]
> {
  const ruleSourceHashesById = buildRuleSourceHashesById(demoRatchets, demoBinding);
  const parsed = parseLintRatchetBaseline(readBaselineText(), demoRatchets, ruleSourceHashesById);
  if (parsed.baseline === undefined) {
    throw new Error(`baseline failed to parse:\n${parsed.failures.join("\n")}`);
  }
  return parsed.baseline;
}

function reportComparison(regressions: readonly string[], improvements: readonly string[]): number {
  if (regressions.length > 0) {
    process.stdout.write(
      `${renderEnvelope({ status: "regressed", regressions, improvements, recovery: RECOVERY_COMMAND })}\n`,
    );
    return 1;
  }
  if (improvements.length > 0) {
    process.stdout.write(
      `${renderEnvelope({
        status: "improved",
        regressions,
        improvements,
        recovery: "bun run lint:ratchet:update  # lock in the improvement",
      })}\n`,
    );
    return 1;
  }
  process.stdout.write(`${renderEnvelope({ status: "ok", regressions, improvements })}\n`);
  return 0;
}

async function runGate(): Promise<number> {
  const baseline = parseCommittedBaseline();
  const currentById = await collectCurrent();
  const comparison = compareCurrentToBaseline(baseline, demoRatchets, currentById);
  const regressions = comparison.regressions.map((entry) => entry.path);
  const improvements = comparison.improvements.map((entry) => entry.path);
  return reportComparison(regressions, improvements);
}

function runCheckRegistry(): number {
  const failures = validateLintRatchetRegistry(demoRatchets, {
    localRuleIds: DEMO_LOCAL_RULE_IDS,
  });
  if (failures.length > 0) {
    process.stderr.write(`lint:ratchet: registry invalid:\n${failures.join("\n")}\n`);
    return 1;
  }
  process.stdout.write("lint:ratchet: registry OK\n");
  return 0;
}

async function runUpdate(args: DemoArgs): Promise<number> {
  const ruleSourceHashesById = buildRuleSourceHashesById(demoRatchets, demoBinding);
  const currentById = await collectCurrent();
  const generated = buildLintRatchetBaseline(demoRatchets, currentById, ruleSourceHashesById);
  const rendered = formatLintRatchetBaseline(generated);
  // The packaged update orchestration gates the committed baseline (structurally,
  // so a stale rule-source hash does not block a regeneration), records any
  // accepted debt in the debt log, and writes the baseline atomically — the same
  // apply path the Musi adapter uses.
  try {
    applyLintRatchetUpdate({
      context: demoContext,
      generated,
      rendered,
      registry: demoRatchets,
      options: {
        allowWorse: args.allowWorse,
        ...(args.reason === undefined ? {} : { reason: args.reason }),
      },
      currentFindingCount: totalCurrentCount(currentById),
    });
  } catch (error) {
    if (error instanceof WorseBaselineError) {
      process.stderr.write(
        `lint:ratchet: update refused:\n${error.message}\nAccept the debt with:\n  ${RECOVERY_COMMAND}\n`,
      );
      return 1;
    }
    throw error;
  }
  return 0;
}

async function runProposeMode(args: DemoArgs): Promise<number> {
  if (args.proposeRuleId === undefined || args.proposeFiles === undefined) {
    throw new UsageError("--propose requires <ruleId> <glob...>");
  }
  // Preview the baseline a rule + globs WOULD produce without writing anything.
  // The demo's own propose engine supplies the registry hint (S4's injected
  // adapter concern) pointing at this demo's registry file.
  await runLintRatchetProposeCli(
    { ruleId: args.proposeRuleId, files: args.proposeFiles },
    demoProposeEngine,
  );
  return 0;
}

function warnIfMergeDriverMissing(): void {
  forwardMissingMergeDriverWarning({
    checkScriptPath: resolve(repoRoot, "scripts/git/check-lint-ratchet-merge-driver.sh"),
    cwd: process.cwd(),
    env: process.env,
    warn: (message) => {
      console.error(message);
    },
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  if (args.mode === "update" || args.mode === "check-baseline") {
    warnIfMergeDriverMissing();
  }
  switch (args.mode) {
    case "check-registry":
      return runCheckRegistry();
    case "update":
      return runUpdate(args);
    case "propose":
      return runProposeMode(args);
    case "gate":
    case "check-baseline":
      return runGate();
    default:
      return runGate();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`lint:ratchet: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    // A parse/config failure (e.g. a stale rule-source hash, or a baseline left
    // unparseable by a bad merge) surfaces as a `lint:ratchet:` diagnostic and a
    // failing exit — not an uncaught stack trace — so callers like the post-merge
    // truth-up hook see a clean "run lint:ratchet:update" verdict.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`lint:ratchet: ${message}\n`);
    process.exitCode = 1;
  }
}

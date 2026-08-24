import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";
import { z } from "zod";

import { parseCli } from "./lib/cli.js";

const DEFAULT_BASELINE_PATH = "sensor-near-duplicates.baseline.json";
const HELP_FLAGS = new Set(["--help", "-h"]);

export type NearDuplicatesCliOptions = {
  readonly baselinePath: string;
  readonly update: boolean;
  readonly checkBaseline: boolean;
  readonly restoreMergeTruth: boolean;
  readonly admission?: {
    readonly identity: string;
    readonly reason: string;
  };
};

function usage(): string {
  return [
    "Usage:",
    "  bun run sensor:near-duplicates",
    "  bun scripts/sensor-near-duplicates.ts --update",
    '  bun scripts/sensor-near-duplicates.ts --admit <identity> --reason "<text>"',
    "  bun scripts/sensor-near-duplicates.ts --check-baseline",
    "  bun scripts/sensor-near-duplicates.ts --restore-merge-truth",
    "  bun scripts/sensor-near-duplicates.ts --baseline=<path>",
    "",
    "Check mode gates high-confidence pairs touching staged files; update mode only shrinks the whole-repo baseline.",
    "Admission mode records one reviewed identity with a required reason.",
    "Exit codes: 0 clean; 1 staged/update verdict; 2 usage or transient failure; 3 stale whole-repo --check-baseline verdict; 6 unreviewed working-tree baseline growth over HEAD.",
  ].join("\n");
}

// Local sentinel so the ParseResult bridge below can convert the substrate's
// thrown errors back into the sensor's ok:false contract.
class NearDuplicatesCliError extends Error {}

const cliOptionsSchema = z.object({
  "--baseline": z.string().default(DEFAULT_BASELINE_PATH),
  "--update": z.boolean().default(false),
  "--check-baseline": z.boolean().default(false),
  "--restore-merge-truth": z.boolean().default(false),
  "--admit": z.string().optional(),
  "--reason": z.string().optional(),
});

function admissionFrom(
  identity: string | undefined,
  reason: string | undefined,
): ParseResult<NearDuplicatesCliOptions["admission"]> {
  if (identity === undefined && reason === undefined) return { ok: true, value: undefined };
  if (reason === undefined) return { ok: false, error: "--admit requires --reason <text>." };
  if (identity === undefined) return { ok: false, error: "--reason requires --admit <identity>." };
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, error: "--reason requires non-empty text." };
  return { ok: true, value: { identity, reason: trimmed } };
}

export function isNearDuplicatesHelpFlag(arg: string | undefined): boolean {
  return arg !== undefined && HELP_FLAGS.has(arg);
}

export function parseNearDuplicatesArgs(
  argv: readonly string[],
): ParseResult<NearDuplicatesCliOptions> {
  // Help wins over every other diagnostic, wherever it appears (the entrypoint
  // maps it to exit 0 only when it is argv[0]).
  if (argv.some((arg) => HELP_FLAGS.has(arg))) return { ok: false, error: usage() };
  // Bug-compat (pinned by the characterization tests): a trailing bare
  // --baseline silently keeps the default path instead of erroring.
  const args = argv.at(-1) === "--baseline" ? argv.slice(0, -1) : argv;
  let parsed;
  try {
    parsed = parseCli({
      argv: args,
      usage: usage(),
      createError: (message) => new NearDuplicatesCliError(message),
      // Empty-string args flow to positionals so they fail as unknown
      // arguments below, matching the pre-substrate contract.
      allowEmptyArgs: true,
      options: [
        // --baseline is the one option that accepts the inline `=` form.
        { name: "--baseline", kind: "value", valueErrorMessage: "--baseline requires a path." },
        {
          name: "--admit",
          kind: "value",
          rejectInlineForm: true,
          valueErrorMessage: "--admit requires an identity.",
        },
        {
          name: "--reason",
          kind: "value",
          rejectInlineForm: true,
          valueErrorMessage: "--reason requires non-empty text.",
        },
        { name: "--update", kind: "flag" },
        { name: "--check-baseline", kind: "flag" },
        { name: "--restore-merge-truth", kind: "flag" },
      ],
      schema: cliOptionsSchema,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const stray = parsed.positionals[0];
  if (stray !== undefined) return { ok: false, error: `Unknown argument: ${stray}\n${usage()}` };
  const admission = admissionFrom(parsed.options["--admit"], parsed.options["--reason"]);
  if (!admission.ok) return admission;
  const update = parsed.options["--update"];
  const checkBaseline = parsed.options["--check-baseline"];
  const restoreMergeTruth = parsed.options["--restore-merge-truth"];
  if (
    [update, checkBaseline, restoreMergeTruth, admission.value !== undefined].filter(Boolean)
      .length > 1
  ) {
    return { ok: false, error: "baseline operating modes cannot be combined." };
  }
  return {
    ok: true,
    value: {
      baselinePath: parsed.options["--baseline"],
      update,
      checkBaseline,
      restoreMergeTruth,
      ...(admission.value === undefined ? {} : { admission: admission.value }),
    },
  };
}

import type { ParseResult } from "./lib/baseline/entry-baseline.js";

const DEFAULT_BASELINE_PATH = "sensor-near-duplicates.baseline.json";
const HELP_FLAGS = new Set(["--help", "-h"]);
const VALUE_FLAGS = new Set(["--baseline", "--admit", "--reason"]);

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
  ].join("\n");
}

function isKnownArg(arg: string): boolean {
  return (
    HELP_FLAGS.has(arg) ||
    ["--update", "--check-baseline", "--restore-merge-truth", ...VALUE_FLAGS].includes(arg) ||
    arg.startsWith("--baseline=")
  );
}

function unknownArg(argv: readonly string[]): string | undefined {
  return argv.find((arg, index) => {
    const previous = index === 0 ? undefined : argv[index - 1];
    return (previous === undefined || !VALUE_FLAGS.has(previous)) && !isKnownArg(arg);
  });
}

function baselinePathFromArgs(argv: readonly string[]): ParseResult<string> {
  const separateIndex = argv.indexOf("--baseline");
  const separateValue = separateIndex < 0 ? undefined : argv[separateIndex + 1];
  const inlineValue = argv
    .find((arg) => arg.startsWith("--baseline="))
    ?.slice("--baseline=".length);
  const baselinePath = separateValue ?? inlineValue ?? DEFAULT_BASELINE_PATH;
  if (baselinePath.length === 0 || baselinePath.startsWith("--")) {
    return { ok: false, error: "--baseline requires a path." };
  }
  return { ok: true, value: baselinePath };
}

function admissionFromArgs(
  argv: readonly string[],
): ParseResult<NearDuplicatesCliOptions["admission"]> {
  const admitIndex = argv.indexOf("--admit");
  const reasonIndex = argv.indexOf("--reason");
  if (Math.max(admitIndex, reasonIndex) < 0) return { ok: true, value: undefined };
  if (admitIndex >= 0 && reasonIndex < 0) {
    return { ok: false, error: "--admit requires --reason <text>." };
  }
  if (reasonIndex >= 0 && admitIndex < 0) {
    return { ok: false, error: "--reason requires --admit <identity>." };
  }
  const identity = argv[admitIndex + 1];
  if (identity === undefined || identity.startsWith("--")) {
    return { ok: false, error: "--admit requires an identity." };
  }
  const rawReason = argv[reasonIndex + 1];
  if (rawReason === undefined || rawReason.trim().length === 0) {
    return { ok: false, error: "--reason requires non-empty text." };
  }
  return { ok: true, value: { identity, reason: rawReason.trim() } };
}

export function isNearDuplicatesHelpFlag(arg: string | undefined): boolean {
  return arg !== undefined && HELP_FLAGS.has(arg);
}

export function parseNearDuplicatesArgs(
  argv: readonly string[],
): ParseResult<NearDuplicatesCliOptions> {
  if (argv.some((arg) => HELP_FLAGS.has(arg))) return { ok: false, error: usage() };
  const unknown = unknownArg(argv);
  if (unknown !== undefined) {
    return { ok: false, error: `Unknown argument: ${unknown}\n${usage()}` };
  }
  const admission = admissionFromArgs(argv);
  if (!admission.ok) return admission;
  const update = argv.includes("--update");
  const checkBaseline = argv.includes("--check-baseline");
  const restoreMergeTruth = argv.includes("--restore-merge-truth");
  if (
    [update, checkBaseline, restoreMergeTruth, admission.value !== undefined].filter(Boolean)
      .length > 1
  ) {
    return { ok: false, error: "baseline operating modes cannot be combined." };
  }
  const baselinePath = baselinePathFromArgs(argv);
  if (!baselinePath.ok) return baselinePath;
  return {
    ok: true,
    value: {
      baselinePath: baselinePath.value,
      update,
      checkBaseline,
      restoreMergeTruth,
      ...(admission.value === undefined ? {} : { admission: admission.value }),
    },
  };
}

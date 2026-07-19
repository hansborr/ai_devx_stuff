import { readFileSync } from "node:fs";

// Run-meta JSON codec for scripts/lib/verify-metadata.sh (backlog leaf 05).
// The bash library keeps orchestration (locks, markers, mktemp, git, `date`)
// and shells out here for every parse/serialize/transform of the run-meta
// format, replacing the deleted sed/awk extractors and printf builders.
//
// Contract: stdin-consuming subcommands read complete documents from stdin;
// argv-only builders take everything as arguments and never touch stdin (the
// subcommand table below records which is which). Each either emits a whole
// JSON document (or a single decoded scalar for the display field getters)
// on stdout, or refuses via exit code. Output is never KEY=VALUE lines for
// `eval` — verify.sh's no-eval stance applies because run-meta values carry
// arbitrary command strings.
//
// This file is deliberately self-contained (node builtins only): shell tests
// copy it into sandbox repos next to verify-metadata.sh, so it must run from
// any directory with no sibling imports.
//
// Exit codes (fail closed, distinct per failure class):
//   0 success · 1 verdict refusal (restamp-wrapper: not a passing verify
//   wrapper) · 2 usage error · 3 malformed JSON input · 4 invalid argument
//   (epoch/exit-code/mode) · 5 invalid fingerprint.

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;
export const EXIT_MALFORMED_JSON = 3;
export const EXIT_INVALID_ARGUMENT = 4;
export const EXIT_INVALID_FINGERPRINT = 5;

interface VerifyMetadataCliOptions {
  readonly argv: readonly string[];
  readonly stdin: string;
}

export interface VerifyMetadataCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type JsonObject = Record<string, unknown>;

const nodeArgvUserArgumentOffset = 2;
// argv lengths include the subcommand token itself.
const stepMetaArgvLength = 9;
const wrapperMetaArgvLength = 10;
const restampWrapperArgvLength = 5;
const shortcircuitMetaArgvLength = 6;
const combineArgvLength = 3;
const restampableModes = new Set(["serial-verify", "parallel-verify"]);
const fingerprintPattern = /^[0-9a-f]{64}$/u;
const historyModePattern = /^[\w.-]+$/u;
const unsignedIntegerPattern = /^\d+$/u;
const millisecondsPerSecond = 1000;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseFailure: unique symbol = Symbol("verify-metadata-parse-failure");

const tryParseJson = (text: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return parseFailure;
  }
};

const parseUnsignedInteger = (value: string): number | undefined => {
  if (!unsignedIntegerPattern.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

interface EpochWindow {
  readonly startEpoch: number;
  readonly endEpoch: number;
  readonly exitCode: number;
}

const parseEpochWindow = (
  startEpochArg: string | undefined,
  endEpochArg: string | undefined,
  exitCodeArg: string | undefined,
): EpochWindow | undefined => {
  const startEpoch = parseUnsignedInteger(startEpochArg ?? "");
  const endEpoch = parseUnsignedInteger(endEpochArg ?? "");
  const exitCode = parseUnsignedInteger(exitCodeArg ?? "");
  if (startEpoch === undefined || endEpoch === undefined || exitCode === undefined)
    return undefined;
  return { startEpoch, endEpoch, exitCode };
};

const clampedElapsedSeconds = (startEpoch: number, endEpoch: number): number =>
  Math.max(0, endEpoch - startEpoch);

const success = (stdout: string): VerifyMetadataCliResult => ({
  exitCode: EXIT_OK,
  stdout,
  stderr: "",
});

const failure = (exitCode: number, message: string): VerifyMetadataCliResult => ({
  exitCode,
  stdout: "",
  stderr: `verify-metadata-core: ${message}\n`,
});

const documentLine = (value: unknown): string => `${JSON.stringify(value)}\n`;

const stringFieldOrEmpty = (object: JsonObject, key: string): string => {
  const value = object[key];
  return typeof value === "string" ? value : "";
};

const runWrapperFragment = ({ stdin }: VerifyMetadataCliOptions): VerifyMetadataCliResult => {
  const parsed = tryParseJson(stdin);
  if (parsed === parseFailure) return failure(EXIT_MALFORMED_JSON, "malformed JSON document");
  if (!isJsonObject(parsed) || !isJsonObject(parsed["wrapper"])) {
    return failure(EXIT_INVALID_ARGUMENT, "document has no wrapper object");
  }
  return success(documentLine(parsed["wrapper"]));
};

const scalarFieldValue = (
  object: JsonObject,
  key: string,
  kind: "string" | "int",
): string | undefined => {
  const value = object[key];
  if (kind === "string") return typeof value === "string" ? value : undefined;
  const isUnsignedInteger = typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  return isUnsignedInteger ? String(value) : undefined;
};

// Shared handler for string-field/int-field. Legacy no-match parity: a
// missing or differently-typed field emits nothing and still exits 0.
const runScalarField = (
  kind: "string" | "int",
  { argv, stdin }: VerifyMetadataCliOptions,
): VerifyMetadataCliResult => {
  const [subcommand, key] = argv;
  if (key === undefined) return failure(EXIT_USAGE, `${subcommand ?? ""} requires <key>`);
  const parsed = tryParseJson(stdin);
  if (parsed === parseFailure) return failure(EXIT_MALFORMED_JSON, "malformed JSON document");
  if (!isJsonObject(parsed)) return success("");
  const value = scalarFieldValue(parsed, key, kind);
  return value === undefined ? success("") : success(`${value}\n`);
};

const runStepMeta = ({ argv }: VerifyMetadataCliOptions): VerifyMetadataCliResult => {
  const [, name, mode, startEpochArg, startTime, endEpochArg, endTime, exitCodeArg, command] = argv;
  if (name === undefined || command === undefined || argv.length !== stepMetaArgvLength) {
    return failure(EXIT_USAGE, "step-meta requires 8 arguments");
  }
  const window = parseEpochWindow(startEpochArg, endEpochArg, exitCodeArg);
  if (window === undefined) return failure(EXIT_INVALID_ARGUMENT, "step-meta: bad epoch/exit-code");
  return success(
    documentLine({
      name,
      mode,
      start_time: startTime,
      end_time: endTime,
      elapsed_seconds: clampedElapsedSeconds(window.startEpoch, window.endEpoch),
      exit_code: window.exitCode,
      command,
    }),
  );
};

const runWrapperMeta = ({ argv }: VerifyMetadataCliOptions): VerifyMetadataCliResult => {
  const [, mode, startEpochArg, startTime, endEpochArg, endTime, exitCodeArg, command] = argv;
  const head = argv[8];
  const fingerprint = argv[9];
  if (fingerprint === undefined || argv.length !== wrapperMetaArgvLength) {
    return failure(EXIT_USAGE, "wrapper-meta requires 9 arguments");
  }
  const window = parseEpochWindow(startEpochArg, endEpochArg, exitCodeArg);
  if (window === undefined) {
    return failure(EXIT_INVALID_ARGUMENT, "wrapper-meta: bad epoch/exit-code");
  }
  if (!fingerprintPattern.test(fingerprint)) {
    return failure(EXIT_INVALID_FINGERPRINT, "wrapper-meta requires a 64-hex fingerprint");
  }
  return success(
    documentLine({
      name: "wrapper",
      mode,
      start_time: startTime,
      end_time: endTime,
      elapsed_seconds: clampedElapsedSeconds(window.startEpoch, window.endEpoch),
      exit_code: window.exitCode,
      head,
      fingerprint,
      command,
    }),
  );
};

// Returns the wrapper's mode when it records a passing serial/parallel verify
// run, and undefined otherwise (the restamp refusal verdict).
const passingRestampableMode = (wrapper: JsonObject): string | undefined => {
  const mode = wrapper["mode"];
  if (typeof mode !== "string" || !restampableModes.has(mode)) return undefined;
  return wrapper["exit_code"] === 0 ? mode : undefined;
};

// Legacy parity: an unparseable or pre-1970 (negative-epoch) start time falls
// back to now, matching the `date -d` fallback the bash implementation used.
const restampStartEpoch = (startTime: string, nowEpoch: number): number => {
  const parsedStartMs = Date.parse(startTime);
  if (Number.isNaN(parsedStartMs)) return nowEpoch;
  const parsedStartEpoch = Math.floor(parsedStartMs / millisecondsPerSecond);
  return parsedStartEpoch < 0 ? nowEpoch : parsedStartEpoch;
};

const runRestampWrapper = ({ argv, stdin }: VerifyMetadataCliOptions): VerifyMetadataCliResult => {
  const [, newHead, newFingerprint, nowEpochArg, nowIso] = argv;
  if (nowIso === undefined || argv.length !== restampWrapperArgvLength) {
    return failure(EXIT_USAGE, "restamp-wrapper requires 4 arguments");
  }
  if (newFingerprint === undefined || !fingerprintPattern.test(newFingerprint)) {
    return failure(EXIT_INVALID_FINGERPRINT, "restamp-wrapper requires a 64-hex fingerprint");
  }
  const nowEpoch = parseUnsignedInteger(nowEpochArg ?? "");
  if (nowEpoch === undefined) {
    return failure(EXIT_INVALID_ARGUMENT, "restamp-wrapper: bad now-epoch");
  }
  const parsed = tryParseJson(stdin);
  if (parsed === parseFailure || !isJsonObject(parsed)) {
    return failure(EXIT_MALFORMED_JSON, "malformed wrapper document");
  }
  const mode = passingRestampableMode(parsed);
  if (mode === undefined) {
    return failure(EXIT_REFUSED, "refusing to re-stamp: not a passing verify wrapper");
  }
  const startTime = stringFieldOrEmpty(parsed, "start_time");
  return success(
    documentLine({
      name: "wrapper",
      mode,
      start_time: startTime,
      end_time: nowIso,
      elapsed_seconds: clampedElapsedSeconds(restampStartEpoch(startTime, nowEpoch), nowEpoch),
      exit_code: 0,
      head: newHead,
      fingerprint: newFingerprint,
      command: stringFieldOrEmpty(parsed, "command"),
    }),
  );
};

const runShortcircuitMeta = ({ argv }: VerifyMetadataCliOptions): VerifyMetadataCliResult => {
  const [, mode, head, fingerprint, satisfiedMarker, generatedAt] = argv;
  if (generatedAt === undefined || argv.length !== shortcircuitMetaArgvLength) {
    return failure(EXIT_USAGE, "shortcircuit-meta requires 5 arguments");
  }
  if (mode === undefined || !historyModePattern.test(mode)) {
    return failure(EXIT_INVALID_ARGUMENT, "shortcircuit-meta mode must match [A-Za-z0-9._-]+");
  }
  if (fingerprint === undefined || !fingerprintPattern.test(fingerprint)) {
    return failure(EXIT_INVALID_FINGERPRINT, "shortcircuit-meta requires a 64-hex fingerprint");
  }
  return success(
    documentLine({
      version: 1,
      mode,
      generated_at: generatedAt,
      wrapper: {
        name: "wrapper",
        mode,
        start_time: generatedAt,
        end_time: generatedAt,
        elapsed_seconds: 0,
        exit_code: 0,
        head: head === undefined || head === "" ? "none" : head,
        fingerprint,
        satisfied_marker: satisfiedMarker,
      },
      steps: [],
    }),
  );
};

// Combining is total: a malformed wrapper line degrades to wrapper:null and a
// malformed step line is dropped, each with a stderr warning, so the emitted
// run-meta document is always well-formed JSON (the legacy cat-based combine
// embedded garbage verbatim). Downstream readers stay fail-closed on null.
const runCombine = ({ argv, stdin }: VerifyMetadataCliOptions): VerifyMetadataCliResult => {
  const [, mode, generatedAt] = argv;
  if (generatedAt === undefined || argv.length !== combineArgvLength) {
    return failure(EXIT_USAGE, "combine requires <mode> <generated-at>");
  }
  const [wrapperLine = "", ...stepLines] = stdin.split("\n");
  const warnings: string[] = [];
  const parsedWrapper = tryParseJson(wrapperLine);
  const wrapper: unknown = parsedWrapper === parseFailure ? null : parsedWrapper;
  if (parsedWrapper === parseFailure) {
    warnings.push("verify-metadata-core: combine: malformed wrapper fragment; recording null\n");
  }
  const steps: unknown[] = [];
  for (const line of stepLines) {
    if (line === "") continue;
    const parsedStep = tryParseJson(line);
    if (parsedStep === parseFailure) {
      warnings.push("verify-metadata-core: combine: dropping malformed step fragment\n");
      continue;
    }
    steps.push(parsedStep);
  }
  return {
    exitCode: EXIT_OK,
    stdout: documentLine({ version: 1, mode, generated_at: generatedAt, wrapper, steps }),
    stderr: warnings.join(""),
  };
};

type SubcommandHandler = (options: VerifyMetadataCliOptions) => VerifyMetadataCliResult;

// Each entry records whether the subcommand consumes stdin. Argv-only
// subcommands must never read it: their writer shims redirect stdin from
// /dev/null as one defense, and this table is the codec-side other — an
// unconditional read would block forever on the caller's terminal whenever a
// spawn misses that redirect (interactive `git commit`, foreground verify).
const subcommands = new Map<string, readonly [SubcommandHandler, "stdin" | "argv-only"]>([
  ["wrapper-fragment", [runWrapperFragment, "stdin"]],
  ["string-field", [(options) => runScalarField("string", options), "stdin"]],
  ["int-field", [(options) => runScalarField("int", options), "stdin"]],
  ["step-meta", [runStepMeta, "argv-only"]],
  ["wrapper-meta", [runWrapperMeta, "argv-only"]],
  ["restamp-wrapper", [runRestampWrapper, "stdin"]],
  ["shortcircuit-meta", [runShortcircuitMeta, "argv-only"]],
  ["combine", [runCombine, "stdin"]],
]);

export const subcommandReadsStdin = (subcommand: string): boolean =>
  subcommands.get(subcommand)?.[1] === "stdin";

export const runVerifyMetadataCoreCli = (
  options: VerifyMetadataCliOptions,
): VerifyMetadataCliResult => {
  const [subcommand] = options.argv;
  if (subcommand === undefined) {
    return failure(
      EXIT_USAGE,
      `usage: <subcommand> — one of: ${[...subcommands.keys()].join(", ")}`,
    );
  }
  const entry = subcommands.get(subcommand);
  if (entry === undefined) return failure(EXIT_USAGE, `unsupported subcommand: ${subcommand}`);
  return entry[0](options);
};

if (import.meta.main) {
  const argv = process.argv.slice(nodeArgvUserArgumentOffset);
  const result = runVerifyMetadataCoreCli({
    argv,
    stdin: subcommandReadsStdin(argv[0] ?? "") ? readFileSync(0, "utf8") : "",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

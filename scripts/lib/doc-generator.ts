// Shared check-or-write scaffold for the harness doc/file generators
// (scripts/generate-lint-guidance.ts, scripts/harness/generate-harness-controls.ts,
// scripts/harness/generate-verify-steps.ts). These generators all expose the
// same `--check` CI contract: in check mode they compare the on-disk output to a
// freshly rendered string and, on mismatch, print
// `<output> is out of date. Run \`<refresh>\` and commit the result.` plus set
// `process.exitCode = 1`; otherwise they (re)write the file. Keeping that
// exit-code contract and operator message in one place stops a future tweak to
// check semantics from silently landing in one generator and skipping the rest.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PROCESS_ARG_OFFSET = 2;

/**
 * The render result for a single doc generator run.
 *
 * `rendered` is the full output text to compare/write. `wroteSuffix` is appended
 * (with a leading space) to the `Wrote <output>` log line when the file is
 * written — e.g. ` (12 rule(s) with metadata)` — and omitted in check mode.
 */
export interface DocRenderResult {
  readonly rendered: string;
  readonly wroteSuffix?: string;
}

export interface RunDocGeneratorOptions {
  /** Absolute path of the generated file to compare against / write. */
  readonly outputPath: string;
  /** The `bun run <command>` the operator runs to refresh the output. */
  readonly refreshCommand: string;
  /**
   * Collects and renders the output. Returning `undefined` short-circuits the
   * run with no write and no error (the collector is expected to have already
   * reported its own failure and set `process.exitCode`).
   */
  readonly render: () => DocRenderResult | undefined;
}

export interface RunDocGeneratorAsyncOptions {
  readonly outputPath: string;
  readonly refreshCommand: string;
  readonly render: () => Promise<DocRenderResult | undefined>;
}

/**
 * Parses generator argv (post-`argv.slice(2)`), accepting only the `--` and
 * `--check` tokens and rejecting anything else. Returns whether `--check` was
 * present.
 */
export function parseCheckModeArgs(args: readonly string[]): { readonly checkMode: boolean } {
  const unknownArgs = args.filter((arg) => arg !== "--" && arg !== "--check");
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  }
  return { checkMode: args.includes("--check") };
}

/** Reads the current generated output, treating a missing file as empty. */
export function readCurrentOutput(outputPath: string): string {
  try {
    return readFileSync(outputPath, "utf8");
  } catch {
    return "";
  }
}

function checkOrWrite(
  result: DocRenderResult | undefined,
  checkMode: boolean,
  outputPath: string,
  refreshCommand: string,
): void {
  if (result === undefined) return;
  const { rendered, wroteSuffix } = result;

  if (checkMode) {
    if (readCurrentOutput(outputPath) !== rendered) {
      console.error(
        `${outputPath} is out of date. Run \`bun run ${refreshCommand}\` and commit the result.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`${outputPath} is up to date.`);
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
  console.log(`Wrote ${outputPath}${wroteSuffix ?? ""}.`);
}

/**
 * Runs a synchronous doc generator: parse argv -> `render()` -> check-or-write.
 * Use {@link runDocGeneratorAsync} when the collector awaits.
 */
export function runDocGenerator(options: RunDocGeneratorOptions): void {
  const { checkMode } = parseCheckModeArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  checkOrWrite(options.render(), checkMode, options.outputPath, options.refreshCommand);
}

/** Async variant of {@link runDocGenerator} for generators whose collector awaits. */
export async function runDocGeneratorAsync(options: RunDocGeneratorAsyncOptions): Promise<void> {
  const { checkMode } = parseCheckModeArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  checkOrWrite(await options.render(), checkMode, options.outputPath, options.refreshCommand);
}

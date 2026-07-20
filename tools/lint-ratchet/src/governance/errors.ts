import { ConfigError } from "../kernel/metrics-types.js";

/**
 * Governance-tier error signalling a baseline/debt-accounting regression: an
 * update or merge that would worsen recorded debt without an explicit
 * `--allow-worse` acknowledgement. Thrown by the update-apply and
 * debt-accounting operations and caught by the adapter that renders the gate
 * failure. Portable: no repo bindings, so an adopter's adapter catches the same
 * type.
 */
export class WorseBaselineError extends Error {}

/**
 * The gate found no committed baseline. The message is deliberately
 * recovery-free — the command that regenerates a baseline is the adapter's
 * runner invocation, so each adapter catches this and appends its own recovery
 * text. Extends ConfigError so an adapter that does not catch it still renders
 * a config-failure diagnostic instead of an uncaught stack.
 */
export class MissingBaselineError extends ConfigError {
  /** Baseline path relative to the engine repo root, for adapter rendering. */
  readonly relativeBaselinePath: string;

  constructor(relativeBaselinePath: string) {
    super(`${relativeBaselinePath} does not exist`);
    this.relativeBaselinePath = relativeBaselinePath;
  }
}

/**
 * The committed baseline exists but failed to parse against the registry.
 * Carries the parser's failures AND its non-blocking warnings as structured
 * data: a post-bad-merge baseline can produce both, and an adapter that prints
 * warnings on the success path should be able to print them on this failure
 * path too before rendering the failures its own way.
 */
export class BaselineParseError extends ConfigError {
  readonly failures: readonly string[];
  /** Non-blocking parse warnings observed before the failures aborted the gate. */
  readonly warnings: readonly string[];

  constructor(failures: readonly string[], warnings: readonly string[]) {
    super(failures.join("\n"));
    this.failures = failures;
    this.warnings = warnings;
  }
}

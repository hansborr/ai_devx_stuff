import type {
  ComplexityDelta,
  LintRatchetComplexityMessage,
  LintRatchetMetricItem,
} from "./lint-ratchet-metrics-types.js";
import { ConfigError, type LintRatchetComplexityFunction } from "./lint-ratchet-metrics-types.js";

const COMPLEXITY_MESSAGE_PATTERN =
  /^(?<label>.+) has a complexity of (?<complexity>\d+)\. Maximum allowed is \d+\.$/u;

interface ComplexityMessageContext {
  readonly ratchetId: string;
  readonly path: string;
  readonly message: LintRatchetComplexityMessage;
}

function complexityDiagnosticPrefix(context: ComplexityMessageContext): string {
  return `ratchet ${context.ratchetId}: complexity diagnostic for ${context.path}`;
}

function assertComplexityMessageId(context: ComplexityMessageContext): void {
  if (context.message.messageId !== undefined && context.message.messageId !== "complex") {
    throw new ConfigError(
      `${complexityDiagnosticPrefix(context)} has unexpected messageId ${context.message.messageId}`,
    );
  }
}

function parseComplexityMessageGroups(
  context: ComplexityMessageContext,
): Pick<LintRatchetComplexityFunction, "label" | "complexity"> {
  const groups = COMPLEXITY_MESSAGE_PATTERN.exec(context.message.message)?.groups;
  const complexity = groups?.complexity === undefined ? undefined : Number(groups.complexity);
  if (groups?.label === undefined || complexity === undefined || !Number.isInteger(complexity)) {
    throw new ConfigError(
      `ratchet ${context.ratchetId}: could not parse complexity for ${context.path}: ${context.message.message}`,
    );
  }
  return { label: groups.label, complexity };
}

function assertComplexityMessageLine(context: ComplexityMessageContext): number {
  if (
    context.message.line === undefined ||
    !Number.isInteger(context.message.line) ||
    context.message.line < 0
  ) {
    throw new ConfigError(`${complexityDiagnosticPrefix(context)} is missing a line`);
  }
  return context.message.line;
}

export function parseComplexitySeverityMessage(
  ratchetId: string,
  path: string,
  message: LintRatchetComplexityMessage,
): LintRatchetComplexityFunction {
  const context = { ratchetId, path, message };
  assertComplexityMessageId(context);
  const { label, complexity } = parseComplexityMessageGroups(context);
  const line = assertComplexityMessageLine(context);
  return { line, label, complexity };
}

export function compareComplexityFunction(
  left: LintRatchetComplexityFunction,
  right: LintRatchetComplexityFunction,
): number {
  return (
    right.complexity - left.complexity ||
    left.line - right.line ||
    left.label.localeCompare(right.label)
  );
}

export function maxComplexityFor(
  perFunction: readonly LintRatchetComplexityFunction[] | undefined,
): number | undefined {
  return perFunction === undefined || perFunction.length === 0
    ? undefined
    : Math.max(...perFunction.map((entry) => entry.complexity));
}

function complexityIdentity(entry: LintRatchetComplexityFunction): string {
  return `${String(entry.line)}\u0000${entry.label}`;
}

export function uniqueComplexityMap(
  values: readonly LintRatchetComplexityFunction[],
): ReadonlyMap<string, LintRatchetComplexityFunction> {
  const map = new Map<string, LintRatchetComplexityFunction>();
  for (const entry of values) {
    const key = complexityIdentity(entry);
    const previous = map.get(key);
    if (previous === undefined || entry.complexity > previous.complexity) {
      map.set(key, entry);
    }
  }
  return map;
}

function exactComplexityDelta(
  baseline: readonly LintRatchetComplexityFunction[],
  current: readonly LintRatchetComplexityFunction[],
  regression: boolean,
): ComplexityDelta | undefined {
  const baselineByIdentity = uniqueComplexityMap(baseline);
  for (const entry of current) {
    const previous = baselineByIdentity.get(complexityIdentity(entry));
    if (previous === undefined) continue;
    if (
      regression ? entry.complexity > previous.complexity : entry.complexity < previous.complexity
    ) {
      return {
        baselineComplexity: previous.complexity,
        currentComplexity: entry.complexity,
        line: entry.line,
        regression,
      };
    }
  }
  return undefined;
}

function vectorComplexityDelta(
  baseline: readonly LintRatchetComplexityFunction[],
  current: readonly LintRatchetComplexityFunction[],
  regression: boolean,
): ComplexityDelta | undefined {
  const baselineSorted = [...baseline].sort(compareComplexityFunction);
  const currentSorted = [...current].sort(compareComplexityFunction);
  for (let index = 0; index < Math.min(baselineSorted.length, currentSorted.length); index += 1) {
    const previous = baselineSorted[index];
    const entry = currentSorted[index];
    if (previous === undefined || entry === undefined) continue;
    if (
      regression ? entry.complexity > previous.complexity : entry.complexity < previous.complexity
    ) {
      return {
        baselineComplexity: previous.complexity,
        currentComplexity: entry.complexity,
        line: entry.line,
        regression,
      };
    }
  }
  return undefined;
}

export function complexityDelta(
  baseline: LintRatchetMetricItem | undefined,
  current: LintRatchetMetricItem,
): ComplexityDelta | undefined {
  const baselineFunctions = baseline?.perFunction;
  const currentFunctions = current.perFunction;
  if (baselineFunctions === undefined || currentFunctions === undefined) return undefined;
  return (
    exactComplexityDelta(baselineFunctions, currentFunctions, true) ??
    vectorComplexityDelta(baselineFunctions, currentFunctions, true) ??
    exactComplexityDelta(baselineFunctions, currentFunctions, false) ??
    vectorComplexityDelta(baselineFunctions, currentFunctions, false)
  );
}

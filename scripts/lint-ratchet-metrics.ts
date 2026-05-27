import type { LintRatchetMetric } from "./lint-ratchet-config.js";

const COMPLEXITY_MESSAGE_PATTERN =
  /^(?<label>.+) has a complexity of (?<complexity>\d+)\. Maximum allowed is (?<max>\d+)\.$/u;

export class ConfigError extends Error {}
export interface LintRatchetComplexityFunction {
  readonly line: number;
  readonly nodeType: string;
  readonly label: string;
  readonly complexity: number;
}
export interface LintRatchetMetricItem {
  readonly count: number;
  readonly lines?: number;
  readonly maxComplexity?: number;
  readonly perFunction?: readonly LintRatchetComplexityFunction[];
}
export interface LintRatchetComplexityMessage {
  readonly message: string;
  readonly line?: number;
  readonly nodeType?: string;
  readonly messageId?: string;
}
export interface ComplexityDelta {
  readonly baselineComplexity: number;
  readonly currentComplexity: number;
  readonly line?: number;
  readonly regression: boolean;
}
interface ComplexityMessageContext {
  readonly ratchetId: string;
  readonly path: string;
  readonly message: LintRatchetComplexityMessage;
}
interface ParsedComplexityFunctionFields {
  readonly line?: number;
  readonly nodeType?: string;
  readonly label?: string;
  readonly complexity?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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

function assertComplexityMessageNodeType(context: ComplexityMessageContext): string {
  if (typeof context.message.nodeType !== "string" || context.message.nodeType.length === 0) {
    throw new ConfigError(`${complexityDiagnosticPrefix(context)} is missing nodeType`);
  }
  return context.message.nodeType;
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
  const nodeType = assertComplexityMessageNodeType(context);
  return { line, nodeType, label, complexity };
}

function compareComplexityFunction(
  left: LintRatchetComplexityFunction,
  right: LintRatchetComplexityFunction,
): number {
  return (
    right.complexity - left.complexity ||
    left.line - right.line ||
    left.label.localeCompare(right.label) ||
    left.nodeType.localeCompare(right.nodeType)
  );
}

function sortedComplexityFunctions(
  item: LintRatchetMetricItem,
): readonly LintRatchetComplexityFunction[] | undefined {
  return item.perFunction === undefined
    ? undefined
    : [...item.perFunction].sort(compareComplexityFunction);
}

function maxComplexityFor(
  perFunction: readonly LintRatchetComplexityFunction[] | undefined,
): number | undefined {
  return perFunction === undefined || perFunction.length === 0
    ? undefined
    : Math.max(...perFunction.map((entry) => entry.complexity));
}

export function metricItemForFormat(
  metric: LintRatchetMetric,
  item: LintRatchetMetricItem,
): LintRatchetMetricItem {
  if (metric === "effective-line-count" && item.lines !== undefined)
    return { count: item.count, lines: item.lines };
  if (metric === "complexity-severity") {
    const perFunction = sortedComplexityFunctions(item);
    const maxComplexity = maxComplexityFor(perFunction);
    return perFunction === undefined || maxComplexity === undefined
      ? { count: item.count }
      : { count: item.count, maxComplexity, perFunction };
  }
  return { count: item.count };
}

function parseComplexityFunctionLine(
  value: unknown,
  path: string,
  failures: string[],
): number | undefined {
  if (!isNonNegativeInteger(value)) {
    failures.push(`${path}.line must be a non-negative integer`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionNodeType(
  value: unknown,
  path: string,
  failures: string[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${path}.nodeType must be a non-empty string`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionLabel(
  value: unknown,
  path: string,
  failures: string[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${path}.label must be a non-empty string`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionComplexity(
  value: unknown,
  path: string,
  failures: string[],
): number | undefined {
  if (!isNonNegativeInteger(value)) {
    failures.push(`${path}.complexity must be a non-negative integer`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionFields(
  value: Record<string, unknown>,
  path: string,
  failures: string[],
): ParsedComplexityFunctionFields {
  return {
    line: parseComplexityFunctionLine(value.line, path, failures),
    nodeType: parseComplexityFunctionNodeType(value.nodeType, path, failures),
    label: parseComplexityFunctionLabel(value.label, path, failures),
    complexity: parseComplexityFunctionComplexity(value.complexity, path, failures),
  };
}

function isCompleteComplexityFunction(
  fields: ParsedComplexityFunctionFields,
): fields is LintRatchetComplexityFunction {
  return (
    fields.line !== undefined &&
    fields.nodeType !== undefined &&
    fields.label !== undefined &&
    fields.complexity !== undefined
  );
}

function parseComplexityFunction(
  value: unknown,
  path: string,
  failures: string[],
): LintRatchetComplexityFunction | undefined {
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  const fields = parseComplexityFunctionFields(value, path, failures);
  if (!isCompleteComplexityFunction(fields)) return undefined;
  return fields;
}

function parseComplexityFunctions(
  value: unknown,
  path: string,
  failures: string[],
): readonly LintRatchetComplexityFunction[] | undefined {
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return undefined;
  }
  const parsed: LintRatchetComplexityFunction[] = [];
  for (const [index, entry] of value.entries()) {
    const item = parseComplexityFunction(entry, `${path}[${String(index)}]`, failures);
    if (item !== undefined) parsed.push(item);
  }
  return parsed;
}

export function parseMetricFields(
  rawItem: Record<string, unknown>,
  path: string,
  failures: string[],
): Omit<LintRatchetMetricItem, "count"> | undefined {
  const lines = rawItem.lines;
  if (lines !== undefined && !isNonNegativeInteger(lines)) {
    failures.push(`${path}.lines must be a non-negative integer`);
    return undefined;
  }
  const maxComplexity = rawItem.maxComplexity;
  if (maxComplexity !== undefined && !isNonNegativeInteger(maxComplexity)) {
    failures.push(`${path}.maxComplexity must be a non-negative integer`);
    return undefined;
  }
  const perFunction =
    rawItem.perFunction === undefined
      ? undefined
      : parseComplexityFunctions(rawItem.perFunction, `${path}.perFunction`, failures);
  return {
    ...(lines === undefined ? {} : { lines }),
    ...(maxComplexity === undefined ? {} : { maxComplexity }),
    ...(perFunction === undefined ? {} : { perFunction }),
  };
}

function validateEffectiveLineCountItem(
  path: string,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (item.lines === undefined) failures.push(`${path}.lines is required for effective-line-count`);
  if (item.maxComplexity !== undefined)
    failures.push(`${path}.maxComplexity is only valid for complexity-severity`);
  if (item.perFunction !== undefined)
    failures.push(`${path}.perFunction is only valid for complexity-severity`);
}

function validateComplexitySeverityItem(
  path: string,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (item.maxComplexity === undefined)
    failures.push(`${path}.maxComplexity is required for complexity-severity`);
  if (item.perFunction === undefined)
    failures.push(`${path}.perFunction is required for complexity-severity`);
  if (item.lines !== undefined)
    failures.push(`${path}.lines is only valid for effective-line-count`);
  if (item.perFunction !== undefined && item.perFunction.length !== item.count)
    failures.push(`${path}.perFunction length must equal count`);
  const maxComplexity = maxComplexityFor(item.perFunction);
  if (maxComplexity !== undefined && item.maxComplexity !== maxComplexity)
    failures.push(`${path}.maxComplexity must match perFunction maximum`);
}

function validateOtherMetricItem(
  path: string,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (item.lines !== undefined)
    failures.push(`${path}.lines is only valid for effective-line-count`);
  if (item.maxComplexity !== undefined)
    failures.push(`${path}.maxComplexity is only valid for complexity-severity`);
  if (item.perFunction !== undefined)
    failures.push(`${path}.perFunction is only valid for complexity-severity`);
}

export function validateMetricItem(
  testId: string,
  itemPath: string,
  metric: LintRatchetMetric,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  const path = `${testId}.items.${itemPath}`;
  if (metric === "complexity-severity") {
    validateComplexitySeverityItem(path, item, failures);
    return;
  }
  if (metric === "effective-line-count") {
    validateEffectiveLineCountItem(path, item, failures);
    return;
  }
  validateOtherMetricItem(path, item, failures);
}

function complexityIdentity(entry: LintRatchetComplexityFunction): string {
  return `${String(entry.line)}\u0000${entry.nodeType}\u0000${entry.label}`;
}

export function uniqueComplexityMap(
  values: readonly LintRatchetComplexityFunction[],
): ReadonlyMap<string, LintRatchetComplexityFunction> {
  const map = new Map<string, LintRatchetComplexityFunction>();
  for (const entry of values) {
    const key = complexityIdentity(entry);
    const previous = map.get(key);
    if (previous === undefined || entry.complexity > previous.complexity) map.set(key, entry); // Keep the highest duplicate so exact matching stays conservative.
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

export const VERIFY_STEP_DYNAMIC_RESOLVERS = [
  "precommit-test-timings",
  "staged-script-classifier",
] as const;

export type VerifyStepDynamicResolver = (typeof VERIFY_STEP_DYNAMIC_RESOLVERS)[number];

const verifyStepDynamicResolverSet: ReadonlySet<string> = new Set(VERIFY_STEP_DYNAMIC_RESOLVERS);

export function isVerifyStepDynamicResolver(value: unknown): value is VerifyStepDynamicResolver {
  return typeof value === "string" && verifyStepDynamicResolverSet.has(value);
}

export function formatVerifyStepDynamicResolvers(): string {
  return VERIFY_STEP_DYNAMIC_RESOLVERS.join(", ");
}

export interface VerifyStepSlot {
  readonly name: string;
  readonly script: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly dynamic?: VerifyStepDynamicResolver;
  /** Documentation-only: rendered into the generated harness-controls doc; nothing gates execution on it. */
  readonly condition?: string;
}

const ENV_NAME_PATTERN = /^[A-Za-z_]\w*$/u;
const SLOT_NAME_PATTERN = /^[A-Za-z0-9][\w-]*$/u;
const SLOT_NAME_PATTERN_DESCRIPTION = "/^[A-Za-z0-9][A-Za-z0-9_-]*$/";
const SLOT_KEYS = ["name", "script", "condition", "args", "env", "dynamic"] as const;
const slotKeySet: ReadonlySet<string> = new Set(SLOT_KEYS);

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSlotArgs(
  rawArgs: unknown,
  slotName: string,
  failures: string[],
  contextPrefix: string,
): readonly string[] | undefined {
  if (rawArgs === undefined) return undefined;
  const slotPrefix = `${contextPrefix}slot ${slotName}`;
  if (!Array.isArray(rawArgs)) {
    failures.push(`${slotPrefix} args must be an array of strings`);
    return undefined;
  }
  const args: string[] = [];
  for (const [index, arg] of rawArgs.entries()) {
    if (!isNonEmptyString(arg)) {
      failures.push(`${slotPrefix} args[${String(index)}] must be a non-empty string`);
      continue;
    }
    args.push(arg);
  }
  return args;
}

function parseSlotEnv(
  rawEnv: unknown,
  slotName: string,
  failures: string[],
  contextPrefix: string,
): Readonly<Record<string, string>> | undefined {
  if (rawEnv === undefined) return undefined;
  const slotPrefix = `${contextPrefix}slot ${slotName}`;
  if (!isObject(rawEnv)) {
    failures.push(`${slotPrefix} env must be an object of VAR=value strings`);
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawEnv).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!ENV_NAME_PATTERN.test(name)) {
      failures.push(`${slotPrefix} env key must be a shell variable name: ${name}`);
      continue;
    }
    if (!isNonEmptyString(value)) {
      failures.push(`${slotPrefix} env.${name} must be a non-empty string`);
      continue;
    }
    env[name] = value;
  }
  return env;
}

function parseSlotHeader(
  rawSlot: Record<string, unknown>,
  index: number,
  failures: string[],
  contextPrefix: string,
): Pick<VerifyStepSlot, "name" | "script" | "condition"> | undefined {
  const { name, script, condition } = rawSlot;
  if (!isNonEmptyString(name)) {
    failures.push(`${contextPrefix}slots[${String(index)}].name must be a non-empty string`);
    return undefined;
  }
  // Names and scripts flow into generated shell identifiers and `bun run`
  // tokens; a dynamic ($-bearing) value is never legitimate there and would
  // otherwise reach the generator's expanding double-quote path unguarded.
  if (name.includes("$")) {
    failures.push(`${contextPrefix}slots[${String(index)}].name must not contain $: ${name}`);
    return undefined;
  }
  if (!SLOT_NAME_PATTERN.test(name)) {
    failures.push(
      `${contextPrefix}slots[${String(index)}].name must match ${SLOT_NAME_PATTERN_DESCRIPTION}: ${name}`,
    );
    return undefined;
  }
  if (!isNonEmptyString(script)) {
    failures.push(`${contextPrefix}slot ${name} script must be a non-empty string`);
    return undefined;
  }
  if (script.includes("$")) {
    failures.push(`${contextPrefix}slot ${name} script must not contain $: ${script}`);
    return undefined;
  }
  if (condition !== undefined && !isNonEmptyString(condition)) {
    failures.push(`${contextPrefix}slot ${name} condition must be a non-empty string`);
    return undefined;
  }
  return { name, script, ...(condition !== undefined ? { condition } : {}) };
}

function parseSlot(
  rawSlot: unknown,
  index: number,
  failures: string[],
  contextPrefix: string,
): VerifyStepSlot | undefined {
  if (!isObject(rawSlot)) {
    failures.push(`${contextPrefix}slots[${String(index)}] must be an object`);
    return undefined;
  }
  const unknownKeys = Object.keys(rawSlot).filter((key) => !slotKeySet.has(key));
  if (unknownKeys.length > 0) {
    for (const key of unknownKeys) {
      failures.push(
        `${contextPrefix}slots[${String(index)}] has unsupported key ${key}; valid keys: ${SLOT_KEYS.join(", ")}`,
      );
    }
    return undefined;
  }
  const header = parseSlotHeader(rawSlot, index, failures, contextPrefix);
  if (header === undefined) return undefined;
  const args = parseSlotArgs(rawSlot.args, header.name, failures, contextPrefix);
  const env = parseSlotEnv(rawSlot.env, header.name, failures, contextPrefix);
  const dynamic = rawSlot.dynamic;
  if (dynamic !== undefined && !isVerifyStepDynamicResolver(dynamic)) {
    failures.push(
      `${contextPrefix}slot ${header.name} dynamic must be one of: ${formatVerifyStepDynamicResolvers()}`,
    );
    return undefined;
  }
  return {
    ...header,
    ...(args !== undefined ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(dynamic !== undefined ? { dynamic } : {}),
  };
}

/**
 * Shared manifest slot parser for every slots consumer (the shell generator
 * and the harness-controls docs validator), so they cannot drift in what they
 * accept. Accumulates problems into `failures` instead of throwing; callers
 * that want throw-on-error semantics join the failures themselves.
 */
export function parseVerifyStepSlots(
  rawSlots: unknown,
  failures: string[],
  contextPrefix = "",
): readonly VerifyStepSlot[] | undefined {
  if (rawSlots === undefined) return undefined;
  if (!Array.isArray(rawSlots)) {
    failures.push(`${contextPrefix}slots must be an array when present`);
    return undefined;
  }
  const seen = new Set<string>();
  const slots: VerifyStepSlot[] = [];
  for (const [index, rawSlot] of rawSlots.entries()) {
    const slot = parseSlot(rawSlot, index, failures, contextPrefix);
    if (slot === undefined) continue;
    if (seen.has(slot.name)) {
      failures.push(`${contextPrefix}duplicate slot name: ${slot.name}`);
      continue;
    }
    seen.add(slot.name);
    slots.push(slot);
  }
  return slots;
}

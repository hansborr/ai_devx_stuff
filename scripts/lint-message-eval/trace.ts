export type MessageEvalMode = "control" | "treatment";

const TARGET_RULE_IDS = [
  "complexity",
  "max-depth",
  "max-lines-per-function",
  "max-params",
] as const;

type TargetRuleId = (typeof TARGET_RULE_IDS)[number];

interface MessageEvalArm {
  readonly mode: MessageEvalMode;
  readonly presentedMessage: string;
  readonly attempts: readonly string[];
}

export interface MessageEvalFixture {
  readonly id: string;
  readonly filename: string;
  readonly sourceLine: number;
  readonly sourceEndLine: number;
  readonly source: string;
  readonly targetRuleId: TargetRuleId;
  readonly arms: readonly MessageEvalArm[];
}

export interface MessageEvalTrace {
  readonly runId: string;
  readonly generatedAt: string;
  readonly gitCommit: string;
  readonly agent: string;
  readonly fixtures: readonly MessageEvalFixture[];
}

const EXPECTED_ARM_COUNT = 2;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${context} must be a positive integer`);
  }
  return value;
}

function stringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context} must be a non-empty string array`);
  }
  return value.map((entry, index) => requiredString(entry, `${context}[${String(index)}]`));
}

function parseArm(value: unknown, context: string): MessageEvalArm {
  if (!isObject(value)) throw new Error(`${context} must be an object`);
  const mode = value.mode;
  if (mode !== "control" && mode !== "treatment") {
    throw new Error(`${context}.mode must be control or treatment`);
  }
  return {
    mode,
    presentedMessage: requiredString(value.presentedMessage, `${context}.presentedMessage`),
    attempts: stringArray(value.attempts, `${context}.attempts`),
  };
}

function targetRuleId(value: unknown, context: string): MessageEvalFixture["targetRuleId"] {
  const ruleId = requiredString(value, context);
  const target = TARGET_RULE_IDS.find((id) => id === ruleId);
  if (target === undefined) {
    throw new Error(`${context} is not an evaluated structural rule`);
  }
  return target;
}

function parseFixture(value: unknown, index: number): MessageEvalFixture {
  const context = `fixtures[${String(index)}]`;
  if (!isObject(value)) throw new Error(`${context} must be an object`);
  if (!Array.isArray(value.arms) || value.arms.length !== EXPECTED_ARM_COUNT) {
    throw new Error(`${context}.arms must contain exactly two entries`);
  }
  const sourceLine = positiveInteger(value.sourceLine, `${context}.sourceLine`);
  const sourceEndLine = positiveInteger(value.sourceEndLine, `${context}.sourceEndLine`);
  if (sourceEndLine < sourceLine) {
    throw new Error(`${context}.sourceEndLine must be at or after sourceLine`);
  }
  return {
    id: requiredString(value.id, `${context}.id`),
    filename: requiredString(value.filename, `${context}.filename`),
    sourceLine,
    sourceEndLine,
    source: requiredString(value.source, `${context}.source`),
    targetRuleId: targetRuleId(value.targetRuleId, `${context}.targetRuleId`),
    arms: value.arms.map((arm, armIndex) => parseArm(arm, `${context}.arms[${String(armIndex)}]`)),
  };
}

export function parseLintMessageTrace(input: unknown): MessageEvalTrace {
  if (!isObject(input)) throw new Error("message eval trace must be an object");
  if (input.version !== 1) throw new Error("message eval trace version must be 1");
  const gitCommit = requiredString(input.gitCommit, "gitCommit");
  if (!/^[0-9a-f]{40}$/u.test(gitCommit)) throw new Error("gitCommit must be a full commit SHA");
  if (!Array.isArray(input.fixtures) || input.fixtures.length === 0) {
    throw new Error("fixtures must be a non-empty array");
  }
  return {
    runId: requiredString(input.runId, "runId"),
    generatedAt: requiredString(input.generatedAt, "generatedAt"),
    gitCommit,
    agent: requiredString(input.agent, "agent"),
    fixtures: input.fixtures.map(parseFixture),
  };
}

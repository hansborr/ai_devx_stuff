// Shared parser for ESLint `--format=json` stdout.
//
// `scripts/lint-agent.ts` and `tools/lint-ratchet/src/kernel/eslint-runner.ts` both need
// to turn ESLint's JSON report into a typed, defensively-validated result set.
// The shape types and the parser live here so the validation stays in one place
// (previously the two copies had drifted: one skipped the array/`ruleId`
// guards). Callers inject their own error factory so each keeps its own throw
// type — `eslint-runner` uses `ConfigError`, `lint-agent` the default `Error` —
// without this module depending on either caller's config/error machinery.

export interface ESLintMessage {
  readonly ruleId: string | null;
  readonly severity: number;
  readonly message: string;
  readonly messageId?: string;
  readonly line?: number;
  readonly column?: number;
  readonly fatal?: boolean;
  readonly fix?: unknown;
  readonly suggestions?: readonly unknown[];
}

export interface ESLintFileResult {
  readonly filePath: string;
  readonly messages: readonly ESLintMessage[];
}

export type EslintParseErrorFactory = (message: string) => Error;

const defaultMakeError: EslintParseErrorFactory = (message) => new Error(message);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEslintMessage(value: unknown): value is ESLintMessage {
  if (!isRecord(value)) return false;
  if (typeof value.message !== "string") return false;
  if (typeof value.severity !== "number") return false;
  const ruleId = value.ruleId;
  return ruleId === null || typeof ruleId === "string";
}

export function parseEslintOutput(
  stdout: string,
  makeError: EslintParseErrorFactory = defaultMakeError,
): readonly ESLintFileResult[] {
  if (stdout.trim().length === 0) return [];
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw makeError("ESLint --format=json output is not an array");
  }
  const results: ESLintFileResult[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    if (typeof entry.filePath !== "string") continue;
    if (!Array.isArray(entry.messages)) continue;
    const messages: ESLintMessage[] = [];
    for (const raw of entry.messages) {
      if (isEslintMessage(raw)) messages.push(raw);
    }
    results.push({ filePath: entry.filePath, messages });
  }
  return results;
}

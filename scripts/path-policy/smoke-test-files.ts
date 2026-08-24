const smokeTestBasenamePattern = /^test-.+\.sh$/u;
const scriptSmokeTestPathPattern = /^scripts\/tests\/test-[^/]+\.sh$/u;

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function isSmokeTestBasename(value: string): boolean {
  return smokeTestBasenamePattern.test(value);
}

export function isScriptSmokeTestPath(value: string): boolean {
  return scriptSmokeTestPathPattern.test(normalizePath(value));
}

/**
 * The smoke that owns script-smoke metadata freshness: changing any smoke-test
 * file must re-run it so subject/projection metadata cannot go stale silently.
 * Declared here (the module that owns smoke-file meanings) so the changed-path
 * query and the registration explain view share one authority for the name.
 */
export const SMOKE_METADATA_FRESHNESS_TEST_NAME = "test-harness-check";

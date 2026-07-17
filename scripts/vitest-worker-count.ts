const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export function maxWorkersFromEnv(
  variableNames: readonly [configured: string, native: string],
  defaultMaxWorkers: number,
  maximumMaxWorkers: number,
  env: NodeJS.ProcessEnv,
): number {
  const [configuredVariableName, nativeVariableName] = variableNames;
  const configuredOverride = parseWorkerOverride(configuredVariableName, maximumMaxWorkers, env);
  const nativeOverride = parseWorkerOverride(nativeVariableName, maximumMaxWorkers, env);
  return nativeOverride ?? configuredOverride ?? defaultMaxWorkers;
}

function parseWorkerOverride(
  variableName: string,
  maximumMaxWorkers: number,
  env: NodeJS.ProcessEnv,
): number | undefined {
  const override = env[variableName];
  if (override === undefined) return undefined;

  const parsed = Number(override);
  if (!POSITIVE_INTEGER_PATTERN.test(override) || !Number.isSafeInteger(parsed)) {
    throw new Error(
      `${variableName} must be a positive integer, received ${JSON.stringify(override)}`,
    );
  }
  if (parsed > maximumMaxWorkers) {
    throw new Error(
      `${variableName} must be no greater than ${String(maximumMaxWorkers)}, received ${JSON.stringify(override)}`,
    );
  }
  return parsed;
}

export function clearTranslatedNativeWorkerOverride(env: NodeJS.ProcessEnv): void {
  const translatedOverride = env["MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS"];
  if (translatedOverride === undefined || env["VITEST_MAX_WORKERS"] !== translatedOverride) return;
  delete env.VITEST_MAX_WORKERS;
}

export function workerEnvWithTranslatedNativeOverride(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const translatedOverride = env["MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS"];
  if (translatedOverride === undefined || env["VITEST_MAX_WORKERS"] !== undefined) return env;
  return { ...env, VITEST_MAX_WORKERS: translatedOverride };
}

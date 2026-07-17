import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SERVER_TEST_MAX_WORKERS } from "../packages/server/src/test/test-database-url.js";
import { MAX_NON_SERVER_TEST_MAX_WORKERS, NON_SERVER_TEST_MAX_WORKERS } from "../vitest.config.js";
import {
  clearTranslatedNativeWorkerOverride,
  maxWorkersFromEnv,
  workerEnvWithTranslatedNativeOverride,
} from "./vitest-worker-count.js";

const WORKER_VARIABLE_NAMES = ["NON_SERVER_TEST_MAX_WORKERS", "VITEST_MAX_WORKERS"] as const;

describe("maxWorkersFromEnv", () => {
  it("uses the project default when the override is absent", () => {
    expect(maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {})).toBe(6);
  });

  it("accepts an override at the measured-safe maximum", () => {
    expect(
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        NON_SERVER_TEST_MAX_WORKERS: "8",
      }),
    ).toBe(8);
  });

  it.each(["", "0", "-1", "1.5", "4workers"])("rejects invalid override %j", (override) => {
    expect(() =>
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        NON_SERVER_TEST_MAX_WORKERS: override,
      }),
    ).toThrow(
      `NON_SERVER_TEST_MAX_WORKERS must be a positive integer, received ${JSON.stringify(override)}`,
    );
  });

  it.each(["9", "60"])("rejects unmeasured elevated override %j", (override) => {
    expect(() =>
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        NON_SERVER_TEST_MAX_WORKERS: override,
      }),
    ).toThrow(
      `NON_SERVER_TEST_MAX_WORKERS must be no greater than 8, received ${JSON.stringify(override)}`,
    );
  });

  it("accepts the native override at the measured-safe maximum", () => {
    expect(
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        VITEST_MAX_WORKERS: "8",
      }),
    ).toBe(8);
  });

  it.each(["9", "60"])("rejects unmeasured native override %j", (override) => {
    expect(() =>
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        VITEST_MAX_WORKERS: override,
      }),
    ).toThrow(`VITEST_MAX_WORKERS must be no greater than 8, received ${JSON.stringify(override)}`);
  });

  it("gives the native override precedence when both values are valid", () => {
    expect(
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        NON_SERVER_TEST_MAX_WORKERS: "8",
        VITEST_MAX_WORKERS: "4",
      }),
    ).toBe(4);
  });

  it("rejects an invalid configured override even when the native value would win", () => {
    expect(() =>
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, {
        NON_SERVER_TEST_MAX_WORKERS: "60",
        VITEST_MAX_WORKERS: "4",
      }),
    ).toThrow('NON_SERVER_TEST_MAX_WORKERS must be no greater than 8, received "60"');
  });
});

describe("non-server Vitest worker cap", () => {
  it("keeps a translated CLI cap of 8 from overriding the server phase cap of 6", () => {
    const env: NodeJS.ProcessEnv = {
      MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS: "8",
      VITEST_MAX_WORKERS: "8",
    };

    expect(
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, workerEnvWithTranslatedNativeOverride(env)),
    ).toBe(8);
    clearTranslatedNativeWorkerOverride(env);
    expect(env).not.toHaveProperty("VITEST_MAX_WORKERS");
    expect(env).toHaveProperty("MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS", "8");
    expect(
      maxWorkersFromEnv(WORKER_VARIABLE_NAMES, 6, 8, workerEnvWithTranslatedNativeOverride(env)),
    ).toBe(8);
    expect(SERVER_TEST_MAX_WORKERS).toBe(6);
    expect(readFileSync("vitest.config.ts", "utf8")).toContain(
      "workerEnvWithTranslatedNativeOverride(process.env)",
    );
  });

  it("uses the measured cap for every project in sequence group 0", () => {
    expect(NON_SERVER_TEST_MAX_WORKERS).toBe(6);
    expect(MAX_NON_SERVER_TEST_MAX_WORKERS).toBe(8);
    for (const configPath of [
      "packages/client/vitest.config.ts",
      "packages/shared/vitest.config.ts",
      "scripts/vitest.config.ts",
      "eslint-rules/vitest.config.ts",
    ]) {
      expect(readFileSync(configPath, "utf8")).toContain("maxWorkers: NON_SERVER_TEST_MAX_WORKERS");
    }
  });
});

describe("test reservation documentation", () => {
  it("keeps active guidance and the lint co-admission example on current values", () => {
    const harnessGuide = readFileSync("docs/ai-harness.md", "utf8");
    const lintPartitionNote = readFileSync(
      "docs/agent_notes/backlog/lint-deep-dive-2026-07/76-partition-lint-type-program.md",
      "utf8",
    );
    const workerCapNote = readFileSync(
      "docs/agent_notes/backlog/lint-deep-dive-2026-07/77-cap-vitest-workers.md",
      "utf8",
    );

    expect(harnessGuide).toContain("default test slot's 3,200 MB reservation");
    expect(harnessGuide).toContain(
      "`VITEST_MAX_WORKERS` takes precedence over CLI `--maxWorkers`, which takes precedence over `NON_SERVER_TEST_MAX_WORKERS`",
    );
    expect(harnessGuide).toContain("`--max-workers` spelling");
    expect(harnessGuide).toContain("Repeated worker flags are rejected as ambiguous");
    expect(harnessGuide).toContain(
      "`test:changed` ordinary/fallback Vitest phase uses the same translation",
    );
    expect(harnessGuide).toContain(
      "`MUSI_CLIENT_FAST_LANE_MAX_WORKERS` is 4 by default and uses the same 1–8 validation",
    );
    expect(harnessGuide).not.toContain("edit-loop checks behind a 5.58 GB reservation");
    expect(lintPartitionNote).toContain("with 10,400 MB available");
    expect(lintPartitionNote).toContain("the 1,024 MB safety margin");
    expect(lintPartitionNote).toContain("live test (3,200 MB) plus ratchet (2,210 MB)");
    expect(lintPartitionNote).toContain("leave 3,966 MB");
    expect(lintPartitionNote).toContain("4,270 MB > 3,966 MB, so the prior lint reservation waits");
    expect(lintPartitionNote).toContain(
      "3,700 MB ≤ 3,966 MB, so the adopted lint reservation admits",
    );
    expect(lintPartitionNote).not.toContain("live test (5,580 MB) plus ratchet");
    expect(workerCapNote).toContain("installed Vitest 4.1.7");
    expect(workerCapNote).toContain("re-audit precedence and repeated-option parsing");
    expect(workerCapNote).toContain("`resolveConfig` in the `coverage.*` chunk");
    expect(workerCapNote).toContain(
      "`resolveProjects` / `resolveMaxWorkers` in the `cli-api.*` chunk",
    );
    expect(workerCapNote).toContain("CAC/mri `toVal` in the `cac.*` chunk");
    expect(workerCapNote).toContain("translation-origin marker");
    expect(workerCapNote).toContain("server remains at `SERVER_TEST_MAX_WORKERS=6`");
  });
});

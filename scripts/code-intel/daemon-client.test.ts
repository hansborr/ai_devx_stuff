import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DaemonRequestTimeoutError, requestDaemonQuery } from "./daemon-client.js";
import { CODE_INTEL_DAEMON_PROTOCOL_VERSION } from "./daemon-protocol.js";
import {
  buildDaemonMetadata,
  ensureStateDir,
  resolveDaemonStatePaths,
  writeDaemonMetadata,
} from "./daemon-state.js";
import { CodeIntelError } from "./errors.js";
import { formatCodeIntelQueryResult } from "./format.js";
import type { CodeIntelQueryResult, ExecutableCliCommand } from "./types.js";

describe("code:intel daemon client", () => {
  let tempRoot: string;
  let stateRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-daemon-client-"));
    stateRoot = path.join(tempRoot, "state");
    repoRoot = path.join(tempRoot, "repo");
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function prepareReadyDaemonClient(): void {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeDaemonMetadata(
      paths,
      buildDaemonMetadata({ paths, pid: process.pid, repoRealpath: repoRoot, repoRoot }),
    );
    writeFileSync(paths.socketPath, "");
  }

  function expectDaemonResult(
    outcome: Awaited<ReturnType<typeof requestDaemonQuery>>,
  ): CodeIntelQueryResult {
    if (outcome.kind === "result") return outcome.result;
    throw new Error(`Expected daemon result, got fallback: ${outcome.reason}`);
  }

  it("falls back when no daemon is running", async () => {
    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("absent");

    const symbolOutcome = await requestDaemonQuery(
      { kind: "defName", name: "coreValue" },
      { repoRoot, state: { rootDir: stateRoot } },
    );
    expect(symbolOutcome.kind).toBe("fallback");
    if (symbolOutcome.kind === "fallback") expect(symbolOutcome.reason).toContain("absent");
  });

  it("falls back when metadata advertises a different protocol version", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeDaemonMetadata(paths, {
      ...buildDaemonMetadata({ paths, pid: process.pid, repoRealpath: repoRoot, repoRoot }),
      protocolVersion:
        // type-assertion-boundary: test - deliberately mismatched version widened back to the literal type so the metadata still typechecks
        (CODE_INTEL_DAEMON_PROTOCOL_VERSION + 1) as typeof CODE_INTEL_DAEMON_PROTOCOL_VERSION,
    });
    writeFileSync(paths.socketPath, "");

    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("protocol");

    const symbolOutcome = await requestDaemonQuery(
      { kind: "defName", name: "coreValue" },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(symbolOutcome.kind).toBe("fallback");
    if (symbolOutcome.kind === "fallback") expect(symbolOutcome.reason).toContain("protocol");
  });

  it("falls back when daemon metadata is malformed instead of throwing", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, "{ not valid json");
    writeFileSync(paths.socketPath, "");

    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("metadata");
  });

  it("falls back when daemon metadata fails the shape check", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, JSON.stringify({ pid: "not-a-number" }));
    writeFileSync(paths.socketPath, "");

    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("metadata");
  });

  it("throws when the daemon returns a known result arm for the wrong command", async () => {
    prepareReadyDaemonClient();
    let caught: unknown;
    try {
      await requestDaemonQuery(
        { file: "packages/shared/src/rules/core.ts", kind: "exports" },
        {
          isAlive: () => true,
          repoRoot,
          state: { rootDir: stateRoot },
          transport: (_socketPath, payload) => {
            const request = JSON.parse(payload) as { id: string };
            return Promise.resolve(
              JSON.stringify({
                id: request.id,
                ok: true,
                protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
                result: {
                  kind: "results",
                  header: "exports packages/shared/src/rules/core.ts",
                  results: [
                    {
                      kind: "reference",
                      name: "core",
                      file: "packages/shared/src/rules/core.ts",
                      line: 1,
                      col: 14,
                      referenceKind: "value",
                    },
                  ],
                },
              }),
            );
          },
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodeIntelError);
    if (!(caught instanceof Error)) throw new Error("expected CodeIntelError");
    expect(caught.message).toBe(
      "code:intel: Daemon returned a malformed success response for exports. Run `bun run code:intel:server -- restart` and retry.",
    );
  });

  it("throws when a definition-name miss omits its hint", async () => {
    prepareReadyDaemonClient();
    let caught: unknown;
    try {
      await requestDaemonQuery(
        { kind: "defName", name: "missingName" },
        {
          isAlive: () => true,
          repoRoot,
          state: { rootDir: stateRoot },
          transport: (_socketPath, payload) => {
            const request = JSON.parse(payload) as { id: string };
            return Promise.resolve(
              JSON.stringify({
                id: request.id,
                ok: true,
                protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
                result: {
                  kind: "definitionNameMiss",
                  header: "definition missingName",
                },
              }),
            );
          },
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodeIntelError);
    if (!(caught instanceof Error)) throw new Error("expected CodeIntelError");
    expect(caught.message).toContain("malformed success response for defName");
  });

  it("formats an empty v1 daemon result from the issued command kind", async () => {
    prepareReadyDaemonClient();
    const command: ExecutableCliCommand = {
      file: "packages/shared/src/rules/core.ts",
      kind: "exports",
    };
    const outcome = await requestDaemonQuery(command, {
      isAlive: () => true,
      repoRoot,
      state: { rootDir: stateRoot },
      transport: (_socketPath, payload) => {
        const request = JSON.parse(payload) as { id: string };
        return Promise.resolve(
          JSON.stringify({
            id: request.id,
            ok: true,
            protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
            result: {
              kind: "results",
              header: "custom heading",
              results: [],
            },
          }),
        );
      },
    });

    const result = expectDaemonResult(outcome);
    expect(formatCodeIntelQueryResult(result, "text", command.kind)).toBe(
      "custom heading (0 results)\n  no exports found",
    );
  });

  it("uses a longer refs timeout and avoids one-shot fallback after timeout", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeDaemonMetadata(
      paths,
      buildDaemonMetadata({ paths, pid: process.pid, repoRealpath: repoRoot, repoRoot }),
    );
    writeFileSync(paths.socketPath, "");

    let refsTimeout = 0;
    await expect(
      requestDaemonQuery(
        {
          kind: "refs",
          location: { col: 14, file: "packages/shared/src/rules/core.ts", line: 1 },
        },
        {
          isAlive: () => true,
          repoRoot,
          state: { rootDir: stateRoot },
          transport: (_socketPath, _payload, timeoutMs) => {
            refsTimeout = timeoutMs;
            return Promise.reject(new DaemonRequestTimeoutError(timeoutMs));
          },
        },
      ),
    ).rejects.toThrow(/Retry the query/u);
    expect(refsTimeout).toBe(30000);

    let graphTimeout = 0;
    const graphOutcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      {
        isAlive: () => true,
        repoRoot,
        state: { rootDir: stateRoot },
        transport: (_socketPath, _payload, timeoutMs) => {
          graphTimeout = timeoutMs;
          return Promise.reject(new DaemonRequestTimeoutError(timeoutMs));
        },
      },
    );
    expect(graphTimeout).toBe(5000);
    expect(graphOutcome.kind).toBe("fallback");
  });
});

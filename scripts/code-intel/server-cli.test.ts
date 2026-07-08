import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DaemonSpawner } from "./daemon-process.js";
import { runDaemon } from "./daemon-server.js";
import {
  buildDaemonMetadata,
  computeRepoKey,
  ensureStateDir,
  resolveDaemonStatePaths,
  writeDaemonMetadata,
} from "./daemon-state.js";
import { runServerCliCommand } from "./server-cli.js";

describe("code:intel:server lifecycle", () => {
  let tempRoot: string;
  let stateRoot: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-server-"));
    stateRoot = path.join(tempRoot, "state");
    repoA = path.join(tempRoot, "repo-a");
    repoB = path.join(tempRoot, "repo-b");
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function pathsFor(repo: string): ReturnType<typeof resolveDaemonStatePaths> {
    return resolveDaemonStatePaths(repo, { rootDir: stateRoot });
  }

  function seedRunningDaemon(repo: string, pid: number): void {
    const paths = pathsFor(repo);
    ensureStateDir(paths);
    writeDaemonMetadata(
      paths,
      buildDaemonMetadata({ paths, pid, repoRealpath: repo, repoRoot: repo }),
    );
    writeFileSync(paths.socketPath, "");
  }

  function okProbe(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  function failedProbe(): Promise<{
    failureKind: "unverified";
    ok: false;
    reason: string;
  }> {
    return Promise.resolve({
      failureKind: "unverified",
      ok: false,
      reason: "socket probe timed out",
    });
  }

  it("derives different state directories per repo realpath", () => {
    const aPaths = pathsFor(repoA);
    const bPaths = pathsFor(repoB);
    expect(aPaths.stateDir).not.toBe(bPaths.stateDir);
    expect(aPaths.stateDir).toContain(stateRoot);
    expect(bPaths.stateDir).toContain(stateRoot);
    expect(path.basename(aPaths.stateDir)).toBe(computeRepoKey(repoA));
    expect(path.basename(bPaths.stateDir)).toBe(computeRepoKey(repoB));
  });

  it("status distinguishes absent, running, and stale daemons", async () => {
    const absent = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
    });
    expect(absent.exitCode).toBe(0);
    expect(absent.output).toContain("absent");

    seedRunningDaemon(repoA, process.pid);
    const running = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: okProbe,
    });
    expect(running.output).toContain("running");
    expect(running.output).toContain(`pid ${String(process.pid)}`);

    const stale = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => false,
    });
    expect(stale.output).toContain("stale");
  });

  it("status validates a daemon with the built-in ping command", async () => {
    const daemon = await runDaemon({
      paths: pathsFor(repoA),
      repoRealpath: repoA,
      repoRoot: repoA,
      signalEvents: [],
    });
    try {
      const status = await runServerCliCommand(["status"], {
        repoRoot: repoA,
        state: { rootDir: stateRoot },
      });
      expect(status.exitCode).toBe(0);
      expect(status.output).toContain("running");
      expect(status.output).toContain(`pid ${String(process.pid)}`);
    } finally {
      await daemon.shutdown();
    }
  });

  it("stop removes live and stale state", async () => {
    seedRunningDaemon(repoA, process.pid);
    const livePaths = pathsFor(repoA);
    expect(existsSync(livePaths.metadataPath)).toBe(true);

    let stopSignalled = false;
    const liveStop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: okProbe,
      stopProcess: () => {
        stopSignalled = true;
        return Promise.resolve(true);
      },
    });
    expect(liveStop.output).toContain("stopped");
    expect(stopSignalled).toBe(true);
    expect(existsSync(livePaths.stateDir)).toBe(false);

    seedRunningDaemon(repoB, 999_999);
    const stalePaths = pathsFor(repoB);
    const staleStop = await runServerCliCommand(["stop"], {
      repoRoot: repoB,
      state: { rootDir: stateRoot },
      isAlive: () => false,
    });
    expect(staleStop.output).toContain("cleared stale state");
    expect(existsSync(stalePaths.stateDir)).toBe(false);

    const noState = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => false,
    });
    expect(noState.output).toContain("no state to stop");
  });

  it("restart spawns a fresh daemon and waits for readiness", async () => {
    seedRunningDaemon(repoA, process.pid);
    const stalePid = process.pid;
    const stalePaths = pathsFor(repoA);
    let stopped = false;
    const fakeSpawner: DaemonSpawner = (resolvedRepo, _scriptPath) => {
      const targetPaths = resolveDaemonStatePaths(resolvedRepo, { rootDir: stateRoot });
      ensureStateDir(targetPaths);
      writeDaemonMetadata(
        targetPaths,
        buildDaemonMetadata({
          paths: targetPaths,
          pid: 424242,
          repoRealpath: resolvedRepo,
          repoRoot: resolvedRepo,
        }),
      );
      writeFileSync(targetPaths.socketPath, "");
      return { pid: 424242 };
    };

    const result = await runServerCliCommand(["restart"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: (pid: number) => {
        if (pid === stalePid) return !stopped;
        return pid === 424242;
      },
      probeDaemon: okProbe,
      spawner: fakeSpawner,
      stopProcess: () => {
        stopped = true;
        return Promise.resolve(true);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("started");
    expect(result.output).toContain("pid 424242");
    expect(existsSync(stalePaths.socketPath)).toBe(true);
    expect(existsSync(stalePaths.metadataPath)).toBe(true);
  });

  it("recovers lifecycle commands from corrupt metadata", async () => {
    const paths = pathsFor(repoA);
    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, "{ not valid json");
    writeFileSync(paths.pidPath, `${String(process.pid)}\n`);
    writeFileSync(paths.socketPath, "");

    const status = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
    });
    expect(status.output).toContain("invalid state");

    let stopCalled = false;
    const stop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(stop.output).toContain("cleared invalid state");
    expect(stopCalled).toBe(false);
    expect(existsSync(paths.stateDir)).toBe(false);

    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, JSON.stringify({ pid: "not-a-number" }));
    writeFileSync(paths.pidPath, `${String(process.pid)}\n`);
    writeFileSync(paths.socketPath, "");
    const result = await runServerCliCommand(["restart"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: (pid: number) => pid === 424243,
      spawner: (resolvedRepo) => {
        const targetPaths = resolveDaemonStatePaths(resolvedRepo, { rootDir: stateRoot });
        ensureStateDir(targetPaths);
        writeDaemonMetadata(
          targetPaths,
          buildDaemonMetadata({
            paths: targetPaths,
            pid: 424243,
            repoRealpath: resolvedRepo,
            repoRoot: resolvedRepo,
          }),
        );
        writeFileSync(targetPaths.socketPath, "");
        return { pid: 424243 };
      },
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(result.output).toContain("started");
    expect(stopCalled).toBe(false);
  });

  it("preserves unverifiable live PID state without signaling it", async () => {
    seedRunningDaemon(repoA, process.pid);
    const paths = pathsFor(repoA);
    let stopCalled = false;

    const stop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: failedProbe,
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(stop.exitCode).toBe(1);
    expect(stop.output).toContain("state preserved");
    expect(stop.output).toContain("socket probe timed out");
    expect(stopCalled).toBe(false);
    expect(existsSync(paths.stateDir)).toBe(true);
  });

  it("restart preserves unverifiable live PID state without spawning", async () => {
    seedRunningDaemon(repoA, process.pid);
    let stopCalled = false;
    let spawnCalled = false;

    const result = await runServerCliCommand(["restart"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: (pid: number) => pid === process.pid || pid === 424244,
      probeDaemon: failedProbe,
      spawner: (resolvedRepo) => {
        spawnCalled = true;
        const targetPaths = resolveDaemonStatePaths(resolvedRepo, { rootDir: stateRoot });
        ensureStateDir(targetPaths);
        writeDaemonMetadata(
          targetPaths,
          buildDaemonMetadata({
            paths: targetPaths,
            pid: 424244,
            repoRealpath: resolvedRepo,
            repoRoot: resolvedRepo,
          }),
        );
        writeFileSync(targetPaths.socketPath, "");
        return { pid: 424244 };
      },
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("restart skipped");
    expect(result.output).toContain("state preserved");
    expect(stopCalled).toBe(false);
    expect(spawnCalled).toBe(false);
    expect(existsSync(pathsFor(repoA).stateDir)).toBe(true);
  });

  it("stops an unresponsive daemon after verifying process identity", async () => {
    seedRunningDaemon(repoA, process.pid);
    const paths = pathsFor(repoA);
    let stopCalled = false;

    const stop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: failedProbe,
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
      verifyProcessIdentity: () => ({ kind: "verified" }),
    });
    expect(stop.exitCode).toBe(0);
    expect(stop.output).toContain("stopped");
    expect(stop.output).toContain("verifying process identity");
    expect(stopCalled).toBe(true);
    expect(existsSync(paths.stateDir)).toBe(false);
  });

  it("rejects unknown server subcommands with a usage hint", async () => {
    await expect(
      runServerCliCommand(["bogus"], { repoRoot: repoA, state: { rootDir: stateRoot } }),
    ).rejects.toThrow(/Unknown server command/u);
    await expect(
      runServerCliCommand([], { repoRoot: repoA, state: { rootDir: stateRoot } }),
    ).rejects.toThrow(/Usage:/u);
  });
});

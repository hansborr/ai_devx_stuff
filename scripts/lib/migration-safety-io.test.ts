// Effects-layer contract (backlog leaf 119). `migration-safety-cli.test.ts`
// drives the scanner over an in-memory `MigrationSafetyIo`; this file pins the
// real one against a temporary tree, so the seam the CLI trusts — the one-level
// migration walk, the missing-path policy, and the stdout envelope route — is
// checked rather than assumed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { nodeMigrationSafetyIo } from "./migration-safety-io.js";

const root = mkdtempSync(join(tmpdir(), "musi-migration-safety-io-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMigration(name: string, body: string): string {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "migration.sql"), body);
  return join(root, name, "migration.sql");
}

const first = writeMigration("20260102000000_b", 'DROP TABLE "b";\n');
writeMigration("20260101000000_a", 'DROP TABLE "a";\n');
writeMigration(".hidden", 'DROP TABLE "hidden";\n');
mkdirSync(join(root, "20260103000000_empty"), { recursive: true });

describe("nodeMigrationSafetyIo", () => {
  const io = nodeMigrationSafetyIo();

  it("resolves the repository root from git", () => {
    expect(io.repoRoot).not.toBe("");
    expect(io.isFile(`${io.repoRoot}/package.json`)).toBe(true);
  });

  it("classifies directories, files, and missing paths", () => {
    expect(io.isDirectory(root)).toBe(true);
    expect(io.isFile(root)).toBe(false);
    expect(io.isFile(first)).toBe(true);
    expect(io.isDirectory(join(root, "nope"))).toBe(false);
    expect(io.isFile(join(root, "nope"))).toBe(false);
  });

  it("prefers a directory's own migration.sql over a child walk", () => {
    expect(io.listMigrationSql(join(root, "20260102000000_b"))).toEqual([first]);
  });

  it("walks one level deep in sorted order, skipping dotfiles and childless dirs", () => {
    expect(io.listMigrationSql(root)).toEqual([
      join(root, "20260101000000_a", "migration.sql"),
      join(root, "20260102000000_b", "migration.sql"),
    ]);
  });

  it("returns nothing for a directory that does not exist", () => {
    expect(io.listMigrationSql(join(root, "nope"))).toEqual([]);
  });

  it("reads file text", () => {
    expect(io.readText(first)).toBe('DROP TABLE "b";\n');
  });

  it("routes findings to stdout as one harness-diagnostics envelope", () => {
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      io.emitEnvelope([
        {
          control: "sensor/db-migration-safety",
          severity: "warn",
          path: "packages/server/prisma/migrations/20260102000000_b/migration.sql",
          line: 1,
          messageId: "DROP TABLE",
          why: "DROP TABLE — destroys all data in the table.",
          howToFix: "Acknowledge it or split the migration.",
          repairKind: "manual",
        },
      ]);
    } finally {
      write.mockRestore();
    }
    const envelope: unknown = JSON.parse(chunks.join(""));
    expect(envelope).toMatchObject({
      version: "1",
      tool: "migration-safety-scan",
      summary: { blocking: 0, warning: 1, info: 0 },
    });
  });

  it("takes the allowlist override from MUSI_MIGRATION_ALLOWLIST", () => {
    vi.stubEnv("MUSI_MIGRATION_ALLOWLIST", "/tmp/custom-allowlist");
    try {
      expect(nodeMigrationSafetyIo().allowlistOverride).toBe("/tmp/custom-allowlist");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(nodeMigrationSafetyIo().allowlistOverride).toBe(undefined);
  });
});

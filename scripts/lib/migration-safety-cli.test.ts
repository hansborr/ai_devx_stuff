// The scanner's end-to-end contract (backlog leaf 119): argument parsing,
// target collection, and both renderings, driven through an in-memory
// `MigrationSafetyIo`. These assertions were shell `grep -qE` pins in
// `scripts/tests/test-migration-safety-scan.sh`; running them here makes the
// rendered grammar (section order, summary counts, doctor PASS/WARN lines,
// envelope finding shape) checkable without a sandbox migration tree.

import { type HarnessFinding, harnessFindingSchema } from "@musi/harness-diagnostics/schema.js";
import { describe, expect, it } from "vitest";

import {
  type MigrationSafetyCliResult,
  type MigrationSafetyIo,
  parseMigrationSafetyArgs,
  runMigrationSafetyCli,
} from "./migration-safety-cli.js";

const REPO = "/repo";
const MIGRATIONS = `${REPO}/packages/server/prisma/migrations`;
const DEFAULT_ALLOWLIST = `${MIGRATIONS}/.safety-acknowledged`;

const SAFE_SQL = [
  "-- CreateTable",
  'CREATE TABLE "widgets" (',
  '    "id" TEXT NOT NULL,',
  '    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")',
  ");",
  "",
].join("\n");
const DROP_TABLE_SQL = [
  'DROP TABLE "old_widgets";',
  'DROP TABLE IF EXISTS "old_gadgets";',
  "",
].join("\n");
const DROP_COLUMN_SQL = 'ALTER TABLE "widgets" DROP COLUMN "obsolete_flag";\n';

const SAFE = `${MIGRATIONS}/20260101000000_safe`;
const DROP_TABLE = `${MIGRATIONS}/20260102000000_drop_table`;
const DROP_COLUMN = `${MIGRATIONS}/20260103000000_drop_column`;

/**
 * The three-migration tree every case below scans some subset of. Directories
 * are derived from the declared files, so a fixture is only its contents.
 */
const TREE: Readonly<Record<string, string>> = {
  [`${SAFE}/migration.sql`]: SAFE_SQL,
  [`${DROP_TABLE}/migration.sql`]: DROP_TABLE_SQL,
  [`${DROP_COLUMN}/migration.sql`]: DROP_COLUMN_SQL,
};

interface Run {
  readonly result: MigrationSafetyCliResult;
  readonly findings: readonly HarnessFinding[];
}

function directoriesOf(files: Readonly<Record<string, string>>): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const path of Object.keys(files)) {
    let parent = path.slice(0, path.lastIndexOf("/"));
    while (parent !== "") {
      directories.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
  }
  return directories;
}

function run(
  argv: readonly string[],
  options: {
    readonly files?: Readonly<Record<string, string>>;
    readonly allowlistOverride?: string;
    readonly repoRoot?: string;
    /** Paths whose `readText` throws, standing in for a permission error. */
    readonly unreadable?: readonly string[];
  } = {},
): Run {
  const files = options.files ?? TREE;
  const unreadable = new Set(options.unreadable ?? []);
  const directories = directoriesOf(files);
  const emitted: HarnessFinding[] = [];
  const io: MigrationSafetyIo = {
    repoRoot: options.repoRoot ?? REPO,
    allowlistOverride: options.allowlistOverride,
    isDirectory: (path) => directories.has(path),
    isFile: (path) => Object.hasOwn(files, path),
    listMigrationSql: (dir) => {
      const own = `${dir}/migration.sql`;
      if (Object.hasOwn(files, own)) return [own];
      return Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith("/migration.sql"))
        .filter((path) => path.slice(dir.length + 1).split("/").length === 2)
        .sort();
    },
    readText: (path) => {
      if (unreadable.has(path)) throw new Error(`EACCES: permission denied, open '${path}'`);
      return files[path] ?? "";
    },
    // The real emitter validates every finding against `harnessFindingSchema`
    // before writing the envelope and throws on a violation, which would take
    // this warn-only tool to exit 1 with no output. Validating here keeps that
    // contract in reach of every case below rather than only of the smoke.
    emitEnvelope: (findings) => {
      for (const candidate of findings) harnessFindingSchema.parse(candidate);
      emitted.push(...findings);
    },
  };
  return { result: runMigrationSafetyCli(argv, io), findings: emitted };
}

function lineIndex(text: string, needle: string): number {
  return text.split("\n").findIndex((line) => line.startsWith(needle));
}

describe("parseMigrationSafetyArgs", () => {
  it("treats every non-flag token as a path and stops flag parsing at --", () => {
    expect(parseMigrationSafetyArgs(["--json", "a", "--", "--weird-name"])).toEqual({
      help: false,
      json: true,
      paths: ["a", "--weird-name"],
    });
  });

  it("lets -h and --help win wherever they appear", () => {
    expect(parseMigrationSafetyArgs(["a", "-h", "--json"]).help).toBe(true);
    expect(parseMigrationSafetyArgs(["--help"]).paths).toEqual([]);
  });
});

describe("human report", () => {
  it("reports a clean scan with the PASS doctor signal", () => {
    const { result } = run([SAFE]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Scanned 1 migration file(s).");
    expect(result.stdout).toContain("No destructive operations detected.");
    expect(result.stdout).toContain("PASS: migration safety — no destructive operations detected");
  });

  it("emits a per-finding WARN, its risk guidance, and the final WARN doctor signal", () => {
    const { result } = run([DROP_TABLE]);
    const relative = "packages/server/prisma/migrations/20260102000000_drop_table/migration.sql";
    expect(result.stdout).toContain(`WARN: ${relative}:1 — DROP TABLE`);
    expect(result.stdout).toContain(`WARN: ${relative}:2 — DROP TABLE`);
    expect(result.stdout).toContain("Risk: destroys all data in the table");
    expect(result.stdout).toContain(
      "WARN: migration safety — 2 unacknowledged destructive operation(s) in 1 migration(s)",
    );
  });

  it("aggregates the summary line across every scanned migration", () => {
    const { result } = run([]);
    expect(result.stdout).toContain(
      "Findings: 3 in 2 migration(s) of 3 scanned (3 unacknowledged WARN, 0 acknowledged INFO).",
    );
  });

  it("shortens paths under the repo root and leaves outside paths absolute", () => {
    const outside = { [`/elsewhere/20260102000000_drop_table/migration.sql`]: DROP_TABLE_SQL };
    const { result } = run([`/elsewhere/20260102000000_drop_table`], { files: outside });
    expect(result.stdout).toContain("WARN: /elsewhere/20260102000000_drop_table/migration.sql:1");
  });

  it("always states the warn-only mode", () => {
    expect(run([SAFE]).result.stdout).toContain("Mode: warn-only.");
  });
});

describe("allowlist acknowledgement", () => {
  const allowlist = [
    "# Acknowledged intentional-risk migrations (test fixture).",
    "",
    "20260102000000_drop_table  Reviewed: legacy table drop after backfill.",
    "20260103000000_drop_column",
    "",
  ].join("\n");
  const withAllowlist = { ...TREE, [DEFAULT_ALLOWLIST]: allowlist };

  it("renders acknowledged findings as INFO with their reason and keeps PASS", () => {
    const { result } = run([DROP_TABLE], { files: withAllowlist });
    expect(result.stdout).toContain("== actionable warnings ==");
    expect(result.stdout).toContain(
      "No actionable warnings; acknowledged findings are listed separately.",
    );
    expect(result.stdout).toContain("== acknowledged findings ==");
    expect(result.stdout).toContain(
      "INFO: packages/server/prisma/migrations/20260102000000_drop_table/migration.sql:1 — DROP TABLE (acknowledged: Reviewed: legacy table drop after backfill.)",
    );
    expect(result.stdout).not.toContain(
      "WARN: packages/server/prisma/migrations/20260102000000_drop_table",
    );
    expect(result.stdout).toContain(
      "Findings: 2 in 1 migration(s) of 1 scanned (0 unacknowledged WARN, 2 acknowledged INFO).",
    );
    expect(result.stdout).toContain(
      "PASS: migration safety — 2 acknowledged finding(s), 0 unacknowledged",
    );
  });

  it("accepts an entry with no reason and still renders it as INFO", () => {
    const { result } = run([DROP_COLUMN], { files: withAllowlist });
    expect(result.stdout).toContain("— DROP COLUMN (acknowledged: )");
  });

  it("renders actionable WARN findings before acknowledged INFO findings", () => {
    const mixed = {
      ...TREE,
      [DEFAULT_ALLOWLIST]: "20260102000000_drop_table  Reviewed: legacy table drop.\n",
    };
    const { result } = run([DROP_TABLE, DROP_COLUMN], { files: mixed });
    const actionable = lineIndex(result.stdout, "== actionable warnings ==");
    const warn = lineIndex(
      result.stdout,
      "WARN: packages/server/prisma/migrations/20260103000000_drop_column/migration.sql:1 — DROP COLUMN",
    );
    const acknowledged = lineIndex(result.stdout, "== acknowledged findings ==");
    const info = lineIndex(
      result.stdout,
      "INFO: packages/server/prisma/migrations/20260102000000_drop_table",
    );
    expect(actionable).toBeGreaterThanOrEqual(0);
    expect(actionable).toBeLessThan(warn);
    expect(warn).toBeLessThan(acknowledged);
    expect(acknowledged).toBeLessThan(info);
    expect(result.stdout).toContain(
      "Findings: 3 in 2 migration(s) of 2 scanned (1 unacknowledged WARN, 2 acknowledged INFO).",
    );
    expect(result.stdout).toContain(
      "WARN: migration safety — 1 unacknowledged destructive operation(s) in 1 migration(s)",
    );
  });

  it("reads MUSI_MIGRATION_ALLOWLIST in place of the default file", () => {
    // Stale resolution follows the override's own directory, so the entry
    // below is acknowledged for classification and stale for resolution — the
    // shell behaved the same way, and it is what makes the override visible in
    // both renderings.
    const files = {
      ...TREE,
      "/elsewhere/ack": "20260102000000_drop_table  Reviewed elsewhere.\n",
    };
    const { result } = run([DROP_TABLE], { files, allowlistOverride: "/elsewhere/ack" });
    expect(result.stdout).toContain("(acknowledged: Reviewed elsewhere.)");
    expect(result.stdout).toContain("Stale allowlist entries: 1 in /elsewhere/ack.");
  });
});

describe("stale allowlist entries", () => {
  const staleFiles = {
    ...TREE,
    [DEFAULT_ALLOWLIST]: [
      "# Stale-entry test fixture.",
      "20260101000000_safe              Reviewed: real migration in sandbox.",
      "20260199999999_typoed_migration  Reviewed: typoed name; no such directory.",
      "",
    ].join("\n"),
  };
  const display = "packages/server/prisma/migrations/.safety-acknowledged";

  it("surfaces a stale entry even when the scanned migrations are clean", () => {
    const { result } = run([SAFE], { files: staleFiles });
    expect(result.stdout).toContain(
      `WARN: ${display}:3 — stale acknowledgement "20260199999999_typoed_migration" — no migration at packages/server/prisma/migrations/20260199999999_typoed_migration/migration.sql`,
    );
    expect(result.stdout).toContain(
      "fix the typo or remove the line if the migration was renamed or removed",
    );
    expect(result.stdout).toContain(`Stale allowlist entries: 1 in ${display}.`);
    expect(result.stdout).toContain(
      `WARN: migration safety — 1 stale allowlist entry in ${display} — fix the typo or remove the line`,
    );
    expect(result.stdout).not.toContain("PASS: migration safety");
    expect(result.stdout).not.toContain('"20260101000000_safe"');
  });

  it("pluralizes the final WARN for more than one stale entry", () => {
    const files = {
      ...TREE,
      [DEFAULT_ALLOWLIST]: [
        "20260101000000_typo_one  Reviewed: typoed.",
        "20260101000000_typo_two",
        "",
      ].join("\n"),
    };
    const { result } = run([SAFE], { files });
    expect(result.stdout).toContain(
      `WARN: ${display}:1 — stale acknowledgement "20260101000000_typo_one"`,
    );
    expect(result.stdout).toContain(
      `WARN: ${display}:2 — stale acknowledgement "20260101000000_typo_two"`,
    );
    expect(result.stdout).toContain(`Stale allowlist entries: 2 in ${display}.`);
    expect(result.stdout).toContain(
      `WARN: migration safety — 2 stale allowlist entries in ${display} — fix the typos or remove the lines`,
    );
  });

  it("emits the unacknowledged and stale final WARN signals together", () => {
    const { result } = run([DROP_COLUMN], { files: staleFiles });
    expect(result.stdout).toContain(
      "WARN: packages/server/prisma/migrations/20260103000000_drop_column/migration.sql:1 — DROP COLUMN",
    );
    expect(result.stdout).toContain(`WARN: ${display}:3 — stale acknowledgement`);
    expect(result.stdout).toContain(
      "WARN: migration safety — 1 unacknowledged destructive operation(s) in 1 migration(s)",
    );
    expect(result.stdout).toContain(
      `WARN: migration safety — 1 stale allowlist entry in ${display}`,
    );
  });

  it("is independent of which migrations were scanned", () => {
    const { result } = run([DROP_TABLE], { files: staleFiles });
    expect(result.stdout).toContain(
      `WARN: ${display}:3 — stale acknowledgement "20260199999999_typoed_migration"`,
    );
    expect(result.stdout).not.toContain('"20260101000000_safe"');
  });

  it("reports nothing stale when every entry names a real migration", () => {
    const files = {
      ...TREE,
      [DEFAULT_ALLOWLIST]: "20260101000000_safe  Reviewed: real migration.\n",
    };
    const { result } = run([SAFE], { files });
    expect(result.stdout).not.toContain("stale");
    expect(result.stdout).toContain("PASS: migration safety — no destructive operations detected");
  });

  it("collapses duplicate entries to a single stale WARN on the last line", () => {
    const files = {
      ...TREE,
      [DEFAULT_ALLOWLIST]: [
        "20260101000000_typo_dup  Reviewed: typoed (first occurrence).",
        "20260101000000_typo_dup  Reviewed: typoed (second occurrence).",
        "",
      ].join("\n"),
    };
    const { result } = run([SAFE], { files });
    const staleLines = result.stdout
      .split("\n")
      .filter((line) => line.includes('stale acknowledgement "20260101000000_typo_dup"'));
    expect(staleLines).toHaveLength(1);
    expect(staleLines[0]).toContain(`WARN: ${display}:2 —`);
    expect(result.stdout).toContain("WARN: migration safety — 1 stale allowlist entry");
  });
});

describe("collection edge cases", () => {
  it("reports an empty directory as an INFO notice rather than a finding", () => {
    const { result } = run([`${MIGRATIONS}/empty`], {
      files: { ...TREE, [`${MIGRATIONS}/empty/.keep`]: "" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no migration.sql files found");
  });

  it("warns on a missing explicit target without failing the run", () => {
    const { result } = run([`${REPO}/does-not-exist`]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("WARN: not a file or directory, skipping: /repo/does-not-exist\n");
    expect(result.stdout).toContain("INFO: no migration.sql files found");
  });

  it("warns when the default migrations directory is absent", () => {
    const { result } = run([], { files: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("no migrations directory");
  });

  it("scans a path containing a tab like any other path", () => {
    // The shell version refused these outright: findings were framed as
    // tab-separated records, and a tab in the path shifted every field after
    // it. Nothing is tab-framed now, so the path is just a path.
    const tabbed = `${MIGRATIONS}/20260104\t_tabbed_dir`;
    const { result } = run([tabbed], {
      files: { ...TREE, [`${tabbed}/migration.sql`]: DROP_COLUMN_SQL },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "WARN: packages/server/prisma/migrations/20260104\t_tabbed_dir/migration.sql:1 — DROP COLUMN",
    );
  });

  // The shell scanned each file with its own `awk` and read the allowlist with
  // a shell redirection, so a permission error cost one stderr line and the run
  // still exited 0 with every other migration's findings. Letting the read
  // throw would hide destructive operations the scanner had already resolved.
  describe("an unreadable file is reported and skipped, never fatal", () => {
    it("keeps scanning, keeps the scanned count, and stays warn-only", () => {
      const { result } = run([DROP_TABLE, DROP_COLUMN], {
        unreadable: [`${DROP_TABLE}/migration.sql`],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(
        `WARN: cannot read ${DROP_TABLE}/migration.sql, skipping: EACCES`,
      );
      expect(result.stdout).toContain("Scanned 2 migration file(s).");
      expect(result.stdout).toContain("— DROP COLUMN");
      expect(result.stdout).not.toContain("— DROP TABLE");
    });

    it("still emits an envelope for the readable migrations in --json mode", () => {
      const { result, findings } = run(["--json", DROP_TABLE, DROP_COLUMN], {
        unreadable: [`${DROP_TABLE}/migration.sql`],
      });
      expect(result.exitCode).toBe(0);
      expect(findings).toMatchObject([{ messageId: "DROP COLUMN", severity: "warn" }]);
    });

    it("treats an unreadable allowlist as empty rather than failing the run", () => {
      const files = {
        ...TREE,
        [DEFAULT_ALLOWLIST]: "20260103000000_drop_column  Reviewed.\n",
      };
      const { result } = run([DROP_COLUMN], { files, unreadable: [DEFAULT_ALLOWLIST] });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(`WARN: cannot read ${DEFAULT_ALLOWLIST}, skipping: EACCES`);
      expect(result.stdout).toContain("— DROP COLUMN");
      expect(result.stdout).not.toContain("== acknowledged findings ==");
    });
  });

  it("scans a single .sql file passed directly", () => {
    const { result } = run([`${DROP_COLUMN}/migration.sql`]);
    expect(result.stdout).toContain("Scanned 1 migration file(s).");
    expect(result.stdout).toContain("— DROP COLUMN");
  });

  it("prints usage for --help without scanning", () => {
    const { result } = run(["--help", DROP_TABLE]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: migration-safety-scan.sh");
    expect(result.stdout).not.toContain("WARN");
  });
});

describe("--json findings", () => {
  it("routes findings to the emitter and writes nothing to stdout", () => {
    const { result, findings } = run(["--json", DROP_COLUMN]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(findings).toEqual([
      {
        control: "sensor/db-migration-safety",
        severity: "warn",
        path: "packages/server/prisma/migrations/20260103000000_drop_column/migration.sql",
        line: 1,
        messageId: "DROP COLUMN",
        why: "DROP COLUMN — destroys column data — confirm any backfill is complete and dependent reads are removed.",
        howToFix:
          "Acknowledge intentional destructive migrations by adding the migration directory name to packages/server/prisma/migrations/.safety-acknowledged, or split into the safe multi-step pattern (add nullable, backfill, then SET NOT NULL).",
        repairKind: "manual",
      },
    ]);
  });

  it("emits no findings for a clean scan", () => {
    expect(run(["--json", SAFE]).findings).toEqual([]);
  });

  it("keeps a tab inside an allowlist reason in `why` without shifting `howToFix`", () => {
    const files = {
      ...TREE,
      [DEFAULT_ALLOWLIST]: "20260103000000_drop_column  Reviewed: data export\tand verified\n",
    };
    const { findings } = run(["--json", DROP_COLUMN], { files });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.why).toBe(
      "DROP COLUMN (acknowledged): Reviewed: data export\tand verified",
    );
    expect(findings[0]?.howToFix).toMatch(/^Already acknowledged\./u);
  });

  it("emits stale allowlist entries as warn findings at their allowlist line", () => {
    const files = {
      ...TREE,
      [DEFAULT_ALLOWLIST]: [
        "# Stale-entry test fixture.",
        "20260101000000_safe              Reviewed: real migration in sandbox.",
        "20260199999999_typoed_migration  Reviewed: typoed name; no such directory.",
        "",
      ].join("\n"),
    };
    const { findings } = run(["--json", SAFE], { files });
    expect(findings).toMatchObject([
      {
        severity: "warn",
        path: "packages/server/prisma/migrations/.safety-acknowledged",
        line: 3,
        messageId: "stale-allowlist",
      },
    ]);
  });

  it("emits a missing explicit target as a warn finding, keeping the path as given", () => {
    // Collection warnings carry the raw argument, not the repo-relative form
    // hit findings use: the path may not be under the repo root at all.
    const { findings } = run(["--json", `${REPO}/does-not-exist-json`]);
    expect(findings).toMatchObject([
      {
        severity: "warn",
        path: "/repo/does-not-exist-json",
        messageId: "missing-target",
      },
    ]);
    expect(findings[0]?.why).toContain("not a file or directory");
  });

  it("omits the path key entirely for an empty positional argument", () => {
    // `--json ""` is reachable from any caller that interpolates an unset shell
    // variable into the scanner's argv. The finding must drop `path` rather
    // than carry `""`: the shared schema types it `.min(1).optional()`, so an
    // empty string fails validation inside the emitter and takes a warn-only
    // tool to exit 1 with no envelope. The shell helper this port replaced
    // omitted empty values (`scripts/lib/harness-finding.sh:25-27`).
    const { result, findings } = run(["--json", ""]);
    expect(result.exitCode).toBe(0);
    expect(findings).toHaveLength(1);
    expect(findings[0]).not.toHaveProperty("path");
    expect(findings[0]).toMatchObject({ severity: "warn", messageId: "missing-target" });
  });

  it("emits a missing default migrations directory as a warn finding", () => {
    const { findings } = run(["--json"], { files: {} });
    expect(findings).toMatchObject([
      {
        severity: "warn",
        path: "/repo/packages/server/prisma/migrations",
        messageId: "missing-migrations-directory",
      },
    ]);
    expect(findings[0]?.why).toContain("no migrations directory");
  });
});

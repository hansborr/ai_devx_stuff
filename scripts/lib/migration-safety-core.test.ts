// The scanner's grammar spec (backlog leaf 119). These cases were pinned as
// shell assertions in `scripts/tests/test-migration-safety-scan.sh` against
// synthetic migration fixtures; they moved here with the awk lexer they
// exercise, so a rule change is caught by a millisecond-scale unit test rather
// than a sandbox round-trip. The smoke keeps the facade-level contract (exit
// code, envelope on stdout, real-tree precedents).

import { describe, expect, it } from "vitest";

import {
  classifyHits,
  findStaleEntries,
  migrationNameFor,
  parseAllowlist,
  ruleGuidance,
  type RuleHit,
  sanitizeSqlLine,
  scanSqlText,
  scanTotals,
} from "./migration-safety-core.js";

function rulesFor(sql: string): readonly (readonly [number, string])[] {
  return scanSqlText(sql).map((match) => [match.line, match.rule] as const);
}

function label(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

// gawk's `[[:space:]]` under this repo's `en_US.UTF-8` locale, minus U+000A
// (awk's RS and this port both split records on it first, so it can never sit
// inside a record). Shared by the two halves that disagree about it on purpose:
// the detection rules pin this whole set, the allowlist parser pins only the
// ASCII part. See `ALLOWLIST_SPACE_CLASS` in the module under test.
const GAWK_SPACE = [
  0x09, 0x0b, 0x0c, 0x0d, 0x20, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x205f, 0x3000,
];
const GAWK_SPACE_NON_ASCII = GAWK_SPACE.filter((codePoint) => codePoint > 0x7f);

describe("scanSqlText rules", () => {
  it("reports no findings for a safe CREATE TABLE, whose NOT NULL columns are not ADD COLUMN", () => {
    expect(
      rulesFor(
        [
          "-- CreateTable",
          'CREATE TABLE "widgets" (',
          '    "id" TEXT NOT NULL,',
          `    "name" TEXT NOT NULL DEFAULT '',`,
          '    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
          '    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")',
          ");",
          "",
          'CREATE INDEX "widgets_name_idx" ON "widgets"("name");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("detects DROP TABLE and DROP TABLE IF EXISTS on their own lines", () => {
    expect(
      rulesFor(['DROP TABLE "old_widgets";', 'DROP TABLE IF EXISTS "old_gadgets";'].join("\n")),
    ).toEqual([
      [1, "DROP TABLE"],
      [2, "DROP TABLE"],
    ]);
  });

  it("detects DROP COLUMN", () => {
    expect(rulesFor('ALTER TABLE "widgets" DROP COLUMN "obsolete_flag";')).toEqual([
      [1, "DROP COLUMN"],
    ]);
  });

  // gawk's `[[:space:]]` is glibc `iswspace()` under this repo's `en_US.UTF-8`
  // locale: neither ASCII-only nor Unicode's `White_Space`. Enumerated
  // codepoint by codepoint over the whole BMP and the astral planes, it matches
  // exactly MATCHED below and nothing else, so the ported rules spell that set
  // out. Both directions are pinned: an accidental narrowing back to ASCII
  // silently misses a destructive statement, and reaching for `\s` would
  // over-widen past gawk on NBSP and friends.
  describe("gawk's [[:space:]] boundary", () => {
    const MATCHED = GAWK_SPACE;
    // Rejected by glibc `iswspace()` even though the first four carry Unicode's
    // `White_Space` property. JS `\s` matches U+0085, U+00A0, U+2007, U+202F
    // and U+FEFF, which is exactly why the class is spelled out instead.
    const REJECTED = [0x85, 0xa0, 0x2007, 0x202f, 0x200b, 0xfeff];

    function probe(codePoint: number): (string | readonly string[])[] {
      const ch = String.fromCodePoint(codePoint);
      return [
        label(codePoint),
        rulesFor(`ALTER TABLE "t" DROP${ch}COLUMN "c";`).map(([, rule]) => rule),
        rulesFor(`SELECT 1;${ch}DROP${ch}TABLE "t";`).map(([, rule]) => rule),
      ];
    }

    function notNullRules(codePoint: number): readonly string[] {
      const ch = String.fromCodePoint(codePoint);
      return rulesFor(
        `ALTER TABLE "t" ADD COLUMN "c" TEXT NOT NULL${ch}, ADD COLUMN "d" TEXT;`,
      ).map(([, rule]) => rule);
    }

    it("separates DROP from TABLE and COLUMN for every codepoint gawk matches", () => {
      expect(MATCHED.map(probe)).toEqual(
        MATCHED.map((codePoint) => [label(codePoint), ["DROP COLUMN"], ["DROP TABLE"]]),
      );
    });

    it("leaves DROP joined to TABLE and COLUMN for every codepoint gawk rejects", () => {
      expect(REJECTED.map(probe)).toEqual(REJECTED.map((codePoint) => [label(codePoint), [], []]));
    });

    it("closes a NOT NULL clause on the matched codepoints only", () => {
      expect(
        MATCHED.filter((codePoint) => notNullRules(codePoint).length === 0).map(label),
      ).toEqual([]);
      expect(REJECTED.filter((codePoint) => notNullRules(codePoint).length > 0).map(label)).toEqual(
        [],
      );
    });
  });

  it("detects every ALTER COLUMN ... TYPE clause of a multi-line statement", () => {
    expect(
      rulesFor(
        [
          'ALTER TABLE "widgets"',
          '  ALTER COLUMN "size" TYPE "widget_size" USING "size"::"widget_size",',
          '  ALTER COLUMN "color" TYPE "widget_color" USING "color"::"widget_color";',
        ].join("\n"),
      ),
    ).toEqual([
      [2, "ALTER COLUMN ... TYPE"],
      [3, "ALTER COLUMN ... TYPE"],
    ]);
  });

  it("detects ADD COLUMN ... NOT NULL only when no DEFAULT is present", () => {
    expect(
      rulesFor(
        [
          'ALTER TABLE "widgets" ADD COLUMN "owner_id" TEXT NOT NULL;',
          'ALTER TABLE "widgets" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;',
          'ALTER TABLE "widgets" ADD COLUMN "label" TEXT;',
        ].join("\n"),
      ),
    ).toEqual([[1, "ADD COLUMN ... NOT NULL without DEFAULT"]]);
  });

  it("does not flag the add-nullable, backfill, SET NOT NULL split pattern", () => {
    expect(
      rulesFor(
        [
          'ALTER TABLE "widgets" ADD COLUMN "tier" TEXT;',
          `UPDATE "widgets" SET "tier" = 'standard' WHERE "tier" IS NULL;`,
          'ALTER TABLE "widgets" ALTER COLUMN "tier" SET NOT NULL;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not flag WHERE clauses containing IS NOT NULL", () => {
    expect(rulesFor(`UPDATE "widgets" SET "label" = 'x' WHERE "owner_id" IS NOT NULL;`)).toEqual(
      [],
    );
  });

  it("strips line comments before matching, including trailing ones", () => {
    expect(
      rulesFor(
        [
          `-- DROP TABLE "old_widgets" — describing what we're NOT doing`,
          '-- ALTER COLUMN "x" TYPE TEXT (history note)',
          'ALTER TABLE "widgets" ADD COLUMN "label" TEXT; -- DROP COLUMN "obsolete" later',
          'CREATE TABLE "more_widgets" (',
          '    "id" TEXT NOT NULL,  -- ADD COLUMN "x" TEXT NOT NULL would be unsafe',
          '    CONSTRAINT "more_widgets_pkey" PRIMARY KEY ("id")',
          ");",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("masks single-quoted literals and block comments, including multi-line ones", () => {
    expect(
      rulesFor(
        [
          `UPDATE "widgets" SET "label" = 'please DROP TABLE old_widgets safely';`,
          `UPDATE "widgets" SET "label" = 'DROP COLUMN old_col';`,
          `UPDATE "widgets" SET "label" = 'ALTER COLUMN "size" TYPE TEXT';`,
          `UPDATE "widgets" SET "label" = 'ADD COLUMN "owner_id" TEXT NOT NULL';`,
          `UPDATE "widgets" SET "label" = 'owner''s note: DROP COLUMN old_col';`,
          `UPDATE "widgets" SET "label" = 'comment marker -- DROP TABLE old_widgets';`,
          '/* DROP TABLE "old_widgets"; */',
          'ALTER TABLE "widgets" ADD COLUMN "safe_label" TEXT; /* DROP COLUMN "obsolete"; */',
          "/*",
          'ALTER TABLE "widgets" DROP COLUMN "legacy_flag";',
          'ALTER TABLE "widgets" ADD COLUMN "owner_id" TEXT NOT NULL;',
          "*/",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("keeps the source line as the snippet, trimmed, not the masked form", () => {
    const [match] = scanSqlText(`  DROP TABLE "old_widgets"; -- gone  `);
    expect(match?.snippet).toBe('DROP TABLE "old_widgets"; -- gone');
  });

  it("produces one guidance sentence per rule", () => {
    expect(ruleGuidance("DROP TABLE")).toContain("destroys all data in the table");
    expect(ruleGuidance("DROP COLUMN")).toContain("destroys column data");
    expect(ruleGuidance("ALTER COLUMN ... TYPE")).toContain("type change can narrow or fail");
    expect(ruleGuidance("ADD COLUMN ... NOT NULL without DEFAULT")).toContain(
      "will fail on tables with existing rows",
    );
  });

  it("has no records for empty text and no trailing record for a trailing newline", () => {
    expect(scanSqlText("")).toEqual([]);
    expect(rulesFor('DROP TABLE "x";\n')).toEqual([[1, "DROP TABLE"]]);
  });
});

describe("sanitizeSqlLine", () => {
  it("masks quoted spans in place and drops the line-comment tail", () => {
    const state = { inBlockComment: false };
    const masked = sanitizeSqlLine(`SELECT 'DROP TABLE' -- DROP TABLE`, state);
    expect(masked).not.toContain("DROP TABLE");
    expect(state.inBlockComment).toBe(false);
  });

  it("masks with spaces rather than deleting, so a comment still separates words", () => {
    // Load-bearing, not trivia: were a masked span removed instead of blanked,
    // `DROP/*...*/COLUMN` would collapse to `DROPCOLUMN` and stop matching. The
    // shell scanner blanked spans for the same reason and flags this line too.
    expect(rulesFor(`ALTER TABLE "w" DROP/* keep the words apart */COLUMN "o";`)).toEqual([
      [1, "DROP COLUMN"],
    ]);
  });

  it("carries an unterminated block comment into the next line", () => {
    const state = { inBlockComment: false };
    expect(sanitizeSqlLine("/* DROP TABLE", state)).not.toContain("DROP TABLE");
    expect(state.inBlockComment).toBe(true);
    expect(sanitizeSqlLine("DROP TABLE */ DROP COLUMN", state)).toContain("DROP COLUMN");
    expect(state.inBlockComment).toBe(false);
  });

  it("leaves dollar-quoted bodies unmasked, exactly as the awk lexer did", () => {
    // Bug-for-bug: the shell scanner never handled $$ ... $$ bodies, so SQL
    // hidden inside one is still matched. Pinned so the port does not quietly
    // "fix" a rule the shell version never had.
    expect(rulesFor(`DO $$ BEGIN EXECUTE 'noop'; DROP TABLE "x"; END $$;`)).toEqual([
      [1, "DROP TABLE"],
    ]);
  });
});

describe("allowlist policy", () => {
  const allowlist = parseAllowlist(
    [
      "# Acknowledged intentional-risk migrations (test fixture).",
      "",
      "20260102000000_drop_table  Reviewed: legacy table drop after backfill.",
      "20260104000000_alter_type",
    ].join("\n"),
  );

  it("parses names with optional reasons and skips comments and blank lines", () => {
    expect([...allowlist.keys()]).toEqual([
      "20260102000000_drop_table",
      "20260104000000_alter_type",
    ]);
    expect(allowlist.get("20260102000000_drop_table")?.reason).toBe(
      "Reviewed: legacy table drop after backfill.",
    );
    expect(allowlist.get("20260104000000_alter_type")?.reason).toBe("");
    expect(allowlist.get("20260104000000_alter_type")?.line).toBe(4);
  });

  it("keeps tabs inside a reason intact", () => {
    const parsed = parseAllowlist(
      "20260103000000_drop_column  Reviewed: data export\tand verified\n",
    );
    expect(parsed.get("20260103000000_drop_column")?.reason).toBe(
      "Reviewed: data export\tand verified",
    );
  });

  it("collapses duplicate entries onto the last occurrence's line", () => {
    const parsed = parseAllowlist(
      [
        "20260101000000_typo_dup  first occurrence.",
        "20260101000000_typo_dup  second occurrence.",
      ].join("\n"),
    );
    expect(parsed.size).toBe(1);
    expect(parsed.get("20260101000000_typo_dup")?.line).toBe(2);
    expect(parsed.get("20260101000000_typo_dup")?.reason).toBe("second occurrence.");
  });

  it("reports entries with no matching migration as stale, in allowlist order", () => {
    const stale = findStaleEntries(allowlist, (name) => name === "20260102000000_drop_table");
    expect(stale.map((entry) => entry.name)).toEqual(["20260104000000_alter_type"]);
  });

  it("reports no stale entries when every name resolves", () => {
    expect(findStaleEntries(allowlist, () => true)).toEqual([]);
  });

  // The detection rules and this parser must NOT share a whitespace class.
  // Detection was awk and is pinned to gawk's wide `en_US.UTF-8` set, because
  // widening it can only add findings. This parser was Bash parameter
  // expansion, where widening can only remove them: splitting
  // `<name><U+2003><reason>` into a usable acknowledgement demotes that
  // migration's destructive findings from WARN to INFO, and `doctor` does not
  // count INFO. Measured with `${s%%[[:space:]]*}` in bash 5.2.15 over the whole
  // BMP: 21 codepoints under `en_US.UTF-8`, only the 6 ASCII ones under
  // `LC_ALL=C`. A JS regex cannot be both, so the parser pins the `LC_ALL=C`
  // side and this pair of cases pins the asymmetry itself.
  describe("acknowledgement whitespace stays ASCII while detection stays wide", () => {
    it("still separates DROP from COLUMN on every non-ASCII codepoint gawk matches", () => {
      expect(
        GAWK_SPACE_NON_ASCII.filter(
          (codePoint) =>
            rulesFor(`ALTER TABLE "t" DROP${String.fromCodePoint(codePoint)}COLUMN "c";`).length ===
            0,
        ).map(label),
      ).toEqual([]);
    });

    it("does not split a name from a reason on any non-ASCII codepoint", () => {
      expect(
        GAWK_SPACE_NON_ASCII.map((codePoint) => {
          const separator = String.fromCodePoint(codePoint);
          const parsed = parseAllowlist(`20260101000000_drop_column${separator}reviewed\n`);
          return [label(codePoint), [...parsed.keys()]];
        }),
      ).toEqual(
        GAWK_SPACE_NON_ASCII.map((codePoint) => [
          label(codePoint),
          [`20260101000000_drop_column${String.fromCodePoint(codePoint)}reviewed`],
        ]),
      );
    });

    it("leaves the migration unacknowledged, so its DROP COLUMN still warns", () => {
      const hits: readonly RuleHit[] = [
        {
          path: "migrations/20260101000000_drop_column/migration.sql",
          line: 1,
          rule: "DROP COLUMN",
          snippet: 'ALTER TABLE "t" DROP COLUMN "c";',
        },
      ];
      const emSpace = parseAllowlist("20260101000000_drop_column\u2003reviewed\n");
      expect(classifyHits(hits, emSpace)[0]?.acknowledgedReason).toBeUndefined();
      // The ASCII spelling of the same entry is what actually acknowledges it.
      const ascii = parseAllowlist("20260101000000_drop_column reviewed\n");
      expect(classifyHits(hits, ascii)[0]?.acknowledgedReason).toBe("reviewed");
    });

    it("neither trims a leading non-ASCII space nor reads one as a comment marker", () => {
      const parsed = parseAllowlist("\u3000# not a comment once the trim is ASCII-only\n");
      expect([...parsed.keys()]).toEqual(["\u3000#"]);
    });
  });
});

describe("classification and totals", () => {
  const allowlist = parseAllowlist("20240101_drop_spell  intentional drop\n");
  const hits = classifyHits(
    [
      { path: "a/20240101_drop_spell/migration.sql", line: 1, rule: "DROP TABLE", snippet: "x" },
      { path: "a/20240303_other/migration.sql", line: 1, rule: "DROP COLUMN", snippet: "y" },
      { path: "a/20240303_other/migration.sql", line: 2, rule: "DROP TABLE", snippet: "z" },
    ],
    allowlist,
  );

  it("marks allowlisted migrations acknowledged and leaves the rest unacknowledged", () => {
    expect(hits.map((hit) => hit.acknowledgedReason)).toEqual([
      "intentional drop",
      undefined,
      undefined,
    ]);
  });

  it("counts unacknowledged hits by their migration directory, not per finding", () => {
    expect(scanTotals(hits)).toMatchObject({
      total: 3,
      fileCount: 2,
      acknowledged: 1,
      unacknowledged: 2,
      unacknowledgedMigrations: 1,
    });
  });

  // The shell derived the "in N migration(s)" denominator in its own awk pass
  // (migration-safety-scan.sh:550-559 at 3e63ac0e0) that stripped only a
  // literal `/migration.sql` suffix and keyed acknowledgement on the last
  // component of what was left. Both quirks are only visible for loose `.sql`
  // files passed by path, and both are pinned here because leaf 119 is a
  // bug-for-bug port: the port must not tidy this into `pathDirname`.
  describe("loose .sql targets keep the shell's summary cardinality", () => {
    const looseHits: readonly RuleHit[] = [
      { path: "x/a.sql", line: 1, rule: "DROP COLUMN", snippet: "a" },
      { path: "x/b.sql", line: 1, rule: "DROP COLUMN", snippet: "b" },
    ];

    it("counts two loose files in one directory as two migrations", () => {
      expect(scanTotals(classifyHits(looseHits, new Map()))).toMatchObject({
        unacknowledged: 2,
        unacknowledgedMigrations: 2,
      });
    });

    it("drops a filename-keyed loose file from the denominator but not from the WARNs", () => {
      const totals = scanTotals(classifyHits(looseHits, parseAllowlist("a.sql  keyed by file\n")));
      expect(totals).toMatchObject({ unacknowledged: 2, unacknowledgedMigrations: 1 });
    });

    it("counts nothing when every loose file is filename-keyed, WARNs notwithstanding", () => {
      const allowlist = parseAllowlist("a.sql  keyed by file\nb.sql  keyed by file\n");
      const totals = scanTotals(classifyHits(looseHits, allowlist));
      expect(totals).toMatchObject({ unacknowledged: 2, unacknowledgedMigrations: 0 });
    });

    it("still groups conventional migration.sql paths by their directory", () => {
      const conventional: readonly RuleHit[] = [
        { path: "x/20240101_one/migration.sql", line: 1, rule: "DROP TABLE", snippet: "a" },
        { path: "x/20240101_one/migration.sql", line: 2, rule: "DROP COLUMN", snippet: "b" },
      ];
      expect(scanTotals(classifyHits(conventional, new Map()))).toMatchObject({
        unacknowledged: 2,
        unacknowledgedMigrations: 1,
      });
    });
  });
});

describe("migrationNameFor", () => {
  it("names a migration by its directory, and a loose .sql file by its parent", () => {
    expect(migrationNameFor("a/20240101_init/migration.sql")).toBe("20240101_init");
    expect(migrationNameFor("a/b/one.sql")).toBe("b");
  });

  it("reads an option-shaped directory as a name, not as a flag", () => {
    // The shell needed `dirname --`/`basename --` here; node:path/posix has no
    // flag parsing to defeat, but the case stays pinned because the smoke's
    // `-- --weird-name` contract depends on it.
    expect(migrationNameFor("--weird-name/migration.sql")).toBe("--weird-name");
  });
});

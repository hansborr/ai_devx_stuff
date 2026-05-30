import { describe, expect, it } from "vitest";

import { reduceCoupling } from "./hotspots-coupling.js";
import type { CollectedHistory, CommitFileChange, CommitRecord } from "./hotspots-history.js";

function files(...paths: string[]): CommitFileChange[] {
  return paths.map((path) => ({ path, added: 1, deleted: 1, binary: false }));
}

let seq = 0;
function rec(changes: readonly CommitFileChange[], over: Partial<CommitRecord> = {}): CommitRecord {
  seq += 1;
  return {
    hash: `h${seq}`,
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-05-29T00:00:00-07:00",
    committerDate: "2026-05-29T00:00:00-07:00",
    subject: `subject ${seq}`,
    coAuthors: [],
    files: changes,
    ...over,
  };
}

function history(records: readonly CommitRecord[]): CollectedHistory {
  return {
    records,
    commitCount: records.length,
    requestedWindowDays: 14,
    effectiveWindowDays: 14,
    widened: false,
    widenReason: null,
    metric: "revisions",
    metricAutoSwitched: false,
    squashReason: null,
    singleRevisionRatio: 0,
    linesAvailable: true,
  };
}

function repeat(count: number, build: () => CommitRecord): CommitRecord[] {
  return Array.from({ length: count }, build);
}

describe("reduceCoupling", () => {
  it("counts co-change pairs, computes the symmetric score, and flags cross-boundary", () => {
    const records = repeat(5, () => rec(files("src/a.ts", "client/b.ts")));

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3 });

    expect(section.lens).toBe("coupling");
    expect(section.scoreModel).toBe("symmetric");
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]).toMatchObject({
      a: "client/b.ts", // pair stored sorted
      b: "src/a.ts",
      coChanges: 5,
      revisionsA: 5,
      revisionsB: 5,
      score: 1,
      crossBoundary: true,
    });
  });

  it("drops pairs below minSupport (the long-tail cut)", () => {
    const records = [
      ...repeat(5, () => rec(files("src/a.ts", "src/b.ts"))),
      ...repeat(2, () => rec(files("src/c.ts", "src/d.ts"))),
    ];

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3 });

    const keys = section.entries.map((entry) => `${entry.a}|${entry.b}`);
    expect(keys).toContain("src/a.ts|src/b.ts");
    expect(keys).not.toContain("src/c.ts|src/d.ts");
  });

  it("sorts cross-boundary pairs above same-directory pairs even with a lower count", () => {
    const records = [
      ...repeat(10, () => rec(files("src/x.ts", "src/y.ts"))), // same-dir, high count
      ...repeat(4, () => rec(files("src/a.ts", "client/b.ts"))), // cross-boundary, lower count
    ];

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3 });

    expect(section.entries[0]?.crossBoundary).toBe(true);
    expect(section.entries[0]).toMatchObject({ a: "client/b.ts", b: "src/a.ts" });
  });

  it("bounds a locale-style clique with the per-node degree cap rather than letting it dominate", () => {
    const locales = ["i18n/a.json", "i18n/b.json", "i18n/c.json", "i18n/d.json", "i18n/e.json"];
    const records = [
      ...repeat(4, () => rec(files(...locales))), // every locale co-changes with every other
      ...repeat(3, () => rec(files("src/api.ts", "client/api.ts"))), // a clean cross-boundary pair
    ];

    const section = reduceCoupling(history(records), {
      top: 50,
      minSupport: 3,
      degreeCap: 2,
    });

    // The clean cross-boundary pair sorts to the very top.
    expect(section.entries[0]).toMatchObject({
      a: "client/api.ts",
      b: "src/api.ts",
      crossBoundary: true,
    });
    // No single locale file contributes more than degreeCap partners to the list.
    const degree = new Map<string, number>();
    for (const entry of section.entries) {
      degree.set(entry.a, (degree.get(entry.a) ?? 0) + 1);
      degree.set(entry.b, (degree.get(entry.b) ?? 0) + 1);
    }
    for (const locale of locales) expect(degree.get(locale) ?? 0).toBeLessThanOrEqual(2);
  });

  it("skips wide commits as sweeps (above the sweep cap), so they add no pairs", () => {
    const records = [
      ...repeat(3, () => rec(files("src/a.ts", "src/b.ts"))), // 3 genuine 2-file commits
      rec(files("src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts")), // a 4-file sweep
    ];

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3, sweepCap: 3 });

    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]).toMatchObject({ a: "src/a.ts", b: "src/b.ts", coChanges: 3 });
    // c.ts / d.ts only ever appeared in the skipped sweep → no pair surfaces them.
    const paths = section.entries.flatMap((entry) => [entry.a, entry.b]);
    expect(paths).not.toContain("src/c.ts");
    expect(paths).not.toContain("src/d.ts");
  });

  it("reports an empty reason when no pair clears minSupport", () => {
    const records = repeat(2, () => rec(files("src/a.ts", "src/b.ts")));

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3 });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("no pair co-changed at least 3 times");
  });

  it("excludes sweep commits from pair context, matching the score's scoring window", () => {
    const records = [
      // Newest: a wide sweep touching both paths — excluded from coOccur, so it must
      // not appear as the pair's authors/recent-subjects evidence either.
      rec(files("src/a.ts", "client/b.ts", "src/c.ts", "src/d.ts"), {
        subject: "format sweep",
        authorName: "Sweeper",
      }),
      ...repeat(3, () => rec(files("src/a.ts", "client/b.ts"), { authorName: "Ada" })),
    ];

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3, sweepCap: 3 });
    const pair = section.entries[0];

    expect(pair?.coChanges).toBe(3);
    expect(pair?.authors).not.toContainEqual({ name: "Sweeper", commits: 1 });
    expect(pair?.recentSubjects).not.toContain("format sweep");
  });

  it("carries pair actionability context from the co-occurrence commits", () => {
    const records = [
      rec(files("src/a.ts", "client/b.ts"), { subject: "third", authorName: "Bob" }),
      rec(files("src/a.ts", "client/b.ts"), { subject: "second", authorName: "Ada" }),
      rec(files("src/a.ts", "client/b.ts"), { subject: "first", authorName: "Ada" }),
      rec(files("src/a.ts"), { subject: "solo a", authorName: "Zed" }), // not a co-occurrence
    ];

    const section = reduceCoupling(history(records), { top: 20, minSupport: 3 });
    const pair = section.entries[0];

    expect(pair?.authors[0]).toEqual({ name: "Ada", commits: 2 });
    expect(pair?.authors).not.toContainEqual({ name: "Zed", commits: 1 });
    expect(pair?.recentSubjects).toEqual(["third", "second", "first"]);
    expect(pair?.inspectCommand).toBe("git log --oneline -- client/b.ts src/a.ts");
  });
});

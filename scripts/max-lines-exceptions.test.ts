import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { maxLinesPolicy } from "../eslint-config/shared-policy.js";
import { runMaxLinesExceptionsCli } from "./max-lines-exceptions.js";
import {
  checkMaxLinesExceptionsBaseline,
  diffMaxLinesExceptions,
  formatMaxLinesExceptionsBaseline,
  makeMaxLinesExceptionEntry,
  type MaxLinesExceptionEntry,
  maxLinesExceptionsSpec,
  parseMaxLinesEntriesForUpdate,
  readMaxLinesExceptionsBaseline,
} from "./max-lines-exceptions-core.js";

const repoRoot = resolve(import.meta.dirname, "..");
const committedBaselinePath = resolve(repoRoot, "eslint-config/max-lines-exceptions.baseline.json");

function entry(
  overrides: Partial<Parameters<typeof makeMaxLinesExceptionEntry>[0]> = {},
): MaxLinesExceptionEntry {
  return makeMaxLinesExceptionEntry({
    path: "packages/a.ts",
    cap: 400,
    severity: "warn",
    reason: "example reason for the cap",
    lifecycle: "candidate-for-split",
    ratchetExcluded: true,
    ...overrides,
  });
}

describe("maxLinesExceptionsSpec format/parse", () => {
  it("sorts by path and derives the summary count", () => {
    const text = formatMaxLinesExceptionsBaseline([
      entry({ path: "packages/z.ts" }),
      entry({ path: "packages/a.ts" }),
    ]);
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toMatchObject({
      version: 2,
      tool: "eslint-max-lines",
      metric: "file-line-cap-exceptions",
      summary: { count: 2 },
    });
    const paths = readMaxLinesExceptionsBaseline(text);
    expect(paths.ok).toBe(true);
    if (paths.ok)
      expect(paths.value.map((e) => e.path)).toEqual(["packages/a.ts", "packages/z.ts"]);
  });

  it("round-trips an entry's cap and metadata", () => {
    const original = entry({
      path: "packages/b.ts",
      cap: 512,
      severity: "error",
      lifecycle: "permanent",
    });
    const parsed = readMaxLinesExceptionsBaseline(formatMaxLinesExceptionsBaseline([original]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value[0]).toEqual(original);
  });

  it.each([
    {
      name: "missing cap",
      raw: {
        path: "a.ts",
        severity: "warn",
        reason: "r",
        lifecycle: "permanent",
        ratchetExcluded: true,
      },
      error: "cap must be a positive integer",
    },
    {
      name: "bad severity",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "info",
        reason: "r",
        lifecycle: "permanent",
        ratchetExcluded: true,
      },
      error: 'severity must be "error" or "warn"',
    },
    {
      name: "empty reason",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "warn",
        reason: "  ",
        lifecycle: "permanent",
        ratchetExcluded: true,
      },
      error: "reason must be a non-empty string",
    },
    {
      name: "bad lifecycle",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "warn",
        reason: "r",
        lifecycle: "someday",
        ratchetExcluded: true,
      },
      error: "lifecycle is invalid",
    },
    {
      name: "non-bool ratchetExcluded",
      raw: {
        path: "a.ts",
        cap: 10,
        severity: "warn",
        reason: "r",
        lifecycle: "permanent",
        ratchetExcluded: "yes",
      },
      error: "ratchetExcluded must be a boolean",
    },
  ])("rejects $name", ({ raw, error }) => {
    const result = maxLinesExceptionsSpec.parseEntry(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(error);
  });
});

describe("count-aware diff (gateEntries) over caps", () => {
  it("passes when caps are identical", () => {
    const set = [entry({ path: "a.ts", cap: 400 }), entry({ path: "b.ts", cap: 300 })];
    expect(diffMaxLinesExceptions(set, set).status).toBe("ok");
  });

  it("flags a raised cap as a regression and a lowered cap as an improvement", () => {
    const baseline = [entry({ path: "a.ts", cap: 400 })];
    expect(diffMaxLinesExceptions(baseline, [entry({ path: "a.ts", cap: 450 })])).toMatchObject({
      status: "regressed",
      increased: ["a.ts"],
    });
    expect(diffMaxLinesExceptions(baseline, [entry({ path: "a.ts", cap: 350 })])).toMatchObject({
      status: "improved",
      decreased: ["a.ts"],
    });
  });

  it("flags an added or removed exception path", () => {
    const baseline = [entry({ path: "a.ts" })];
    expect(
      diffMaxLinesExceptions(baseline, [entry({ path: "a.ts" }), entry({ path: "b.ts" })]),
    ).toMatchObject({
      status: "regressed",
      added: ["b.ts"],
    });
  });
});

describe("checkMaxLinesExceptionsBaseline / --update", () => {
  it("accepts a freshly formatted baseline", () => {
    const text = formatMaxLinesExceptionsBaseline([
      entry({ path: "a.ts" }),
      entry({ path: "b.ts" }),
    ]);
    expect(checkMaxLinesExceptionsBaseline(text)).toEqual({ ok: true });
  });

  it("rejects an un-normalized baseline (stale summary) but --update tolerates and fixes it", () => {
    const staleSummary = JSON.stringify(
      {
        version: 2,
        tool: "eslint-max-lines",
        metric: "file-line-cap-exceptions",
        summary: { count: 99 },
        entries: [
          {
            path: "a.ts",
            cap: 400,
            severity: "warn",
            reason: "r",
            lifecycle: "permanent",
            ratchetExcluded: true,
          },
        ],
      },
      null,
      2,
    );
    expect(checkMaxLinesExceptionsBaseline(staleSummary).ok).toBe(false);

    const forUpdate = parseMaxLinesEntriesForUpdate(staleSummary);
    expect(forUpdate.ok).toBe(true);
    if (forUpdate.ok) {
      const normalized = formatMaxLinesExceptionsBaseline(forUpdate.value);
      expect(checkMaxLinesExceptionsBaseline(normalized)).toEqual({ ok: true });
    }
  });

  it("--update rewrites a denormalized file and --check then passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "max-lines-exceptions-"));
    const baselinePath = join(dir, "baseline.json");
    // Shuffled entries + wrong summary count: not normalized.
    writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 2,
        tool: "eslint-max-lines",
        metric: "file-line-cap-exceptions",
        summary: { count: 0 },
        entries: [
          {
            path: "z.ts",
            cap: 500,
            severity: "error",
            reason: "r",
            lifecycle: "permanent",
            ratchetExcluded: true,
          },
          {
            path: "a.ts",
            cap: 400,
            severity: "warn",
            reason: "r",
            lifecycle: "permanent",
            ratchetExcluded: true,
          },
        ],
      }),
    );

    expect(runMaxLinesExceptionsCli({ argv: [], baselinePath }).exitCode).toBe(2);
    const updated = runMaxLinesExceptionsCli({ argv: ["--update"], baselinePath });
    expect(updated.exitCode).toBe(0);
    expect(runMaxLinesExceptionsCli({ argv: [], baselinePath }).exitCode).toBe(0);
    const parsed = readMaxLinesExceptionsBaseline(readFileSync(baselinePath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.map((e) => e.path)).toEqual(["a.ts", "z.ts"]);
  });
});

describe("committed baseline", () => {
  it("is normalized and valid on disk", () => {
    expect(checkMaxLinesExceptionsBaseline(readFileSync(committedBaselinePath, "utf8"))).toEqual({
      ok: true,
    });
  });

  it("carries exactly the caps shared-policy.js exposes to eslint", () => {
    const parsed = readMaxLinesExceptionsBaseline(readFileSync(committedBaselinePath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // shared-policy.js is JS, so its exceptions array widens to any[] on import.
    const policyExceptions = maxLinesPolicy.exceptions as ReadonlyArray<
      Parameters<typeof makeMaxLinesExceptionEntry>[0]
    >;
    const fromPolicy = policyExceptions.map((exception) => makeMaxLinesExceptionEntry(exception));
    // No path added/removed and no cap moved between the JSON and what the eslint
    // config layer consumes: the count-aware gate proves the migration is exact.
    expect(diffMaxLinesExceptions(fromPolicy, parsed.value).status).toBe("ok");
  });
});

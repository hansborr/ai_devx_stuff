import { describe, expect, it } from "vitest";

import {
  type CoverageEntry,
  coverageManifestSchema,
  type CoverageSection,
} from "./lint-coverage-map-manifest-schema.js";

// These invariants used to live in `lint-coverage-map-check.ts` and were
// exercised through the checker's Markdown fixtures. They are schema refinements
// now, so they fail at manifest load instead of at drift-check time — which also
// means the checker tests no longer reach them. Pin them here.

const BASE_ENTRY = {
  id: "example-entry",
  globs: ["scripts/example.ts"],
  files: "1 .ts",
  normalLint: { covered: true },
  ratchets: "`ratchet/local-type-assertion-boundary`",
  parser: "ESLint",
  proposed: "none",
  status: ["linted"],
  followUp: "—",
} as const satisfies CoverageEntry;

function manifestOf(...entries: readonly unknown[]): unknown {
  return [{ heading: "Example", level: 2, groups: [{ entries }] }];
}

function parseIssues(manifest: unknown): string[] {
  const result = coverageManifestSchema.safeParse(manifest);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

function expectSchemaParseSuccess(manifest: unknown): void {
  expect(parseIssues(manifest)).toEqual([]);
}

function expectParseFailure(manifest: unknown, fragment: string): void {
  const issues = parseIssues(manifest);
  expect(issues.join("\n")).toContain(fragment);
}

describe("coverageManifestSchema", () => {
  it("accepts the canonical shape of a hand-asserted entry", () => {
    expectSchemaParseSuccess(manifestOf(BASE_ENTRY));
  });

  it("rejects a status part outside the coverage vocabulary", () => {
    const issues = parseIssues(manifestOf({ ...BASE_ENTRY, status: ["lintd"] }));
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects a row whose `normalLint.covered` disagrees with its `linted` status", () => {
    expectParseFailure(
      manifestOf({ ...BASE_ENTRY, normalLint: { covered: false } }),
      "says normal lint does not cover it but its status is `linted`",
    );
    expectParseFailure(
      manifestOf({ ...BASE_ENTRY, normalLint: { covered: true }, status: ["ratcheted"] }),
      "says normal lint covers it but its status is `ratcheted`",
    );
  });

  it("rejects a row mixing lint-target and non-lint-target status parts", () => {
    expectParseFailure(
      manifestOf({
        ...BASE_ENTRY,
        normalLint: { covered: false },
        status: ["ratcheted", "excluded"],
      }),
      "mixes lint-target and non-lint-target status parts: ratcheted + excluded",
    );
  });

  it("accepts composed adoption-stage status parts", () => {
    expectSchemaParseSuccess(
      manifestOf({ ...BASE_ENTRY, status: ["linted", "ratcheted", "proposed"] }),
    );
  });

  it("requires exactly one of `derived` and the asserted `files`/`ratchets` cells", () => {
    // Asserted row that also claims to be derived: both cells double-declared.
    expectParseFailure(
      manifestOf({ ...BASE_ENTRY, derived: "drift-ai" }),
      "`files` is asserted by hand-maintained rows and rendered for `derived` rows",
    );
    // Derived row that omits both: accepted, because the generator renders them.
    const { files: _files, ratchets: _ratchets, ...withoutAsserted } = BASE_ENTRY;
    expectSchemaParseSuccess(manifestOf({ ...withoutAsserted, derived: "drift-ai" }));
    // Hand-maintained row that omits the asserted ratchet prose: nothing would
    // render that cell.
    expectParseFailure(
      manifestOf(withoutAsserted),
      "`files` is asserted by hand-maintained rows and rendered for `derived` rows",
    );
  });

  it("rejects a ratchet reference the checker's id lexer would not see", () => {
    // The checker lexes claims with /ratchet\/[a-z0-9-]+/g and validates each
    // hit against the live registry. A reference that pattern cannot see reads
    // as a claim in the rendered cell and validates as no claim at all, so the
    // schema refuses it rather than letting it through as prose.
    for (const ratchets of [
      "`ratchet/Local-Type-Assertion-Boundary`",
      "`ratchets/local-type-assertion-boundary`",
      "`ratchet/local_type_assertion_boundary`",
      "`ratchet/`",
    ]) {
      expectParseFailure(
        manifestOf({ ...BASE_ENTRY, ratchets }),
        "is not a well-formed `ratchet/<id>` reference",
      );
    }
    // A malformed id the lexer *can* see is fine here — the checker reports it
    // against the registry as an unknown ratchet.
    expectSchemaParseSuccess(manifestOf({ ...BASE_ENTRY, ratchets: "`ratchet/no-such-id`" }));
    // Ordinary prose, several ids in one cell, and non-ratchet floors all pass.
    expectSchemaParseSuccess(
      manifestOf({
        ...BASE_ENTRY,
        ratchets:
          "`ratchet/local-type-assertion-boundary`, `ratchet/vitest-valid-expect-script-tests`; no other ratchet applies",
      }),
    );
  });

  it("rejects globs that are not repo-rooted minimatch patterns", () => {
    for (const glob of ["/scripts/example.ts", "./scripts/example.ts", "scripts/../example.ts"]) {
      expectParseFailure(
        manifestOf({ ...BASE_ENTRY, globs: [glob] }),
        "repo-rooted minimatch patterns",
      );
    }
    expectSchemaParseSuccess(manifestOf({ ...BASE_ENTRY, globs: ["scripts/**/*.{ts,tsx}"] }));
  });

  it("rejects entry ids that are not lowercase kebab-case", () => {
    for (const id of ["Example-Entry", "example_entry", "example--entry", "-example"]) {
      expectParseFailure(manifestOf({ ...BASE_ENTRY, id }), "lowercase kebab-case");
    }
  });

  it("rejects duplicate entry ids across sections", () => {
    const sections: unknown = [
      { heading: "First", level: 2, groups: [{ entries: [BASE_ENTRY] }] },
      { heading: "Second", level: 3, groups: [{ entries: [BASE_ENTRY] }] },
    ];
    expectParseFailure(sections, "duplicate coverage-map entry id `example-entry`");
  });

  it("rejects unknown entry keys rather than silently dropping policy", () => {
    const issues = parseIssues(manifestOf({ ...BASE_ENTRY, statuss: ["linted"] }));
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a pure grouping section that carries no table", () => {
    const sections: readonly CoverageSection[] = [
      { heading: "Additional Script Families", level: 2, groups: [] },
    ];
    expectSchemaParseSuccess(sections);
  });
});

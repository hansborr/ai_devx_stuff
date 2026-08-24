import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAdrCheck } from "./adr-check.js";

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, contents: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function acceptedAdr(
  overrides: Partial<Record<"id" | "date" | "status" | "guide", string>> = {},
): string {
  return `---
id: ${overrides.id ?? "ADR-0001"}
date: ${overrides.date ?? "2026-07-20"}
status: ${overrides.status ?? "Accepted"}
enforced_by:
  - eslint-rule:local/concurrency-guard
  - restricted-import:RawTxClient
  - type-boundary:packages/server/src/utils/prisma-types.ts#TxClient
  - package-script:codemod:concurrency-guard
  - test-file:packages/server/src/routers/invite-concurrency.test.ts
guide: ${overrides.guide ?? "docs/guides/add-race-sensitive-mutation.md"}
---

# Race-sensitive writes use helpers

## Context

Concurrent writes can lose updates.

## Decision

Use the gated helper boundary.

## Consequences

The deterministic gates must stay linked.
`;
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "adr-check-"));
  fixtureRoots.push(root);
  write(root, "docs/adr/README.md", "# Architecture decisions\n");
  write(root, "docs/adr/0001-race-sensitive-writes.md", acceptedAdr());
  write(root, "docs/guides/add-race-sensitive-mutation.md", "# Repair guide\n");
  write(
    root,
    "package.json",
    JSON.stringify({ scripts: { "codemod:concurrency-guard": "bun scripts/codemod.ts" } }),
  );
  write(
    root,
    "eslint-rules/concurrency-guard.js",
    'export default { meta: { messages: { gated: "Why: ADR-0001 requires helpers. How to fix: use one." } } };\n',
  );
  write(
    root,
    "eslint-config/local-plugin.generated.js",
    'import concurrencyGuard from "../eslint-rules/concurrency-guard.js";\nexport const localPlugin = { rules: { "concurrency-guard": concurrencyGuard } };\n',
  );
  write(
    root,
    "eslint-config/package-boundary-configs.js",
    `// RawTxClient is named in comments and diagnostics as well as importNames.
export const rawTxClientBoundaryConfigs = [{
  rules: {
    "local/concurrency-guard": "error",
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/prisma-types.js"],
        importNames: ["RawTxClient"],
        message: "RawTxClient is restricted by ADR-0001",
      }],
    }],
  },
}];
`,
  );
  write(
    root,
    "eslint.config.js",
    'import { rawTxClientBoundaryConfigs } from "./eslint-config/package-boundary-configs.js";\nexport default [...rawTxClientBoundaryConfigs];\n',
  );
  write(
    root,
    "packages/server/src/utils/prisma-types.ts",
    "export type TxClient = { id: string };\n",
  );
  write(root, "packages/server/src/routers/invite-concurrency.test.ts", "// gate\n");
  return root;
}

function check(root: string): ReturnType<typeof runAdrCheck> {
  return runAdrCheck({ cwd: root });
}

describe("adr:check", () => {
  it("accepts the pilot shape and resolves every typed locator from real sources", () => {
    const result = check(createFixture());

    expect(result).toEqual({
      exitCode: 0,
      stdout: "adr:check OK — 1 ADR(s), 5 gate locator(s) checked.\n",
      stderr: "",
      failures: [],
    });
  });

  it("rejects malformed, missing, duplicate, and unknown frontmatter fields", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["must begin with frontmatter", acceptedAdr().replace("---\n", "")],
      ["missing closing frontmatter delimiter", acceptedAdr().replace("\n---\n\n#", "\n\n#")],
      ["missing required field 'guide'", acceptedAdr().replace(/guide: .*\n/, "")],
      ["unknown frontmatter field 'owner'", acceptedAdr().replace("guide:", "owner: team\nguide:")],
      ["duplicate frontmatter field 'id'", acceptedAdr().replace("date:", "id: ADR-0001\ndate:")],
      ["must be a list", acceptedAdr().replace("enforced_by:\n  -", "enforced_by: gate\n  -")],
      ["unsupported frontmatter syntax", acceptedAdr().replace("date:", " date:")],
    ];

    for (const [expected, contents] of cases) {
      const root = createFixture();
      write(root, "docs/adr/0001-race-sensitive-writes.md", contents);
      expect(check(root).stderr, expected).toContain(expected);
    }
  });

  it("rejects invalid filenames, duplicate IDs, dates, statuses, guides, and body shape", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["unsupported file in docs/adr", "docs/adr/TEMPLATE.md", "template"],
      ["filename number 0002 does not match ADR-0001", "docs/adr/0002-other.md", acceptedAdr()],
      [
        "invalid calendar date '2026-02-30'",
        "docs/adr/0001-race-sensitive-writes.md",
        acceptedAdr({ date: "2026-02-30" }),
      ],
      [
        "invalid status 'Active'",
        "docs/adr/0001-race-sensitive-writes.md",
        acceptedAdr({ status: "Active" }),
      ],
      [
        "guide does not resolve",
        "docs/adr/0001-race-sensitive-writes.md",
        acceptedAdr({ guide: "docs/guides/missing.md" }),
      ],
      [
        "missing required heading '## Decision'",
        "docs/adr/0001-race-sensitive-writes.md",
        acceptedAdr().replace("## Decision", "## Choice"),
      ],
    ];

    for (const [expected, path, contents] of cases) {
      const root = createFixture();
      write(root, path, contents);
      expect(check(root).stderr, expected).toContain(expected);
    }

    const duplicateRoot = createFixture();
    write(duplicateRoot, "docs/adr/0002-duplicate.md", acceptedAdr());
    expect(check(duplicateRoot).stderr).toContain("duplicate ADR id ADR-0001");
  });

  it("requires accepted ADR gates to be non-empty and unique", () => {
    const emptyRoot = createFixture();
    write(
      emptyRoot,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr().replace(/enforced_by:\n(?: {2}- .*\n)+/, "enforced_by:\n"),
    );
    expect(check(emptyRoot).stderr).toContain(
      "Accepted ADR requires at least one enforced_by locator",
    );

    const duplicateRoot = createFixture();
    write(
      duplicateRoot,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr().replace(
        "  - restricted-import:RawTxClient\n",
        "  - eslint-rule:local/concurrency-guard\n",
      ),
    );
    expect(check(duplicateRoot).stderr).toContain("duplicate enforced_by locator");
  });

  it("rejects unknown and broken locators with repair-oriented diagnostics", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["unknown locator kind 'mystery'", "eslint-rule:local/concurrency-guard", "mystery:gate"],
      ["local ESLint rule file does not resolve", "concurrency-guard", "missing-rule"],
      ["restricted import pattern does not resolve uniquely", "RawTxClient", "OtherClient"],
      [
        "type-boundary file does not resolve",
        "packages/server/src/utils/prisma-types.ts",
        "packages/server/src/utils/missing.ts",
      ],
      ["exported symbol 'MissingType' does not resolve", "#TxClient", "#MissingType"],
      [
        "package script 'codemod:missing' does not resolve",
        "codemod:concurrency-guard",
        "codemod:missing",
      ],
      ["test file does not resolve", "invite-concurrency.test.ts", "missing.test.ts"],
    ];

    for (const [expected, from, to] of cases) {
      const root = createFixture();
      write(root, "docs/adr/0001-race-sensitive-writes.md", acceptedAdr().replace(from, to));
      expect(check(root).stderr, expected).toContain(expected);
    }
  });

  it("resolves restricted imports structurally and requires the root config spread", () => {
    const root = createFixture();
    write(
      root,
      "eslint.config.js",
      'import { rawTxClientBoundaryConfigs } from "./eslint-config/package-boundary-configs.js";\nexport default [];\n',
    );

    expect(check(root).stderr).toContain(
      "rawTxClientBoundaryConfigs must be imported and spread into eslint.config.js",
    );
  });

  // The generated plugin quotes a rule key only when the id is not already an
  // identifier: scripts/harness/generate-local-plugin.ts emits a single-word id
  // as a BARE key so the render stays a prettier fixed point (pinned against
  // real prettier in generate-local-plugin.test.ts). Registration is therefore
  // read structurally — a `"<name>"` byte match would report a correctly
  // generated registration as unresolved for exactly the id shape the generator
  // is written to support.
  it("resolves a plugin registration whose generated key is unquoted", () => {
    const root = createFixture();
    write(root, "eslint-rules/complexity.js", "export default {};\n");
    write(
      root,
      "eslint-config/local-plugin.generated.js",
      `import complexity from "../eslint-rules/complexity.js";
import concurrencyGuard from "../eslint-rules/concurrency-guard.js";

export const localPlugin = {
  rules: {
    complexity: complexity,
    "concurrency-guard": concurrencyGuard,
  },
};
`,
    );
    write(
      root,
      "eslint-config/complexity-configs.js",
      'export const complexityConfigs = [{ rules: { "local/complexity": "error" } }];\n',
    );
    write(
      root,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr().replace("eslint-rule:local/concurrency-guard", "eslint-rule:local/complexity"),
    );

    expect(check(root)).toEqual({
      exitCode: 0,
      stdout: "adr:check OK — 1 ADR(s), 5 gate locator(s) checked.\n",
      stderr: "",
      failures: [],
    });
  });

  it("validates supersession targets and rejects active references to superseded ADRs", () => {
    const validRoot = createFixture();
    write(
      validRoot,
      "docs/adr/0002-replacement.md",
      acceptedAdr({ id: "ADR-0002", status: "Proposed" }).replace(
        /enforced_by:\n(?: {2}- .*\n)+/,
        "enforced_by:\n",
      ),
    );
    write(
      validRoot,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr({ status: "Superseded by ADR-0002" }).replace(
        /enforced_by:\n(?: {2}- .*\n)+/,
        "enforced_by:\n",
      ),
    );
    write(validRoot, "eslint-rules/concurrency-guard.js", "export default {};\n");
    write(
      validRoot,
      "eslint-config/package-boundary-configs.js",
      readFileSync(join(validRoot, "eslint-config/package-boundary-configs.js"), "utf8").replace(
        "ADR-0001",
        "architecture decision",
      ),
    );
    expect(check(validRoot).exitCode).toBe(0);

    const activeRoot = createFixture();
    write(
      activeRoot,
      "docs/adr/0002-replacement.md",
      acceptedAdr({ id: "ADR-0002", status: "Proposed" }).replace(
        /enforced_by:\n(?: {2}- .*\n)+/,
        "enforced_by:\n",
      ),
    );
    write(
      activeRoot,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr({ status: "Superseded by ADR-0002" }),
    );
    expect(check(activeRoot).stderr).toContain("active gate references superseded ADR-0001");

    const missingRoot = createFixture();
    write(
      missingRoot,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr({ status: "Superseded by ADR-0009" }),
    );
    expect(check(missingRoot).stderr).toContain("superseding target ADR-0009 does not exist");

    const selfRoot = createFixture();
    write(
      selfRoot,
      "docs/adr/0001-race-sensitive-writes.md",
      acceptedAdr({ status: "Superseded by ADR-0001" }),
    );
    expect(check(selfRoot).stderr).toContain("cannot supersede itself");
  });

  it("checks active references while excluding tests, fixtures, generated files, and process docs", () => {
    const excludedRoot = createFixture();
    for (const path of [
      "scripts/example.test.ts",
      "scripts/fixtures/sample.ts",
      "packages/server/src/generated/output.ts",
      "docs/agent_notes/history.md",
    ]) {
      write(excludedRoot, path, "// ADR-9999 historical fixture\n");
    }
    expect(check(excludedRoot).exitCode).toBe(0);

    write(excludedRoot, "packages/server/src/service.ts", "// ADR-9999 active gate\n");
    expect(check(excludedRoot).stderr).toContain("active reference ADR-9999 does not resolve");
  });

  it("rejects malformed active references with more than four digits", () => {
    const root = createFixture();
    write(root, "packages/server/src/service.ts", "// ADR-00010 active gate\n");

    expect(check(root).stderr).toContain("invalid active reference ADR-00010");
  });
});

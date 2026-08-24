import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectSmokeSubjectDefinitions,
  renderAllSmokeTestsFixture,
  renderSmokeSubjectsData,
} from "./smoke-subject-headers.js";

describe("smoke subject headers", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "smoke-subject-headers-"));
    mkdirSync(join(repoRoot, "scripts", "tests"), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeSmoke(name: string, body: string): void {
    writeFileSync(join(repoRoot, "scripts", "tests", `${name}.sh`), body);
  }

  it("collects subjects from test-file headers and keeps run order separate from filename order", () => {
    writeSmoke(
      "test-zeta",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts/zeta.sh",
        "# smoke-subjects: scripts/tests/test-zeta.sh",
        "",
      ].join("\n"),
    );
    writeSmoke(
      "test-alpha",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 020",
        "# smoke-subjects: scripts/alpha.sh scripts/tests/test-alpha.sh",
        "",
      ].join("\n"),
    );

    const definitions = collectSmokeSubjectDefinitions(repoRoot);

    expect(definitions.map((definition) => definition.name)).toEqual(["test-zeta", "test-alpha"]);
    expect(renderSmokeSubjectsData(definitions)).toContain(
      [
        '  "test-zeta": [',
        '    "scripts/zeta.sh",',
        '    "scripts/tests/test-zeta.sh",',
        "  ],",
        '  "test-alpha": [',
      ].join("\n"),
    );
    expect(renderAllSmokeTestsFixture(definitions)).toBe(
      ["runner ran test-alpha", "runner ran test-zeta", ""].join("\n"),
    );
  });

  it("projects generated outputs from in-memory smoke source overrides", () => {
    writeSmoke(
      "test-alpha",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts/tests/test-alpha.sh",
        "",
      ].join("\n"),
    );

    const definitions = collectSmokeSubjectDefinitions(
      repoRoot,
      new Map([
        [
          "scripts/tests/test-alpha.sh",
          [
            "#!/usr/bin/env bash",
            "# smoke-order: 010",
            "# smoke-subjects: generated/input.ts",
            "# smoke-subjects: scripts/tests/test-alpha.sh",
            "",
          ].join("\n"),
        ],
      ]),
    );

    expect(definitions[0]?.subjects).toEqual(["generated/input.ts", "scripts/tests/test-alpha.sh"]);
  });

  it("rejects a repo root with no scripts/tests tree, naming the root it scanned", () => {
    rmSync(join(repoRoot, "scripts", "tests"), { recursive: true });

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      `scripts/tests does not exist under ${repoRoot}`,
    );
    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "empty smoke registry and an empty all-smoke-tests fixture",
    );
  });

  it("rejects an existing scripts/tests tree that holds no smoke scripts", () => {
    writeFileSync(join(repoRoot, "scripts", "tests", "notes.md"), "not a smoke test\n");
    // A shell script whose basename does not match `test-*.sh` is invisible to
    // discovery, so the diagnostic must name the pattern rather than `*.sh`.
    writeFileSync(join(repoRoot, "scripts", "tests", "smoke-alpha.sh"), "exit 0\n");

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests exists but contains no test-*.sh smoke tests",
    );
    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "empty smoke registry and an empty all-smoke-tests fixture",
    );
  });

  it("rejects a smoke file without a smoke-subjects header", () => {
    writeSmoke(
      "test-missing-header",
      ["#!/usr/bin/env bash", "# smoke-order: 010", "exit 0", ""].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-missing-header.sh must declare at least one # smoke-subjects: header",
    );
  });

  it("requires the smoke file to own itself as a changed-mode subject", () => {
    writeSmoke(
      "test-no-self-subject",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts/no-self-subject.sh",
        "",
      ].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-no-self-subject.sh smoke-subjects must include scripts/tests/test-no-self-subject.sh",
    );
  });

  it("rejects duplicate smoke-subject entries", () => {
    writeSmoke(
      "test-duplicate-subject",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts/tests/test-duplicate-subject.sh",
        "# smoke-subjects: scripts/tests/test-duplicate-subject.sh",
        "",
      ].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-duplicate-subject.sh smoke-subjects contains duplicate subjects",
    );
  });

  it("rejects more than one smoke-order in a single smoke file", () => {
    writeSmoke(
      "test-duplicate-order-header",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-order: 020",
        "# smoke-subjects: scripts/tests/test-duplicate-order-header.sh",
        "",
      ].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-duplicate-order-header.sh:3 declares more than one smoke-order",
    );
  });

  it("rejects duplicate smoke-order values across smoke files", () => {
    writeSmoke(
      "test-alpha",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts/tests/test-alpha.sh",
        "",
      ].join("\n"),
    );
    writeSmoke(
      "test-beta",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts/tests/test-beta.sh",
        "",
      ].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-beta.sh and scripts/tests/test-alpha.sh both declare smoke-order 10",
    );
  });

  it("rejects absolute smoke-subject paths", () => {
    writeSmoke(
      "test-absolute-subject",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: /scripts/bad.sh",
        "# smoke-subjects: scripts/tests/test-absolute-subject.sh",
        "",
      ].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-absolute-subject.sh:3 smoke-subjects must be repo-relative POSIX paths: /scripts/bad.sh",
    );
  });

  it("rejects smoke-subject paths with backslashes", () => {
    writeSmoke(
      "test-backslash-subject",
      [
        "#!/usr/bin/env bash",
        "# smoke-order: 010",
        "# smoke-subjects: scripts\\bad.sh",
        "# smoke-subjects: scripts/tests/test-backslash-subject.sh",
        "",
      ].join("\n"),
    );

    expect(() => collectSmokeSubjectDefinitions(repoRoot)).toThrow(
      "scripts/tests/test-backslash-subject.sh:3 smoke-subjects must be repo-relative POSIX paths: scripts\\bad.sh",
    );
  });
});

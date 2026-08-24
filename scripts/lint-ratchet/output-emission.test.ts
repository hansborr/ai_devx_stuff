import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { HarnessDiagnostics } from "@musi/harness-diagnostics/schema.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";
import { describe, expect, it, vi } from "vitest";

import { validateSeedImportClosure } from "../import-closure/closure-walk.js";
import { emitHarnessDiagnosticsEnvelope } from "./output.js";
import {
  ADAPTER_SUPPORT_FILES,
  lintRatchetAdapterFiles,
  makeFixture,
  perTestTmpRepo,
  repoRoot,
  writeFixtureRatchetConfig,
} from "./output-fixture.test-helper.js";

describe("lint ratchet output fixture copy closure", () => {
  it("keeps generated ESLint config caches fixture-local", () => {
    const fixtureRoot = makeFixture();
    const fixtureNodeModules = join(fixtureRoot, "node_modules");
    const fixtureCache = join(fixtureNodeModules, ".cache");

    // These lstat guards pin the isolation half of linkFixtureNodeModules's cross-worker contract.
    expect(lstatSync(fixtureNodeModules).isDirectory()).toBe(true);
    expect(lstatSync(fixtureNodeModules).isSymbolicLink()).toBe(false);
    expect(lstatSync(fixtureCache).isDirectory()).toBe(true);
    expect(lstatSync(fixtureCache).isSymbolicLink()).toBe(false);
  });

  it("lists every repository-local adapter runtime import", () => {
    const entry = "scripts/lint-ratchet.ts";
    const fixtureConfig = "scripts/lint-ratchet/lint-ratchet-config.ts";
    expect(ADAPTER_SUPPORT_FILES).toContain(entry);
    const { violations } = validateSeedImportClosure({
      root: repoRoot,
      entry,
      allowedRoots: [],
      allowedFiles: [...ADAPTER_SUPPORT_FILES, ...lintRatchetAdapterFiles(), fixtureConfig],
      terminalFiles: [fixtureConfig],
      externalPackages: ["@musi/harness-diagnostics", "@musi/lint-ratchet"],
      nonStaticSpecifiers: "skip",
    });

    expect(violations).toEqual([]);
  });
});

// The old fixture runtime derivation and copy manifest remain deleted (leaf 02
// S3/S5). The focused assertion above protects only the still-copied Musi
// adapter's static repository-local imports; package self-containment stays with
// the package's §2 structural checks and the demo consumer.

// The five acceptance fixture writers (this Vitest helper plus the four shell
// heredocs) used to emit private facsimiles of the package's config-type module
// ahead of their two value exports, and every copy had drifted from the
// authority. They now emit the same type-only import the real registry uses, so
// a sandbox registry reads like a real adopter's and evolving the authority's
// types needs no fixture edits. Nothing typechecks the emitted configs, so this
// guard is what keeps a future writer from reintroducing a local copy.
const SHELL_ACCEPTANCE_SUITE = "scripts/tests/test-lint-ratchet.sh";
const SHELL_CONFIG_WRITERS = [
  "write_third_party_config",
  "write_core_config",
  "write_max_lines_config",
  "write_type_assertion_config",
] as const;
const CONFIG_TYPE_IMPORT_HEADER = [
  "import type {",
  "  LintRatchetConfig,",
  "  LintRatchetThirdPartyPluginAllowlistEntry,",
  '} from "@musi/lint-ratchet/kernel/config-types.js";',
].join("\n");
// Any re-declaration of the authority's vocabulary, exported or not.
const PRIVATE_CONFIG_TYPE_DECLARATION =
  /^(?:export )?(?:type|interface) (?:Json|LintRatchet)\w*/gmu;

function shellFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`\n${name}() {\n`);
  expect(start, `${name} not found in ${SHELL_ACCEPTANCE_SUITE}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}\n", start);
  expect(end, `${name} has no closing brace in ${SHELL_ACCEPTANCE_SUITE}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("lint ratchet fixture registry authoring surface", () => {
  it("mirrors the real registry's type-only config-type import", () => {
    const registry = readFileSync(
      join(repoRoot, "scripts/lint-ratchet/lint-ratchet-config.ts"),
      "utf8",
    );

    expect(registry.startsWith(`${CONFIG_TYPE_IMPORT_HEADER}\n`)).toBe(true);
  });

  it("emits the shared import instead of a private type copy from the Vitest writer", () => {
    const fixtureRoot = perTestTmpRepo.makeTempRepo();
    mkdirSync(join(fixtureRoot, "scripts/lint-ratchet"), { recursive: true });

    writeFixtureRatchetConfig(fixtureRoot);

    const emitted = readFileSync(
      join(fixtureRoot, "scripts/lint-ratchet/lint-ratchet-config.ts"),
      "utf8",
    );
    expect(emitted.startsWith(`${CONFIG_TYPE_IMPORT_HEADER}\n`)).toBe(true);
    expect(emitted.match(PRIVATE_CONFIG_TYPE_DECLARATION)).toBeNull();
    expect(emitted).toContain(
      "export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[]",
    );
    expect(emitted).toContain("] as const satisfies readonly LintRatchetConfig[];");
  });

  it("emits the shared import instead of a private type copy from every shell writer", () => {
    const suite = readFileSync(join(repoRoot, SHELL_ACCEPTANCE_SUITE), "utf8");

    for (const writer of SHELL_CONFIG_WRITERS) {
      const body = shellFunctionBody(suite, writer);
      expect(body, writer).toContain(CONFIG_TYPE_IMPORT_HEADER);
      expect(body.match(PRIVATE_CONFIG_TYPE_DECLARATION), writer).toBeNull();
      expect(body, writer).toContain("] as const satisfies readonly LintRatchetConfig[];");
    }
  });
});

describe("lint ratchet envelope emission adapter", () => {
  it("re-raises a malformed envelope as ConfigError without writing stdout", () => {
    // type-assertion-boundary: test - exercises runtime rejection of a summary
    // that disagrees with findings, which the static type forbids.
    const invalid = {
      version: "1",
      tool: "lint:ratchet",
      findings: [],
      summary: { blocking: 3, warning: 0, info: 0, byControl: {} },
    } as unknown as HarnessDiagnostics;
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(() => {
      emitHarnessDiagnosticsEnvelope(invalid);
    }).toThrow(ConfigError);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { checkManifestReadTripwire, MANIFEST_DIRECT_READERS } from "./manifest-contract-check.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const tmpRepo = registerTempRootCleanup();

const READ_IMPORT = 'import { loadHarnessManifest } from "./harness/harness-manifest.js";\n';
const PATH_IMPORT = 'import { HARNESS_MANIFEST_FILENAME } from "./harness/harness-manifest.js";\n';

// Ordinary cooperative-accident import forms that must all trip the wire:
// the tripwire guards against accidental bypass regrowth, so every way a
// TS author would plausibly reach a read-capable symbol needs coverage.
const READ_CAPABLE_FORMS: ReadonlyMap<string, string> = new Map([
  ["named-single-quoted", "import { readHarnessManifest } from './harness/harness-manifest.js';\n"],
  ["namespace", 'import * as manifest from "./harness/harness-manifest.js";\n'],
  ["namespace-single-quoted", "import * as manifest from './harness/harness-manifest.js';\n"],
  ["default", 'import manifest from "./harness/harness-manifest.js";\n'],
  [
    "default-plus-named",
    'import manifest, { loadHarnessManifest } from "./harness/harness-manifest.js";\n',
  ],
  [
    "dynamic-import",
    'export async function read(): Promise<unknown> {\n  const { readHarnessManifest } = await import("./harness/harness-manifest.js");\n  return readHarnessManifest(".");\n}\n',
  ],
  ["require", 'const { loadHarnessManifest } = require("./harness/harness-manifest.js");\n'],
  ["named-reexport", 'export { readHarnessManifest } from "./harness/harness-manifest.js";\n'],
  ["star-reexport", 'export * from "./harness/harness-manifest.js";\n'],
]);

describe("checkManifestReadTripwire", () => {
  it("passes on the real tree: the direct-reader population is frozen", () => {
    expect(checkManifestReadTripwire(repoRoot)).toEqual([]);
  });

  it("flags a new unlisted read-capable importer and points at the typed seam", () => {
    const root = tmpRepo.writeRepo(
      { "scripts/new-consumer.ts": READ_IMPORT },
      "manifest-tripwire-",
    );

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/new-consumer.ts");
    expect(failures[0]).toContain("harness-manifest-loader.ts");
    expect(failures[0]).toContain("docs/guides/harness-manifest-parser.md");
  });

  for (const [form, source] of READ_CAPABLE_FORMS) {
    it(`flags an unlisted ${form} import of a read-capable symbol`, () => {
      const root = tmpRepo.writeRepo(
        { "scripts/new-consumer.ts": source },
        `manifest-tripwire-${form}-`,
      );

      const failures = checkManifestReadTripwire(root);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("scripts/new-consumer.ts");
    });
  }

  it("flags a re-export intermediary itself, covering importers of the intermediary", () => {
    // A consumer that imports read symbols from an intermediary module never
    // names harness-manifest.js, so the scan cannot see it. Coverage instead
    // comes from the intermediary being a scanned non-test file under
    // scripts/: its re-export trips the wire, so the indirection cannot exist
    // without a conscious MANIFEST_DIRECT_READERS entry for the intermediary.
    const root = tmpRepo.writeRepo(
      {
        "scripts/intermediary.ts":
          'export { readHarnessManifest } from "./harness/harness-manifest.js";\n',
        "scripts/consumer.ts":
          'import { readHarnessManifest } from "./intermediary.js";\nexport const value = readHarnessManifest(".");\n',
      },
      "manifest-tripwire-intermediary-",
    );

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/intermediary.ts");
  });

  it("does not report an allowlisted reader using single quotes as stale", () => {
    const [allowlisted] = MANIFEST_DIRECT_READERS.keys();
    const root = tmpRepo.writeRepo(
      {
        [allowlisted ?? "scripts/harness-check.ts"]:
          "import { readHarnessManifest } from './harness/harness-manifest.js';\n",
      },
      "manifest-tripwire-quote-style-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("ignores type-only imports of read-capable names", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/type-only.ts":
          'import type { readHarnessManifest } from "./harness/harness-manifest.js";\nexport type Reader = typeof readHarnessManifest;\n',
      },
      "manifest-tripwire-type-only-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("ignores inline type-specifier imports of read-capable names", () => {
    // `import { type X }` erases exactly like `import type { X }`; only the
    // inline-type spelling used to false-trip the named arm.
    const root = tmpRepo.writeRepo(
      {
        "scripts/inline-type.ts":
          'import { type readHarnessManifest } from "./harness/harness-manifest.js";\nexport type Reader = typeof readHarnessManifest;\n',
      },
      "manifest-tripwire-inline-type-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("ignores inline type-specifier re-exports of read-capable names", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/inline-type-reexport.ts":
          'export { type readHarnessManifest } from "./harness/harness-manifest.js";\n',
      },
      "manifest-tripwire-inline-type-reexport-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("still flags a runtime symbol imported alongside an inline type specifier", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/mixed-inline-type.ts":
          'import { type readHarnessManifest, loadHarnessManifest } from "./harness/harness-manifest.js";\nexport const controls = loadHarnessManifest(".");\n',
      },
      "manifest-tripwire-mixed-inline-type-",
    );

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/mixed-inline-type.ts");
  });

  it("flags backtick static-string specifiers in dynamic import and require", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/backtick-dynamic.ts":
          "export async function read(): Promise<unknown> {\n  const { readHarnessManifest } = await import(`./harness/harness-manifest.js`);\n  return readHarnessManifest('.');\n}\n",
        "scripts/backtick-require.ts":
          "const { loadHarnessManifest } = require(`./harness/harness-manifest.js`);\n",
      },
      "manifest-tripwire-backtick-",
    );

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(2);
    expect(failures.join("\n")).toContain("scripts/backtick-dynamic.ts");
    expect(failures.join("\n")).toContain("scripts/backtick-require.ts");
  });

  it("scans every walkable source extension, not only .ts", () => {
    const walkableConsumers = {
      "scripts/consumer-a.tsx": READ_IMPORT,
      "scripts/consumer-b.mts": READ_IMPORT,
      "scripts/consumer-c.cts": READ_IMPORT,
      "scripts/consumer-d.js": READ_IMPORT,
      "scripts/consumer-e.mjs": READ_IMPORT,
      "scripts/consumer-f.cjs":
        'const { loadHarnessManifest } = require("./harness/harness-manifest.js");\n',
    };
    const root = tmpRepo.writeRepo(walkableConsumers, "manifest-tripwire-extensions-");

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(Object.keys(walkableConsumers).length);
    for (const path of Object.keys(walkableConsumers)) {
      expect(failures.join("\n")).toContain(path);
    }
  });

  it("still ignores test files across the widened extensions", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/probe.test.tsx": READ_IMPORT,
        "scripts/probe.test.mjs": READ_IMPORT,
      },
      "manifest-tripwire-widened-tests-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("ignores commented-out read-capable imports", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/line-commented.ts":
          '// import { readHarnessManifest } from "./harness/harness-manifest.js";\nexport const nothing = true;\n',
        "scripts/block-commented.ts":
          '/*\nimport { loadHarnessManifest } from "./harness/harness-manifest.js";\n*/\nexport const nothing = true;\n',
      },
      "manifest-tripwire-commented-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("still flags a real import that follows a comment block", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/after-comment.ts":
          "/* explanatory block */\n" +
          '// import { readHarnessManifest } from "./harness/harness-manifest.js";\n' +
          READ_IMPORT,
      },
      "manifest-tripwire-after-comment-",
    );

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/after-comment.ts");
  });

  it("ignores path-only imports of the manifest filename constant", () => {
    const root = tmpRepo.writeRepo(
      { "scripts/path-only.ts": PATH_IMPORT },
      "manifest-tripwire-path-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("ignores test files and skipped directories", () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/new-consumer.test.ts": READ_IMPORT,
        "scripts/tests/probe.ts": READ_IMPORT,
        "scripts/fixtures/copy.ts": READ_IMPORT,
      },
      "manifest-tripwire-scope-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });

  it("flags a stale allowlist entry whose file no longer imports a read symbol", () => {
    const [allowlisted] = MANIFEST_DIRECT_READERS.keys();
    const root = tmpRepo.writeRepo(
      { [allowlisted ?? "scripts/harness-check.ts"]: PATH_IMPORT },
      "manifest-tripwire-stale-",
    );

    const failures = checkManifestReadTripwire(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no longer imports a read-capable symbol");
  });

  it("skips allowlisted files absent from reduced trees", () => {
    const root = tmpRepo.writeRepo(
      { "scripts/unrelated.ts": "export const unrelated = true;\n" },
      "manifest-tripwire-reduced-",
    );

    expect(checkManifestReadTripwire(root)).toEqual([]);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DriftAiIgnoreConfig } from "./config.js";
import { runModuleDocPathsCheck } from "./module-doc-paths.js";
import { defaultListModuleDocs, isModuleDocPath } from "./module-doc-paths-io.js";

const DEFAULT_ROOTS = ["packages/server/src", "packages/client/src"];

type RunFixture = {
  readonly docs: Record<string, string>;
  readonly existing?: readonly string[];
  readonly roots?: readonly string[];
  readonly ignored?: readonly string[];
  readonly excludeGlobs?: readonly string[];
  // Omit the injected ignore probe to exercise the real git check-ignore default.
  readonly realIgnore?: boolean;
  readonly repoRoot?: string;
};

function run(fixture: RunFixture) {
  const existing = new Set(fixture.existing ?? []);
  const ignored = new Set(fixture.ignored ?? []);
  return runModuleDocPathsCheck({
    roots: fixture.roots ?? DEFAULT_ROOTS,
    listModuleDocs: () => Object.keys(fixture.docs),
    readFile: (repoRelativePath) => fixture.docs[repoRelativePath],
    pathExists: (repoRelativePath) => existing.has(repoRelativePath),
    ...(fixture.realIgnore === true ? {} : { isIgnored: (p) => ignored.has(p) }),
    ...(fixture.excludeGlobs === undefined ? {} : { excludeGlobs: fixture.excludeGlobs }),
    ...(fixture.repoRoot === undefined ? {} : { repoRoot: fixture.repoRoot }),
  });
}

describe("runModuleDocPathsCheck", () => {
  it("returns no findings when every file reference resolves under a candidate base", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": [
          // module-dir relative (dotted)
          "- `./auth-middleware.ts` validates the socket session.",
          // package-src relative
          "- `utils/socket-helpers.ts` exposes the optional server.",
          // NodeNext `.js` specifier resolving to the `.ts` source
          "- `./broadcast-registry.js` validates payloads.",
          // repo-root relative
          "- see `docs/CONCURRENCY.md` for invariants.",
          // not paths: package specifier, member access, event name
          "- `@musi/shared/schemas/socket-events.ts`, `socket.broadcast`, `presence:heartbeat`.",
        ].join("\n"),
      },
      existing: [
        "packages/server/src/socket/auth-middleware.ts",
        "packages/server/src/utils/socket-helpers.ts",
        "packages/server/src/socket/broadcast-registry.ts",
        "docs/CONCURRENCY.md",
      ],
    });

    expect(findings).toEqual([]);
  });

  it("flags a multi-segment file reference that resolves under no base", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "uses `utils/missing-helper.ts` for delivery.",
      },
    });

    expect(findings).toEqual([
      {
        check: "module-doc-paths",
        file: "packages/server/src/socket/MODULE.md:1",
        message: "backtick path utils/missing-helper.ts does not resolve to a file",
        hint: "update the reference to the file's new location, or remove it if the file was deleted.",
        details: { line: 1, path: "utils/missing-helper.ts" },
      },
    ]);
  });

  it("resolves `../` references against the module directory only, not other bases", () => {
    // The real file exists under the package src root, but a `../../lib` ref from
    // `.../homebrew/collections` points at `.../homebrew/lib` — genuine drift.
    const findings = run({
      roots: ["packages/client/src"],
      docs: {
        "packages/client/src/components/homebrew/collections/MODULE.md":
          "talks to `../../lib/trpc.js` for server calls.",
      },
      existing: ["packages/client/src/lib/trpc.ts"],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.details).toEqual({ line: 1, path: "../../lib/trpc.js" });
  });

  it("resolves shared-sibling references against the parent directory", () => {
    const findings = run({
      roots: ["packages/client/src"],
      docs: {
        "packages/client/src/components/homebrew/background/MODULE.md":
          "renders `entries/entry-dialog.tsx`.",
      },
      existing: ["packages/client/src/components/homebrew/entries/entry-dialog.tsx"],
    });

    expect(findings).toEqual([]);
  });

  it("ignores references inside fenced code blocks", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": [
          "```ts",
          "import x from `utils/example-only.ts`;",
          "```",
          "and `utils/real.ts`.",
        ].join("\n"),
      },
      existing: ["packages/server/src/utils/real.ts"],
    });

    expect(findings).toEqual([]);
  });

  it("does not flag single-segment, directory, or member-access tokens", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": [
          "single `connection-handler.ts`",
          "member `character.get` and `socket.broadcast`",
          "directory `services/rest/`",
        ].join("\n"),
      },
    });

    expect(findings).toEqual([]);
  });

  it("treats a `.js` reference with no `.ts` source as stale", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "imports `utils/gone.js`.",
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.details).toEqual({ line: 1, path: "utils/gone.js" });
  });

  it("skips a stale reference when every resolved path is gitignored", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "loads `dist/bundle.js`.",
      },
      ignored: [
        "packages/server/src/socket/dist/bundle.js",
        "packages/server/src/dist/bundle.js",
        "packages/server/dist/bundle.js",
        "packages/client/src/dist/bundle.js",
        "packages/client/dist/bundle.js",
        "dist/bundle.js",
      ],
    });

    expect(findings).toEqual([]);
  });

  it("still reports a stale multi-base reference when only one candidate is gitignored", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "loads `tmp/missing-helper.ts`.",
      },
      ignored: ["tmp/missing-helper.ts"],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.details).toEqual({ line: 1, path: "tmp/missing-helper.ts" });
  });

  it("does not flag a `../` reference that escapes the repo under every base", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "see `../../../../../../outside.ts`.",
      },
    });

    expect(findings).toEqual([]);
  });

  it("deduplicates a reference repeated on the same line", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "`utils/gone.ts` then again `utils/gone.ts`.",
      },
    });

    expect(findings).toHaveLength(1);
  });

  it("skips MODULE.md docs matched by excludeGlobs", () => {
    const findings = run({
      docs: {
        "packages/server/src/socket/MODULE.md": "stale `utils/gone.ts`.",
      },
      excludeGlobs: ["packages/server/src/socket/MODULE.md"],
    });

    expect(findings).toEqual([]);
  });

  it("emits findings sorted by doc path and resolves the default ignore probe via git", () => {
    // No injected isIgnored: exercises the real git check-ignore default against the
    // live repo root. The fabricated paths are not gitignored, so the stale refs
    // are emitted; ordering follows the sorted doc list.
    const findings = run({
      realIgnore: true,
      repoRoot: process.cwd(),
      roots: ["packages/server/src"],
      docs: {
        "packages/server/src/b/MODULE.md": "uses `helpers/zz-missing-b.ts`.",
        "packages/server/src/a/MODULE.md": "uses `helpers/zz-missing-a.ts`.",
      },
    });

    expect(findings.map((finding) => finding.file)).toEqual([
      "packages/server/src/a/MODULE.md:1",
      "packages/server/src/b/MODULE.md:1",
    ]);
  });
});

describe("isModuleDocPath", () => {
  it("matches MODULE.md and *-MODULE.md, rejects other markdown", () => {
    expect(isModuleDocPath("packages/server/src/socket/MODULE.md")).toBe(true);
    expect(isModuleDocPath("packages/server/src/services/rest-MODULE.md")).toBe(true);
    expect(isModuleDocPath("MODULE.md")).toBe(true);
    expect(isModuleDocPath("packages/server/src/README.md")).toBe(false);
    expect(isModuleDocPath("packages/server/src/socket/MODULE.mdx")).toBe(false);
  });
});

const EMPTY_IGNORE: DriftAiIgnoreConfig = { segments: ["node_modules"], prefixes: [], globs: [] };
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-module-doc-paths-"));
  tempRoots.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  return root;
}

describe("defaultListModuleDocs", () => {
  it("discovers module docs under the roots and ignores other files", () => {
    const repoRoot = writeRepo({
      "packages/server/src/socket/MODULE.md": "# socket\n",
      "packages/server/src/services/rest-MODULE.md": "# rest\n",
      "packages/server/src/services/README.md": "# readme\n",
      "packages/server/src/node_modules/dep/MODULE.md": "# vendored\n",
      "docs/MODULE.md": "# outside roots\n",
    });

    const docs = defaultListModuleDocs(repoRoot, ["packages/server/src"], EMPTY_IGNORE);

    expect(docs).toEqual([
      "packages/server/src/services/rest-MODULE.md",
      "packages/server/src/socket/MODULE.md",
    ]);
  });
});

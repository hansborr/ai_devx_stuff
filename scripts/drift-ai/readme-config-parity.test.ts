import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALL_CHECKS } from "./check-metadata.js";
import { DriftAiHelp, parseArgs } from "./cli-args.js";
import { PROTOTYPE_SUBCOMMAND_IDS } from "./prototype-subcommands.js";
import { TOP_LEVEL_SUBCOMMAND_IDS } from "./runner.js";
import { parseRuleSourceManifest } from "./semgrep-rule-manifest.js";

// Operator-doc parity guard. Metadata-vs-runtime registry parity is already pinned
// by `check-metadata.test.ts`; this file pins the operator-facing surfaces that the
// registry does not own and that several earlier tasks edited by hand: the
// `drift-ai.config.example.json` starter knobs, the `README.md` check and
// subcommand enumerations, and the README's internal backlog links. Adding a check
// id or a subcommand cannot silently leave these stale, and a removed backlog
// folder cannot leave a dead README pointer.
//
// It is report-only: it never rewrites the docs or the example config.

const dir = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.join(dir, "README.md");
const PROTOTYPE_SUBCOMMAND_DOC_PATH = path.join(dir, "docs", "prototype-subcommands.md");
const EXAMPLE_CONFIG_PATH = path.join(dir, "..", "..", "drift-ai.config.example.json");
const EXAMPLE_SEMGREP_MANIFEST_PATH = path.join(dir, "..", "..", "semgrep-rules.example.json");

const REGISTRY_CHECK_IDS = new Set<string>(ALL_CHECKS);

// The example config is a curated *starter*, not an exhaustive defaults dump: it
// shows the knobs an operator most often tunes first. Every live check id must be
// classified into exactly one of these two sets, so adding a check to the registry
// forces a conscious "show it in the starter example or deliberately omit it"
// decision here rather than letting the example silently fall behind.
const STARTER_EXAMPLE_CHECK_IDS = new Set<string>([
  "duplicates",
  "ghost-files",
  "comments",
  "commented-out-code",
  "near-duplicates",
]);
const OMITTED_FROM_EXAMPLE_CHECK_IDS = new Set<string>([
  "suppressions",
  "module-doc-paths",
  "orphan-files",
  "knip-duplicates",
  "import-cycles",
  "layer-direction",
  "duplicate-types",
  "duplicate-schemas",
  "duplicate-literals",
  "duplicate-constants",
  "unused-exports",
]);

const LIVE_SUBCOMMANDS = new Set<string>([
  ...TOP_LEVEL_SUBCOMMAND_IDS,
  ...PROTOTYPE_SUBCOMMAND_IDS,
]);
// Live subcommands intentionally left out of the README table, if any. Empty today.
const README_OMITTED_SUBCOMMANDS = new Set<string>();

function readReadme(): string {
  return readFileSync(README_PATH, "utf8");
}

function readPrototypeSubcommandsDoc(): string {
  return readFileSync(PROTOTYPE_SUBCOMMAND_DOC_PATH, "utf8");
}

function rootHelpText(): string {
  try {
    parseArgs(["--help"]);
  } catch (err) {
    if (err instanceof DriftAiHelp) return err.message;
    throw err;
  }
  throw new Error("expected root help to throw DriftAiHelp");
}

function exampleCheckIds(): string[] {
  // type-assertion-boundary: JSON parse — narrow the example config's `checks` map.
  const parsed = JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, "utf8")) as {
    checks?: Record<string, unknown>;
  };
  return Object.keys(parsed.checks ?? {});
}

// First-column cells of the markdown table immediately following `header`. Returns
// every data-row first cell verbatim (header/separator rows fall out because the
// caller's backtick regex never matches "Check"/"Command" or the dash separator).
function tableFirstCells(readme: string, header: string): string[] {
  const lines = readme.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === header);
  if (headerIndex < 0) return [];
  const cells: string[] = [];
  let started = false;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("|")) {
      started = true;
      cells.push((line.split("|")[1] ?? "").trim());
      continue;
    }
    if (started) break;
  }
  return cells;
}

function extractCheckIds(readme: string): string[] {
  return tableFirstCells(readme, "Implemented checks:").flatMap((cell) => {
    const match = cell.match(/^`([a-z][a-z-]*)`$/u);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

function extractSubcommands(readme: string): string[] {
  return tableFirstCells(readme, "Subcommands:").flatMap((cell) => {
    const match = cell.match(/^`bun run drift:ai ([a-z][a-z-]*)`$/u);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

function extractPrototypeIndexSubcommands(readme: string): string[] {
  const match = readme.match(/- \[Prototype subcommands\]\([^)]*\) covers[\s\S]*?\./u);
  const block = match?.[0] ?? "";
  return [...block.matchAll(/`([a-z][a-z-]*)`/gu)].map((item) => item[1] ?? "");
}

function extractPrototypeDocHeadings(doc: string): string[] {
  return [...doc.matchAll(/^## The `([a-z][a-z-]*)` prototype subcommand$/gmu)].map(
    (item) => item[1] ?? "",
  );
}

function semgrepPrototypeDocSection(): string {
  const doc = readPrototypeSubcommandsDoc();
  const start = doc.indexOf("## The `semgrep-candidates` prototype subcommand");
  const end = doc.indexOf("\n## The `coverage-evidence` prototype subcommand", start);
  if (start < 0 || end < 0) {
    throw new Error("could not locate semgrep-candidates prototype doc section");
  }
  return doc.slice(start, end);
}

// Relative README markdown links that point into the backlog tree.
function backlogLinkTargets(readme: string): string[] {
  const targets: string[] = [];
  for (const match of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (target !== undefined && target.includes("docs/agent_notes/backlog/")) targets.push(target);
  }
  return targets;
}

function brokenBacklogLinks(readme: string, baseDir: string): string[] {
  return backlogLinkTargets(readme).filter((target) => {
    const filePath = path.resolve(baseDir, target.split("#")[0] ?? target);
    return !existsSync(filePath) || statSync(filePath).size === 0;
  });
}

function missing(expected: ReadonlySet<string>, actual: ReadonlySet<string>): string[] {
  return [...expected].filter((id) => !actual.has(id)).sort();
}

describe("readme/config parity", () => {
  it("classifies every live check id as starter-example or omitted, with no overlap", () => {
    expect(missing(REGISTRY_CHECK_IDS, STARTER_EXAMPLE_CHECK_IDS)).toEqual(
      [...OMITTED_FROM_EXAMPLE_CHECK_IDS].sort(),
    );
    expect(missing(REGISTRY_CHECK_IDS, OMITTED_FROM_EXAMPLE_CHECK_IDS)).toEqual(
      [...STARTER_EXAMPLE_CHECK_IDS].sort(),
    );
    const overlap = [...STARTER_EXAMPLE_CHECK_IDS].filter((id) =>
      OMITTED_FROM_EXAMPLE_CHECK_IDS.has(id),
    );
    expect(overlap).toEqual([]);
  });

  it("example config carries no unknown check ids", () => {
    const unknown = exampleCheckIds().filter((id) => !REGISTRY_CHECK_IDS.has(id));
    expect(unknown).toEqual([]);
  });

  it("example config check-id set matches the starter-example allowlist", () => {
    expect(new Set(exampleCheckIds())).toEqual(STARTER_EXAMPLE_CHECK_IDS);
  });

  it("README check-id enumeration matches the live registry", () => {
    expect(new Set(extractCheckIds(readReadme()))).toEqual(REGISTRY_CHECK_IDS);
  });

  it("README subcommand enumeration matches the live subcommands minus the omit list", () => {
    const expected = new Set(
      [...LIVE_SUBCOMMANDS].filter((id) => !README_OMITTED_SUBCOMMANDS.has(id)),
    );
    expect(new Set(extractSubcommands(readReadme()))).toEqual(expected);
  });

  it("root help advertises every live prototype subcommand", () => {
    const help = rootHelpText();
    for (const id of PROTOTYPE_SUBCOMMAND_IDS) {
      expect(help).toContain(`bun run drift:ai ${id}`);
    }
  });

  it("README prototype index sentence matches the live prototype subcommands", () => {
    expect(new Set(extractPrototypeIndexSubcommands(readReadme()))).toEqual(
      new Set(PROTOTYPE_SUBCOMMAND_IDS),
    );
  });

  it("prototype subcommand docs have a heading for every live prototype subcommand", () => {
    expect(new Set(extractPrototypeDocHeadings(readPrototypeSubcommandsDoc()))).toEqual(
      new Set(PROTOTYPE_SUBCOMMAND_IDS),
    );
  });

  it("README backlog links resolve to non-empty targets", () => {
    expect(brokenBacklogLinks(readReadme(), dir)).toEqual([]);
  });

  // The semgrep starter manifest is copy-paste infrastructure like the example
  // config: it must keep parsing under the real manifest parser, and it must keep
  // demonstrating both source kinds so the operator sees the local-pinned shape
  // and the registry-pack consent shape side by side.
  it("example semgrep rule-source manifest parses and shows both source kinds", () => {
    const sources = parseRuleSourceManifest(
      readFileSync(EXAMPLE_SEMGREP_MANIFEST_PATH, "utf8"),
      EXAMPLE_SEMGREP_MANIFEST_PATH,
    );
    expect(new Set(sources.map((source) => source.kind))).toEqual(
      new Set(["local", "registry-pack"]),
    );
  });

  it("prototype subcommand docs link the example semgrep manifest", () => {
    expect(readPrototypeSubcommandsDoc()).toContain("semgrep-rules.example.json");
  });

  it("README external quickstart points operators to Semgrep community-rule setup", () => {
    const readme = readReadme();
    expect(readme).toContain("third-party/community rules");
    expect(readme).toContain(
      "docs/prototype-subcommands.md#the-semgrep-candidates-prototype-subcommand",
    );
  });

  it("Semgrep prototype docs show portable tools-checkout commands for foreign repos", () => {
    const section = semgrepPrototypeDocSection();
    expect(section).toContain("bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates");
    expect(section).not.toContain("bun run drift:ai semgrep-candidates --root src");
  });
});

// Deliberately-stale inputs prove the guard actually fails on drift rather than
// passing vacuously. Each fixture mutates one surface and asserts the matching
// extractor/comparison reports it.
describe("readme/config parity catches staleness", () => {
  it("flags an unknown check id in the example config", () => {
    const unknown = ["duplicates", "made-up-check"].filter((id) => !REGISTRY_CHECK_IDS.has(id));
    expect(unknown).toEqual(["made-up-check"]);
  });

  it("flags a README check table missing a registry id", () => {
    const stale = [
      "Implemented checks:",
      "",
      "| Check | ? |",
      "| --- | --- |",
      "| `duplicates` | Yes |",
    ].join("\n");
    expect(new Set(extractCheckIds(stale))).not.toEqual(REGISTRY_CHECK_IDS);
    expect(missing(REGISTRY_CHECK_IDS, new Set(extractCheckIds(stale)))).toContain("ghost-files");
  });

  it("flags a README subcommand table with an unknown subcommand", () => {
    const stale = [
      "Subcommands:",
      "",
      "| Command | Purpose |",
      "| --- | --- |",
      "| `bun run drift:ai hotspots` | x |",
      "| `bun run drift:ai phantom-lens` | x |",
    ].join("\n");
    const found = new Set(extractSubcommands(stale));
    const unexpected = [...found].filter((id) => !LIVE_SUBCOMMANDS.has(id));
    expect(unexpected).toEqual(["phantom-lens"]);
  });

  it("flags a dead backlog link", () => {
    const stale = "See [old queue](../../docs/agent_notes/backlog/drift-ai-tasks/00-index.md).";
    expect(brokenBacklogLinks(stale, dir)).toEqual([
      "../../docs/agent_notes/backlog/drift-ai-tasks/00-index.md",
    ]);
  });
});

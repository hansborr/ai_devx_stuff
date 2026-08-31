// Generates docs/agent_notes/backlog/CATALOG.md: the record-class and
// lifecycle map of the backlog namespace. The corpus comes from the
// backlog-lint facade, so the catalog and the advisory lint always see exactly
// the same tracked files; the classification comes from backlog-lint-classify.
//
// `--check` is the freshness gate, in the same advisory tier as the rest of the
// backlog lint: pre-commit warns when a staged change staled the catalog and
// never blocks. Nothing here reads the clock, so `--check` is deterministic.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderBacklogCatalog } from "./backlog-catalog-render.js";
import { BACKLOG_DIR, loadBacklogFiles } from "./backlog-lint.js";
import { classifyBacklogTree } from "./backlog-lint-classify.js";
import { runDocGenerator } from "./lib/doc-generator.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_BASE = "CATALOG.md";
const outputPath = resolve(repoRoot, BACKLOG_DIR, CATALOG_BASE);

runDocGenerator({
  outputPath,
  refreshCommand: "docs:backlog-catalog",
  render: () => {
    // The catalog does not list itself: including a generated file in its own
    // input would make the first run and every later run render different text.
    const files = loadBacklogFiles(repoRoot, BACKLOG_DIR).filter(
      (file) => file.path !== `${BACKLOG_DIR}/${CATALOG_BASE}`,
    );
    const catalog = classifyBacklogTree({ files, backlogDir: BACKLOG_DIR });
    return {
      rendered: renderBacklogCatalog(catalog, BACKLOG_DIR),
      wroteSuffix: ` (${String(catalog.notes.length)} note(s), ${String(catalog.packs.length)} pack(s))`,
    };
  },
});

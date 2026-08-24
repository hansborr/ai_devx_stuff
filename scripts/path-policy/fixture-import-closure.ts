// Import-graph companion to fixture-shell-dependencies.ts. That check follows
// literal `# shellcheck source=` edges, so a TS/JS entry script copied into a
// sandbox got no closure check at all: adding a leaf module under `scripts/`
// silently under-closed every fixture that runs an entry importing it, and the
// gap surfaced only at the next-deeper gate (three incidents on 2026-07-19
// alone). Here every copied `scripts/**` TS/JS file the sandbox model reports
// (fixture-sandbox-model.ts) is treated as an entry point and closure-walked
// with the shared seed walker; each closure file must be present in the
// sandbox.
//
// Known limitation — entry selection is a *path* heuristic, not an execution
// one. `entryPathPattern` treats every copied `scripts/**` TS/JS file as
// executed and everything outside `scripts/` as inert data, which is wrong in
// both directions. The live tree copies `eslint-rules/type-assertion-boundary.js`
// into a fixture and imports it from the executed fixture ESLint config
// (scripts/tests/test-lint-ratchet.sh); that file is import-free today, so
// there is no live gap, but extracting a helper out of it would under-close
// the fixture silently. The `not-an-entry` annotation covers the other
// direction (a copied `scripts/**` module that the sandbox never executes);
// there is deliberately no positive "this non-scripts file is an entry"
// annotation yet, because no live fixture needs one.

import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { validateSeedImportClosure } from "../import-closure/closure-walk.js";
import { entryPathPattern } from "./fixture-copy-expressions.js";
import type { FixtureSandbox } from "./fixture-sandbox-model.js";
import { normalizePath } from "./smoke-test-files.js";

/**
 * `cp -R scripts/support/. "$dir/scripts/support/"` puts executable modules in
 * the sandbox exactly like a per-file copy does. Recording the directory only
 * as closure *satisfaction* would let a copied subtree whose files import
 * outside it pass silently, so every `scripts/**` module beneath a copied
 * directory is an entry too.
 */
function entriesUnderCopiedDirectories(
  repoRoot: string,
  sandbox: FixtureSandbox,
): readonly string[] {
  const entries: string[] = [];
  for (const directory of sandbox.copiedDirectories) {
    if (!directory.startsWith("scripts/") && directory !== "scripts") continue;
    const pending = [resolve(repoRoot, directory)];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      for (const child of readdirSync(current, { withFileTypes: true })) {
        const childPath = join(current, child.name);
        if (child.isDirectory()) {
          pending.push(childPath);
          continue;
        }
        const relativePath = normalizePath(relative(repoRoot, childPath));
        if (entryPathPattern.test(relativePath)) entries.push(relativePath);
      }
    }
  }
  return entries;
}

function isPresentInSandbox(sandbox: FixtureSandbox, path: string): boolean {
  if (sandbox.copiedFiles.has(path) || sandbox.synthesizedPaths.has(path)) return true;
  for (const directory of sandbox.copiedDirectories) {
    if (path.startsWith(`${directory}/`)) return true;
  }
  return false;
}

/**
 * Every `scripts/**` TS/JS file a sandbox copies must bring its whole static
 * import closure with it. A walk failure (an unresolvable repository-local
 * package, a missing file) is reported rather than thrown, so one broken copy
 * set does not hide the rest of the tree's diagnostics.
 */
export function collectFixtureImportClosureFailures(
  repoRoot: string,
  fixturePath: string,
  sandbox: FixtureSandbox,
): readonly string[] {
  if (sandbox.wholeTreeSeeded || sandbox.composedIntoCaller) return [];
  const failures: string[] = [];
  const functionLabel =
    sandbox.functionScope.length === 0 ? "" : ` function ${sandbox.functionScope.join(" > ")}`;
  const entries = [
    ...new Set([...sandbox.copiedFiles, ...entriesUnderCopiedDirectories(repoRoot, sandbox)]),
  ]
    .filter((path) => entryPathPattern.test(path) && !sandbox.nonEntryPaths.has(path))
    .sort();
  for (const entry of entries) {
    try {
      const { files } = validateSeedImportClosure({
        root: repoRoot,
        entry,
        allowedRoots: ["."],
        allowedFiles: [],
        externalPackages: [...sandbox.externalPackages],
        terminalFiles: [...sandbox.synthesizedPaths],
        nonStaticSpecifiers: "skip",
      });
      for (const file of files) {
        if (file === entry || isPresentInSandbox(sandbox, file)) continue;
        failures.push(
          `${fixturePath}${functionLabel} fixture ${sandbox.fixtureRoot} copies ${entry} but omits imported dependency ${file}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(
        `${fixturePath}${functionLabel} fixture ${sandbox.fixtureRoot} cannot walk the import closure of ${entry}: ${message}`,
      );
    }
  }
  return failures;
}

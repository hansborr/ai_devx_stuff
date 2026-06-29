// @ts-check
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { localPlugin } from "../eslint-config/local-plugin.js";
import { ALL_LOCAL_RULES } from "./all-local-rules.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * An ESLint rule module is the default export carrying both `meta` and
 * `create`. Helper modules in eslint-rules/ (e.g.
 * trpc-shared-schema-import-collector.js, eslint-config-resolution-timeout.js,
 * all-local-rules.js) have no such default export, so detecting rules by shape
 * keeps this completeness guard from breaking when a new non-rule helper lands
 * while still failing if a real rule file is forgotten in the registries.
 *
 * @param {unknown} mod
 * @returns {unknown | undefined}
 */
function ruleFromModule(mod) {
  const candidate =
    mod && typeof mod === "object" && "default" in mod
      ? /** @type {{ default: unknown }} */ (mod).default
      : undefined;
  if (
    candidate &&
    typeof candidate === "object" &&
    "meta" in candidate &&
    typeof (/** @type {{ create?: unknown }} */ (candidate).create) === "function"
  ) {
    return candidate;
  }
  return undefined;
}

/** @returns {Promise<Array<{ id: string; rule: unknown }>>} rules derived from the rule files on disk */
async function ruleFileEntriesOnDisk() {
  const candidates = readdirSync(here)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => !name.endsWith(".test.js"));

  const entries = [];
  for (const name of candidates) {
    const mod = await import(pathToFileURL(join(here, name)).href);
    const rule = ruleFromModule(mod);
    if (rule) {
      entries.push({ id: name.slice(0, -".js".length), rule });
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

describe("local-plugin rule registry completeness", () => {
  it("registers every rule file in localPlugin.rules (no dead, unwired rule)", async () => {
    // Mode A: a new rule file added with its own test but forgotten in
    // localPlugin.rules would never run in the lint, the doc generator, or the
    // ratchet registry check. Pin disk -> plugin so that omission is a failure.
    const pluginIds = Object.keys(localPlugin.rules).sort();
    const diskIds = (await ruleFileEntriesOnDisk()).map((entry) => entry.id);
    expect(diskIds).toEqual(pluginIds);
  });

  it("derives ALL_LOCAL_RULES from localPlugin.rules for meta-contract coverage", () => {
    const pluginIds = Object.keys(localPlugin.rules).sort();
    const metaContractIds = ALL_LOCAL_RULES.map((entry) => entry.id).sort();
    expect(metaContractIds).toEqual(pluginIds);
  });

  it("wires each plugin id to its matching rule file object", async () => {
    // Guards against a wiring typo where an id matches but the imported rule
    // module differs from the rule file carrying that id.
    for (const entry of await ruleFileEntriesOnDisk()) {
      expect(localPlugin.rules[entry.id], `${entry.id} rule object`).toBe(entry.rule);
    }
  });
});

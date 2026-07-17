// @ts-check
import { describe, expect, it } from "vitest";

import { SHARED_SCHEMA_PREFIX } from "./shared-schema-prefix.js";
import {
  createSharedSchemaImportCollector,
  isSharedSchemaSource,
  SHARED_SCHEMA_PREFIX as COLLECTOR_SHARED_SCHEMA_PREFIX,
} from "./trpc-shared-schema-import-collector.js";

/**
 * @param {string} source
 * @param {Array<{ type: string, local: { name: string } }>} specifiers
 * @returns {import('estree').ImportDeclaration}
 */
function importNode(source, specifiers) {
  // Minimal ESTree-shaped fixtures; the collector only reads source.value and
  // specifier.type/local.name. Cast at the test boundary to the rule's node type.
  return /** @type {import('estree').ImportDeclaration} */ (
    /** @type {unknown} */ ({ source: { value: source }, specifiers })
  );
}

describe("trpc-shared-schema-import-collector", () => {
  it("exposes the shared-schema prefix and predicate", () => {
    expect(SHARED_SCHEMA_PREFIX).toBe("@musi/shared/schemas/");
    expect(COLLECTOR_SHARED_SCHEMA_PREFIX).toBe(SHARED_SCHEMA_PREFIX);
    expect(isSharedSchemaSource("@musi/shared/schemas/campaign.js")).toBe(true);
    expect(isSharedSchemaSource("../schemas/local.js")).toBe(false);
    expect(isSharedSchemaSource("@musi/shared/rules")).toBe(false);
  });

  it("records local names of named imports from shared schema modules", () => {
    const collector = createSharedSchemaImportCollector();
    collector.ImportDeclaration(
      importNode("@musi/shared/schemas/campaign.js", [
        { type: "ImportSpecifier", local: { name: "campaignDetailSchema" } },
      ]),
    );
    expect(collector.sharedSchemaImports.has("campaignDetailSchema")).toBe(true);
  });

  it("ignores imports from non-shared sources and non-named specifiers", () => {
    const collector = createSharedSchemaImportCollector();
    collector.ImportDeclaration(
      importNode("../schemas/local.js", [
        { type: "ImportSpecifier", local: { name: "localSchema" } },
      ]),
    );
    collector.ImportDeclaration(
      importNode("@musi/shared/schemas/campaign.js", [
        { type: "ImportNamespaceSpecifier", local: { name: "sharedSchemas" } },
      ]),
    );
    expect(collector.sharedSchemaImports.size).toBe(0);
  });

  it("gives each instance an independent import set", () => {
    const first = createSharedSchemaImportCollector();
    const second = createSharedSchemaImportCollector();
    first.ImportDeclaration(
      importNode("@musi/shared/schemas/campaign.js", [
        { type: "ImportSpecifier", local: { name: "campaignDetailSchema" } },
      ]),
    );
    expect(first.sharedSchemaImports.size).toBe(1);
    expect(second.sharedSchemaImports.size).toBe(0);
  });
});

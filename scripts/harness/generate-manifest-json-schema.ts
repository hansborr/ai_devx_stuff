// Emits schemas/harness.controls.schema.json: the PUBLIC JSON Schema for
// harness.controls.json, projected from the Zod contract that already validates
// it (harness-manifest-schema.ts) via native z.toJSONSchema.
//
// Why publish at all: harness.controls.json is the artifact an external adopter
// of this harness copies or generates tooling against. Without a machine-
// readable contract, validating a manifest, getting editor completion, or
// noticing that the format changed between two pins all mean reverse-engineering
// an internal TypeScript module graph.
//
// DERIVATION DIRECTION IS ONE-WAY. The Zod contract stays the single source of
// truth; this file is a projection of it and is never hand-edited. Consequently
// the emitter imports ONLY the Zod schema module: it must not read
// harness.controls.json (the schema describes the format, not the repo's own
// data) and must not import the dependency-free leaf harness-manifest.ts, whose
// fixture-copy closure and MANIFEST_DIRECT_READERS seam stay untouched by
// schema publication.
//
// Serialization is deterministic and stable-key: z.toJSONSchema emits keys in
// Zod's internal traversal order, which a refactor can reshuffle without any
// contract change. Sorting every object key by codepoint means the freshness
// gate only fires on a real contract diff instead of flapping on churn.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { runDocGenerator } from "../lib/doc-generator.js";
import { harnessManifestSchema } from "./harness-manifest-schema.js";

/** `bun run <script>` that refreshes the published schema. */
export const MANIFEST_JSON_SCHEMA_REFRESH_COMMAND = "harness:manifest-schema";

/** Repo-relative path of the published schema. */
export const MANIFEST_JSON_SCHEMA_OUTPUT_PATH = "schemas/harness.controls.schema.json";

const JSON_INDENT = 2;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, MANIFEST_JSON_SCHEMA_OUTPUT_PATH);

/**
 * Recursively codepoint-sort object keys. Arrays keep their order: `oneOf`,
 * `required`, and `enum` are ordered contract, not a key set.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value !== "object" || value === null) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareByCodepoint)) {
    sorted[key] = sortKeysDeep(Object.getOwnPropertyDescriptor(value, key)?.value);
  }
  return sorted;
}

/**
 * Render the published schema. `io: "input"` is the validating side: the
 * manifest is authored JSON fed *into* the parser, so an external validator
 * must see the pre-parse shape.
 */
export function renderManifestJsonSchema(): string {
  const schema = z.toJSONSchema(harnessManifestSchema, { io: "input" });
  return `${JSON.stringify(sortKeysDeep(schema), null, JSON_INDENT)}\n`;
}

function main(): void {
  runDocGenerator({
    outputPath,
    refreshCommand: MANIFEST_JSON_SCHEMA_REFRESH_COMMAND,
    render: () => ({ rendered: renderManifestJsonSchema() }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

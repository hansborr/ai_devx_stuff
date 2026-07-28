import { isRecord } from "../lib/records.js";

export type SkillOverlay =
  | { readonly path: string; readonly kind: "canonical-only" | "target-only" | "harness-block" }
  | { readonly path: string; readonly kind: "frontmatter-field"; readonly field: string };

export interface SkillTarget {
  readonly harness: string;
  readonly path: string;
  readonly overlays: readonly SkillOverlay[];
}

export interface SkillWiring {
  readonly id: string;
  readonly canonical: string;
  readonly targets: readonly SkillTarget[];
  readonly gitignoreOptIns: readonly string[];
  readonly smokeTest?: string;
}

function stringField(raw: Record<string, unknown>, field: string, context: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context}.${field} must be a non-empty string`);
  }
  return value;
}

function stringArray(raw: Record<string, unknown>, field: string, context: string): string[] {
  const value = raw[field];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${field} must be an array of non-empty strings`);
  }
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(`${context}.${field} must be an array of non-empty strings`);
    }
    strings.push(entry);
  }
  return strings;
}

function assertExactKeys(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${context} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  }
}

function assertUnique(values: readonly string[], context: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${context} contains duplicate declaration: ${value}`);
    seen.add(value);
  }
}

function parseOverlay(raw: unknown, context: string): SkillOverlay {
  if (!isRecord(raw)) throw new Error(`${context} must be an object`);
  const path = stringField(raw, "path", context);
  const kind = stringField(raw, "kind", context);
  if (kind === "frontmatter-field") {
    assertExactKeys(raw, new Set(["path", "kind", "field"]), context);
    return { path, kind, field: stringField(raw, "field", context) };
  }
  if (kind === "canonical-only" || kind === "target-only" || kind === "harness-block") {
    assertExactKeys(raw, new Set(["path", "kind"]), context);
    return { path, kind };
  }
  throw new Error(`${context}.kind is not a supported skill overlay`);
}

function parseTarget(raw: unknown, context: string): SkillTarget {
  if (!isRecord(raw)) throw new Error(`${context} must be an object`);
  assertExactKeys(raw, new Set(["harness", "path", "overlays"]), context);
  if (!Array.isArray(raw.overlays)) throw new Error(`${context}.overlays must be an array`);
  return {
    harness: stringField(raw, "harness", context),
    path: stringField(raw, "path", context),
    overlays: raw.overlays.map((overlay, index) =>
      parseOverlay(overlay, `${context}.overlays[${String(index)}]`),
    ),
  };
}

export function parseSkillWiring(control: Record<string, unknown>): SkillWiring {
  const id = stringField(control, "id", "skill control");
  const raw = control.skillWiring;
  if (!isRecord(raw)) throw new Error(`${id}.skillWiring must be an object`);
  assertExactKeys(
    raw,
    new Set(["canonical", "targets", "gitignoreOptIns", "smokeTest"]),
    `${id}.skillWiring`,
  );
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error(`${id}.skillWiring.targets must be a non-empty array`);
  }
  const smokeTest = raw.smokeTest;
  if (smokeTest !== undefined && (typeof smokeTest !== "string" || smokeTest === "")) {
    throw new Error(`${id}.skillWiring.smokeTest must be a non-empty string`);
  }
  const targets = raw.targets.map((target, index) =>
    parseTarget(target, `${id}.skillWiring.targets[${String(index)}]`),
  );
  assertUnique(
    targets.map((target) => target.harness),
    `${id}.skillWiring.targets harnesses`,
  );
  assertUnique(
    targets.map((target) => target.path),
    `${id}.skillWiring.targets paths`,
  );
  const gitignoreOptIns = stringArray(raw, "gitignoreOptIns", `${id}.skillWiring`);
  assertUnique(gitignoreOptIns, `${id}.skillWiring.gitignoreOptIns`);
  return {
    id,
    canonical: stringField(raw, "canonical", `${id}.skillWiring`),
    targets,
    gitignoreOptIns,
    ...(smokeTest !== undefined ? { smokeTest } : {}),
  };
}

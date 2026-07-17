export type SkillOverlay =
  | { readonly path: string; readonly kind: "canonical-only" | "target-only" | "harness-block" }
  | { readonly path: string; readonly kind: "frontmatter-field"; readonly field: string };

interface SkillTarget {
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
  readonly smokeSubjects: readonly string[];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseOverlay(raw: unknown, context: string): SkillOverlay {
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  const path = stringField(raw, "path", context);
  const kind = stringField(raw, "kind", context);
  if (kind === "frontmatter-field") {
    return { path, kind, field: stringField(raw, "field", context) };
  }
  if (kind === "canonical-only" || kind === "target-only" || kind === "harness-block") {
    return { path, kind };
  }
  throw new Error(`${context}.kind is not a supported skill overlay`);
}

function parseTarget(raw: unknown, context: string): SkillTarget {
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
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
  if (!isObject(raw)) throw new Error(`${id}.skillWiring must be an object`);
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error(`${id}.skillWiring.targets must be a non-empty array`);
  }
  const smokeTest = raw.smokeTest;
  if (smokeTest !== undefined && (typeof smokeTest !== "string" || smokeTest === "")) {
    throw new Error(`${id}.skillWiring.smokeTest must be a non-empty string`);
  }
  return {
    id,
    canonical: stringField(raw, "canonical", `${id}.skillWiring`),
    targets: raw.targets.map((target, index) =>
      parseTarget(target, `${id}.skillWiring.targets[${String(index)}]`),
    ),
    gitignoreOptIns: stringArray(raw, "gitignoreOptIns", `${id}.skillWiring`),
    ...(smokeTest !== undefined ? { smokeTest } : {}),
    smokeSubjects: stringArray(raw, "smokeSubjects", `${id}.skillWiring`),
  };
}

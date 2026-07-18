function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) normalized[key] = canonicalValue(value[key]);
  return normalized;
}

export function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

export function parseArray<Value>(
  value: unknown,
  parseValue: (entry: unknown) => Value | null,
): Value[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: Value[] = [];
  for (const entry of value) {
    const result = parseValue(entry);
    if (result === null) return null;
    parsed.push(result);
  }
  return parsed;
}

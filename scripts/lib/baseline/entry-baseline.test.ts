import { describe, expect, it } from "vitest";

import {
  BASELINE_SCHEMA_VERSION,
  type BaselineMetricSpec,
  formatBaseline,
  parseBaseline,
  type ParseResult,
} from "./entry-baseline.js";

interface TagEntry {
  readonly key: string;
  readonly kind: string;
  readonly name: string;
}

function tagKey(kind: string, name: string): string {
  return `${kind}|${name}`;
}

const tagSpec: BaselineMetricSpec<TagEntry> = {
  tool: "demo",
  metric: "tags",
  meta: { scope: "all" },
  parseEntry(raw): ParseResult<TagEntry> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "entry must be an object" };
    }
    const record = raw as Record<string, unknown>;
    const { kind, name } = record;
    if (typeof kind !== "string" || typeof name !== "string") {
      return { ok: false, error: "entry needs string kind and name" };
    }
    return { ok: true, value: { key: tagKey(kind, name), kind, name } };
  },
  formatEntry(entry) {
    return { key: entry.key, kind: entry.kind, name: entry.name };
  },
  summarize(entries) {
    const kinds: Record<string, number> = {};
    for (const entry of entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
    return { count: entries.length, kinds };
  },
};

function tag(kind: string, name: string): TagEntry {
  return { key: tagKey(kind, name), kind, name };
}

describe("formatBaseline", () => {
  it("sorts entries by key and derives the summary", () => {
    const text = formatBaseline(tagSpec, [tag("b", "two"), tag("a", "one"), tag("a", "alpha")]);
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toEqual({
      version: BASELINE_SCHEMA_VERSION,
      tool: "demo",
      metric: "tags",
      scope: "all",
      summary: { count: 3, kinds: { a: 2, b: 1 } },
      entries: [
        { key: "a|alpha", kind: "a", name: "alpha" },
        { key: "a|one", kind: "a", name: "one" },
        { key: "b|two", kind: "b", name: "two" },
      ],
    });
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("is stable regardless of input order", () => {
    const first = formatBaseline(tagSpec, [tag("a", "one"), tag("b", "two")]);
    const second = formatBaseline(tagSpec, [tag("b", "two"), tag("a", "one")]);
    expect(first).toBe(second);
  });
});

describe("parseBaseline", () => {
  it("round-trips a formatted baseline", () => {
    const entries = [tag("a", "one"), tag("b", "two")];
    const parsed = parseBaseline(tagSpec, formatBaseline(tagSpec, entries));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.entries).toEqual(entries);
  });

  it.each([
    { name: "invalid JSON", text: "{", error: "baseline is not valid JSON" },
    {
      name: "wrong version",
      text: JSON.stringify({ version: 1, tool: "demo", metric: "tags", scope: "all", entries: [] }),
      error: "baseline version must be 2",
    },
    {
      name: "wrong tool",
      text: JSON.stringify({
        version: 2,
        tool: "other",
        metric: "tags",
        scope: "all",
        entries: [],
      }),
      error: "baseline tool must be 'demo'",
    },
    {
      name: "wrong meta",
      text: JSON.stringify({
        version: 2,
        tool: "demo",
        metric: "tags",
        scope: "some",
        entries: [],
      }),
      error: "baseline scope must be 'all'",
    },
  ])("rejects $name", ({ text, error }) => {
    const parsed = parseBaseline(tagSpec, text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(error);
  });

  it("rejects entries that are not sorted by key", () => {
    const text = JSON.stringify({
      version: 2,
      tool: "demo",
      metric: "tags",
      scope: "all",
      summary: { count: 2, kinds: { a: 1, b: 1 } },
      entries: [
        { key: "b|two", kind: "b", name: "two" },
        { key: "a|one", kind: "a", name: "one" },
      ],
    });
    const parsed = parseBaseline(tagSpec, text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("must be sorted by key");
  });

  it("rejects duplicate entry keys", () => {
    const text = JSON.stringify({
      version: 2,
      tool: "demo",
      metric: "tags",
      scope: "all",
      summary: { count: 2, kinds: { a: 2 } },
      entries: [
        { key: "a|one", kind: "a", name: "one" },
        { key: "a|one", kind: "a", name: "one" },
      ],
    });
    const parsed = parseBaseline(tagSpec, text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("duplicate entry key");
  });

  it("rejects a summary that does not match the entries", () => {
    const text = JSON.stringify({
      version: 2,
      tool: "demo",
      metric: "tags",
      scope: "all",
      summary: { count: 99, kinds: { a: 1 } },
      entries: [{ key: "a|one", kind: "a", name: "one" }],
    });
    const parsed = parseBaseline(tagSpec, text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("summary does not match the entries");
  });
});

import { z } from "zod";

import { baselineConflictMarkerTripwire } from "./baseline-conflict-marker.js";
import type {
  BaselineConflictMarkerRemediation,
  GroupedBaseline,
  GroupedBaselineGroup,
  GroupedBaselineSpec,
  GroupedParseResult,
  KeyedGroupedItem,
} from "./group-baseline.js";

const objectEnvelopeSchema = z.record(z.string(), z.unknown());
const testsEnvelopeSchema = z.looseObject({
  version: z.number().int(),
  regenerate: z.unknown().optional(),
  tests: z.record(z.string(), z.unknown()),
});
const entriesEnvelopeSchema = z.looseObject({
  version: z.number().int(),
  regenerate: z.unknown().optional(),
  entries: z.array(z.unknown()),
});
const testGroupEnvelopeSchema = z.looseObject({
  items: z.record(z.string(), z.unknown()),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(
  text: string,
  remediation: BaselineConflictMarkerRemediation | undefined,
): GroupedParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      error:
        baselineConflictMarkerTripwire(text, remediation) ??
        `baseline is not valid JSON: ${errorMessage(error)}`,
    };
  }
}

function invalidEnvelopeError(
  rootKey: "tests" | "entries",
  envelope: Readonly<Record<string, unknown>>,
): string {
  if (typeof envelope["version"] !== "number" || !Number.isInteger(envelope["version"])) {
    return "baseline version must be an integer";
  }
  return rootKey === "tests"
    ? "baseline tests must be an object"
    : "baseline entries must be an array";
}

function checkedEnvelope<GroupMeta, Item>(
  spec: Pick<GroupedBaselineSpec<GroupMeta, Item>, "acceptedReadVersions" | "rootKey">,
  raw: unknown,
): GroupedParseResult<Readonly<Record<string, unknown>>> {
  const objectResult = objectEnvelopeSchema.safeParse(raw);
  if (!objectResult.success) return { ok: false, error: "baseline must be a JSON object" };
  const envelope = objectResult.data;
  const otherRootKey = spec.rootKey === "tests" ? "entries" : "tests";
  if (!(spec.rootKey in envelope) && otherRootKey in envelope) {
    return {
      ok: false,
      error: `baseline has wrong document family: expected '${spec.rootKey}', found '${otherRootKey}'`,
    };
  }
  const checked =
    spec.rootKey === "tests"
      ? testsEnvelopeSchema.safeParse(envelope)
      : entriesEnvelopeSchema.safeParse(envelope);
  if (!checked.success) return { ok: false, error: invalidEnvelopeError(spec.rootKey, envelope) };
  if (!spec.acceptedReadVersions.includes(checked.data.version)) {
    const accepted = spec.acceptedReadVersions;
    return {
      ok: false,
      error:
        accepted.length === 1
          ? `baseline version must be ${String(accepted[0])}`
          : `baseline version must be one of ${accepted.join(", ")}`,
    };
  }
  return { ok: true, value: checked.data };
}

function appendWarnings(target: string[], result: { readonly warnings?: readonly string[] }): void {
  if (result.warnings !== undefined) target.push(...result.warnings);
}

function failureList(result: {
  readonly error: string;
  readonly errors?: readonly string[];
}): readonly string[] {
  return result.errors ?? [result.error];
}

interface ParseDiagnostics {
  readonly warnings: string[];
  readonly failures: string[];
}

function parseArrayItems<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  rawItems: readonly unknown[],
  warnings: string[],
): GroupedParseResult<readonly KeyedGroupedItem<Item>[]> {
  const items: KeyedGroupedItem<Item>[] = [];
  const seen = new Set<string>();
  let previousKey: string | undefined;
  for (let index = 0; index < rawItems.length; index += 1) {
    const parsed = spec.parseItem(groupId, undefined, rawItems[index]);
    if (!parsed.ok) {
      return { ok: false, error: `baseline entries[${String(index)}]: ${parsed.error}` };
    }
    const { key } = parsed.value;
    if (seen.has(key)) return { ok: false, error: `baseline has duplicate entry key '${key}'` };
    if (
      spec.requireSortedKeysOnParse !== false &&
      previousKey !== undefined &&
      spec.compareItemKeys(previousKey, key) > 0
    ) {
      return {
        ok: false,
        error: `baseline entries must be sorted by key; '${key}' follows '${previousKey}'`,
      };
    }
    appendWarnings(warnings, parsed);
    seen.add(key);
    previousKey = key;
    items.push(parsed.value);
  }
  return { ok: true, value: items };
}

function parseObjectItems<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  rawItems: Readonly<Record<string, unknown>>,
  diagnostics: ParseDiagnostics,
): readonly KeyedGroupedItem<Item>[] {
  const items: KeyedGroupedItem<Item>[] = [];
  let previousKey: string | undefined;
  for (const [itemKey, rawItem] of Object.entries(rawItems)) {
    if (
      spec.requireSortedKeysOnParse !== false &&
      previousKey !== undefined &&
      spec.compareItemKeys(previousKey, itemKey) > 0
    ) {
      diagnostics.failures.push(
        `${groupId}.items must be sorted by key; '${itemKey}' follows '${previousKey}'`,
      );
    }
    previousKey = itemKey;
    const parsed = spec.parseItem(groupId, itemKey, rawItem);
    if (!parsed.ok) {
      diagnostics.failures.push(
        ...failureList(parsed).map((failure) => `${groupId}.items.${itemKey}: ${failure}`),
      );
      continue;
    }
    if (parsed.value.key !== itemKey) {
      diagnostics.failures.push(`${groupId}.items.${itemKey}: parsed item key differs`);
      continue;
    }
    appendWarnings(diagnostics.warnings, parsed);
    items.push(parsed.value);
  }
  return items;
}

function parseEntriesFamily<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  envelope: Readonly<Record<string, unknown>>,
  warnings: string[],
): GroupedParseResult<ReadonlyMap<string, GroupedBaselineGroup<GroupMeta, Item>>> {
  const groupId = spec.singleGroupId;
  if (groupId === undefined) {
    return { ok: false, error: "entries-family codec requires a singleGroupId" };
  }
  const rawEntries = envelope["entries"];
  if (!Array.isArray(rawEntries)) return { ok: false, error: "baseline entries must be an array" };
  const parsedItems = parseArrayItems(spec, groupId, rawEntries, warnings);
  if (!parsedItems.ok) return parsedItems;
  const parsedMeta = spec.parseGroupMeta(groupId, envelope, parsedItems.value);
  if (!parsedMeta.ok) return parsedMeta;
  appendWarnings(warnings, parsedMeta);
  return {
    ok: true,
    value: new Map([[groupId, { meta: parsedMeta.value, items: keyedItemMap(parsedItems.value) }]]),
  };
}

function keyedItemMap<Item>(items: readonly KeyedGroupedItem<Item>[]): ReadonlyMap<string, Item> {
  return new Map(items.map(({ key, item }) => [key, item]));
}

// A group with a broken items container can still be a plain object; its
// metadata defects are reported in the same pass rather than only after the
// items container is repaired.
function collectBrokenGroupMetaFailures<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  rawGroup: unknown,
  failures: string[],
): void {
  const rawGroupObject = objectEnvelopeSchema.safeParse(rawGroup);
  if (!rawGroupObject.success) return;
  const parsedMeta = spec.parseGroupMeta(groupId, rawGroupObject.data, []);
  if (!parsedMeta.ok) {
    failures.push(...failureList(parsedMeta).map((failure) => `${groupId}: ${failure}`));
  }
}

function parseTestsFamily<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  envelope: Readonly<Record<string, unknown>>,
  warnings: string[],
): GroupedParseResult<ReadonlyMap<string, GroupedBaselineGroup<GroupMeta, Item>>> {
  const rawTests = envelope["tests"];
  const testsResult = z.record(z.string(), z.unknown()).safeParse(rawTests);
  if (!testsResult.success) return { ok: false, error: "baseline tests must be an object" };
  const groups = new Map<string, GroupedBaselineGroup<GroupMeta, Item>>();
  const diagnostics: ParseDiagnostics = { warnings, failures: [] };
  let previousGroupId: string | undefined;
  for (const [groupId, rawGroup] of Object.entries(testsResult.data)) {
    if (
      spec.requireSortedKeysOnParse !== false &&
      previousGroupId !== undefined &&
      spec.compareGroupKeys(previousGroupId, groupId) > 0
    ) {
      diagnostics.failures.push(
        `baseline tests must be sorted by key; '${groupId}' follows '${previousGroupId}'`,
      );
    }
    previousGroupId = groupId;
    const groupResult = testGroupEnvelopeSchema.safeParse(rawGroup);
    if (!groupResult.success) {
      diagnostics.failures.push(`${groupId}: baseline group must contain an items object`);
      collectBrokenGroupMetaFailures(spec, groupId, rawGroup, diagnostics.failures);
      continue;
    }
    const parsedItems = parseObjectItems(spec, groupId, groupResult.data.items, diagnostics);
    const parsedMeta = spec.parseGroupMeta(groupId, groupResult.data, parsedItems);
    if (!parsedMeta.ok) {
      diagnostics.failures.push(
        ...failureList(parsedMeta).map((failure) => `${groupId}: ${failure}`),
      );
      continue;
    }
    appendWarnings(warnings, parsedMeta);
    groups.set(groupId, { meta: parsedMeta.value, items: keyedItemMap(parsedItems) });
  }
  const failures = diagnostics.failures;
  if (failures.length > 0) {
    return { ok: false, error: failures[0] ?? "baseline tests are invalid", errors: failures };
  }
  return { ok: true, value: groups };
}

function collectRegenerateWarning<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  envelope: Readonly<Record<string, unknown>>,
  warnings: string[],
): void {
  const committed = envelope["regenerate"];
  if (committed === undefined || spec.regenerate === undefined || committed === spec.regenerate) {
    return;
  }
  warnings.push(
    `baseline regenerate annotation is stale; regenerate with \`${spec.regenerate}\` (committed ${JSON.stringify(committed)})`,
  );
}

export function parseGroupedBaselineDocument<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  text: string,
): GroupedParseResult<GroupedBaseline<GroupMeta, Item>> {
  const parsedJson = parseJson(text, spec.conflictMarkerRemediation);
  if (!parsedJson.ok) return parsedJson;
  const envelope = checkedEnvelope(spec, parsedJson.value);
  if (!envelope.ok) return envelope;
  const warnings: string[] = [];
  collectRegenerateWarning(spec, envelope.value, warnings);
  const groups =
    spec.rootKey === "tests"
      ? parseTestsFamily(spec, envelope.value, warnings)
      : parseEntriesFamily(spec, envelope.value, warnings);
  if (!groups.ok) return groups;
  const version = envelope.value["version"];
  if (typeof version !== "number")
    return { ok: false, error: "baseline version must be an integer" };
  const regenerate = envelope.value["regenerate"];
  const value = {
    version,
    ...(regenerate === undefined ? {} : { regenerate }),
    groups: groups.value,
  };
  return warnings.length > 0 ? { ok: true, value, warnings } : { ok: true, value };
}

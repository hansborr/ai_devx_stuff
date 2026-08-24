import type { PacketItemGroup, TriagePacketLane } from "./triage-packet-types.js";
import type { TriageItem } from "./triage-report-types.js";

type CoreLane = Omit<TriagePacketLane, "area">;

export function groupPacketItems(
  items: readonly TriageItem[],
  packetSize: number,
): PacketItemGroup[] {
  const laneItems = new Map<string, { lane: CoreLane; items: TriageItem[] }>();
  for (const item of items) addToLane(laneItems, item);
  const groups: PacketItemGroup[] = [];
  for (const lane of laneItems.values()) {
    groups.push(...packComponents(lane.lane, connectedComponents(lane.items), packetSize));
  }
  return groups;
}

function addToLane(
  lanes: Map<string, { lane: CoreLane; items: TriageItem[] }>,
  item: TriageItem,
): void {
  const lane = coreLaneForItem(item);
  const key = JSON.stringify(lane);
  const existing = lanes.get(key);
  if (existing === undefined) lanes.set(key, { lane, items: [item] });
  else existing.items.push(item);
}

function connectedComponents(items: readonly TriageItem[]): TriageItem[][] {
  const remaining = [...items];
  const components: TriageItem[][] = [];
  while (remaining.length > 0) {
    const first = remaining.shift();
    if (first === undefined) break;
    const component = [first];
    const paths = new Set(itemPaths(first));
    let foundConnection = true;
    while (foundConnection) foundConnection = absorbConnected(remaining, component, paths);
    components.push(component);
  }
  return components;
}

function absorbConnected(
  remaining: TriageItem[],
  component: TriageItem[],
  paths: Set<string>,
): boolean {
  let found = false;
  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    const candidate = remaining[index];
    if (candidate === undefined || !itemPaths(candidate).some((path) => paths.has(path))) continue;
    remaining.splice(index, 1);
    component.push(candidate);
    for (const path of itemPaths(candidate)) paths.add(path);
    found = true;
  }
  return found;
}

function packComponents(
  lane: CoreLane,
  components: readonly TriageItem[][],
  packetSize: number,
): PacketItemGroup[] {
  const groups: PacketItemGroup[] = [];
  let pending: TriageItem[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    groups.push(toGroup(lane, pending, false));
    pending = [];
  };
  for (const component of components) {
    if (component.length > packetSize) {
      flush();
      groups.push(...splitComponent(lane, component, packetSize));
      continue;
    }
    if (pending.length + component.length > packetSize) flush();
    pending.push(...component);
    if (pending.length === packetSize) flush();
  }
  flush();
  return groups;
}

function splitComponent(
  lane: CoreLane,
  component: readonly TriageItem[],
  packetSize: number,
): PacketItemGroup[] {
  const groups: PacketItemGroup[] = [];
  const chunkCount = Math.ceil(component.length / packetSize);
  const baseSize = Math.floor(component.length / chunkCount);
  const largerChunks = component.length % chunkCount;
  let offset = 0;
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const size = baseSize + (chunk < largerChunks ? 1 : 0);
    groups.push(toGroup(lane, component.slice(offset, offset + size), true));
    offset += size;
  }
  return groups;
}

function toGroup(
  lane: CoreLane,
  items: readonly TriageItem[],
  splitPathComponent: boolean,
): PacketItemGroup {
  return {
    lane: { ...lane, area: itemArea(items) },
    items: [...items],
    splitPathComponent,
  };
}

function coreLaneForItem(item: TriageItem): CoreLane {
  return { priority: item.priority, category: item.category, source: sourceFamily(item) };
}

function sourceFamily(item: TriageItem): CoreLane["source"] {
  const families = new Set(
    item.evidence.map((evidence) => {
      if (evidence.source === "semgrep") return "semgrep";
      if (evidence.source === "dolos") return "dolos";
      return "drift";
    }),
  );
  if (families.size !== 1) return "mixed";
  return families.values().next().value ?? "mixed";
}

function itemArea(items: readonly TriageItem[]): string {
  const areas = new Set(items.flatMap(itemPaths).map(pathArea));
  return areas.size === 1 ? (areas.values().next().value ?? "unknown") : "mixed";
}

function itemPaths(item: TriageItem): string[] {
  return [...new Set(item.locationDetails.map((location) => location.path))];
}

/**
 * Musi's repository path taxonomy for packet lane areas — policy data, not
 * mechanism. Order-sensitive: the first matching prefix wins, so
 * `scripts/drift-ai/` must stay ahead of `scripts/`. Paths matching no prefix
 * fall back to their first path segment.
 */
export const PATH_AREA_TAXONOMY: readonly { prefix: string; area: string }[] = [
  { prefix: "packages/client/", area: "packages/client" },
  { prefix: "packages/server/", area: "packages/server" },
  { prefix: "packages/shared/", area: "packages/shared" },
  { prefix: "scripts/drift-ai/", area: "scripts/drift-ai" },
  { prefix: "scripts/", area: "scripts" },
  { prefix: "eslint-rules/", area: "eslint-rules" },
];

function pathArea(path: string): string {
  const match = PATH_AREA_TAXONOMY.find(({ prefix }) => path.startsWith(prefix));
  return match?.area ?? path.split("/")[0] ?? "unknown";
}

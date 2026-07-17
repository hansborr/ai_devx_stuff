import { createHash } from "node:crypto";

import { groupPacketItems } from "./triage-packet-group.js";
import { selectTriageItems } from "./triage-packet-select.js";
import { findStaleAdvisories } from "./triage-packet-staleness.js";
import type {
  PacketItemGroup,
  TriagePacket,
  TriagePacketBundle,
  TriagePacketOptions,
  TriagePacketProvenance,
} from "./triage-packet-types.js";
import type { TriageReport } from "./triage-report-types.js";

const DEFAULT_PACKET_SIZE = 20;
const JSON_INDENT = 2;

const VERDICT_CONTRACT = {
  verdicts: ["confirmed", "false-positive", "accepted-drift", "duplicate-of", "needs-human"],
  severities: ["high", "medium", "low", "informational"],
  confidences: ["high", "medium", "low"],
  requiredFields: [
    "itemId",
    "verdict",
    "severity",
    "confidence",
    "rationale",
    "verifiedLocations",
    "recommendedAction",
    "canonicalItemId",
  ],
  duplicateOfRequires: "canonicalItemId",
} as const;

const PACKET_TASK =
  "Inspect the cited source and return one verdict for every item ID. Do not edit code. " +
  "Use the manifest's verdict contract, cite concrete evidence, and mark uncertainty as needs-human. " +
  "For items listed in disclosures.staleAdvisories, return needs-human and recommend regenerating the advisory.";

export function buildTriagePackets(
  report: TriageReport,
  options: TriagePacketOptions,
  provenance: TriagePacketProvenance,
): TriagePacketBundle {
  const packetSize = options.packetSize ?? DEFAULT_PACKET_SIZE;
  validatePacketSize(packetSize);
  const selected = selectTriageItems(report, options);
  const groups = groupPacketItems(selected.items, packetSize);
  const packets = groups.map((group, index) =>
    buildPacket(report, group, index, provenance, options.readSourceFile),
  );
  return {
    packets,
    manifest: {
      schemaVersion: 1,
      kind: "drift-triage-packet-manifest",
      triageSchemaVersion: report.schemaVersion,
      provenance,
      packetSize,
      filters: selected.filters,
      selection: selected.selection,
      packets: packets.map((packet) => ({
        packetId: packet.packetId,
        file: `${packet.packetId}.json`,
        itemCount: packet.items.length,
        itemIds: packet.itemIds,
        lane: packet.lane,
        oversized: packet.oversized,
        splitPathComponent: packet.splitPathComponent,
        sha256: sha256(renderPacket(packet)),
      })),
    },
  };
}

export function renderPacket(packet: TriagePacket): string {
  return JSON.stringify(packet, null, JSON_INDENT);
}

function buildPacket(
  report: TriageReport,
  group: PacketItemGroup,
  index: number,
  provenance: TriagePacketProvenance,
  readSourceFile: TriagePacketOptions["readSourceFile"],
): TriagePacket {
  const packetId = `packet-${String(index + 1).padStart(3, "0")}`;
  return {
    schemaVersion: 1,
    kind: "drift-triage-packet",
    packetId,
    lane: group.lane,
    oversized: group.oversized,
    splitPathComponent: group.splitPathComponent,
    itemIds: group.items.map((item) => item.id),
    task: PACKET_TASK,
    verdictContract: VERDICT_CONTRACT,
    disclosures: {
      policy: report.policy,
      summary: report.summary,
      inputs: report.inputs,
      deferred: report.deferred,
      staleAdvisories: findStaleAdvisories(report.inputs, group.items, provenance, readSourceFile),
    },
    items: group.items,
  };
}

function validatePacketSize(packetSize: number): void {
  if (!Number.isInteger(packetSize) || packetSize <= 0) {
    throw new Error("packetSize must be a positive integer");
  }
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

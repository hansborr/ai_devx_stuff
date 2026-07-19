import type {
  CollectedVerdict,
  CurrentSourceState,
  NamedTriageVerdictFile,
  PacketManifestInput,
  TriageVerdict,
  VerdictCollectionReport,
} from "./triage-verdict-types.js";

export function collectTriageVerdicts(
  manifest: PacketManifestInput,
  files: readonly NamedTriageVerdictFile[],
  currentSource?: CurrentSourceState,
): VerdictCollectionReport {
  const ownership = buildOwnership(manifest);
  const collected = collectFiles(files, ownership);
  validateCanonicalItems(collected, ownership);
  const verdicts = orderVerdicts(collected, manifest);
  const missing = missingByPacket(manifest, collected);
  return {
    schemaVersion: 1,
    kind: "drift-triage-verdict-collection",
    sourceState: sourceState(manifest, currentSource),
    summary: buildSummary(manifest, verdicts, missing),
    missing,
    verificationQueue: buildVerificationQueue(verdicts),
    verdicts,
  };
}

function buildOwnership(manifest: PacketManifestInput): Map<string, string> {
  const ownership = new Map<string, string>();
  const packetIds = new Set<string>();
  for (const packet of manifest.packets) {
    if (packetIds.has(packet.packetId)) throw new Error(`duplicate packet ID ${packet.packetId}`);
    packetIds.add(packet.packetId);
    for (const itemId of packet.itemIds) {
      if (ownership.has(itemId)) throw new Error(`item ${itemId} is assigned more than once`);
      ownership.set(itemId, packet.packetId);
    }
  }
  return ownership;
}

function collectFiles(
  files: readonly NamedTriageVerdictFile[],
  ownership: ReadonlyMap<string, string>,
): Map<string, CollectedVerdict> {
  const collected = new Map<string, CollectedVerdict>();
  const packetIds = new Set(ownership.values());
  for (const file of files) {
    if (!packetIds.has(file.result.packetId)) {
      throw new Error(`unknown packet ${file.result.packetId} in ${file.path}`);
    }
    for (const verdict of file.result.verdicts) {
      validateOwnership(verdict, file.result.packetId, ownership);
      if (collected.has(verdict.itemId)) {
        throw new Error(`duplicate verdict for item ${verdict.itemId}`);
      }
      collected.set(verdict.itemId, {
        ...verdict,
        packetId: file.result.packetId,
        inputPath: file.path,
        reviewer: file.result.reviewer,
      });
    }
  }
  return collected;
}

function validateOwnership(
  verdict: TriageVerdict,
  packetId: string,
  ownership: ReadonlyMap<string, string>,
): void {
  const owner = ownership.get(verdict.itemId);
  if (owner === undefined) throw new Error(`unknown item ${verdict.itemId}`);
  if (owner !== packetId) {
    throw new Error(`item ${verdict.itemId} belongs to ${owner}, not ${packetId}`);
  }
}

function validateCanonicalItems(
  collected: ReadonlyMap<string, CollectedVerdict>,
  ownership: ReadonlyMap<string, string>,
): void {
  for (const verdict of collected.values()) {
    if (verdict.verdict !== "duplicate-of") {
      if (verdict.canonicalItemId !== null) {
        throw new Error(
          `${verdict.verdict} verdict for ${verdict.itemId} cannot set canonicalItemId`,
        );
      }
      continue;
    }
    if (verdict.canonicalItemId === null) {
      throw new Error(`duplicate-of verdict for ${verdict.itemId} requires canonicalItemId`);
    }
    if (verdict.canonicalItemId === verdict.itemId) {
      throw new Error(`duplicate-of verdict for ${verdict.itemId} cannot reference itself`);
    }
    if (!ownership.has(verdict.canonicalItemId)) {
      throw new Error(`canonical item ${verdict.canonicalItemId} is not assigned`);
    }
  }
}

function orderVerdicts(
  collected: ReadonlyMap<string, CollectedVerdict>,
  manifest: PacketManifestInput,
): CollectedVerdict[] {
  const ordered: CollectedVerdict[] = [];
  for (const packet of manifest.packets) {
    for (const itemId of packet.itemIds) {
      const verdict = collected.get(itemId);
      if (verdict !== undefined) ordered.push(verdict);
    }
  }
  return ordered;
}

function missingByPacket(
  manifest: PacketManifestInput,
  collected: ReadonlyMap<string, CollectedVerdict>,
): VerdictCollectionReport["missing"] {
  return manifest.packets
    .map((packet) => ({
      packetId: packet.packetId,
      itemIds: packet.itemIds.filter((itemId) => !collected.has(itemId)),
    }))
    .filter((packet) => packet.itemIds.length > 0);
}

function buildSummary(
  manifest: PacketManifestInput,
  verdicts: readonly CollectedVerdict[],
  missing: VerdictCollectionReport["missing"],
): VerdictCollectionReport["summary"] {
  const assignedItems = manifest.packets.reduce(
    (total, packet) => total + packet.itemIds.length,
    0,
  );
  const missingCounts = new Map(missing.map((packet) => [packet.packetId, packet.itemIds.length]));
  let completedPackets = 0;
  let partialPackets = 0;
  let unstartedPackets = 0;
  for (const packet of manifest.packets) {
    const missingCount = missingCounts.get(packet.packetId) ?? 0;
    if (missingCount === 0) completedPackets += 1;
    else if (missingCount === packet.itemIds.length) unstartedPackets += 1;
    else partialPackets += 1;
  }
  return {
    assignedItems,
    receivedVerdicts: verdicts.length,
    missingItems: assignedItems - verdicts.length,
    totalPackets: manifest.packets.length,
    completedPackets,
    partialPackets,
    unstartedPackets,
    byVerdict: countBy(verdicts, (verdict) => verdict.verdict),
    bySeverity: countBy(verdicts, (verdict) => verdict.severity),
  };
}

function countBy<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function buildVerificationQueue(
  verdicts: readonly CollectedVerdict[],
): VerdictCollectionReport["verificationQueue"] {
  const queue: VerdictCollectionReport["verificationQueue"][number][] = [];
  for (const verdict of verdicts) {
    if (verdict.verdict === "needs-human") {
      queue.push({ itemId: verdict.itemId, packetId: verdict.packetId, reason: "needs-human" });
      continue;
    }
    if (
      verdict.verdict === "confirmed" &&
      (verdict.severity === "high" || verdict.severity === "medium")
    ) {
      queue.push({
        itemId: verdict.itemId,
        packetId: verdict.packetId,
        reason: "confirmed-medium-or-high",
      });
    }
  }
  return queue;
}

function sourceState(
  manifest: PacketManifestInput,
  current: CurrentSourceState | undefined,
): VerdictCollectionReport["sourceState"] {
  const currentGitHead = current?.gitHead ?? null;
  const stale =
    manifest.provenance.gitHead === null || currentGitHead === null
      ? null
      : manifest.provenance.gitHead !== currentGitHead;
  return {
    manifestGitHead: manifest.provenance.gitHead,
    currentGitHead,
    stale,
    manifestDirty: manifest.provenance.gitDirty,
    currentDirty: current?.gitDirty ?? null,
  };
}

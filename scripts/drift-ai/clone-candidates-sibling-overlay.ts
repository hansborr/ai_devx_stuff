import path from "node:path";

import { formatPercent } from "./advisory-format-helpers.js";
import type { GhostFileAllowedPair } from "./config.js";
import { pairKey as ghostPairKey } from "./ghost-files-findings.js";
import type { NearDuplicateFunctionRef } from "./near-duplicates.js";
import { toPosix, uniqSorted } from "./path-util.js";
import {
  classifySiblingPair,
  type SiblingCaveatLabeler,
  type SiblingMarker,
  type SiblingNamingPair,
} from "./sibling-naming.js";

export type CloneCandidateSiblingOverlayOptions = {
  readonly allowedPairs?: readonly GhostFileAllowedPair[];
  readonly caveatLabeler?: SiblingCaveatLabeler;
};

export type CloneCandidateSiblingOverlayContext = {
  readonly allowedPairKeys: ReadonlySet<string>;
  readonly caveatLabeler?: SiblingCaveatLabeler;
};

export type CloneCandidateSiblingOverlayRow = {
  readonly candidateSource: "minhash-lsh";
  readonly comparator: "ts-morph";
  readonly comparatorAgreed: boolean;
  readonly left: NearDuplicateFunctionRef;
  readonly right: NearDuplicateFunctionRef;
  readonly estimatedSimilarity: number;
  readonly comparatorSimilarity: number | null;
  readonly threshold: number;
};

type CloneCandidateSiblingNamingEvidence = {
  readonly source: "near-duplicate-row";
  readonly candidateSource: "minhash-lsh";
  readonly comparator: "ts-morph";
  readonly comparatorAgreed: boolean;
  readonly estimatedSimilarity: number;
  readonly comparatorSimilarity: number | null;
  readonly threshold: number;
};

export type CloneCandidateSiblingNamingOverlay = {
  readonly leftPath: string;
  readonly rightPath: string;
  readonly sharedTokens: readonly string[];
  readonly leftMarkers: readonly SiblingMarker[];
  readonly rightMarkers: readonly SiblingMarker[];
  readonly relation: SiblingNamingPair["relation"];
  readonly namingPattern: string;
  readonly caveats: readonly string[];
  readonly supportingEvidence: readonly CloneCandidateSiblingNamingEvidence[];
};

export function cloneCandidateSiblingOverlayContext(
  options: CloneCandidateSiblingOverlayOptions,
): CloneCandidateSiblingOverlayContext {
  return {
    allowedPairKeys: new Set(
      (options.allowedPairs ?? []).map((pair) =>
        ghostPairKey(toPosix(pair.files[0]), toPosix(pair.files[1])),
      ),
    ),
    ...(options.caveatLabeler === undefined ? {} : { caveatLabeler: options.caveatLabeler }),
  };
}

export function buildCloneCandidateSiblingOverlay(
  row: CloneCandidateSiblingOverlayRow,
  context: CloneCandidateSiblingOverlayContext,
): CloneCandidateSiblingNamingOverlay | undefined {
  if (!sameDirectory(row.left.filePath, row.right.filePath)) return undefined;
  if (
    context.allowedPairKeys.has(
      ghostPairKey(toPosix(row.left.filePath), toPosix(row.right.filePath)),
    )
  ) {
    return undefined;
  }
  const pair = classifySiblingPair(row.left.filePath, row.right.filePath, {
    ...(context.caveatLabeler === undefined ? {} : { caveatLabeler: context.caveatLabeler }),
  });
  if (pair === undefined) return undefined;
  return {
    leftPath: pair.leftPath,
    rightPath: pair.rightPath,
    sharedTokens: pair.sharedTokens,
    leftMarkers: pair.leftMarkers,
    rightMarkers: pair.rightMarkers,
    relation: pair.relation,
    namingPattern: namingPattern(pair),
    caveats: pair.caveats,
    supportingEvidence: [
      {
        source: "near-duplicate-row",
        candidateSource: row.candidateSource,
        comparator: row.comparator,
        comparatorAgreed: row.comparatorAgreed,
        estimatedSimilarity: row.estimatedSimilarity,
        comparatorSimilarity: row.comparatorSimilarity,
        threshold: row.threshold,
      },
    ],
  };
}

export function formatCloneCandidateSiblingOverlay(
  overlay: CloneCandidateSiblingNamingOverlay,
): readonly string[] {
  return [
    `sibling naming overlay: ${overlay.leftPath} <=> ${overlay.rightPath}; pattern ${overlay.namingPattern}; shared tokens ${formatTokenList(overlay.sharedTokens)}`,
    `sibling markers: ${formatMarkers("left", overlay.leftMarkers)}; ${formatMarkers(
      "right",
      overlay.rightMarkers,
    )}`,
    `supporting evidence: ${formatSupportingEvidence(overlay.supportingEvidence)}`,
    `caveats: ${overlay.caveats.join(" | ")}`,
  ];
}

function sameDirectory(left: string, right: string): boolean {
  return path.posix.dirname(toPosix(left)) === path.posix.dirname(toPosix(right));
}

function namingPattern(pair: SiblingNamingPair): string {
  return `${pair.relation} (${formatMarkersForPattern(pair)})`;
}

function formatMarkersForPattern(pair: SiblingNamingPair): string {
  const markers = [
    ...pair.leftMarkers.map((marker) => markerPattern("left", marker)),
    ...pair.rightMarkers.map((marker) => markerPattern("right", marker)),
  ];
  return markers.length > 0 ? markers.join(", ") : "no variant marker";
}

function markerPattern(side: "left" | "right", marker: SiblingMarker): string {
  return `${side} ${marker.token}/${marker.kind}/${marker.position}`;
}

function formatMarkers(side: "left" | "right", markers: readonly SiblingMarker[]): string {
  if (markers.length === 0) return `${side} none`;
  return `${side} ${markers
    .map((marker) => `${marker.token}/${marker.kind}/${marker.position}`)
    .join(", ")}`;
}

function formatSupportingEvidence(entries: readonly CloneCandidateSiblingNamingEvidence[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.source} (${entry.candidateSource} estimate ${formatPercent(
          entry.estimatedSimilarity,
          1,
        )}; comparator ${entry.comparator} ${entry.comparatorAgreed ? "agreed" : "did not agree"} ${formatNullablePercent(
          entry.comparatorSimilarity,
        )}; threshold ${formatPercent(entry.threshold, 1)})`,
    )
    .join("; ");
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "n/a" : formatPercent(value, 1);
}

function formatTokenList(tokens: readonly string[]): string {
  return tokens.length > 0 ? uniqSorted(tokens).join(", ") : "(none)";
}

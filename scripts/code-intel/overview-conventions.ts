/**
 * Musi conventions for the router-overview call-target heuristics — an adopter
 * swaps this module wholesale for their own repository's spellings, keeping the
 * exported names and the `OverviewConventions` shape intact.
 *
 * These are heuristics; absence of matches is not evidence of absence: a call
 * that follows none of these conventions silently disappears from the overview
 * rather than being reported as unmatched, so an empty result is not
 * authoritative.
 */

export type OverviewConventions = {
  /** Import-path fragments that classify an imported callable as a service call. */
  readonly serviceImportPathFragments: readonly string[];
  /** Import-path fragments that classify an imported callable as a broadcast helper. */
  readonly broadcastImportPathFragments: readonly string[];
  /** Imported-name prefixes that classify a callable as a broadcast helper. */
  readonly broadcastNamePrefixes: readonly string[];
  /** Imported-name suffixes that classify a callable as a broadcast helper. */
  readonly broadcastNameSuffixes: readonly string[];
  /** Spelling of the emit method in the socket emit chain (`<server>.<room>(...).<emit>(...)`). */
  readonly socketEmitMethod: string;
  /** Spelling of the room-targeting method in the socket emit chain. */
  readonly socketRoomMethod: string;
  /** Spelling of the socket server identifier that owns the emit chain. */
  readonly socketServerIdentifier: string;
};

export const DEFAULT_OVERVIEW_CONVENTIONS: OverviewConventions = {
  serviceImportPathFragments: ["/services/"],
  broadcastImportPathFragments: ["/socket/", "/utils/character-campaign"],
  broadcastNamePrefixes: ["broadcast", "emit"],
  broadcastNameSuffixes: ["Broadcast"],
  socketEmitMethod: "emit",
  socketRoomMethod: "to",
  socketServerIdentifier: "io",
};

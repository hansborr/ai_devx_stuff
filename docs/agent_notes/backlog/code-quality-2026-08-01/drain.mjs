#!/usr/bin/env node
/**
 * The drain surface for this pack: what is available, what a pick collides
 * with, what to send an implementer, and who holds the drain lock.
 *
 * This exists so an orchestrator does not have to read a protocol document to
 * dispatch a unit. Everything it prints is derived from live state — the
 * reviewed edge graph, `drain-queue.json`, merge commits on `main`, carrier
 * records, live lane branches, and the lock directory.
 *
 * `record` appends one carrier record; `lock acquire` / `lock release` manage
 * one directory in the shared git dir. Run `node drain.mjs --check` after
 * changing this tool or its machine data.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CATEGORY_ORDER,
  CONCURRENCY_BLOCKING_CATEGORIES,
  categoryForKind,
  relationToken,
} from "./working/phase5/edge-graph-relations.mjs";
import {
  MINIMUM_CONSTRAINT_NOTICE,
  edgesBetween,
  fail,
  leafByFile,
  leafByNumber,
  leaves,
  normalizeNumber,
  normalizedEdges,
  planSliceIds,
  provenanceLabel,
  relationsForLeaf,
  resolveLeaf,
} from "./working/phase5/pack-model.mjs";

const packRoot = dirname(fileURLToPath(import.meta.url));
const packDir = "docs/agent_notes/backlog/code-quality-2026-08-01";
const selfPath = `${packDir}/drain.mjs`;
const queue = JSON.parse(readFileSync(join(packRoot, "drain-queue.json"), "utf8"));
const CARRIER_FILE = "drain-carriers.jsonl";
const LANE_ROOT = "/home/node/persist/worktrees";
const LOCK_NAME = "musi-cq-drain.lock";

const git = (args) =>
  execFileSync("git", args, { cwd: packRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * A unit is what everything is keyed by: the lane branch and landed state. For
 * an ordinary leaf the unit is the leaf (`154`).
 * For a sliced plan it is one slice (`107-S0`), except 108, which lands whole.
 */
const parseUnit = (raw) => {
  const match = /^(\d{1,3})(?:-(S\d+|\d+\.\d+))?$/u.exec(raw.trim());
  if (!match) fail(`not a unit id: ${raw} (expected 154, 107-S0, or 108)`);
  const leaf = resolveLeaf(match[1]);
  const plan = queue.plans[leaf.number];
  const sliceIds = leaf.planFile ? planSliceIds(leaf.number) : [];
  const slice = match[2] ?? null;

  if (!leaf.planFile) {
    if (slice) fail(`leaf ${leaf.number} has no plan, so ${raw} is not a unit — use ${leaf.number}`);
    return { id: leaf.number, leaf, slice: null, plan: null, sliceIds };
  }
  if (plan?.landing === "whole-plan") {
    if (slice) {
      fail(`${leaf.number} lands as one whole-plan unit — use ${leaf.number}, not ${raw}`);
    }
    return { id: leaf.number, leaf, slice: null, plan, sliceIds };
  }
  if (!slice) {
    fail(
      `${leaf.number} lands slice by slice — name one: ${sliceIds.map((id) => `${leaf.number}-${id}`).join(", ")}`,
    );
  }
  if (sliceIds.length && !sliceIds.includes(slice)) {
    fail(`${leaf.number}-PLAN.md declares no slice ${slice} (it has ${sliceIds.join(", ")})`);
  }
  return { id: `${leaf.number}-${slice}`, leaf, slice, plan, sliceIds };
};

/** The unit ids a leaf currently splits into, in landing order. */
const unitIdsForLeaf = (leaf) => {
  const plan = queue.plans[leaf.number];
  if (!leaf.planFile || plan?.landing === "whole-plan") return [leaf.number];
  const sliceIds = planSliceIds(leaf.number);
  return sliceIds.length ? sliceIds.map((id) => `${leaf.number}-${id}`) : [leaf.number];
};

const branchFor = (unitId) => `fix/cq-${unitId}`;
const lanePathFor = (unitId) => `${LANE_ROOT}/cq-${unitId}`;

// ---------------------------------------------------------------------------
// Live state: merges, carrier records, lanes, lock
// ---------------------------------------------------------------------------

export const parseCarrierRecords = (text) => {
  const records = new Map();
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      fail(`${CARRIER_FILE}:${index + 1} is not valid JSON`);
    }
    if (typeof record?.unit !== "string" || typeof record?.carrier !== "string") {
      fail(`${CARRIER_FILE}:${index + 1} needs string unit and carrier fields`);
    }
    const unit = parseUnit(record.unit).id;
    const carrier = parseUnit(record.carrier).id;
    if (unit === carrier) fail(`${CARRIER_FILE}:${index + 1} cannot map a unit to itself`);
    if (records.has(unit)) fail(`${CARRIER_FILE} records ${unit} more than once`);
    records.set(unit, carrier);
  }
  return records;
};

export const mergeDecisionCarriers = (records, dec) => {
  const merged = new Map(records);
  for (const entry of dec.colandCarriers ?? []) {
    const carrier = parseUnit(entry.carrier).id;
    for (const rawUnit of entry.covers ?? []) {
      const unit = parseUnit(rawUnit).id;
      if (unit === carrier) continue;
      const existing = merged.get(unit);
      if (existing !== undefined && existing !== carrier) {
        fail(
          `${unit} already has a batch carrier record (${existing}); ${entry.edge} owns its co-land carrier`,
        );
      }
      merged.set(unit, carrier);
    }
  }
  return merged;
};

export const carrierChainErrors = (records) =>
  [...records].flatMap(([unit, carrier]) =>
    records.has(carrier)
      ? [`${unit} names carrier ${carrier}, which is itself a covered unit`]
      : [],
  );

export const landedFromMergeLog = (text, carrierRecords) => {
  const landed = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([0-9a-f]+)\tMerge branch 'fix\/cq-(\d{3}(?:-(?:S\d+|\d+\.\d+))?)'$/u.exec(
      line,
    );
    if (!match) continue;
    const [, merge, unit] = match;
    landed.set(unit, { unit, branch: branchFor(unit), merge });
  }
  const directLandings = new Map(landed);
  for (const [unit, carrier] of carrierRecords) {
    const carrierLanding = directLandings.get(carrier);
    if (!carrierLanding) continue;
    landed.set(unit, { unit, branch: branchFor(carrier), merge: carrierLanding.merge });
  }
  return landed;
};

const carrierRecords = () => {
  const path = join(packRoot, CARRIER_FILE);
  let text;
  try {
    text = git(["show", `main:${packDir}/${CARRIER_FILE}`]);
  } catch {
    text = existsSync(path) ? readFileSync(path, "utf8") : "";
  }
  return parseCarrierRecords(text);
};

const landedUnits = () =>
  landedFromMergeLog(
    git(["log", "main", "--first-parent", "--merges", "--format=%H%x09%s"]),
    mergeDecisionCarriers(carrierRecords(), decisions),
  );

/**
 * Open lane claims. The branch is the claim: branch names are visible repo-wide
 * the moment they exist, which makes them the only in-flight signal that works
 * across sessions. The globs are exact-width so they cannot pick up the
 * 2026-07-25 pack's legacy `fix/cq-*` branches.
 */
const openLanes = () => {
  const output = git([
    "branch",
    "--list",
    "--format=%(refname:short)",
    "fix/cq-[0-9][0-9][0-9]",
    "fix/cq-[0-9][0-9][0-9]-S[0-9]",
    "fix/cq-[0-9][0-9][0-9]-[0-9].[0-9]",
  ]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((branch) => branch.slice("fix/cq-".length))
    .sort();
};

// `--git-common-dir` answers relative to the caller's cwd, so resolve it before
// use: an unresolved `../../../../.git` would silently miss the real lock.
const lockDir = () => join(resolve(packRoot, git(["rev-parse", "--git-common-dir"]).trim()), LOCK_NAME);

const lockState = () => {
  const dir = lockDir();
  return { held: existsSync(dir), dir };
};

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

const CATEGORY_VERDICT = {
  hard: "HARD ORDER — the named peer must land first; never concurrent",
  serialize: "SERIAL — either order is fine, but never two open lanes at once",
  coland: "CO-LAND — the pair is one landing unit",
  outcome: "DECIDE FIRST — one may moot the other; settle the outcome before scheduling",
  rebase: "REBASE — concurrency permitted; whichever lands later reconciles the earlier outcome",
  preference: "PREFERENCE — reversible ordering hint only",
};

/** What an incident peer outside the pick means for the lane you are opening. */
const EXTERNAL_ADVICE = {
  hard: "keep out of flight, and settle the order first",
  serialize: "keep out of flight while this lane runs",
  coland: "keep out of flight — the pair lands together",
  outcome: "keep out of flight — decide the outcome first",
  rebase: "concurrency permitted; reconcile whichever lands later",
  preference: "ordering hint only",
};

const normalizedById = new Map(normalizedEdges.map((normalized) => [normalized.edge.id, normalized]));

/**
 * The remedies an edge actually imposes.
 *
 * One reviewed edge can carry several sequencings, and when an adjudicator put
 * a `rebase` or preference remedy on the *same* edge as a mooting one, that
 * permitting remedy is the way through — `s3-003-097` is both
 * `rebaseOn: 003 → 097` and `moots-slice: 097 → 003`, and the pair is meant to
 * proceed and reconcile. So the outcome half of that edge is dropped.
 *
 * Scoped to the edge, never to the pair. Two leaves can carry several separate
 * declared edges — 097 and 203 have four — and a `rebaseOn` edge beside a
 * `moots` edge resolves nothing about the mooting. Widening this to the pair
 * silently freed the pack's only `alternativeTo` cluster.
 */
export const effectiveSequencing = (sequencing) => {
  const permits = sequencing.some((sequence) =>
    ["rebase", "preference"].includes(categoryForKind(sequence.kind)),
  );
  return permits
    ? sequencing.filter((sequence) => categoryForKind(sequence.kind) !== "outcome")
    : sequencing;
};

/** The full effective sequencing of the edge a relation came from. */
const effectiveForRelation = (relation) => {
  const normalized = normalizedById.get(relation.edgeId);
  const full = normalized?.sequencing ?? relation.sequencing;
  const effective = new Set(effectiveSequencing(full));
  return relation.sequencing.filter((sequence) => effective.has(sequence));
};

/** Every constraint between two leaves, each carrying its own remedy. */
export const pairConstraints = (left, right) => {
  const found = [];
  for (const normalized of edgesBetween(left.file, right.file)) {
    for (const sequence of effectiveSequencing(normalized.sequencing)) {
      const prefix = normalized.edge.provenance === "s3" ? `S3-${normalized.edge.kind}!` : "";
      const category = categoryForKind(sequence.kind);
      found.push({
        category,
        token: `${prefix}${relationToken(sequence, left.file, right.number)}`,
        warrant: sequence.warrant,
        provenance: provenanceLabel(normalized.edge),
        // Only "these two lanes must not be open together". Say nothing about
        // whether either may be opened at all — that is an obligation, below.
        blocking: CONCURRENCY_BLOCKING_CATEGORIES.has(category),
        // For a hard order the direction is load-bearing: `from` is the
        // dependent, `to` is the prerequisite that has to land first.
        prerequisiteFile: sequence.kind === "requires" ? sequence.to : null,
        dependentFile: sequence.kind === "requires" ? sequence.from : null,
      });
    }
  }
  return found;
};

/** A leaf counts as landed only when every unit it splits into has landed. */
export const leafLanded = (leaf, landed) =>
  unitIdsForLeaf(leaf).every((unitId) => landed.has(unitId));

const decisions = queue.ownerDecisions ?? { outcomes: [], colandCarriers: [] };
const outcomeDecision = (edgeId, dec) =>
  (dec.outcomes ?? []).find((entry) => entry.edge === edgeId) ?? null;
const colandCarrier = (edgeId, dec) =>
  (dec.colandCarriers ?? []).find((entry) => entry.edge === edgeId) ?? null;

/** Every unit id the two endpoint leaves of an edge split into. */
const endpointUnits = (edgeId) =>
  (normalizedById.get(edgeId)?.endpoints ?? []).flatMap((file) => {
    const leaf = leafByFile.get(file);
    return leaf ? unitIdsForLeaf(leaf) : [];
  });

const sameSet = (left, right) =>
  left.length === right.length && [...left].sort().join() === [...right].sort().join();

const edgeCarriesKind = (edgeId, kind) =>
  (normalizedById.get(edgeId)?.sequencing ?? []).some((sequence) => sequence.kind === kind);

/**
 * Why an outcome decision row cannot be acted on, or null when it is usable.
 *
 * The gate and `--check` share this deliberately. Validating in `--check`
 * alone put the rule at the wrong point in the loop: `--check` runs at
 * bookkeeping time, `plan` runs before it, and `plan` is what decides whether
 * work opens. A row the validator would reject must not schedule anything in
 * the window between.
 */
const outcomeRowFault = (entry) => {
  if (!entry.date) return "it needs a date";
  const proceed = entry.proceed ?? [];
  const named = [...proceed, ...(entry.moot ?? [])];
  const endpoints = endpointUnits(entry.edge);
  // Decide by omission and a row with neither field free both ends — the
  // round-3 defect one level down.
  if (!sameSet(named, endpoints)) {
    return `proceed+moot must name exactly ${endpoints.join(", ")}, got ${named.join(", ") || "nothing"}`;
  }
  // `moots` claims one leaf *may* make another unnecessary, and the owner is
  // entitled to find that it did not. `alternativeTo` is not a maybe: doing
  // both is the outcome the edge exists to prevent.
  if (edgeCarriesKind(entry.edge, "alternativeTo") && proceed.length !== 1) {
    return `${entry.edge} is an either/or, so exactly one side may proceed, got ${proceed.join(", ") || "nothing"}`;
  }
  return null;
};

/**
 * Constraints that forbid opening a lane for this leaf *at all* right now,
 * whatever else is in the pick. Distinct from the concurrency question: a
 * `serial` peer only stops two lanes running together, while an unlanded
 * prerequisite, an unresolved co-land pair, or an undecided outcome stops this
 * lane outright.
 *
 * Every one of these is *resolvable*, and it has to be: a block whose only
 * clearing condition is the peer landing deadlocks when the peer is blocked by
 * the same edge. Prerequisites clear when the peer lands; outcome and co-land
 * clear when the owner records a decision in `drain-queue.json`.
 */
export const unmetObligations = (leaf, landed, dec = decisions) => {
  const found = [];
  const unitsOf = (peer) => unitIdsForLeaf(peer);
  for (const relation of relationsForLeaf(leaf.file)) {
    const peer = leafByFile.get(relation.other);
    if (!peer) continue;
    const prefix = relation.provenance === "s3" ? `S3-${relation.relation}!` : "";
    const peerLanded = leafLanded(peer, landed);
    for (const sequence of effectiveForRelation(relation)) {
      const category = categoryForKind(sequence.kind);
      const token = `${prefix}${relationToken(sequence, leaf.file, peer.number)}`;
      if (category === "hard") {
        if (peerLanded) continue;
        // A `requires` sequence runs dependent → prerequisite, so this leaf is
        // blocked only when it is the `from` side (its token reads `after:`).
        // On the `to` side the token reads `before:` — the peer waits on us.
        if (sequence.from !== leaf.file) continue;
        found.push({
          category,
          peer,
          token,
          warrant: sequence.warrant,
          why: `${peer.number} must land first`,
        });
      } else if (category === "coland") {
        const ownLanded = unitsOf(leaf).every((unitId) => landed.has(unitId));
        if (ownLanded) continue;
        const carrier = colandCarrier(relation.edgeId, dec);
        if (carrier?.carrier === leaf.number) continue;
        found.push({
          category,
          peer,
          token,
          warrant: sequence.warrant,
          why: carrier
            ? `covered by the ${carrier.carrier} lane, which carries this co-land pair`
            : `co-lands with ${peer.number} — one branch has to contain both, so the owner names a carrier unit in drain-queue.json before either can open`,
        });
      } else if (category === "outcome") {
        const decision = outcomeDecision(relation.edgeId, dec);
        const fault = decision ? outcomeRowFault(decision) : null;
        if (decision && fault) {
          found.push({
            category,
            peer,
            token,
            warrant: sequence.warrant,
            why: `the ${relation.edgeId} row under ownerDecisions.outcomes is unusable — ${fault}. Fix the row and re-run \`node drain.mjs --check\` rather than opening a lane`,
          });
          continue;
        }
        if (decision) {
          // Cleared by naming this unit in `proceed`, never by mere presence of
          // a row: "A wins, drop B" must not free B.
          //
          // Positive membership rather than absence-from-`moot`. Given the
          // coverage rule above the two are equivalent, and no test separates
          // them, because every outcome edge in this graph joins two
          // single-unit leaves. It is written this way so that if a row ever
          // reaches here unvalidated, the failure is a block and not a release.
          if (unitsOf(leaf).every((unitId) => (decision.proceed ?? []).includes(unitId))) continue;
          found.push({
            category,
            peer,
            token,
            warrant: sequence.warrant,
            why: `recorded as moot by the ${decision.date} decision on ${relation.edgeId} — do not schedule it`,
          });
          continue;
        }
        // No `peerLanded` exit. Landing the peer may produce the information
        // the owner needs, but it does not record what they decided, and this
        // leaf may be wholly moot. That shortcut predated `ownerDecisions` and
        // was the only way out before the decision rows existed.
        //
        // The mooting side is not blocked by its own mooting — landing it is
        // how the outcome gets decided. `alternativeTo` is a genuine either/or
        // and blocks both ends.
        if (sequence.kind !== "alternativeTo" && sequence.from === leaf.file) continue;
        const bothEnds = sequence.kind === "alternativeTo";
        found.push({
          category,
          peer,
          token,
          warrant: sequence.warrant,
          why: bothEnds
            ? `either this or ${peer.number}, not both — the owner records which proceeds in drain-queue.json before either can open`
            : `${peer.number} may moot all or part of this — the owner records the outcome in drain-queue.json before this one can open`,
        });
      }
    }
  }
  return found;
};

/** Peers outside the picked/in-flight set that carry a constraint on a leaf. */
const externalPeers = (leaf, insideNumbers, landed) => {
  const peers = new Map();
  for (const normalized of normalizedEdges) {
    if (!normalized.endpoints.includes(leaf.file)) continue;
    const otherFile = normalized.endpoints.find((endpoint) => endpoint !== leaf.file);
    const other = leafByFile.get(otherFile);
    // A landed peer constrains nothing: its work is already on `main`.
    if (!other || insideNumbers.has(other.number) || leafLanded(other, landed)) continue;
    for (const constraint of pairConstraints(leaf, other)) {
      const existing = peers.get(other.number) ?? { peer: other, constraints: [] };
      existing.constraints.push(constraint);
      peers.set(other.number, existing);
    }
  }
  return [...peers.values()].sort((left, right) =>
    left.peer.number.localeCompare(right.peer.number),
  );
};

/**
 * Plan slices run one at a time, in the plan's order. The edge graph cannot
 * express this — both slices are the same leaf, so it sees no edge at all.
 */
export const sliceGate = (unit, landed, lanes) => {
  if (!unit.leaf.planFile) return null;
  const plan = queue.plans[unit.leaf.number] ?? {};
  const ids = unitIdsForLeaf(unit.leaf);

  if (plan.sliceOrder === "independent") {
    // The plan's own dependency edges govern. 109 says S2–S4 are
    // order-independent and may land before or after S1; only the declared
    // pairs may not be open at once. A blanket total order would over-block.
    for (const pair of plan.notConcurrent ?? []) {
      if (!pair.includes(unit.slice)) continue;
      const peerSlice = pair.find((slice) => slice !== unit.slice);
      const peerUnit = `${unit.leaf.number}-${peerSlice}`;
      if (lanes.includes(peerUnit)) {
        return `${peerUnit} is open, and ${unit.leaf.number}-PLAN.md forbids running ${pair.join(" and ")} concurrently`;
      }
    }
    return null;
  }

  const openSibling = ids.find((id) => id !== unit.id && lanes.includes(id));
  if (openSibling) {
    return `sibling slice lane ${openSibling} is open — ${unit.leaf.number}-PLAN.md is strictly sequential`;
  }
  const earlier = ids.slice(0, ids.indexOf(unit.id)).filter((id) => !landed.has(id));
  if (earlier.length) {
    return `earlier slice(s) ${earlier.join(", ")} have not landed — ${unit.leaf.number}-PLAN.md is strictly sequential`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Queue view
// ---------------------------------------------------------------------------

const queueById = (id) => {
  const found = queue.queues.find((candidate) => candidate.id === id);
  if (!found) {
    fail(`unknown queue: ${id} (have ${queue.queues.map((entry) => entry.id).join(", ")})`);
  }
  return found;
};

/**
 * Queue-order defects, read from the reviewed edge graph rather than from the
 * wave labels. A wave is a scheduling proposal, but a dependent scheduled ahead
 * of its prerequisite is not: an unattended drain reaches it, finds it blocked,
 * and has no move left. Preferences are reversible, so one counts only when the
 * queue schedules both sides and neither has landed — an unqueued preferred-
 * first peer constrains nothing.
 */
export const queueOrderProblems = (queueEntries = queue.queues, landed = new Map()) => {
  const position = new Map();
  for (const queueEntry of queueEntries) {
    for (const wave of queueEntry.waves) {
      for (const number of wave.units) {
        const normalized = normalizeNumber(number);
        if (position.has(normalized)) continue;
        position.set(normalized, { order: position.size, where: `${queueEntry.id}/${wave.id}` });
      }
    }
  }
  const leafHasLanded = (number) => {
    const leaf = leafByNumber.get(number);
    return leaf ? leafLanded(leaf, landed) : false;
  };
  const problems = [];
  for (const normalized of normalizedEdges) {
    for (const sequence of normalized.sequencing) {
      const hard = sequence.kind === "requires";
      if (!hard && sequence.kind !== "prefersBefore") continue;
      const dependent = leafByFile.get(sequence.from)?.number;
      const first = leafByFile.get(sequence.to)?.number;
      if (!dependent || !first) continue;
      const dependentAt = position.get(dependent);
      if (!dependentAt) continue;
      if (leafHasLanded(dependent) || leafHasLanded(first)) continue;
      const firstAt = position.get(first);
      if (!firstAt) {
        if (hard) {
          problems.push(
            `${dependentAt.where}: ${dependent} requires ${first}, which is neither queued nor landed (${normalized.edge.id})`,
          );
        }
        continue;
      }
      if (firstAt.order < dependentAt.order) continue;
      problems.push(
        hard
          ? `${dependentAt.where}: ${dependent} is queued before its prerequisite ${first} (${firstAt.where}, ${normalized.edge.id})`
          : `${dependentAt.where}: ${dependent} is queued before ${first} (${firstAt.where}), contradicting the recorded preference (${normalized.edge.id})`,
      );
    }
  }
  return problems;
};

/**
 * Live state of one unit. `free` means dispatchable now: not landed, unclaimed,
 * and carrying no unmet prerequisite, co-land, or outcome obligation. Anything
 * a lane cannot start on today reads as `blocked`, never as free — and a leaf
 * closed by the evidence route reads as `not needed`, a terminal state like
 * `landed`. The unit carries its live-parsed leaf, so the status is injectable
 * the same way landed state is: through the arguments, live in the CLI.
 */
export const unitState = (unit, landed, lanes, dec = decisions) => {
  if (landed.has(unit.id)) return { state: "landed" };
  if (lanes.includes(unit.id)) return { state: "in flight" };
  // Standing rules: the evidence route lands its `Not needed — <evidence>`
  // flip through the lane, so a merge does exist — but it names only the
  // claimed unit. This state keeps every unit the flipped leaf covers
  // terminal — above all a sliced leaf's sibling slices, which no merge
  // ever seats in `landed` — instead of free or blocked again the moment
  // the claim is released.
  if (/^Not needed\b/u.test(unit.leaf.status)) {
    return { state: "not needed", why: unit.leaf.status };
  }
  const slice = sliceGate(unit, landed, lanes);
  if (slice) return { state: "blocked", why: slice };
  const obligations = unmetObligations(unit.leaf, landed, dec);
  if (obligations.length) {
    return {
      state: "blocked",
      why: obligations.map((obligation) => obligation.why).join("; "),
      obligations,
    };
  }
  return { state: "free" };
};

/**
 * Why a unit is not fully closed, or nothing when step 8 truly finished.
 *
 * Step 8's contract as one checkable answer, so a dispatcher audits a
 * conducted unit — or its own close-out — from live state instead of a
 * report. Landing facts only: catalogs and counts are step 5's hand-edited
 * bookkeeping, which `bun run backlog:lint` checks but never regenerates.
 *
 * A leaf whose Status reads `Not needed` closed by the evidence route
 * (standing rules): the lane lands the flip through `land.sh`, so a merge
 * exists and normally seats the unit in `landed`. The two `!notNeeded`
 * exemptions below differ in weight: the landing check's is belt-and-braces
 * for units that merge never names, such as a sliced leaf's sibling slices,
 * but the status check's is load-bearing for the flipped unit itself — its
 * Status reads `Not needed`, never `Landed on fix/cq-…`, so removing that
 * exemption breaks every standard evidence close.
 */
export const closureProblems = (unit, { landed, lanes, worktreeExists, leafStatus }) => {
  const problems = [];
  const notNeeded = /^Not needed\b/u.test(leafStatus);
  if (!notNeeded && !landed.has(unit.id)) {
    problems.push(
      `no merge of ${branchFor(unit.id)} (or of a recorded carrier) is on main — the unit has not landed`,
    );
  }
  if (lanes.includes(unit.id)) {
    problems.push(
      `${branchFor(unit.id)} still exists — delete it (step 8), or the unit reads as permanently in flight`,
    );
  }
  if (worktreeExists) {
    problems.push(
      `lane worktree ${lanePathFor(unit.id)} still exists — bun run worktree:drop ${lanePathFor(unit.id)} --remove`,
    );
  }
  // Sliced plans flip Status once, when the last slice lands, so an earlier
  // slice must not demand it. The prefix requires a `fix/cq-` branch — any
  // unit's, since a passenger legitimately names its carrier — because bare
  // "Landed" prose records no landing branch at all.
  if (!notNeeded && leafLanded(unit.leaf, landed) && !/^Landed on fix\/cq-/u.test(leafStatus)) {
    problems.push(
      `${unit.leaf.file} Status: still reads "${leafStatus}" — flip it to \`Landed on fix/cq-<CARRIER>\` (step 5) and commit`,
    );
  }
  return problems;
};

/** Queue units in wave order, annotated with live availability. */
const queueRows = (queueEntry, landed, lanes) => {
  const rows = [];
  for (const wave of queueEntry.waves) {
    for (const number of wave.units) {
      const leaf = leafByNumber.get(normalizeNumber(number));
      if (!leaf) fail(`${queueEntry.id}/${wave.id}: unknown leaf ${number}`);
      for (const unitId of unitIdsForLeaf(leaf)) {
        const unit = parseUnit(unitId);
        rows.push({
          unitId,
          leaf,
          wave,
          ...unitState(unit, landed, lanes),
        });
      }
    }
  }
  return rows;
};

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const truncate = (text, width) => (text.length <= width ? text : `${text.slice(0, width - 1)}…`);

const table = (headers, rows) => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)),
  );
  const line = (cells) =>
    cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
};

const heading = (text) => `\n${text}\n${"=".repeat(text.length)}`;

// ---------------------------------------------------------------------------
// Mission templates
// ---------------------------------------------------------------------------

/**
 * The implementer and reviewer missions. These are the text an orchestrator
 * sends, so they live next to the state that fills them in — `brief` renders a
 * complete mission with no placeholders left. Edit them here, not in DRAIN.md.
 */
export const implementerMission = (unit, batch = []) => {
  const leafPath = `${packDir}/${unit.leaf.file}`;
  const planPath = `${packDir}/${unit.leaf.number}-PLAN.md`;
  const scope = unit.slice
    ? `Work **only slice \`${unit.slice}\`** of \`${planPath}\`. Read that plan's \`## Slices\` row for \`${unit.slice}\` and the leaf it belongs to (\`${leafPath}\`). Sibling slices land in their own lanes — leaving their work undone is the contract. Use the slice row's own verify commands where they differ from the generic gate advice below.`
    : unit.plan
      ? `The unit is the **whole plan** \`${planPath}\`. Read the plan and its leaf (\`${leafPath}\`); every declared slice lands on this branch.`
      : `Read \`${leafPath}\` in full before editing — \`## Scope / caveats\` first, then \`## Proposed direction\`.`;
  const carrier = (decisions.colandCarriers ?? []).find(
    (entry) => entry.carrier === unit.leaf.number,
  );
  const colandClause = carrier
    ? `\n\n**This lane carries a co-land pair.** It implements every one of ${carrier.covers.join(", ")} on this one branch, because the graph requires them to land together. Read each leaf; \`ownerDecisions.colandCarriers\` already records their carrier membership.`
    : "";
  const batchClause = batch.length
    ? `\n\n**This lane is a batch.** It implements every one of ${[unit, ...batch].map((member) => member.id).join(", ")} on this one branch — the batch-lane procedure in ${packDir}/DRAIN.md. Read each unit's leaf in full before touching its area; a unit you narrow or skip must be called out in your final report, never silently dropped. Record every covered unit before review:\n${batch.map((member) => `node ${selfPath} record ${member.id} --carrier ${unit.id}`).join("\n")}`
    : "";
  return `Work unit **${unit.id}** on branch \`${branchFor(unit.id)}\`, in the worktree you were started in.

${scope}${colandClause}${batchClause}

\`## Problem\` and \`## Evidence\` are load-bearing and every claim carries a \`path:line\`. Line anchors are pinned to the audit and may have rotted, so re-resolve each citation **by symbol name** (\`bun run code:intel\` helps) and expect the claim itself to hold. If a claim no longer holds against the live tree, stop and report that instead of implementing around it.

Constraints:
- TDD. Read the relevant \`docs/guides/\` guide first.
- Do not take on scope the leaf excludes, and do not act on a ruling in \`${packDir}/CONSTRAINTS.md\` as though it were open.
- You may fix a real bug you hit inside this unit's blast radius: add a regression test and say so explicitly in your final report. Do not go looking for bugs outside it.
- Commit incrementally by logical unit with conventional commits; do not defer one large mixed commit to the end.
- The commit gate is the normal verification step — commit and let it run. Reach for \`bun run verify:changed\` directly only when you are not committing or when troubleshooting a gate failure. Never run the full \`bun run verify\`: step 7's \`land.sh\` is this lane's only full gate, and a lane-side run just pays ~15 minutes for the answer it produces again minutes later. If you introduced a file or surface that is not yet a registered verify subject, **flag it in your final report** — selection cannot route what it does not know about, and the land-time full verify is what covers it. Foreground long gates; a backgrounded \`&\` dies with your final turn.
- Do not push, open a PR, or merge.

Done when: the unit's proposed direction is implemented or explicitly and defensibly narrowed, tests cover the change, gates pass, and work is committed on this branch. Report the commit range, what you narrowed and why, and any bug you fixed.`;
};

export const reviewerMission = (unit, round, batch = []) => {
  const leafPath = `${packDir}/${unit.leaf.file}`;
  const carrier = (decisions.colandCarriers ?? []).find(
    (entry) => entry.carrier === unit.leaf.number,
  );
  // Without this the reviewer of a carrier lane is told to judge one unit and
  // sees the other covered unit's work as unexplained scope.
  const colandClause = carrier
    ? `\n\n**This lane carries a co-land pair**: it is required to implement every one of ${carrier.covers.join(", ")} on this one branch, so read each of their leaves. Work for a covered unit is in scope, not scope creep; a covered unit left unimplemented is a finding.`
    : "";
  const batchClause = batch.length
    ? `\n\n**This lane is a batch**: it is required to implement every one of ${[unit, ...batch].map((member) => member.id).join(", ")} on this one branch, so read each of their leaves. Work for a batch unit is in scope, not scope creep; a batch unit left unimplemented, without the report explaining that narrowing, is a finding.`
    : "";
  const sliceClause = unit.slice
    ? `\n\nThis branch implements **only slice \`${unit.slice}\`** of \`${packDir}/${unit.leaf.number}-PLAN.md\`. Its sibling slices land in their own lanes. Read that plan's \`## Slices\` row for \`${unit.slice}\` — work belonging to another slice being absent is the contract, not a finding.`
    : "";
  const roundClause =
    round > 1
      ? `\n\nThis is review round ${round}: the branch has already answered an earlier round's findings. Review the current tree, including the fixes.`
      : "";
  return `Review branch \`${branchFor(unit.id)}\` against \`main\`. It implements unit \`${unit.id}\` of \`${packDir}/\` — read \`${leafPath}\` for intent and its \`## Scope / caveats\` for what was deliberately excluded. Run the diff yourself.

Report \`[P0]\`/\`[P1]\`/\`[P2]\` findings with \`file:line\`. Judge the change against the unit's stated intent, not against a redesign you would prefer; deliberate narrowing that the report explains is not a finding.${colandClause}${batchClause}${sliceClause}${roundClause}

If the lane's diff is bookkeeping-only and it flips the leaf's \`Status:\` to \`Not needed\` naming the evidence, this is the **evidence route** (DRAIN.md standing rules): the question under review is whether the cited evidence holds and the bookkeeping is complete — the unit not being implemented is the contract, not a finding.

If this change touches defensive or guard code, the threat model is accidental misuse — a caller getting it wrong in good faith — not an adversarial caller working to defeat the guard. Do not report evasion findings that require deliberate circumvention. Without this calibration, review rounds on guard code produce P1 evasion findings indefinitely and never converge.

Review only from the repository and your own experiments. Do not read any other reviewer's answer, log, or scratch files, and do not base any claim on them. If your shell is blocked, say so explicitly at the top of your answer and mark every claim you could only check statically.`;
};

/**
 * The conductor mission: one fresh agent that runs steps 3–8 for one claimed
 * unit, so a long drain's orchestrating session stays small (DRAIN.md
 * “Conducting a unit”). The seam is deliberate: gate, claim, lock, and
 * decision panels stay with the dispatcher; everything downstream of the
 * claim — parking its own lane included — moves here. Done is `verify-closed`
 * passing — externally checkable, so the dispatcher never has to trust the
 * conductor's report.
 */
export const conductorMission = (unit, batch = []) => {
  // A co-land carrier's merge lands every covered unit, so the mission and
  // the closure line must cover them all — a covered leaf left unflipped is
  // exactly what `verify-closed` exists to catch. Covered units and batch
  // passengers never coexist: the batch gate refuses co-land members.
  const carrier = (decisions.colandCarriers ?? []).find(
    (entry) => entry.carrier === unit.leaf.number,
  );
  const covered = (carrier?.covers ?? [])
    .filter((number) => number !== unit.leaf.number)
    .map(parseUnit);
  const members = [unit, ...covered, ...batch];
  const unitIds = members.map((member) => member.id);
  const leafPaths = members.map((member) => `\`${packDir}/${member.leaf.file}\``).join(", ");
  const withFlag = batch.length ? ` --with ${batch.map((member) => member.id).join(",")}` : "";
  const colandClause = carrier
    ? `\n\n**This lane carries a co-land pair.** Its one branch implements every one of ${carrier.covers.join(", ")} — \`ownerDecisions.colandCarriers\` records the mapping — so hold the implementer, every review round, and close-out to all of them.`
    : "";
  const batchClause = batch.length
    ? `\n\n**This lane is a batch.** One branch carries every one of ${unitIds.join(", ")}. Keep \`--with ${batch.map((member) => member.id).join(",")}\` on every brief you render, and confirm the record commands from the implementer brief are run and committed before the first review round.`
    : "";
  return `Conduct unit **${unit.id}** of \`${packDir}/\`. The unit is already claimed on branch \`${branchFor(unit.id)}\` with lane worktree \`${lanePathFor(unit.id)}\`, and you own everything from that claim to a closed unit: steps 3–8 of \`${packDir}/DRAIN.md\`, which is the authority wherever this mission is silent. Read it in full before acting.

First finish step 2's deferred half: read ${leafPaths} and BOTH leaves of every incident edge in full, and re-verify every pin (file, line, symbol, cited test) against the live tree — the audit is from 2026-08-01 and its pins rot; the implementer brief gets your live-verified pins and traps, not the audit's. Two different exits hang on that reading: if the claim should not proceed in this lane now but the unit's work remains valid, **abandon** it with step 8's release commands, report why, and stop — the unit returns to the pool, and a released claim is cheap; if the reading shows the unit's work is obsolete, take the **evidence route** in the done-block below, which is yours to finish, not a stop.${colandClause}${batchClause}

Boundaries — these stay with the session that dispatched you:
- The drain lock. Never touch \`node ${selfPath} lock\`, and never adopt or clear one you find.
- Selection. Never run \`plan\` to take more work, never claim another unit, and never open a second lane — one lane, this one, is the whole job.
- Pushing and opening PRs stay the owner's call. Merging to \`main\` through \`scripts/land.sh\` is covered by the standing grant.

The loop you run:
1. Dispatch ONE fresh-context implementer into the lane with the mission from \`node ${selfPath} brief ${unit.id}${withFlag}\`. Do not implement the unit yourself: your context is for judging the work, not doing it.
2. Verify the lane directly when the implementer reports — or goes quiet, which often means it finished: \`git -C ${lanePathFor(unit.id)} log --oneline main..HEAD\`, the diff stat, the gate output. Self-reports are not evidence.
3. Do step 5's bookkeeping, then run review rounds exactly as step 6 prescribes: the fixed five-seat panel dispatched detached through the agent-cli wrapper so each seat's findings land in an \`-o\` answer file handed directly to the fix agent — never a subagent whose report you would transcribe by hand — a fresh file per seat per round, and land only on a clean panel round.
4. Land per step 7 — background \`land.sh\` and read its exit line before moving on — then close per step 8. That run is the lane's only full \`verify\`: never run one yourself, and never ask an implementer or fix agent for one.

Done when \`node ${selfPath} verify-closed ${unitIds.join(" ")}\` passes; your dispatcher audits that command's answer, not your report. The evidence route closes through that same audit as a normal close whose diff is bookkeeping-only: a unit whose audited premise no longer holds (standing rules) flips its Status to \`Not needed\` naming the evidence and does step 5's bookkeeping on the lane branch, committed like any other unit work; the concurring review round is the ordinary review of that lane diff, and \`land.sh\` and step 8 then close it exactly like a code close — the landing merge is what carries the flip to main, where \`verify-closed\` reads the status. Exactly two stops never reach \`verify-closed\`, and both are yours to finish, not calls to hand back:
- Abandoned — the deep read's valid-but-not-now exit above: claim released with step 8's commands, unit back in the pool.
- Parked — a lane you cannot land or cleanly release (four failed verifies, a wedged claim): you park it yourself, following "Parking a lane" to the letter, and parking disposes of every member of this lane, not just the carrier — passenger marker branches deleted, no member left in \`fix/cq-*\`, and the queue exclusion covering all of ${unitIds.join(", ")}.
Either way, report exactly where you stopped, so the unit is never left ambiguous.

Final report: merge sha, review rounds and their outcomes, anything narrowed or parked, any bug fixed along the way.`;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const renderStatus = (limit) => {
  const landed = landedUnits();
  const lanes = openLanes();
  const lock = lockState();
  const lockLine = lock.held ? "HELD — never adopt it; the owner clears it" : "free";

  // A claim with no worktree at the conventional lane path reads the same
  // whether it is a batch passenger's marker or an abandoned bare claim — say
  // which question to ask before anyone "cleans up" a live batch's markers.
  const laneLabel = (laneId) =>
    existsSync(lanePathFor(laneId)) ? laneId : `${laneId} (no worktree)`;
  console.log(heading("Drain — code-quality-2026-08-01"));
  console.log(`\nLock:   ${lockLine}`);
  console.log(`Lanes:  ${lanes.length ? lanes.map(laneLabel).join(", ") : "none open"}`);
  if (lanes.some((laneId) => !existsSync(lanePathFor(laneId)))) {
    console.log(
      "        (no worktree) = a batch claim marker, or an abandoned bare claim. Find the\n        carrier lane whose brief names the unit before treating it as orphaned.",
    );
  }
  console.log(`Landed: ${landed.size} unit(s) · ${leaves.length} live leaves in the pack`);
  if (lanes.length) console.log(`\n${SERIAL_ONLY_NOTICE}`);

  for (const queueEntry of queue.queues) {
    const rows = queueRows(queueEntry, landed, lanes);
    const free = rows.filter((row) => row.state === "free");
    const count = (state) => rows.filter((row) => row.state === state).length;
    console.log(heading(`Queue: ${queueEntry.id}`));
    console.log(
      `\n${rows.length} unit(s): ${free.length} free, ${count("blocked")} blocked, ${count("in flight")} in flight, ${count("landed")} landed, ${count("not needed")} not needed`,
    );
    const shown = free.slice(0, limit);
    console.log(
      `\n${table(
        ["wave", "unit", "area", "sev/size", "subject"],
        shown.map((row) => [
          row.wave.id,
          row.unitId,
          row.leaf.area,
          `${row.leaf.severity}/${row.leaf.size}`,
          truncate(row.leaf.title, 72),
        ]),
      )}`,
    );
    if (free.length > shown.length) {
      console.log(
        `\n… ${free.length - shown.length} more free — \`node ${selfPath} list\` shows all.`,
      );
    }
    if (!free.length) console.log("\n**Queue drained.** Ask the owner for the next priority call.");
  }

  console.log(heading("Next"));
  console.log(`
  node ${selfPath} plan <UNIT>...   gate a pick and print its lane commands
  node ${selfPath} brief <UNIT>     the implementer mission to send
  node ${selfPath} list --all       every leaf in the pack, not just the queue
`);
};

const renderList = (options) => {
  const landed = landedUnits();
  const lanes = openLanes();
  let rows;
  if (options.all) {
    rows = leaves.flatMap((leaf) =>
      unitIdsForLeaf(leaf).map((unitId) => ({
        unitId,
        leaf,
        wave: { id: "—" },
        ...unitState(parseUnit(unitId), landed, lanes),
      })),
    );
  } else {
    rows = queueRows(queueById(options.queue), landed, lanes);
  }
  if (options.area) rows = rows.filter((row) => row.leaf.area === options.area);
  if (options.available) rows = rows.filter((row) => row.state === "free");
  if (options.limit) rows = rows.slice(0, options.limit);
  if (lanes.length) console.log(`${SERIAL_ONLY_NOTICE}\n`);
  if (!rows.length) {
    console.log("No units match.");
    return;
  }
  console.log(
    table(
      ["wave", "unit", "state", "area", "sev/size", "subject", "blocked by"],
      rows.map((row) => [
        row.wave.id,
        row.unitId,
        row.state,
        row.leaf.area,
        `${row.leaf.severity}/${row.leaf.size}`,
        truncate(row.leaf.title, 56),
        row.why ? truncate(row.why, 44) : "",
      ]),
    ),
  );
};

/**
 * Validate a hand-picked set and read the live state it has to be gated
 * against. `state` is injectable so the behaviour tests can drive stub landed
 * state and a lane list instead of the live repository.
 */
export const resolvePick = (rawUnits, state = null, laneOverride = null, dec = decisions) => {
  const units = rawUnits.map(parseUnit);
  const picked = new Set();
  const byLeaf = new Map();
  for (const unit of units) {
    if (picked.has(unit.id)) fail(`duplicate unit: ${unit.id}`);
    picked.add(unit.id);
    const sibling = byLeaf.get(unit.leaf.number);
    if (sibling) {
      fail(
        `${sibling} and ${unit.id} are slices of one plan — run a plan's slices one at a time, in the plan's order`,
      );
    }
    byLeaf.set(unit.leaf.number, unit.id);
  }

  const lanes = laneOverride ?? openLanes();
  const unparsedLanes = [];
  const inFlight = [];
  for (const lane of lanes) {
    try {
      const unit = parseUnit(lane);
      if (!picked.has(unit.id)) inFlight.push(unit);
    } catch (error) {
      unparsedLanes.push(`fix/cq-${lane} — ${error.message}`);
    }
  }
  const landed = state ?? landedUnits();
  return {
    units,
    picked,
    lanes,
    inFlight,
    unparsedLanes,
    landed,
    decisions: dec,
  };
};

/** The three constraint sections, plus the blockers they imply. */
const constraintSections = (pick) => {
  const { units, inFlight, landed } = pick;
  const blockers = [];
  const insideNumbers = new Set([...units, ...inFlight].map((unit) => unit.leaf.number));

  const between = [];
  for (let left = 0; left < units.length; left += 1) {
    for (let right = left + 1; right < units.length; right += 1) {
      for (const constraint of pairConstraints(units[left].leaf, units[right].leaf)) {
        if (constraint.blocking) {
          blockers.push({
            category: constraint.category,
            text: `${units[left].id} ↔ ${units[right].id} (\`${constraint.token}\`)`,
          });
        }
        between.push(
          `- \`${units[left].id}\` ↔ \`${units[right].id}\` · \`${constraint.token}\` · **${CATEGORY_VERDICT[constraint.category]}**\n  ${constraint.warrant}\n  _${constraint.provenance}_`,
        );
      }
    }
  }

  const againstLanes = [];
  for (const unit of units) {
    for (const other of inFlight) {
      for (const constraint of pairConstraints(unit.leaf, other.leaf)) {
        if (constraint.blocking) {
          blockers.push({
            category: constraint.category,
            text: `${unit.id} vs open lane ${other.id} (\`${constraint.token}\`)`,
          });
        }
        againstLanes.push(
          `- \`${unit.id}\` vs open lane \`${other.id}\` · \`${constraint.token}\` · **${CATEGORY_VERDICT[constraint.category]}**\n  ${constraint.warrant}`,
        );
      }
    }
  }

  const external = [];
  for (const unit of units) {
    for (const { peer, constraints } of externalPeers(unit.leaf, insideNumbers, landed)) {
      const tokens = [...new Set(constraints.map((constraint) => constraint.token))].join(" ");
      const worst = constraints
        .map((constraint) => constraint.category)
        .sort(
          (left, right) =>
            CATEGORY_ORDER.findIndex(([key]) => key === left) -
            CATEGORY_ORDER.findIndex(([key]) => key === right),
        )[0];
      external.push(
        `- \`${unit.id}\` → ${peer.number} ${truncate(peer.title, 56)} · \`${tokens}\` · ${EXTERNAL_ADVICE[worst]}`,
      );
    }
  }

  return { between, againstLanes, external, blockers };
};

/**
 * Which of the picked units may have a lane opened for them right now.
 *
 * Two independent questions, and conflating them was this tool's first real
 * defect. **May this unit be opened at all** is answered by `unitState` from
 * git-derived landed state — an unlanded prerequisite, an unresolved co-land, or an undecided
 * outcome stops it regardless of what else is in the pick. **May these two run
 * side by side** is the concurrency question, and only it depends on pick
 * order.
 */
export const dispatchable = (pick) => {
  const takeable = [];
  const deferred = [];
  for (const unit of pick.units) {
    const state = unitState(unit, pick.landed, pick.lanes, pick.decisions);
    if (state.state === "landed") {
      const landing = pick.landed.get(unit.id);
      deferred.push(`${unit.id} — already landed on ${landing.branch} (${landing.merge})`);
      continue;
    }
    if (state.state === "in flight") {
      deferred.push(`${unit.id} — a lane branch already claims it`);
      continue;
    }
    if (state.state === "not needed") {
      deferred.push(`${unit.id} — ${state.why} (closed by the evidence route; nothing to dispatch)`);
      continue;
    }
    if (state.state === "blocked") {
      deferred.push(`${unit.id} — ${state.why}`);
      continue;
    }
    const blocks = (other) =>
      pairConstraints(unit.leaf, other.leaf).some((constraint) => constraint.blocking);
    const taken = takeable.find(blocks);
    if (taken) {
      deferred.push(`${unit.id} — cannot be open at the same time as ${taken.id}`);
      continue;
    }
    const lane = pick.inFlight.find(blocks);
    if (lane) {
      deferred.push(`${unit.id} — conflicts with the open lane ${lane.id}`);
      continue;
    }
    // The standing rule, not the graph: one lane at a time, always. Any live
    // claim — related or not, parseable or not — means no new lane opens.
    // (`inFlight` excludes claims on picked units, so check the raw lane list:
    // a pick-mate's claim is still an open lane.)
    if (pick.lanes.length) {
      deferred.push(
        `${unit.id} — serial-only: ${pick.lanes.map((laneId) => `fix/cq-${laneId}`).join(", ")} is open, and this drain runs one lane at a time (DRAIN.md standing rule) — finish or abandon it first`,
      );
      continue;
    }
    takeable.push(unit);
  }
  return { takeable, deferred };
};

/**
 * May this pick share ONE lane? The batch procedure in DRAIN.md — several
 * small units on one branch, one review cycle, one land — exists because the
 * per-unit fixed cost, not gating, bounds a serial drain's throughput.
 *
 * Stricter than dispatching the same pick as separate lanes: every unit must
 * be free right now (a batch has no "re-run later" half), must be a plain
 * leaf unit (a plan's landing contract already fixes its lane shape), and
 * must sit outside any co-land pair (the carrier decision already fixes that
 * lane's shape). Blocking edges inside the pick refuse the whole batch: one
 * agent working a lane is sequential, which arguably satisfies `serialize`,
 * but relaxing a reviewed gate is a separate decision — this version keeps
 * the concurrency rule as-is.
 *
 * The first unit is the carrier: its branch carries every unit in the batch,
 * and the others get claim-marker branches so the claim stays visible to
 * every session.
 */
/**
 * The static half of the batch gate: everything about a batch's SHAPE that is
 * wrong regardless of live state. Shared by `plan --one-lane` and `brief
 * --with`, so skipping the gate and going straight to `brief` cannot render a
 * mission for a batch the gate would refuse — at brief time the members are
 * already claimed, which is exactly when the live half stops being checkable.
 */
export const batchShapeProblems = (units, dec = decisions) => {
  const problems = [];
  if (units.length > 5) {
    problems.push(
      `a batch is at most five units (this pick has ${units.length}) — one reviewer must read one diff covering all of them, so split the pick`,
    );
  }
  for (const unit of units) {
    if (unit.slice || unit.plan) {
      problems.push(
        `${unit.id} — plan-governed; its plan's landing contract decides the lane shape, so batch only plain leaf units`,
      );
    }
    const pair = (dec.colandCarriers ?? []).find((entry) =>
      (entry.covers ?? []).includes(unit.leaf.number),
    );
    if (pair) {
      problems.push(
        `${unit.id} — part of the ${pair.edge} co-land pair; that carrier lane covers exactly its pair and cannot take batch passengers`,
      );
    }
  }
  for (let left = 0; left < units.length; left += 1) {
    for (let right = left + 1; right < units.length; right += 1) {
      for (const constraint of pairConstraints(units[left].leaf, units[right].leaf)) {
        if (constraint.blocking) {
          problems.push(
            `${units[left].id} ↔ ${units[right].id} (\`${constraint.token}\`) — a blocking edge refuses the whole batch`,
          );
        }
      }
    }
  }
  return problems;
};

export const oneLaneBatch = (pick) => {
  const problems = [];
  if (pick.units.length < 2) {
    problems.push("a batch is two or more units — for a single unit, drop --one-lane");
  }
  problems.push(...batchShapeProblems(pick.units, pick.decisions));
  const verdict = dispatchable(pick);
  if (verdict.takeable.length !== pick.units.length) problems.push(...verdict.deferred);
  if (problems.length) return { ok: false, problems };
  return { ok: true, carrier: pick.units[0], covered: pick.units.slice(1) };
};

const section = (title, lines) => {
  console.log(`\n## ${title}\n`);
  console.log(lines.length ? lines.join("\n") : "_None recorded._");
};

/**
 * `unitState`'s "free" is a fact about the unit — no landing, obligation, or
 * claim of its own stops it. While any lane is open, the serial-only rule
 * stops all of them anyway; the tables keep the per-unit answer (it says what
 * frees up next) and this banner keeps it from reading as an invitation.
 */
const SERIAL_ONLY_NOTICE =
  "> **A lane is open, so nothing is dispatchable right now** (serial-only — see DRAIN.md).\n> \"free\" below means free once the open lane lands or is abandoned; `plan` defers every pick until then.";

/** Group blockers by remedy so the verdict states the right one for each. */
const verdictLines = (blockers) => {
  const byCategory = new Map();
  for (const blocker of blockers) {
    const group = byCategory.get(blocker.category) ?? [];
    group.push(blocker.text);
    byCategory.set(blocker.category, group);
  }
  const lines = [];
  for (const [key] of CATEGORY_ORDER) {
    const group = byCategory.get(key);
    if (!group) continue;
    lines.push(`**${CATEGORY_VERDICT[key]}**`);
    for (const entry of [...new Set(group)]) lines.push(`- ${entry}`);
    lines.push("");
  }
  return lines;
};

const renderPlan = (rawUnits, oneLane = false) => {
  const pick = resolvePick(rawUnits);
  const { units, lanes, inFlight, unparsedLanes, landed } = pick;
  const constraints = constraintSections(pick);
  const { takeable, deferred } = dispatchable(pick);

  console.log(heading(`Pick: ${units.map((unit) => unit.id).join(", ")}`));

  console.log("\n## Availability\n");
  console.log(
    table(
      ["unit", "state", "area", "sev/size", "subject"],
      units.map((unit) => {
        const live = unitState(unit, landed, lanes);
        const state =
          live.state === "landed"
            ? `LANDED ${landed.get(unit.id).branch} (${landed.get(unit.id).merge})`
            : live.state === "in flight"
              ? "CLAIMED — a lane branch already exists"
              : live.state === "not needed"
                ? `NOT NEEDED — ${truncate(live.why, 60)}`
                : live.state === "blocked"
                  ? `BLOCKED — ${truncate(live.why, 60)}`
                  : "free";
        return [
          unit.id,
          state,
          unit.leaf.area,
          `${unit.leaf.severity}/${unit.leaf.size}`,
          truncate(unit.leaf.title, 52),
        ];
      }),
    ),
  );

  const obligationLines = [];
  for (const unit of units) {
    for (const obligation of unmetObligations(unit.leaf, landed)) {
      obligationLines.push(
        `- \`${unit.id}\` · \`${obligation.token}\` · **${CATEGORY_VERDICT[obligation.category]}**\n  ${obligation.why}.\n  ${obligation.warrant}`,
      );
    }
    const slice = sliceGate(unit, landed, lanes);
    if (slice) obligationLines.push(`- \`${unit.id}\` · plan order · ${slice}`);
  }
  section("Unmet obligations — these stop the lane outright", obligationLines);

  section("Between the units you picked", constraints.between);
  section(
    `Against open lanes (${inFlight.length ? inFlight.map((unit) => unit.id).join(", ") : "none"})`,
    constraints.againstLanes,
  );
  section("Incident peers not in this pick and not in flight", constraints.external);

  if (unparsedLanes.length) {
    section(
      "Lane branches this tool could not read as units",
      unparsedLanes.map((lane) => `- ${lane}`),
    );
    console.log(
      "\nThey were not gated against your pick. Resolve or report them before dispatching.",
    );
  }

  console.log("\n## Verdict\n");
  if (constraints.blockers.length) {
    console.log("These picks cannot all be open at once:\n");
    for (const line of verdictLines(constraints.blockers)) console.log(line);
  } else {
    console.log("No concurrency blocker among the units you picked.");
  }
  console.log(
    "\nThis drain runs one lane at a time (serial-only — see DRAIN.md). To take several\nunits in one session, share the lane: re-run this pick with --one-lane.",
  );
  console.log(`\n> ${MINIMUM_CONSTRAINT_NOTICE}`);

  if (deferred.length) {
    section("Not dispatchable now", deferred.map((entry) => `- ${entry}`));
    console.log("\nRe-run this command for them once the lanes they wait on have landed.");
  }

  if (oneLane) {
    const batch = oneLaneBatch(pick);
    console.log(`\n## Batch lane — one branch for the whole pick\n`);
    if (!batch.ok) {
      console.log("This pick cannot share a lane:\n");
      for (const problem of [...new Set(batch.problems)]) console.log(`- ${problem}`);
      console.log("\nFix what blocks it, shrink the pick, or drop --one-lane.");
      return;
    }
    const withList = batch.covered.map((member) => member.id).join(",");
    console.log(`# ${batch.carrier.id} carries ${pick.units.map((member) => member.id).join(", ")} on one branch`);
    console.log(
      `bun run worktree:new ${lanePathFor(batch.carrier.id)} -b ${branchFor(batch.carrier.id)} --from main`,
    );
    for (const member of batch.covered) {
      console.log(
        `git branch ${branchFor(member.id)} main   # claim marker, no worktree — delete with the carrier branch at close`,
      );
    }
    console.log(
      `node ${selfPath} brief ${batch.carrier.id} --with ${withList} > /tmp/cq-${batch.carrier.id}-implementer.prompt`,
    );
    return;
  }

  // One claim recipe, never several: printing a worktree command per takeable
  // unit is how a good-faith reader ends up with the two concurrent gates the
  // standing rule exists to prevent.
  console.log(`\n## Lane commands — serial-only, so one lane\n`);
  if (!takeable.length) {
    console.log("_Nothing in this pick can be opened right now._");
    return;
  }
  const [first, ...rest] = takeable;
  console.log(`# ${first.id} — ${first.leaf.title}`);
  console.log(`bun run worktree:new ${lanePathFor(first.id)} -b ${branchFor(first.id)} --from main`);
  console.log(`node ${selfPath} brief ${first.id} > /tmp/cq-${first.id}-implementer.prompt`);
  if (rest.length) {
    console.log(
      `\n${rest.map((unit) => unit.id).join(", ")} ${rest.length === 1 ? "is" : "are"} also takeable, but not as a second lane: land ${first.id} and re-run this pick — or share one lane, re-running it with --one-lane.`,
    );
  }
};

/**
 * The stderr warning for briefing a unit that cannot be worked. `in flight`
 * is deliberately silent: the documented loop claims the branch before
 * rendering the brief, so the lane's own claim is the normal state here and
 * warning on it would train the reader to ignore the warnings that matter.
 * For the conductor mission `free` inverts: that mission opens by asserting
 * an existing claim and lane worktree, so an unclaimed unit is the mistake —
 * and so is a claim whose lane worktree does not exist (a batch marker or an
 * abandoned bare claim), because the mission's first command runs inside it.
 * A warning, not a gate: the mission still renders on stdout.
 */
export const briefWarning = (unitId, live, conduct = false, laneWorktreeExists = true) => {
  if (live.state === "in flight") {
    if (conduct && !laneWorktreeExists) {
      return `WARNING: ${unitId} is claimed but its lane worktree ${lanePathFor(unitId)} does not exist — a batch marker, or an abandoned bare claim.\nThe conductor mission asserts that worktree; provision it (or find the carrier lane whose brief names this unit) before dispatching.`;
    }
    return null;
  }
  if (live.state === "free") {
    return conduct
      ? `WARNING: ${unitId} is unclaimed, but the conductor mission asserts a claim and lane that do not exist.\nClaim it first (step 2), then re-render this mission.`
      : null;
  }
  return `WARNING: ${unitId} is ${live.state}${live.why ? ` — ${live.why}` : ""}.\nRun \`node ${selfPath} plan ${unitId}\` before dispatching this mission.`;
};

const renderBrief = (rawUnit, options) => {
  const unit = parseUnit(rawUnit);
  const batch = (options.with ?? []).map(parseUnit);
  const seen = new Set([unit.id]);
  for (const member of batch) {
    if (seen.has(member.id)) fail(`--with repeats ${member.id}`);
    seen.add(member.id);
  }
  if (batch.length) {
    // The same static shape gate as `plan --one-lane`, carrier included: a
    // mission for a batch the gate refuses is never right to render, and
    // these checks don't depend on live claims, so there is no false positive
    // from the claim-then-brief order.
    const problems = batchShapeProblems([unit, ...batch]);
    if (problems.length) fail(problems.join("\n"));
  }
  // `brief` is not the gate, but rendering a mission for a unit that cannot be
  // opened is a plausible good-faith mistake — skipping `plan` and going
  // straight to dispatch. Warn on stderr so piping the mission to a file still
  // produces a clean prompt.
  if (!options.review) {
    const landed = landedUnits();
    const lanes = openLanes();
    for (const member of [unit, ...batch]) {
      const warning = briefWarning(
        member.id,
        unitState(member, landed, lanes),
        options.conduct,
        // Only the carrier's lane worktree is asserted by the conductor
        // mission; batch passengers are worktree-less markers by design.
        member === unit ? existsSync(lanePathFor(member.id)) : true,
      );
      if (warning) console.error(warning);
    }
  }
  console.log(
    options.review
      ? reviewerMission(unit, options.round, batch)
      : options.conduct
        ? conductorMission(unit, batch)
        : implementerMission(unit, batch),
  );
};

/**
 * The Status line the closure audit judges, parsed from a leaf's raw source.
 * A `null` source (the leaf is not on `main` yet) and a source with no
 * Status line both fall back to the caller's live-parsed status. Pure so the
 * fallback branch is testable, same seam as `parseCarrierRecords`.
 */
export const statusFromLeafSource = (source, fallback) => {
  const match = source === null ? null : /^Status:\s+(.+)$/mu.exec(source);
  return match ? match[1].trim() : fallback;
};

/**
 * The leaf status read from `main`, like the merge and carrier facts already
 * are. The caller may run from any checkout — a stale one must not fail a
 * closed unit, and an uncommitted local edit must not pass one. Missions and
 * gating keep reading the live tree; only this audit needs main's truth.
 */
const leafStatusOnMain = (leaf) => {
  let source;
  try {
    source = git(["show", `main:${packDir}/${leaf.file}`]);
  } catch {
    source = null;
  }
  return statusFromLeafSource(source, leaf.status);
};

const renderVerifyClosed = (rawUnits) => {
  const landed = landedUnits();
  const lanes = openLanes();
  let open = 0;
  for (const raw of rawUnits) {
    const unit = parseUnit(raw);
    const problems = closureProblems(unit, {
      landed,
      lanes,
      worktreeExists: existsSync(lanePathFor(unit.id)),
      leafStatus: leafStatusOnMain(unit.leaf),
    });
    if (!problems.length) {
      console.log(`${unit.id}: closed`);
      continue;
    }
    open += 1;
    console.log(`${unit.id}: NOT closed`);
    for (const problem of problems) console.log(`  - ${problem}`);
  }
  if (open) process.exitCode = 1;
};

const renderRecord = (rawUnit, rawCarrier) => {
  const unit = parseUnit(rawUnit);
  const carrier = parseUnit(rawCarrier);
  if (unit.id === carrier.id) {
    fail("record only batch passengers; a carrier lands from its own branch");
  }
  const path = join(packRoot, CARRIER_FILE);
  const records = parseCarrierRecords(existsSync(path) ? readFileSync(path, "utf8") : "");
  if (records.has(unit.id)) {
    fail(`${unit.id} already records carrier ${records.get(unit.id)}`);
  }
  appendFileSync(path, `${JSON.stringify({ unit: unit.id, carrier: carrier.id })}\n`);
  console.log(`recorded: ${unit.id} lands with ${branchFor(carrier.id)}`);
};

const renderLock = (action) => {
  const dir = lockDir();
  const state = lockState();
  switch (action) {
    case "status": {
      console.log(state.held ? "held" : "free");
      return;
    }
    case "acquire": {
      let created = false;
      try {
        mkdirSync(dir);
        created = true;
      } catch (error) {
        // Only "it already exists" means someone else holds the drain. Anything
        // else (permissions, a missing git dir) must not read as a held lock.
        if (error.code !== "EEXIST") throw error;
      }
      if (!created) {
        console.error("STOP: the drain is locked. Never adopt it; the owner clears it.");
        process.exitCode = 1;
        return;
      }
      console.log("acquired");
      return;
    }
    case "release": {
      if (!state.held) {
        console.error("STOP: the drain lock is already free.");
        process.exitCode = 1;
        return;
      }
      try {
        rmSync(dir, { recursive: true });
      } catch (error) {
        console.error(
          `STOP: delete failed — state unknown, re-probe before concluding anything: ${error.message}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log("released");
      return;
    }
    default:
      fail(`unknown lock action: ${action} (acquire, release, status)`);
  }
};

const renderCheck = () => {
  const errors = [];
  const carrierPath = join(packRoot, CARRIER_FILE);
  let carriers = new Map();
  try {
    carriers = parseCarrierRecords(existsSync(carrierPath) ? readFileSync(carrierPath, "utf8") : "");
    carriers = mergeDecisionCarriers(carriers, decisions);
  } catch (error) {
    errors.push(error.message);
  }
  errors.push(...carrierChainErrors(carriers).map((error) => `${CARRIER_FILE}: ${error}`));
  const landed = landedFromMergeLog(
    git(["log", "main", "--first-parent", "--merges", "--format=%H%x09%s"]),
    carriers,
  );
  const seenQueueUnits = new Set();

  for (const queueEntry of queue.queues) {
    for (const wave of queueEntry.waves) {
      for (const number of wave.units) {
        const normalized = normalizeNumber(number);
        const leaf = leafByNumber.get(normalized);
        if (!leaf) {
          errors.push(`${queueEntry.id}/${wave.id}: unknown leaf ${number}`);
          continue;
        }
        if (seenQueueUnits.has(normalized)) {
          errors.push(`${queueEntry.id}: leaf ${normalized} appears in more than one wave`);
        }
        seenQueueUnits.add(normalized);
      }
    }
    for (const exclusion of queueEntry.exclusions ?? []) {
      for (const number of exclusion.units) {
        if (!leafByNumber.has(normalizeNumber(number))) {
          errors.push(`${queueEntry.id}: exclusion names unknown leaf ${number}`);
        }
        if (seenQueueUnits.has(normalizeNumber(number))) {
          errors.push(`${queueEntry.id}: ${number} is both queued and excluded`);
        }
      }
    }
  }

  errors.push(...queueOrderProblems(queue.queues, landed));

  for (const [number, plan] of Object.entries(queue.plans)) {
    const leaf = leafByNumber.get(normalizeNumber(number));
    if (!leaf) {
      errors.push(`plans: unknown leaf ${number}`);
      continue;
    }
    if (!leaf.planFile) errors.push(`plans: leaf ${number} has no ${number}-PLAN.md`);
    if (!["per-slice", "whole-plan"].includes(plan.landing)) {
      errors.push(`plans: ${number} has unknown landing contract ${plan.landing}`);
    }
    if (plan.landing === "per-slice" && !planSliceIds(number).length) {
      errors.push(`plans: ${number} lands per slice but its plan declares no slices`);
    }
  }
  for (const leaf of leaves) {
    if (leaf.planFile && !queue.plans[leaf.number]) {
      errors.push(`plans: ${leaf.planFile} exists but drain-queue.json records no landing contract`);
    }
  }

  // Every rendered mission must be complete: an unresolved placeholder would be
  // dispatched verbatim to an agent.
  for (const leaf of leaves) {
    for (const unitId of unitIdsForLeaf(leaf)) {
      const unit = parseUnit(unitId);
      let missions;
      try {
        // `conductorMission` parses `colandCarriers.covers`, so a malformed
        // row must collect as an error here — attributed to the row, since
        // this loop runs before the labelled validator below — not abort the
        // whole check on exactly the hand-edit `--check` exists to police.
        missions = [implementerMission(unit), reviewerMission(unit, 2), conductorMission(unit)];
      } catch (error) {
        errors.push(
          `ownerDecisions.colandCarriers: rendering ${unitId}'s missions failed — ${error.message}`,
        );
        continue;
      }
      for (const mission of missions) {
        if (/<[A-Za-z]+>|undefined|\[object /u.test(mission)) {
          errors.push(`${unitId}: rendered mission still carries a placeholder`);
        }
      }
    }
  }

  // Owner decisions unblock work, so a row naming a stale edge has to fail
  // loudly rather than silently clearing a gate that still applies.
  const edgeIds = new Set(normalizedEdges.map((normalized) => normalized.edge.id));
  const edgeCategories = (edgeId) => {
    const found = normalizedEdges.find((normalized) => normalized.edge.id === edgeId);
    return new Set((found?.sequencing ?? []).map((sequence) => categoryForKind(sequence.kind)));
  };
  for (const entry of decisions.outcomes ?? []) {
    if (!edgeIds.has(entry.edge)) {
      errors.push(`ownerDecisions.outcomes: no edge ${entry.edge} in the graph`);
      continue;
    }
    if (!edgeCategories(entry.edge).has("outcome")) {
      errors.push(`ownerDecisions.outcomes: edge ${entry.edge} carries no outcome remedy`);
    }
    // Exactly what the gate refuses to act on, so a row can never be rejected
    // by one and honoured by the other.
    const fault = outcomeRowFault(entry);
    if (fault) errors.push(`ownerDecisions.outcomes: ${entry.edge} ${fault}`);
    const named = [...(entry.proceed ?? []), ...(entry.moot ?? [])];
    for (const unitId of named) {
      try {
        parseUnit(unitId);
      } catch (error) {
        errors.push(`ownerDecisions.outcomes: ${entry.edge} names ${unitId} — ${error.message}`);
      }
    }
  }
  for (const entry of decisions.colandCarriers ?? []) {
    if (!edgeIds.has(entry.edge)) {
      errors.push(`ownerDecisions.colandCarriers: no edge ${entry.edge} in the graph`);
      continue;
    }
    if (!edgeCategories(entry.edge).has("coland")) {
      errors.push(`ownerDecisions.colandCarriers: edge ${entry.edge} carries no co-land remedy`);
    }
    const covers = entry.covers ?? [];
    // Endpoint-exact: a covers list that is narrow leaves the peer stranded,
    // and one that is wide hands the carrier's implementer unrelated scope.
    if (!sameSet(covers, endpointUnits(entry.edge))) {
      errors.push(
        `ownerDecisions.colandCarriers: ${entry.edge} covers must name exactly ${endpointUnits(entry.edge).join(", ")}, got ${covers.join(", ") || "nothing"}`,
      );
    }
    if (!covers.includes(entry.carrier)) {
      errors.push(
        `ownerDecisions.colandCarriers: ${entry.edge} carrier ${entry.carrier} is not in its own covers list`,
      );
    }
    for (const covered of covers) {
      try {
        parseUnit(covered);
      } catch (error) {
        errors.push(
          `ownerDecisions.colandCarriers: ${entry.edge} covers ${covered} — ${error.message}`,
        );
      }
    }
  }

  console.log(
    `drain: ${seenQueueUnits.size} queued leaves, ${leaves.length} live leaves, ${landed.size} landed unit(s); ${errors.length} error(s)`,
  );
  for (const error of errors) console.error(`  ERROR: ${error}`);
  process.exitCode = errors.length ? 1 : 0;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const usage = () => {
  console.log(`Usage:
  drain.mjs status [--limit <n>]              lock, lanes, and what is free to take
  drain.mjs list [--all] [--area <area>]      browse units; --available hides taken ones
                 [--available] [--limit <n>]
  drain.mjs plan <UNIT>... [--one-lane]       gate a pick, then print its lane commands;
                                              --one-lane gates the pick as ONE batch lane
  drain.mjs brief <UNIT> [--review|--conduct] render the mission to send; --with adds the
                 [--round <n>] [--with <U,U>] rest of a batch lane's units; --conduct
                                              renders the steps-3–8 conductor mission
  drain.mjs verify-closed <UNIT>...           prove step 8 finished: landed, claim gone,
                                              worktree gone, leaf status flipped
  drain.mjs record <UNIT> --carrier <UNIT>     record a batch passenger's carrier branch
  drain.mjs lock <acquire|release|status>       bare shared-directory lock
  drain.mjs --check                           self-check this tool against the pack

A UNIT is a leaf (154), a plan slice (107-S0, 109-S2), or a whole-plan leaf (108).`);
};

/**
 * Flags each command accepts. Anything else is a typo, and a typo has to fail:
 * an unknown flag that swallowed the next argument would silently gate a
 * smaller pick than the caller asked for.
 */
const BOOLEAN_FLAGS = new Set(["all", "available", "review", "conduct", "one-lane"]);
const COMMAND_FLAGS = {
  status: ["limit"],
  list: ["all", "available", "area", "queue", "limit"],
  plan: ["one-lane"],
  brief: ["review", "conduct", "round", "with"],
  "verify-closed": [],
  record: ["carrier"],
  lock: [],
  "--check": [],
};

export const parseFlags = (args, allowed) => {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!allowed.includes(name)) {
      fail(`unknown flag --${name}${allowed.length ? ` (accepts ${allowed.join(", ")})` : ""}`);
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`--${name} requires a value`);
    flags[name] = value;
    index += 1;
  }
  return { flags, positional };
};

/** Whole positive integers only — `Number.parseInt` would accept `2x`. */
const positiveInteger = (raw, label) => {
  if (raw === undefined) return null;
  if (!/^[1-9]\d*$/u.test(raw)) fail(`${label} must be a positive integer, got ${raw}`);
  return Number(raw);
};

const runCli = (argv) => {
  const args = [...argv];
  const command = args.shift();
  if (command === undefined || command === "--help" || command === "-h") {
    usage();
    if (command === undefined) process.exitCode = 1;
    return;
  }
  const allowed = COMMAND_FLAGS[command];
  if (!allowed) fail(`unknown command: ${command}`);
  const { flags, positional } = parseFlags(args, allowed);
  const limit = positiveInteger(flags.limit, "--limit");

  switch (command) {
    case "status":
      if (positional.length) fail("status takes no arguments");
      renderStatus(limit ?? 12);
      break;
    case "list":
      if (positional.length) fail("list takes no arguments");
      renderList({
        all: flags.all === true,
        queue: flags.queue ?? queue.queues[0].id,
        area: flags.area ?? null,
        available: flags.available === true,
        limit,
      });
      break;
    case "plan":
      if (!positional.length) fail("plan requires at least one unit");
      renderPlan(positional, flags["one-lane"] === true);
      break;
    case "brief": {
      if (positional.length !== 1) fail("brief requires exactly one unit");
      if (flags.review === true && flags.conduct === true) {
        fail("--review and --conduct are different missions — pick one");
      }
      if (flags.round !== undefined && flags.review !== true) {
        fail("--round only applies with --review");
      }
      const withUnits =
        flags.with === undefined
          ? []
          : flags.with
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean);
      if (flags.with !== undefined && !withUnits.length) {
        fail("--with requires a comma-separated unit list, e.g. --with 169,225");
      }
      renderBrief(positional[0], {
        review: flags.review === true,
        conduct: flags.conduct === true,
        round: positiveInteger(flags.round, "--round") ?? 1,
        with: withUnits,
      });
      break;
    }
    case "verify-closed":
      if (!positional.length) fail("verify-closed requires at least one unit");
      renderVerifyClosed(positional);
      break;
    case "record":
      if (positional.length !== 1) fail("record requires exactly one batch passenger");
      if (flags.carrier === undefined) fail("record requires --carrier <UNIT>");
      renderRecord(positional[0], flags.carrier);
      break;
    case "lock":
      if (positional.length !== 1) {
        fail("lock requires one action: acquire, release, status");
      }
      renderLock(positional[0]);
      break;
    case "--check":
      if (positional.length) fail("--check takes no arguments");
      renderCheck();
      break;
    default:
      fail(`unknown command: ${command}`);
  }
};

// Importable for the behaviour tests; only the direct invocation runs the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

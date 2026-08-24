/**
 * Behaviour tests for the drain gate.
 *
 * `drain.mjs --check` validates structure — that the queue, plans, carrier records, and
 * missions are internally consistent. It cannot catch a wrong *scheduling*
 * answer, which is the failure that actually costs work: a cross-model review
 * of the first version found the gate treating hard order, co-land, and outcome
 * edges as though they were all plain serialization, so `plan` printed lane
 * commands for a unit whose prerequisite had not landed and let argument order
 * decide which side of a hard edge got the lane.
 *
 * These cases pin the remedies against stub landed-unit and lane state. Run with:
 *
 *   node --test docs/agent_notes/backlog/code-quality-2026-08-01/drain.test.mjs
 *
 * The registered `test-cq-drain.sh` smoke runs this suite and the tool's
 * structural self-check.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  batchShapeProblems,
  briefWarning,
  carrierChainErrors,
  closureProblems,
  conductorMission,
  dispatchable,
  implementerMission,
  landedFromMergeLog,
  leafLanded,
  mergeDecisionCarriers,
  oneLaneBatch,
  pairConstraints,
  parseCarrierRecords,
  parseFlags,
  queueOrderProblems,
  resolvePick,
  reviewerMission,
  sliceGate,
  statusFromLeafSource,
  unitState,
  unmetObligations,
} from "./drain.mjs";
import { leafByNumber, resolveLeaf } from "./working/phase5/pack-model.mjs";

/** Injectable landed state, from a list of landed units. */
const landedOf = (...units) =>
  new Map(units.map((unit) => [unit, { unit, branch: `fix/cq-${unit}`, merge: "abc1234" }]));

const NO_DECISIONS = { outcomes: [], colandCarriers: [] };

const pickOf = (units, { landed = landedOf(), lanes = [], decisions = NO_DECISIONS } = {}) =>
  resolvePick(units, landed, lanes, decisions);

const deferredFor = (pick, unit) =>
  dispatchable(pick).deferred.find((entry) => entry.startsWith(`${unit} —`));

const takeableIds = (pick) => dispatchable(pick).takeable.map((unit) => unit.id);

// --- hard order (`requires`) -----------------------------------------------
// 268 `after:001`: 001 is the prerequisite, 268 the dependent.

test("a dependent is blocked while its prerequisite is unlanded, alone in the pick", () => {
  const obligations = unmetObligations(resolveLeaf("268"), landedOf());
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].category, "hard");
  assert.equal(obligations[0].peer.number, "001");
  assert.deepEqual(takeableIds(pickOf(["268"])), []);
});

test("the prerequisite side is never blocked by its own dependent", () => {
  assert.deepEqual(unmetObligations(resolveLeaf("001"), landedOf()), []);
  assert.deepEqual(takeableIds(pickOf(["001"])), ["001"]);
});

test("hard order is decided by the graph, not by argument order", () => {
  for (const order of [
    ["268", "001"],
    ["001", "268"],
  ]) {
    const pick = pickOf(order);
    assert.deepEqual(takeableIds(pick), ["001"], `order ${order.join(",")}`);
    assert.match(deferredFor(pick, "268"), /001 must land first/u);
  }
});

test("a landed prerequisite unblocks its dependent", () => {
  const pick = pickOf(["268"], { landed: landedOf("001") });
  assert.deepEqual(takeableIds(pick), ["268"]);
});

// --- co-land ----------------------------------------------------------------
// 182 `coland:171`: one branch has to contain both.

test("a co-land pair is refused as two lanes, in either order and alone", () => {
  for (const units of [["182"], ["171"], ["182", "171"], ["171", "182"]]) {
    const pick = pickOf(units);
    assert.deepEqual(takeableIds(pick), [], `pick ${units.join(",")}`);
    assert.match(deferredFor(pick, units[0]), /co-lands with/u);
  }
});

test("co-land does not read as plain serialization", () => {
  // Inject NO_DECISIONS: the live queue file records a d-182-01 carrier,
  // which rightly clears this obligation — the test pins the undecided state.
  const obligations = unmetObligations(resolveLeaf("182"), landedOf(), NO_DECISIONS);
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].category, "coland");
});

const CARRIER_DECISIONS = {
  outcomes: [],
  colandCarriers: [{ edge: "d-182-01", carrier: "182", covers: ["171", "182"] }],
};

test("an owner decision unblocks a co-land pair through a named carrier", () => {
  assert.deepEqual(takeableIds(pickOf(["182"], { decisions: CARRIER_DECISIONS })), ["182"]);
  const covered = pickOf(["171"], { decisions: CARRIER_DECISIONS });
  assert.deepEqual(takeableIds(covered), []);
  assert.match(deferredFor(covered, "171"), /covered by the 182 lane/u);
});

test("a recorded carrier makes every covered unit land with its merge", () => {
  const carriers = parseCarrierRecords('{"unit":"171","carrier":"182"}\n');
  const landed = landedFromMergeLog(
    "abc1234\tMerge branch 'fix/cq-182'\n",
    carriers,
  );
  assert.equal(landed.get("182").merge, "abc1234");
  assert.equal(landed.get("171").branch, "fix/cq-182");
  assert.equal(landed.get("171").merge, "abc1234");
});

test("a carrier record does not land before its carrier branch merges", () => {
  const carriers = parseCarrierRecords('{"unit":"171","carrier":"182"}\n');
  assert.equal(landedFromMergeLog("", carriers).has("171"), false);
});

// --- outcome (`moots` / `moots-slice` / `alt`) ------------------------------
// d-047-01 is `moots: 047 → 105` with no permitting remedy on the pair.

test("the mooted side is blocked but the mooting side is not", () => {
  // Landing 047 is how the outcome gets decided, so 047 must stay dispatchable.
  assert.deepEqual(takeableIds(pickOf(["047"])), ["047"]);
  const mooted = pickOf(["105"]);
  assert.deepEqual(takeableIds(mooted), []);
  assert.match(deferredFor(mooted, "105"), /047 may moot all or part of this/u);
});

test("a recorded outcome decision unblocks the side it names in proceed", () => {
  const decisions = {
    outcomes: [{ edge: "d-047-01", date: "2026-08-09", proceed: ["047", "105"], moot: [] }],
    colandCarriers: [],
  };
  assert.deepEqual(takeableIds(pickOf(["105"], { decisions })), ["105"]);
});

test("a row that names neither disposition does not unblock anything", () => {
  // The round-3 defect recurring one level down: clearing on the *presence* of
  // a row rather than on its content means two omitted fields free both ends.
  // `--check` has always rejected this shape; the gate has to reject it too,
  // because `--check` runs at bookkeeping time and `plan` runs before it.
  const decisions = {
    outcomes: [{ edge: "d-047-01", date: "2026-08-09" }],
    colandCarriers: [],
  };
  const blocked = pickOf(["105"], { decisions });
  assert.deepEqual(takeableIds(blocked), []);
  assert.match(deferredFor(blocked, "105"), /unusable/u);
});

test("a landed peer is not a disposition", () => {
  // Landing 047 may produce the information the owner needs, but it does not
  // record what they decided — 105 may be wholly moot. This `peerLanded`
  // shortcut predated `ownerDecisions` and was the only exit before it existed.
  const blocked = pickOf(["105"], { landed: landedOf("047") });
  assert.deepEqual(takeableIds(blocked), []);
  assert.match(deferredFor(blocked, "105"), /may moot all or part of this/u);
});

test("a landed peer does not clear an either/or either", () => {
  const blocked = pickOf(["203"], { landed: landedOf("097") });
  assert.deepEqual(takeableIds(blocked), []);
  assert.match(deferredFor(blocked, "203"), /either this or 097, not both/u);
});

test("an outcome remedy on the SAME edge as a permitting one does not block", () => {
  // s3-003-097 is one reviewed edge carrying `rebaseOn: 003 → 097` and
  // `moots-slice: 097 → 003`; the rebase half is the adjudicated way through.
  assert.deepEqual(
    unmetObligations(resolveLeaf("003"), landedOf(), NO_DECISIONS),
    [],
    "003 is rebase-reconcilable with 097",
  );
  assert.deepEqual(takeableIds(pickOf(["003"])), ["003"]);
});

test("the same-edge exemption also clears the concurrency half", () => {
  // The outcome remedy must not survive as a lane-concurrency blocker when the
  // edge's own rebase remedy says proceed and reconcile.
  const constraints = pairConstraints(resolveLeaf("003"), resolveLeaf("097"));
  assert.equal(
    constraints.some((constraint) => constraint.blocking),
    false,
  );
});

test("a permitting remedy on a SEPARATE edge does not waive an outcome edge", () => {
  // 097/203 carry four distinct declared edges — moots, rebaseOn,
  // alternativeTo, prefersBefore. The rebase edge resolves nothing about the
  // mooting one; scoping the exemption to the pair silently freed both.
  for (const unit of ["097", "203"]) {
    const obligations = unmetObligations(resolveLeaf(unit), landedOf(), NO_DECISIONS);
    assert.ok(obligations.length > 0, `${unit} must stay blocked without a decision`);
  }
  for (const order of [
    ["097", "203"],
    ["203", "097"],
  ]) {
    assert.deepEqual(takeableIds(pickOf(order)), [], `order ${order.join(",")}`);
  }
});

test("alternativeTo blocks both ends; moots blocks only the mooted one", () => {
  const alt = unmetObligations(resolveLeaf("097"), landedOf(), NO_DECISIONS);
  assert.ok(alt.some((obligation) => obligation.token.startsWith("alt:")));
  // 047 moots 105 and carries no alt, so the mooting side stays open.
  assert.deepEqual(takeableIds(pickOf(["047"])), ["047"]);
});

test("an outcome decision enforces its disposition instead of freeing both", () => {
  // "097 wins, drop 203" must not make 203 dispatchable.
  const decisions = {
    outcomes: [
      { edge: "d-203-01", date: "2026-08-09", proceed: ["097"], moot: ["203"] },
      { edge: "d-097-01", date: "2026-08-09", proceed: ["097"], moot: ["203"] },
    ],
    colandCarriers: [],
  };
  assert.deepEqual(takeableIds(pickOf(["097"], { decisions })), ["097"]);
  const dropped = pickOf(["203"], { decisions });
  assert.deepEqual(takeableIds(dropped), []);
  assert.match(deferredFor(dropped, "203"), /recorded as moot/u);
});

test("a both-proceed decision frees both ends of a moots edge", () => {
  // `moots` is a claim that one leaf *may* make another unnecessary; the owner
  // is entitled to find that it did not.
  const decisions = {
    outcomes: [{ edge: "d-047-01", date: "2026-08-09", proceed: ["047", "105"], moot: [] }],
    colandCarriers: [],
  };
  assert.deepEqual(takeableIds(pickOf(["105"], { decisions })), ["105"]);
});

test("a both-proceed decision is refused on an either/or edge", () => {
  // `alternativeTo` is not a maybe: doing both is the outcome the edge exists
  // to prevent, so a row permitting it is malformed rather than permissive.
  const decisions = {
    outcomes: [{ edge: "d-203-01", date: "2026-08-09", proceed: ["097", "203"], moot: [] }],
    colandCarriers: [],
  };
  const blocked = pickOf(["203"], { decisions });
  assert.deepEqual(takeableIds(blocked), []);
  assert.match(deferredFor(blocked, "203"), /exactly one side/u);
});

test("outcome blocking never deadlocks a pair with no resolution", () => {
  // Both ends blocked with no recordable decision was the round-2 defect: each
  // side cleared only when the other landed, and neither could open. For alt
  // pairs both ends are blocked by design, so the exit is the decision row —
  // proven by the disposition tests above, not by one side being open.
  const bothBlocked = ["047", "105"].every(
    (unit) => unmetObligations(resolveLeaf(unit), landedOf(), NO_DECISIONS).length > 0,
  );
  assert.equal(bothBlocked, false, "a plain moots pair must leave the mooting side openable");
});

// --- serialization ----------------------------------------------------------
// 124 `serial:122`: either order is fine, but never two open lanes.

test("serial peers are individually dispatchable but not together", () => {
  assert.deepEqual(takeableIds(pickOf(["124"])), ["124"]);
  assert.deepEqual(takeableIds(pickOf(["122"])), ["122"]);
  const pick = pickOf(["124", "122"]);
  assert.deepEqual(takeableIds(pick), ["124"]);
  assert.match(deferredFor(pick, "122"), /cannot be open at the same time as 124/u);
});

test("an open lane blocks its serial peer", () => {
  const pick = pickOf(["122"], { lanes: ["124"] });
  assert.deepEqual(takeableIds(pick), []);
  assert.match(deferredFor(pick, "122"), /open lane 124/u);
});

test("a rebase peer permits concurrency", () => {
  // 148 `rebase:150` — the later lane reconciles; both may be open.
  assert.deepEqual(takeableIds(pickOf(["148", "150"])), ["148", "150"]);
});

// --- serial-only -------------------------------------------------------------
// DRAIN.md standing rule: one lane at a time, always. The graph question
// (may these two ever be open together) stays answered above; the session
// question (may a second lane open NOW) is always no while any claim exists.

test("any open lane defers every pick, related or not", () => {
  // 169 has no edge to 154 — under serial-only that does not matter.
  const pick = pickOf(["169"], { lanes: ["154"] });
  assert.deepEqual(takeableIds(pick), []);
  assert.match(deferredFor(pick, "169"), /serial-only/u);
});

test("a picked unit's own claim defers as claimed, and blocks its pick-mates", () => {
  const pick = pickOf(["154", "169"], { lanes: ["154"] });
  assert.deepEqual(takeableIds(pick), []);
  assert.match(deferredFor(pick, "154"), /already claims it/u);
  assert.match(deferredFor(pick, "169"), /serial-only/u);
});

test("a batch cannot open while any lane is open", () => {
  const batch = oneLaneBatch(pickOf(["154", "169"], { lanes: ["225"] }));
  assert.equal(batch.ok, false);
  assert.match(batch.problems.join("\n"), /serial-only/u);
});

// --- plan slices ------------------------------------------------------------

test("a plan slice waits for its earlier siblings to land", () => {
  assert.match(
    sliceGate({ id: "107-S4", leaf: resolveLeaf("107") }, landedOf(), []),
    /earlier slice\(s\) 107-S0, 107-S1, 107-S2, 107-S3 have not landed/u,
  );
  assert.equal(
    sliceGate(
      { id: "107-S4", leaf: resolveLeaf("107") },
      landedOf("107-S0", "107-S1", "107-S2", "107-S3"),
      [],
    ),
    null,
  );
});

test("an open sibling slice lane blocks the next slice", () => {
  assert.match(
    sliceGate({ id: "107-S1", leaf: resolveLeaf("107") }, landedOf("107-S0"), ["107-S0"]),
    /sibling slice lane 107-S0 is open/u,
  );
});

test("the first slice of a plan is dispatchable on a clean drain", () => {
  assert.deepEqual(takeableIds(pickOf(["107-S0"])), ["107-S0"]);
});

test("two slices of one plan cannot be picked together", () => {
  assert.throws(() => pickOf(["107-S0", "107-S1"]), /one at a time, in the plan's order/u);
});

// 109-PLAN.md: S1 first by preference, S2–S4 order-independent and independent
// of S1's files; only S2/S3 may not run concurrently. A blanket total order
// over-blocks it.

test("an order-independent plan does not make later slices wait", () => {
  assert.equal(sliceGate({ id: "109-S3", leaf: resolveLeaf("109"), slice: "S3" }, landedOf(), []), null);
  assert.equal(sliceGate({ id: "109-S4", leaf: resolveLeaf("109"), slice: "S4" }, landedOf(), []), null);
  assert.deepEqual(takeableIds(pickOf(["109-S4"])), ["109-S4"]);
});

test("an order-independent plan still honours its declared not-concurrent pair", () => {
  assert.match(
    sliceGate({ id: "109-S3", leaf: resolveLeaf("109"), slice: "S3" }, landedOf(), ["109-S2"]),
    /forbids running S2 and S3 concurrently/u,
  );
  // S4 is not in that pair, so an open S2 does not block it.
  assert.equal(
    sliceGate({ id: "109-S4", leaf: resolveLeaf("109"), slice: "S4" }, landedOf(), ["109-S2"]),
    null,
  );
});

test("a whole-plan leaf has no slice units", () => {
  assert.throws(() => pickOf(["108-S1"]), /lands as one whole-plan unit/u);
  assert.deepEqual(takeableIds(pickOf(["108"])), ["108"]);
});

test("a sliced plan refuses a bare leaf number", () => {
  assert.throws(() => pickOf(["107"]), /lands slice by slice — name one/u);
});

// --- landed-ness ------------------------------------------------------------

test("a sliced leaf counts as landed only when every slice has landed", () => {
  const partial = landedOf("107-S0", "107-S1");
  assert.equal(leafLanded(leafByNumber.get("107"), partial), false);
  const whole = landedOf("107-S0", "107-S1", "107-S2", "107-S3", "107-S4");
  assert.equal(leafLanded(leafByNumber.get("107"), whole), true);
});

test("a landed unit is reported as landed, not free", () => {
  const state = unitState({ id: "154", leaf: resolveLeaf("154") }, landedOf("154"), []);
  assert.equal(state.state, "landed");
});

test("a claimed unit is reported as in flight", () => {
  const state = unitState({ id: "154", leaf: resolveLeaf("154") }, landedOf(), ["154"]);
  assert.equal(state.state, "in flight");
});

test("a unit with an unmet obligation is blocked, never free", () => {
  const state = unitState({ id: "268", leaf: resolveLeaf("268") }, landedOf(), []);
  assert.equal(state.state, "blocked");
  assert.match(state.why, /001 must land first/u);
});

// --- Not needed leaves --------------------------------------------------------
// Standing rules: a leaf whose premise no longer holds closes by the evidence
// route — the lane lands the flip, so a merge exists, but it names only the
// claimed unit. Closure tolerating a missing landing (below) is belt-and-braces
// for the units that merge never names; the scheduler must also stop offering
// every unit the flipped leaf covers, or the next session re-picks work the
// drain already decided against.

const notNeededLeaf = (number) => ({
  ...resolveLeaf(number),
  status: "Not needed — fixed on main by 08fd3fc",
});

test("a Not needed leaf is terminal, never free", () => {
  const state = unitState({ id: "154", leaf: notNeededLeaf("154") }, landedOf(), []);
  assert.equal(state.state, "not needed");
  assert.match(state.why, /Not needed/u);
});

test("Not needed covers every unit the leaf splits into", () => {
  // 107 lands slice by slice; a Not needed 107 must not leave any sibling
  // slice dispatchable — or blocked, which invites re-deciding a settled call.
  for (const slice of ["S0", "S4"]) {
    const state = unitState(
      { id: `107-${slice}`, leaf: notNeededLeaf("107"), slice },
      landedOf(),
      [],
    );
    assert.equal(state.state, "not needed", `107-${slice}`);
  }
});

test("an unreleased claim on a Not needed leaf still reads as in flight", () => {
  // The evidence route ends by releasing the claim; until then the lane exists.
  const state = unitState({ id: "154", leaf: notNeededLeaf("154") }, landedOf(), ["154"]);
  assert.equal(state.state, "in flight");
});

test("dispatchable defers a Not needed unit instead of printing lane commands", () => {
  const pick = pickOf(["154"]);
  pick.units[0] = { ...pick.units[0], leaf: notNeededLeaf("154") };
  assert.deepEqual(takeableIds(pick), []);
  assert.match(deferredFor(pick, "154"), /Not needed/u);
});

// --- git-derived landed state ----------------------------------------------

test("only exact cq merge subjects count as direct landings", () => {
  const log = [
    "abc1234\tMerge branch 'fix/cq-154'",
    "def5678\tfeat: mention fix/cq-169 without merging it",
    "987cafe\tMerge branch 'fix/cq-drain-108-resize'",
  ].join("\n");
  const landed = landedFromMergeLog(log, new Map());
  assert.deepEqual([...landed.keys()], ["154"]);
  assert.equal(landed.get("154").branch, "fix/cq-154");
});

test("carrier records are one JSON object per covered unit", () => {
  const records = parseCarrierRecords(
    [
      '{"unit":"176","carrier":"169"}',
      '{"unit":"225","carrier":"169"}',
    ].join("\n"),
  );
  assert.deepEqual([...records], [
    ["176", "169"],
    ["225", "169"],
  ]);
  assert.throws(
    () =>
      parseCarrierRecords(
        '{"unit":"176","carrier":"169"}\n{"unit":"176","carrier":"170"}\n',
      ),
    /records 176 more than once/u,
  );
});

test("carrier records normalize valid short unit ids", () => {
  assert.deepEqual([...parseCarrierRecords('{"unit":"90","carrier":"81"}\n')], [
    ["090", "081"],
  ]);
  assert.throws(() => parseCarrierRecords("not-json\n"), /not valid JSON/u);
});

test("co-land decisions supply carrier membership without a record row", () => {
  const records = mergeDecisionCarriers(new Map(), CARRIER_DECISIONS);
  assert.deepEqual([...records], [["171", "182"]]);
  const landed = landedFromMergeLog("abc1234\tMerge branch 'fix/cq-182'\n", records);
  assert.equal(landed.get("171").branch, "fix/cq-182");
});

test("an agreeing co-land carrier record is idempotent", () => {
  const records = mergeDecisionCarriers(new Map([["171", "182"]]), CARRIER_DECISIONS);
  assert.equal(records.get("171"), "182");
});

test("a conflicting co-land carrier record is rejected", () => {
  assert.throws(
    () => mergeDecisionCarriers(new Map([["171", "169"]]), CARRIER_DECISIONS),
    /171 already has a batch carrier record/u,
  );
});

test("a covered unit cannot itself carry another unit", () => {
  assert.deepEqual(
    carrierChainErrors(
      new Map([
        ["169", "154"],
        ["225", "169"],
      ]),
    ),
    ["225 names carrier 169, which is itself a covered unit"],
  );
});

// --- batch lanes (`plan --one-lane` / `brief --with`) ------------------------
// 154, 169, and 225 are L0 leaves with no recorded edge between them.

test("a pick of free unrelated leaves may share one lane, first unit as carrier", () => {
  const batch = oneLaneBatch(pickOf(["154", "169", "225"]));
  assert.equal(batch.ok, true);
  assert.equal(batch.carrier.id, "154");
  assert.deepEqual(
    batch.covered.map((unit) => unit.id),
    ["169", "225"],
  );
});

test("a blocking pair inside the pick refuses the whole batch", () => {
  // 160 `serial:224` — v1 keeps the concurrency gate for same-lane batches.
  const batch = oneLaneBatch(pickOf(["160", "224"]));
  assert.equal(batch.ok, false);
  assert.match(batch.problems.join("\n"), /cannot be open at the same time/u);
});

test("a batch refuses blocked and landed members outright", () => {
  const blocked = oneLaneBatch(pickOf(["154", "268"]));
  assert.equal(blocked.ok, false);
  assert.match(blocked.problems.join("\n"), /001 must land first/u);
  const landed = oneLaneBatch(pickOf(["154", "169"], { landed: landedOf("169") }));
  assert.equal(landed.ok, false);
  assert.match(landed.problems.join("\n"), /already landed/u);
});

test("plan-governed units keep their own lane shape and stay out of batches", () => {
  const slice = oneLaneBatch(pickOf(["154", "107-S0"]));
  assert.equal(slice.ok, false);
  assert.match(slice.problems.join("\n"), /plan-governed/u);
  const wholePlan = oneLaneBatch(pickOf(["154", "108"]));
  assert.equal(wholePlan.ok, false);
  assert.match(wholePlan.problems.join("\n"), /plan-governed/u);
});

test("a single unit is not a batch", () => {
  const batch = oneLaneBatch(pickOf(["154"]));
  assert.equal(batch.ok, false);
  assert.match(batch.problems.join("\n"), /two or more/u);
});

test("a batch is capped at five units", () => {
  // DRAIN.md: one reviewer reads one diff covering the whole batch.
  const six = oneLaneBatch(pickOf(["154", "155", "169", "170", "176", "225"]));
  assert.equal(six.ok, false);
  assert.match(six.problems.join("\n"), /at most five/u);
  const five = oneLaneBatch(pickOf(["154", "155", "169", "170", "176"]));
  assert.equal(five.ok, true);
});

test("brief's batch shape check refuses what the batch gate refuses", () => {
  // `brief --with` runs these same static checks, so skipping `plan
  // --one-lane` cannot render a mission for a forbidden batch.
  const serialPair = batchShapeProblems(pickOf(["160", "224"]).units);
  assert.match(serialPair.join("\n"), /160 ↔ 224/u);
  const planCarrier = batchShapeProblems(pickOf(["107-S0", "154"]).units);
  assert.match(planCarrier.join("\n"), /107-S0 — plan-governed/u);
  const colandMember = batchShapeProblems(
    pickOf(["182", "154"], { decisions: CARRIER_DECISIONS }).units,
    CARRIER_DECISIONS,
  );
  assert.match(colandMember.join("\n"), /co-land/u);
  assert.deepEqual(batchShapeProblems(pickOf(["154", "169"]).units), []);
});

test("a co-land pair keeps its carrier lane and cannot be folded into a batch", () => {
  const batch = oneLaneBatch(pickOf(["182", "154"], { decisions: CARRIER_DECISIONS }));
  assert.equal(batch.ok, false);
  assert.match(batch.problems.join("\n"), /co-land/u);
});

test("batch missions name every unit, and only batch missions do", () => {
  const units = pickOf(["154", "169"]).units;
  const mission = implementerMission(units[0], units.slice(1));
  assert.match(mission, /batch/u);
  assert.match(mission, /154, 169/u);
  assert.match(mission, /drain\.mjs record 169 --carrier 154/u);
  const review = reviewerMission(units[0], 1, units.slice(1));
  assert.match(review, /154, 169/u);
  assert.match(review, /finding/u);
  assert.doesNotMatch(implementerMission(units[0]), /batch/u);
  assert.doesNotMatch(reviewerMission(units[0], 1), /batch/u);
});

test("every reviewer brief carries the evidence-route contract", () => {
  // The brief opens "It implements unit X", which is false for a
  // bookkeeping-only evidence lane and invites a blocking "unit not
  // implemented" P1. The renderer cannot see the lane's diff, so the clause
  // is unconditional, like the slice contract: the review question becomes
  // whether the evidence holds and the bookkeeping is complete.
  const mission = reviewerMission(pickOf(["154"]).units[0], 1);
  assert.match(mission, /evidence route/u);
  assert.match(mission, /`Not needed` naming the evidence/u);
  assert.match(mission, /the contract, not a finding/u);
  // `--check` dispatches every rendered mission through its placeholder
  // gate, so the clause must never spell the status with a literal <...>.
  assert.doesNotMatch(mission, /<[A-Za-z]+>/u);
});

test("co-land missions use the owner decision without emitting record commands", () => {
  const mission = implementerMission(pickOf(["182"], { decisions: CARRIER_DECISIONS }).units[0]);
  assert.match(mission, /ownerDecisions\.colandCarriers/u);
  assert.doesNotMatch(mission, /drain\.mjs record/u);
});

test("brief warns for landed and blocked units but not for the lane's own claim", () => {
  assert.equal(briefWarning("154", { state: "free" }), null);
  assert.equal(briefWarning("154", { state: "in flight" }), null);
  assert.match(briefWarning("154", { state: "landed" }), /154 is landed/u);
  assert.match(briefWarning("268", { state: "blocked", why: "001 must land first" }), /blocked — 001 must land first/u);
});

test("a conductor brief warns when the unit is not yet claimed", () => {
  // The conductor mission opens by asserting an existing claim and lane
  // worktree, so "free" — silent for the implementer mission — inverts here.
  assert.match(briefWarning("154", { state: "free" }, true), /unclaimed/u);
  assert.equal(briefWarning("154", { state: "in flight" }, true), null);
});

test("a conductor brief warns when the claim has no lane worktree", () => {
  // A batch marker or an abandoned bare claim is documented real state, but
  // the conductor mission asserts the lane worktree exists — dispatched onto
  // one, its first `git -C <lane>` command fails.
  assert.match(briefWarning("154", { state: "in flight" }, true, false), /worktree/u);
  assert.equal(briefWarning("154", { state: "in flight" }, true, true), null);
  // The implementer brief is unchanged: a marker is its normal batch state.
  assert.equal(briefWarning("154", { state: "in flight" }, false, false), null);
});

// --- closure (`verify-closed`) -----------------------------------------------
// Step 8's contract as one checkable answer: landed, claim released, worktree
// gone, leaf status flipped. This is the audit a conductor's dispatcher runs,
// so it must derive from live state and never from anyone's report.

const unitOf = (id) => pickOf([id]).units[0];

const closedState = (overrides = {}) => ({
  landed: landedOf("154"),
  lanes: [],
  worktreeExists: false,
  leafStatus: "Landed on fix/cq-154",
  ...overrides,
});

test("a fully closed unit reports no closure problems", () => {
  assert.deepEqual(closureProblems(unitOf("154"), closedState()), []);
});

test("an unlanded unit is not closed", () => {
  const problems = closureProblems(
    unitOf("154"),
    closedState({ landed: landedOf(), leafStatus: "Not started" }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /has not landed/u);
});

test("a surviving claim branch blocks closure", () => {
  const problems = closureProblems(unitOf("154"), closedState({ lanes: ["154"] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /fix\/cq-154 still exists/u);
});

test("a surviving lane worktree blocks closure", () => {
  const problems = closureProblems(unitOf("154"), closedState({ worktreeExists: true }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /worktree/u);
});

test("an unflipped leaf status blocks closure once the leaf is fully landed", () => {
  const problems = closureProblems(unitOf("154"), closedState({ leafStatus: "Not started" }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Status:/u);
});

test("a slice unit skips the status flip while sibling slices are pending", () => {
  // 107 lands slice by slice; the leaf's Status flips when the last slice
  // lands, so an earlier slice must close without it.
  const problems = closureProblems(
    unitOf("107-S0"),
    closedState({ landed: landedOf("107-S0"), leafStatus: "Not started" }),
  );
  assert.deepEqual(problems, []);
});

test("a batch passenger closes through its carrier's merge", () => {
  // landedFromMergeLog seats passengers under the carrier's merge, so the
  // passenger's own id is in `landed` even though only fix/cq-154 merged.
  const landed = landedFromMergeLog(
    "abc1234\tMerge branch 'fix/cq-154'\n",
    new Map([["169", "154"]]),
  );
  assert.deepEqual(
    closureProblems(unitOf("169"), closedState({ landed, leafStatus: "Landed on fix/cq-154" })),
    [],
  );
});

test("a Not needed leaf closes without a landing", () => {
  const problems = closureProblems(
    unitOf("154"),
    closedState({ landed: landedOf(), leafStatus: "Not needed — fixed on main by 08fd3fc" }),
  );
  assert.deepEqual(problems, []);
});

test("a landed Not needed leaf is not asked to flip to Landed", () => {
  // The standard evidence close: the lane merged (landed seats the unit),
  // and the Status legitimately reads `Not needed`, never `Landed on …`.
  // Pins the status check's notNeeded exemption as load-bearing.
  const problems = closureProblems(
    unitOf("154"),
    closedState({ leafStatus: "Not needed — fixed on main by 08fd3fc" }),
  );
  assert.deepEqual(problems, []);
});

test("the closure audit's status parse reads the Status line from leaf source", () => {
  // The `git show main:<leaf>` half stays in the CLI wrapper; this is the
  // parse `verify-closed` judges, pinned pure like parseCarrierRecords.
  const source = "# 154 — a leaf\n\nStatus: Landed on fix/cq-154  \nCreated: 2026-08-06\n";
  assert.equal(statusFromLeafSource(source, "Not started"), "Landed on fix/cq-154");
});

test("the closure audit's status parse falls back to the live leaf status", () => {
  // `git show` fails for a leaf main does not carry yet (source null), and a
  // source with no Status line must not read as an empty status either way.
  assert.equal(statusFromLeafSource(null, "Not started"), "Not started");
  assert.equal(statusFromLeafSource("# a leaf with no Status line\n", "In review"), "In review");
});

test("a Landed status naming no fix/cq- branch does not close the unit", () => {
  // A passenger legitimately names its carrier, so any `Landed on fix/cq-`
  // status passes — but bare "Landed" prose is not a landing record.
  for (const leafStatus of ["Landed", "Landed on main 2026-08-14"]) {
    const problems = closureProblems(unitOf("154"), closedState({ leafStatus }));
    assert.equal(problems.length, 1, leafStatus);
    assert.match(problems[0], /Status:/u);
  }
});

// --- conductor missions (`brief --conduct`) -----------------------------------

test("a conductor mission binds one unit to its lane and its closure proof", () => {
  const mission = conductorMission(unitOf("154"));
  assert.match(mission, /fix\/cq-154/u);
  assert.match(mission, /worktrees\/cq-154/u);
  assert.match(mission, /DRAIN\.md/u);
  assert.match(mission, /verify-closed 154/u);
});

test("a conductor mission fences off the dispatcher's half of the loop", () => {
  const mission = conductorMission(unitOf("154"));
  assert.match(mission, /never .*lock/iu);
  assert.match(mission, /second lane/u);
  assert.match(mission, /abandon/u);
});

test("a conductor parks its own lane instead of handing the call back", () => {
  // The seam ruling: the conductor owns land.sh's failure path, so it owns
  // parking too — a mission that hands the call back leaves a wedged claim
  // deferring every other unit while two agents each think the other owns it.
  const mission = conductorMission(unitOf("154"));
  assert.match(mission, /park it yourself/u);
  assert.match(mission, /Parking a lane/u);
});

test("a conductor mission routes the evidence route through the lane and land.sh", () => {
  // Round-3 ruling: the evidence route is a normal close whose diff is
  // bookkeeping-only — the flip commits on the lane and reaches main via the
  // landing merge. "Directly on main" would send the conductor into the
  // protected-branch pre-commit guard with no sanctioned next move.
  const mission = conductorMission(unitOf("154"));
  assert.match(mission, /evidence route/u);
  assert.match(mission, /on the lane branch/u);
  assert.match(mission, /landing merge/u);
  assert.doesNotMatch(mission, /directly on main/u);
  assert.doesNotMatch(mission, /nothing merges/u);
});

test("a batch conductor mission names every unit and keeps --with", () => {
  const units = pickOf(["154", "169"]).units;
  const mission = conductorMission(units[0], units.slice(1));
  assert.match(mission, /154, 169/u);
  assert.match(mission, /--with 169/u);
  assert.match(mission, /verify-closed 154 169/u);
});

test("a batch conductor mission names every member's leaf for the deep read", () => {
  // The conductor owns step 2's deferred deep read, and DRAIN.md applies it
  // per batch member — a passenger's caveats are exactly what it can miss.
  const units = pickOf(["154", "169"]).units;
  const mission = conductorMission(units[0], units.slice(1));
  for (const member of units) {
    assert.ok(mission.includes(member.leaf.file), `${member.id}'s leaf is named`);
  }
});

test("a co-land carrier's conductor mission covers every covered unit", () => {
  // The live queue records d-182-01: the 182 lane carries 171. The merge lands
  // both, so the mission must name the covered unit and the closure line must
  // audit both — a covered leaf left unflipped is what verify-closed catches.
  const mission = conductorMission(unitOf("182"));
  assert.match(mission, /co-land/u);
  assert.ok(mission.includes(resolveLeaf("171").file), "171's leaf is named");
  assert.match(mission, /verify-closed 182 171/u);
});

// --- queue order ------------------------------------------------------------
// The gate answers per pick; nothing else checks that the *queue* can be drained
// in the order it is written. An unattended drain that reaches a unit whose
// prerequisite is unqueued has no move left, so `--check` refuses that file.

const queueOf = (...units) => [{ id: "q", waves: [{ id: "w0", units }] }];

test("a queued dependent whose prerequisite is neither queued nor landed is reported", () => {
  const problems = queueOrderProblems(queueOf("268"), landedOf());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /268 .*001/u);
});

test("the same dependent is clean once its prerequisite has landed", () => {
  assert.deepEqual(queueOrderProblems(queueOf("268"), landedOf("001")), []);
});

test("a prerequisite queued after its dependent is reported, and before it is clean", () => {
  assert.match(queueOrderProblems(queueOf("268", "001"), landedOf())[0], /queued before/u);
  assert.deepEqual(queueOrderProblems(queueOf("001", "268"), landedOf()), []);
});

test("queue order spanning two queues still reads as one order", () => {
  const queues = [
    { id: "first", waves: [{ id: "w0", units: ["268"] }] },
    { id: "second", waves: [{ id: "w0", units: ["001"] }] },
  ];
  assert.match(queueOrderProblems(queues, landedOf())[0], /queued before/u);
});

test("a reversed preference is reported only while both sides are unlanded", () => {
  // 251 `pref-after:111`: 111 is the preferred-first side.
  assert.match(queueOrderProblems(queueOf("251", "111"), landedOf())[0], /prefer/u);
  assert.deepEqual(queueOrderProblems(queueOf("251", "111"), landedOf("111")), []);
  assert.deepEqual(queueOrderProblems(queueOf("111", "251"), landedOf()), []);
});

test("an unqueued preferred-first peer is not a queue-order problem", () => {
  // Preferences are reversible, so a peer nobody scheduled constrains nothing;
  // only a hard prerequisite has to be present.
  assert.deepEqual(queueOrderProblems(queueOf("251"), landedOf()), []);
});

// --- CLI parsing ------------------------------------------------------------

test("an unknown flag fails instead of swallowing the next argument", () => {
  assert.throws(() => parseFlags(["154", "--bogus", "169"], ["limit"]), /unknown flag --bogus/u);
});

test("known flags parse into values and positionals", () => {
  const { flags, positional } = parseFlags(
    ["--area", "harness", "--available", "154"],
    ["area", "available"],
  );
  assert.equal(flags.area, "harness");
  assert.equal(flags.available, true);
  assert.deepEqual(positional, ["154"]);
});

test("a flag with no value fails", () => {
  assert.throws(() => parseFlags(["--area"], ["area"]), /--area requires a value/u);
});

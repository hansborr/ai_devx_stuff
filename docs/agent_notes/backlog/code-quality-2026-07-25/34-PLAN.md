# 34-PLAN. drift-ai / drift-triage typing: scheduling plan

Status: Planned — **shrinks leaf 34 from XL to two S slices plus one carve-out**;
supersedes the Proposed direction in
[`34-drift-ai-typing.md`](./34-drift-ai-typing.md)

Date: 2026-07-26 · Area: harness · Source leaf: 34 (XL)

Cross-model planning session: `consult codex` (four internal angles — contract
modelling, blast radius, test/gate risk, framing — synthesized) and
`consult cursor` (Grok, "is this the right approach at all"). Both were asked
independently. Where they disagreed, the call and the reason are in
[Rejected alternatives](#rejected-alternatives--why). Every count below was
re-measured against `c69ce720`.

## Verdict

**Leaf 34 is not an XL leaf. It is two small slices, one carve-out, and four
dropped steps.** Both consults returned that independently: codex "shrink", cursor
"drop this XL as a scheduled package". They disagreed only on which small pieces
survive, and that disagreement is resolved below.

Steps 4, 5 and 6 are dropped permanently — not deferred. Step 7 is carved out to
its own future leaf with a scoping ruling so nobody re-litigates it. Steps 1, 2
and 3 survive as the two slices in this plan.

The orientation gap that `00-index.md` flags for `scripts/drift-ai/`'s 344 files
is **already owned by leaf 28** — its step 6 in
[`28-scripts-layout-families.md`](./28-scripts-layout-families.md) schedules the
`MODULE.md`, and the parked planning branch `plan/cq-harness-xl` (commit
`ce2610c7`, not yet on `main`) promotes it to slice 28.2 with the prefix-family
list and the two-registry layering law. Leaf 34 must not claim it.

## Evidence honesty: what is measured, what is extrapolated

`00-index.md`'s Coverage section puts "most of `scripts/drift-ai/`'s 344 module
bodies" **out** of audit scope and lists only *sampled* `drift-ai/` and
`drift-triage/` bodies as in scope. The honest split:

**Measured, and confirmed live at `c69ce720`** (`git diff 883d48bf..c69ce720` is
empty for `scripts/drift-ai/` and `scripts/drift-triage/` — the leaf's anchors
are current):

| Claim | Live |
|---|---|
| `details` production readers | **2** — `runner.ts` (`--fail-on-runtime-cycles`) and `triage-report-support.ts`. All other `details?.[…]` hits under `scripts/` are test assertions. |
| `details` writers | **14** (leaf said 13) |
| `isTimeoutResult` / `hasErrorCode` copies | **4 each**, in `duplicates-runner.ts`, `knip-runner.ts`, `semgrep-runner.ts`, `dolos-runner.ts` |
| `CLONE_CHECKS` ownership | **One after H10** — `triage-report-support.ts` owns the set and `triage-report.ts` imports it |
| Guard layer | 305 + 160 + 141 = **606** lines; `triage-report-contracts.ts` = **112** |
| `scripts/drift-ai/` inventory | **344** direct-child `.ts` = 240 production + 104 tests; no `MODULE.md` |
| Barrel test | `scripts/drift-ai.test.ts` = **2,765** lines; the three `runDriftAi*` describes start at `:1262`, `:2555`, `:2688`; no `runner.test.ts`, no `cli-args.test.ts` |
| `isRecord` importers from `config-readers.ts` | **7 at the measured SHA; 0 after H6** — the original count of 6 omitted `config-parsing.ts`; all seven now import the shared guard directly, while `UnknownRecord` remains exported from `config-readers.ts` |
| Direction law | Forward five-module list in `scripts/drift-triage/MODULE.md` matches live imports; reverse is ESLint-enforced by `driftDirectionLawConfigs` in `eslint-config/script-configs.js` |

These are greppable facts, so "sampled coverage" does not undermine them.

**Extrapolated, and it matters:**

- The framing sentence — "the family grew by copy-and-extend … why adding a drift
  check touches more files than it should" — is **not measured** across the 240
  production modules. It is a narrative fitted to five sampled shapes. Both
  consults said so.
- "Five recurring shapes" as **one** systemic disease is editorial composition.
  The knip memo, the barrel-test layout, and the zod port share an area, not a
  cause. The leaf's own caveats admit this and then schedule them together anyway.
- "Four external-tool adapters each keep their own **near-verbatim** copy" is
  **overstated** — see the step-5 correction below.
- "Family-wide subprocess plumbing" generalizes from 4 sampled adapters;
  **10** production drift-ai modules invoke spawn/exec, and
  `scripts/drift-ai/command-error-classification.ts` already exists as shared
  error-message classification used by `birth-size-delta-advisory.ts` and
  `bounded-full-history.ts`. The leaf's "no shared helper exists" framing missed it.

**Corrections to specific leaf claims:**

1. **"606 lines … restating 112 lines of contracts" is wrong by a third.**
   `triage-verdict-input.ts` (141 lines) does not parse `triage-report-contracts.ts`
   at all — it parses the separate `triage-verdict-types.ts` family
   (`TriageVerdictFile`, `PacketManifestInput`, `TRIAGE_VERDICTS`, …). Only
   **465** lines (`triage-report-input.ts` + `triage-report-drift-input.ts`)
   restate the contracts module. This is the scoping ruling for the carve-out.
2. **"`runner.ts` and `cli-args.ts` are covered only through the barrel" is false.**
   **12** colocated test files under `scripts/drift-ai/` import `./runner.js`
   directly and **18** import `./cli-args.js` directly. The missing
   `runner.test.ts` / `cli-args.test.ts` filenames are a naming gap, not a
   coverage gap.
3. **The four `isTimeoutResult` bodies are not near-verbatim** — they differ
   exactly on the signal gate, which is the load-bearing line:
   - `duplicates-runner.ts`: `result.signal === null` → not a timeout
   - `knip-runner.ts`: `result.signal !== "SIGTERM"` → not a timeout
   - `semgrep-runner.ts` / `dolos-runner.ts`: `result.signal !== TIMEOUT_KILL_SIGNAL` (`"SIGKILL"`)

   And `knip-runner.ts` spawns with `killSignal: "SIGKILL"` while its own
   classifier gates on `"SIGTERM"`, so that arm is unreachable on a real timeout
   kill (the preceding `hasErrorCode(result.error, "ETIMEDOUT")` line catches it
   first, so there is **no live defect** — it is dead defensive code with a
   misleading constant). Recorded here; not scheduled.
4. **`layer-direction.ts` also writes a `typeOnly` detail**, on check
   `"layer-direction"`. The bare `"typeOnly"` string is therefore genuinely
   ambiguous across the family — which is the strongest argument for step 1, and
   the reason its predicate must gate on `check === "import-cycles"` and not on
   the key alone. The leaf's proposed predicate does this correctly.
5. **Step 2's blast radius is understated.** `clearKnipRunCache` is not just
   `report-builder.ts:44` — it is referenced by **three test files**
   (`scripts/drift-ai.test.ts`, `scripts/drift-ai/knip-runner.test.ts` with 3
   sites, `scripts/drift-ai/knip-unused-exports.test.ts` with 12 sites).
   Deleting it means rewriting those test seams, not deleting one call.

## Step disposition

| Step | Call | Reason |
|---|---|---|
| 1. `typeOnly` key + structural predicate | **Keep**, merged into slice 34.1 | A bare string spans an ESLint-enforced direction boundary, gates a CLI exit code, and is written on two different checks (correction 4). Cheap and correct as specified. |
| 2. Knip memo → `env.reportCache` | **Keep** as slice 34.2 | Both consults kept it. A module-global whose stated justification is refuted by `resolveKnipRunner` having `env` in scope, plus a production module forced to call a test-shaped reset. |
| 3. Type + dedup the triage classification sets | **Keep the remaining typing**, merged into slice 34.1 | H10 already deleted the duplicate `Set` and established `triage-report-support.ts` as its sole owner. The literal-checked annotations remain small enough to pair with step 1. |
| 4. Pass the objects that already exist | **Drop** | Both consults dropped it. No type information is lost; `groupFindingsForChunks`/`buildChunkManifest` are exported API in `scripts/drift-ai/chunks.ts`, so it would churn a public signature for arity cosmetics. Six parameters are explicitly permitted for this family by `eslint-config/script-configs.js`. |
| 5. Bounded-subprocess kernel | **Drop** | Both consults dropped it, on the same verified ground: the four adapters differ on signal gate, kill signal, buffer, exit-code meaning (knip's non-zero exit is success) and tool-unavailable policy. What is genuinely shared reduces to `hasErrorCode` plus a spawn-options literal — not a kernel. Highest hazard, lowest residue. |
| 6. Split the barrel test | **Drop** | Both consults dropped it. Moving 1,658 lines adds no coverage, removes incidental barrel-re-export verification, and its premise is false (correction 2). It also changes the generated coverage-map count — see Operational risks. |
| 7. Port triage input narrowing to zod | **Carve out** to its own leaf, scoped | See the ruling below. |

### Step 7 ruling: carved out, scoped, not dropped

This is where the consults disagreed. Codex: drop — "no type or runtime defect is
demonstrated". Cursor: keep — "if one maintainability item must survive, this is
it".

**Call: neither drop nor schedule it here. Carve it out as its own leaf with a
scope that is one third smaller than the leaf assumes.** Reasons:

- It is not one agent session. 465 lines of guards → schemas, with five behaviours
  that must survive: the per-kind `null` fallthrough vs `parseTriageInput`'s throw,
  matched-kind diagnostics in `parseAdvisory`, user-visible section/row **index**
  positions in error messages, non-finite number rejection (`z.number()` preserves
  it; verified on zod 4.4.3), and the `totalCandidates >= entries.length` bound
  that lives in `parseAdvisorySections` rather than in a guard. That is two to
  three sessions with a real regression surface.
- **Scope it to the contracts family only.** `triage-verdict-input.ts` parses
  `triage-verdict-types.ts`, a different contract family (correction 1). Including
  it triples the schema surface for no shared benefit. Excluded.
- Codex is right that no defect is demonstrated, so it does not earn priority over
  the rest of the pack. Cursor is right that it is the one item here with real
  maintenance payoff. A scoped separate leaf honours both without letting an
  unbounded item ride inside a "shrink" plan.

Do not start it as part of leaf 34.

## Slices

Two slices, no dependency between them. Each is one agent session.

| # | Scope | Done criteria | Verification |
|---|---|---|---|
| **34.1** | **Name the type-only-cycle fact and check the triage sets.** In `scripts/drift-ai/types.ts` (a leaf module, inside the five-module forward contract, already imported at runtime by triage) export `TYPE_ONLY_CYCLE_DETAIL_KEY = "typeOnly"` and `isTypeOnlyCycleFinding(finding: { readonly check: string; readonly details?: Readonly<Record<string, unknown>> }): boolean` with body `finding.check === "import-cycles" && finding.details?.[KEY] === true`. Have `import-cycles.ts:cycleFinding` write the constant. Repoint `runner.ts` (negating) and `triage-report-support.ts`. **Do not** fold either caller's surrounding policy into the predicate. H10 already established `triage-report-support.ts` as the sole `CLONE_CHECKS` owner; keep that ownership and annotate all three sets as `const X: ReadonlySet<string> = new Set<DriftCheckId>([…])` — the literal catches a typo'd id, the widened annotation keeps `.has(finding.check)` compiling. Refresh `scripts/drift-triage/MODULE.md` per `docs/guides/add-module-doc.md`. | The predicate signature accepts both `DriftFinding` and `DriftFindingInput` without a cast; no bare `"typeOnly"` string literal remains in `runner.ts` or `triage-report-support.ts`; exactly one `CLONE_CHECKS` exists; `DriftFinding.details` and its `types.ts` open-extension comment are unchanged; no new drift-ai module is imported by triage | `bun run test:scripts:file -- scripts/drift-ai.test.ts scripts/drift-ai/import-cycles.test.ts scripts/drift-triage/triage-report.test.ts` then `bun run lint` (the direction law is an ESLint rule) |
| **34.2** | **Move the knip memo into `env.reportCache`.** Read `docs/agent_notes/finished_work/drift-ai-knip-cache-report-boundary.md` first — it records why the clear lives in `buildReport` and names the fake `node_modules/.bin/knip` test that proves both halves of the invariant. Pass `env.reportCache` into `memoizingDefaultKnipRunner` from `knip-pass-through-check.ts:resolveKnipRunner`; key the memo off that map instead of the module-level `Map`; mirror `scripts/drift-ai/parsed-source-cache.ts:parsedSourceFileCacheForReport`. Delete `clearKnipRunCache`, its forced call in `report-builder.ts:buildReport` and the now-stale comment above it — **and rewrite its 15+ test call sites across `scripts/drift-ai.test.ts`, `knip-runner.test.ts` and `knip-unused-exports.test.ts`**, which is most of this slice's work. Keep every cache-key dimension (`analyzedRepoRoot`, `knipBin`, `configPath`, `includeCategories`, `timeoutMs`) and the injected-runner bypass. | `grep -rn "clearKnipRunCache" scripts/` returns nothing; the fake-knip test still proves selected knip checks share one spawn within a report and that separate report builds re-spawn | `FORCE_VERIFY=1 bun run test -- scripts/drift-ai.test.ts scripts/drift-ai/knip-runner.test.ts scripts/drift-ai/knip-unused-exports.test.ts` (the exact command the finished-work doc used to validate the original change) |

### Dependency edges

- **None.** `34.1 ∥ 34.2` — disjoint files, disjoint tests. Run them in either
  order or concurrently. Prefer 34.1 first: it is the cheaper review.
- **`34.1` must not grow the forward contract.** `scripts/drift-triage/MODULE.md`
  names exactly five importable drift-ai modules and the forward direction is
  **review-policed, not lint-enforced** — only the reverse direction is caught by
  `driftDirectionLawConfigs`. A sixth triage import passes lint while violating
  the architecture. `types.ts` is already on the list, which is why the predicate
  goes there.
- **Leaf 28 owns `scripts/drift-ai/MODULE.md`** (its step 6; slice 28.2 on the
  parked `plan/cq-harness-xl` branch). Nothing in this plan writes it. If that
  lands first, 34.1's `scripts/drift-triage/MODULE.md` refresh is a smaller edit.

### Index reconciliation (slice 34.1 applies these)

1. `00-index.md`, "Read this first": leaf 34 is no longer XL. Point its row at
   this file and mark it S.
2. `00-index.md`, "Do not start with": remove 34 from the XL list.
3. `34-drift-ai-typing.md`: add a Status pointer to this plan, and record the
   step-7 carve-out so it is not re-scheduled from the leaf.

## Operational risks

- **`runner.ts`'s gate must stay fail-closed.** It negates a strict `=== true`.
  Missing, `false` or malformed `typeOnly` must continue to fail, and a *skipped*
  import-cycles check must still exit 1 — that branch sits immediately above the
  read. This path runs on every changed lint via `scripts/lint-changed.sh:start_import_cycles_lane`,
  so a polarity slip is a commit-gate incident, not a test failure.
- **Adding or moving any file under `scripts/drift-ai/` changes a generated doc.**
  `scripts/lint-coverage-map-gen-core.ts:deriveDriftAiCoverageBlock` embeds the
  direct-child `.ts` **count** into `docs/generated/lint-coverage-map.md` and
  throws if any such file lacks ESLint reach. Both surviving slices modify
  existing files only and should not move that count; this is also a standing
  reason the dropped steps 5 and 6 were more expensive than they looked. If a
  file is ever added, run `bun run docs:lint-coverage-map:generate` and
  `bun run harness:check` before committing.
- **34.2 must not weaken the report boundary.** The invariant is two-sided:
  selected knip checks share one spawn *within* a report, and separate
  `buildReport` calls *re-spawn*. Keying off `env.reportCache` gives the second
  half structurally; the first half depends on every cache-key dimension
  surviving intact.
- **Do not unify adapter exit-code policy** if any future work reopens step 5.
  knip treats a non-zero exit as its normal success case; jscpd, semgrep and dolos
  do not, and only semgrep/dolos classify `ENOENT` as tool-unavailable. Absorbing
  those into a kernel silently flips finding-vs-skip.
- **H6 removed the `config-readers.ts:isRecord` export after this plan was
  written.** Its seven production consumers now import the generic guard directly
  from `scripts/lib/records.ts`, making that ownership visible instead of keeping
  a forwarding export. The constraint behind the original ruling was honoured:
  `UnknownRecord` travelled with the guard change and remains exported from
  `config-readers.ts`; `semgrep-output.ts` and `semgrep-rule-manifest.ts` split
  their value and type imports accordingly. The separate one-line collapse this
  plan anticipated therefore no longer exists, and the two runners retained by
  the dropped step 5 use the shared guard directly.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **Scheduling leaf 34 as an XL** | Both consults independently said no. What survives review is one predicate, three `Set` annotations and one cache relocation. |
| **Dropping the leaf entirely (cursor's position)** | Over-corrects. The `typeOnly` key crosses an architecture-enforced boundary, gates an exit code in the commit path, and is written on two different checks — that is a real contract, not cosmetics. And the knip module-global is a production module forced to call a reset named for tests. |
| **Turning `DriftFinding` into a per-check discriminated union** | The leaf's own caveat is right and both consults agreed: 2 production reads against 14 writers, threading through the generic `TExtra` merge in `duplicate-shapes.ts`, contradicting the deliberate open-extension contract documented in `types.ts`. |
| **Bounded-subprocess kernel (step 5)** | The premise — "near-verbatim copies" — does not survive reading the four bodies (correction 3). Extracting them requires either parameterizing the differences (a kernel with four policy hooks) or normalizing them (a silent behaviour change in commit-gating tools). |
| **Splitting the barrel test (step 6)** | 1,658 lines of pure motion, no new coverage, a false premise about existing colocation (correction 2), loss of incidental barrel verification, and a generated-doc count change. |
| **A shared finding contract across the drift-ai/drift-triage seam** | The two directories deliberately model a finding with two different types — triage is the tolerant consumer (`check: string`, `details: Record<string, unknown>`), drift-ai the strict producer. That asymmetry is the anti-corruption layer, not an accident. Structural typing at the seam (what 34.1 does) is the correct answer. |
| **Writing `scripts/drift-ai/MODULE.md` here** | Cursor proposed orientation over retyping and was right about the priority — but leaf 28's step 6 already schedules exactly that, and the parked `plan/cq-harness-xl` branch promotes it to slice 28.2 with the prefix-family list and the two-registry layering law. Duplicating it would create a conflict, not value. |
| **Porting `triage-verdict-input.ts` alongside the report contracts** | Different contract family (`triage-verdict-types.ts`), no shared schemas. Excluded from the carve-out scope. |
| **Folding triage's category/priority sets into drift-ai check descriptors** | The leaf's caveat holds: `REVIEW_FIRST_CHECKS` and `MAINTENANCE_CHECKS` are two independent axes overlapping on four ids, and pushing them into the producer puts consumer policy in the producer. |
| **Fixing knip's `SIGTERM`-vs-`SIGKILL` classifier mismatch here** | Real, recorded in correction 3, but not a live defect (the `ETIMEDOUT` line catches the case first) and not a typing item. It is a separate bug-shaped decision; do not let it ride inside a refactor. |

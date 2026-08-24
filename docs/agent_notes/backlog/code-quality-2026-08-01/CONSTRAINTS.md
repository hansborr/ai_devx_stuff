# Constraints and unresolved owner decisions

Status: Reference — standing audit rulings and explicit coverage limits for
[00-index.md](./00-index.md)
Created: 2026-08-04

Read this before treating the pack as exhaustive, changing its numbering, or
reopening scope. The first register records settled decisions. The final
section records two questions that are deliberately **not** settled.

## Standing rulings

| Do not | Because | Check |
|---|---|---|
| Describe the audit as exhaustive or the 15 round-6 cuts as still unread | Round 6 substantively reconstructed and read all 15 remaining eligible `coverage.cut` rows, exhausting the finite eligible pool at 216 of 216 read. That closes this cut register, but it does not repair the S0 provenance loss or convert deliberate scope exclusions into reviewed surfaces. | [source-ledger.json](./working/phase5/source-ledger.json); [round-6 seats](./working/phase5/1b-r6/); [RUN-LEDGER.md r99–r100](./RUN-LEDGER.md#runs) |
| Treat a deliberate scope exclusion as clean | Generated server source, build artifacts, `bun.lock`, drift packet outputs, unread legal/source text (`LICENSE`, `NOTICE.md`, and `docs/SRD_CC_v5.2.1.pdf`), SRD content correctness, and the contents of existing `docs/agent_notes/` packs were excluded. Pack structure remained in scope. These are skipped surfaces, not reviewed surfaces. | [ORCHESTRATION.md § Lane ownership matrix](./ORCHESTRATION.md#lane-ownership-matrix); [ownership-closure.md](./working/ownership-closure.md) |
| Add bug hunting or security review to this audit after the fact | The owner assigned bug hunting to `/code-review` and security review to `/security-review`. Suspected bugs were side-listed without audit verification. | [ORCHESTRATION.md § Deliverable](./ORCHESTRATION.md#deliverable); [BUGS-HANDOFF.md](./BUGS-HANDOFF.md) |
| Restore retired leaves 096 or 161, reuse either number, or renumber the pack | S3 merged 096 into 198 and 161 into 142. The 269 live leaves therefore retain deliberate holes at 096 and 161. Stable numbers protect citations, ledger rows, and cross-references. | [s3-adjudication.json](./working/phase5/s3-adjudication.json); [edge-graph.json](./working/phase5/edge-graph.json); [00-index.md § Scheduling rules](./00-index.md#scheduling-rules) |
| Infer a queue priority from severity, size, area, or graph degree | The pack is an evidence and scheduling map. No implementation priority was selected during finalization. | [00-index.md § Scheduling rules](./00-index.md#scheduling-rules) |

## Round-6 rulings for the 15 eligible cuts

Round 6 reconstructed and read every row below. The two 1b seats promoted 9
and dismissed 6: harness promoted 5 of 7, docs/DX promoted 4 of 4, and client
promoted 0 of 4. Pooled 1c adjudication verified the evidence for all 9
survivors, then admitted 1 new leaf, folded 4 into existing leaves, and rejected
4. The final result is leaf 271 plus augmentations to leaves 084, 094, 115, and
126. Two docs candidates duplicated leaf 099, the contribution-guide candidate
duplicated leaf 266, and the remaining rejection was an unmeasured local
subprocess optimization. The 6 seat dismissals did not enter 1c.

The exact `sourceItemId` values remain authoritative material names from
[source-ledger.json](./working/phase5/source-ledger.json). Its round-5
`not-sampled` fields are the state that selected this late pool, not the final
disposition; the substantive rulings are banked in the
[round-6 seats and adjudication](./working/phase5/1b-r6/) and narrated in
[RUN-LEDGER.md r99–r100](./RUN-LEDGER.md#runs). Future readers must not silently
re-open these rulings.

### lane-01-harness-core — 7 read, 5 promoted, 2 dismissed

- `wave-1/lane-01.json::coverage.cut[0]` — augmented leaf **115** with the
  generator-owned typed descriptor for the four verify-step projections.
- `wave-1/lane-01.json::coverage.cut[1]` — augmented leaf **126** with exact-key
  rejection for the top-level `hookWiring` object and harness commands.
- `wave-1/lane-01.json::coverage.cut[2]` — rejected at 1c. The 12 serialized
  launches and 2 repeated projections verified, but no timing established
  material DX harm sufficient to justify parallel process management.
- `wave-1/lane-01.json::coverage.cut[9]` — dismissed at 1b. The portability
  documentation already distinguishes the portable core from repo-local Bash
  orchestration and names the relevant platform assumptions.
- `wave-1/lane-01.json::coverage.cut[10]` — became leaf **271**, which routes
  `verify:logs` wrapper-marker reads through the canonical marker codec.
- `wave-1/lane-01.json::coverage.cut[20]` — augmented leaf **084** with the
  accepted backlog-note and pack grammar and its compatibility boundaries.
- `wave-1/lane-01.json::coverage.cut[29]` — dismissed at 1b. The two sensors
  already share the import-safe CLI envelope; their remaining API and doctor
  differences follow their distinct contracts.

### lane-05-client — 4 read, 0 promoted, 4 dismissed

- `wave-1/lane-05.json::coverage.cut[0]` — dismissed as the same prop-grouping
  direction already declined under **`CQ25-191`**. The one-caller, 24-prop
  shape did not supply a reason to overturn that ruling.
- `wave-1/lane-05.json::coverage.cut[47]` — dismissed: the step headings were
  short distinct presentation, and the review queries used ordinary,
  independently cacheable contracts without a duplicated lifecycle.
- `wave-1/lane-05.json::coverage.cut[48]` — dismissed: the header controls were
  local state rendering, `EncounterMapLink` was a focused one-consumer
  boundary, and `CombatLogPanel` was already divided into cohesive helpers.
- `wave-1/lane-05.json::coverage.cut[49]` — dismissed: no loading policy or
  measured bundle impact made the eager/lazy split a defect, and the page-owned
  empty states had materially different semantics and actions.

### lane-07-docs-dx — 4 read, 4 promoted

- `wave-1/lane-07.json::coverage.cut[2]` — rejected at 1c as fully owned by
  leaf **099**, which already corrects the concurrency writer map's facade
  misdirection.
- `wave-1/lane-07.json::coverage.cut[3]` — rejected at 1c as the second explicit
  half of leaf **099**, which already owns the guide's UTF-16 code-unit
  terminology correction.
- `wave-1/lane-07.json::coverage.cut[15]` — augmented leaf **094** with the
  corrected guide inventory. Leaf 094's settled authority split keeps
  `ai-harness.md` as the single complete guide-table owner, so the proposed
  competing local landing page remains rejected.
- `wave-1/lane-07.json::coverage.cut[17]` — rejected at 1c as an exact duplicate
  of leaf **266**, which already owns the human-focused contribution entrypoint.

## Deliberately excluded scope

The lane matrix excluded the following. Nothing in this pack establishes that
these surfaces are clean:

- `packages/server/src/generated/`;
- build artifacts;
- `bun.lock`, which was not read as source and carries no cleanliness claim;
- drift packet outputs;
- `LICENSE`, `NOTICE.md`, and `docs/SRD_CC_v5.2.1.pdf`, which were not read as
  legal/source text and carry no cleanliness claim;
- SRD content correctness (data values), while data structure remained in
  scope; and
- the contents of `docs/agent_notes/` packs, while pack structure remained a
  lane-07 subject.

The concrete path accounting is retained in
[ownership-closure.md](./working/ownership-closure.md). Bug and security review
were separate owner-assigned scopes, as recorded above.

## Open owner-facing questions — unanswered

These are preserved from
[ORCHESTRATION.md § Last checkpoint](./ORCHESTRATION.md#last-checkpoint).
Neither finalization nor the owner's one-off request to read these 15 rows
answers them, and a future audit must not silently turn that request into a
general ruling.

1. **Round limit.** When the written `>= 3` accepted-promotion rule keeps
   re-firing, should a future audit run a finite pool to exhaustion, or stop at
   a fixed round count and record the remainder as knowingly unsampled? The
   decision also determines when S0 may freeze. Exhausting this pack's pool did
   not settle that choice.
2. **Stopping-rule design.** For a larger future pack, should the template use
   an acceptance rate (accepted per cut read) or a fewer-than-N yield threshold
   instead of a raw count that loses information as the remaining draw shrinks?
   The template should settle this once rather than re-litigating it per pack;
   round 6 made no general ruling on the design.

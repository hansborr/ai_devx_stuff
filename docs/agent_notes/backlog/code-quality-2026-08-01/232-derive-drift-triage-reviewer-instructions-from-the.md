# 232. Derive drift-triage reviewer instructions from the enforced verdict contract

Status: Landed on fix/cq-232
Theme: Single-source drift-triage's advertised and enforced verdict contract · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Drift-triage packet generation advertises one reviewer contract while verdict
collection enforces another independently maintained contract. The two lists
currently agree, but TypeScript does not connect the packet's string arrays or
required-field names to the canonical verdict model.

A vocabulary or shape change can therefore update only one side. Reviewers may
complete a valid generated packet while following instructions that request a
value or field the collector later rejects, wasting completed review work and
turning an internal maintenance omission into a delayed boundary failure.

The packet shape also advertises an `oversized` state that grouping makes
uninhabitable. Ordinary groups flush before exceeding the configured bound, and
large path-connected components are split into bounded chunks before the field
is calculated. Carrying an always-false property through grouping, packet and
manifest types, serialization, and fixtures invites dead consumer handling and
adds synchronized maintenance without disclosing a possible runtime condition.

## Evidence

- `scripts/drift-triage/triage-packets.ts:18-33` — packet production locally
  declares reviewer-facing verdicts, severities, confidences, required fields
  and the conditional `canonicalItemId` requirement.
- `scripts/drift-triage/triage-verdict-types.ts:1-19` — separate canonical
  literal arrays and the `TriageVerdict` model define the vocabulary and fields
  accepted by verdict collection.
- `scripts/drift-triage/triage-verdict-input.ts:58-83` — runtime parsing
  independently enforces those canonical arrays and each required record field.
- `scripts/drift-triage/triage-packet-types.ts:39-45` — the packet-facing type
  widens all three closed vocabularies and `requiredFields` to arbitrary string
  arrays, so neither vocabulary nor field names are tied to
  `TriageVerdict`.
- `scripts/drift-triage/triage-packet-group.ts:74-83` — ordinary components
  flush before `pending` can exceed `packetSize`, including an exact-size flush.
- `scripts/drift-triage/triage-packet-group.ts:88-117` — oversized components
  are divided into bounded chunks before `toGroup` calculates
  `items.length > packetSize`, leaving `oversized` false even for split path
  components.
- `scripts/drift-triage/triage-packet-types.ts:30-37` exposes `oversized` on
  every packet; `scripts/drift-triage/triage-packet-types.ts:72-80` repeats it
  on each manifest entry; and
  `scripts/drift-triage/triage-packet-types.ts:110-115` repeats it on the
  internal grouping result.
- `scripts/drift-triage/triage-packets.ts:62-70` copies the field into every
  manifest entry, while `scripts/drift-triage/triage-packets.ts:80-105` copies
  it from the grouping result into every serialized packet.

## Proposed direction

Place reviewer-facing contract metadata beside `TRIAGE_VERDICTS`,
`TRIAGE_SEVERITIES`, `TRIAGE_CONFIDENCES` and `TriageVerdict` in
`triage-verdict-types.ts`. Define the required-field list through
`keyof TriageVerdict`-checked metadata and keep the
`duplicate-of`/`canonicalItemId` requirement keyed to the canonical verdict
literal rather than to an unrelated string.

Have `triage-packets.ts` import that metadata when constructing
`verdictContract`, deleting its private vocabulary and field lists. Narrow
`TriagePacket["verdictContract"]` to the canonical element and field-name types
so a producer-side respelling fails typechecking. Keep
`triage-verdict-input.ts` consuming the same canonical arrays, and bind any
field-presence metadata it needs to the same exported contract rather than
creating another runtime list.

Delete `oversized` throughout the packet pipeline: remove it from
`PacketItemGroup`, `TriagePacket`, the manifest-entry type, `toGroup`, packet
construction, manifest serialization, and fixtures. Retain
`splitPathComponent` as the truthful disclosure that an otherwise connected
component crossed packet boundaries. Keep packet and manifest `schemaVersion`
at 1: the deleted field has no inhabitable state, and the in-tree manifest
reader at `scripts/drift-triage/triage-verdict-input.ts:12-25,116-120` consumes
only the manifest contract, provenance, `packetId`, and `itemIds`, not
`oversized`.

Update packet and verdict-collection fixtures together. Pin the emitted verdict
contract byte-for-byte at its current external vocabulary, plus focused cases
showing that `duplicate-of` still requires `canonicalItemId` and all existing
record fields retain their current nullability and validation behavior. Add a
grouping/serialization assertion that every emitted packet respects
`packetSize`, split components retain `splitPathComponent`, and neither packet
nor manifest JSON contains `oversized`.

## Scope / caveats

- Preserve the current external verdict, severity and confidence literals,
  required field names, and collection behavior. Verdict metadata
  single-sourcing is not contract evolution. The sole packet-shape evolution is
  deletion of the uninhabitable `oversized` field; retain packet and manifest
  schema version 1 for the reason stated above.
- Preserve `splitPathComponent`, packet-size enforcement, grouping, selection,
  ordering, checksums, provenance, and all other serialized fields.
- Keep reviewer-facing descriptions and conditional requirements beside the
  canonical constants, but do not make the collector depend on prose.
- Do not fold in prior-pack CQ25-47
  ([code-quality-2026-07-25/34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md)).
  That optional Zod conversion is confined to the report-contract parser
  family and explicitly excludes `triage-verdict-input.ts`; it does not connect
  packet instructions to verdict constants.
- Prior-pack CQ25-10’s verdict-family exclusion does not cover deleting an
  impossible serialized packet field. Do not use this deletion to revive its
  refused Zod port or alter verdict parsing.
- Do not convert the hand-written verdict parser to Zod, change tolerant report
  parsing or generalize this into a shared analyzer-contract framework.

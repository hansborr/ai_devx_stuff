# 138. Drift-triage merge keys double as the published verdict-protocol IDs, with undocumented per-adapter grammars and a JSON.stringify segment

Status: Landed on fix/cq-138
Theme: protocol identity fencing · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The drift-triage report builder mints item identity as ad-hoc template strings
inline in each input adapter — one grammar for drift findings, a second for
Semgrep rows, a third (`pairKey`) shared by clone checks and Dolos — and then
uses that same string three ways at once: as the mutable merge-map key that
decides when two findings collapse into one item, as the item's published `id`
in the report, and (copied verbatim into packet `itemIds`) as the token
external LLM reviewers hand-copy into verdict files that the `collect`
subcommand validates by exact string equality, throwing on any mismatch.

Nothing marks these strings as a contract. The grammars are documented nowhere
(`scripts/drift-triage/MODULE.md`, 138 lines, never mentions them), and their
segments are implementation details: the drift grammar embeds the input file
path, the check name, and a positional row index; the Semgrep grammar embeds
`JSON.stringify(row.ranges)` — property-order dependent, and long enough to be
hostile to the hand-copying reviewers actually do in swarm runs (a known
copy-error surface). So an innocuous producer refactor — reordering findings,
changing a provenance path, tweaking range parsing or merge behavior — silently
changes the identity protocol and invalidates every in-flight verdict file,
without anyone having made an identity decision on purpose.

The blast radius is bounded: IDs are per-run, and `collect` validates verdicts
against the same run's manifest, so the cost is within-run breakage plus
reviewer copy ergonomics — not cross-run corruption. But for a repo meant as a
copyable harness reference, an implicit ID codec at a cross-agent protocol
boundary is exactly the kind of hazard a reader should not have to reverse-
engineer from three adapter bodies.

## Evidence

- `scripts/drift-triage/triage-report.ts:132` — drift item key
  `` `drift:${inputPath}:${finding.check}:${index}:${finding.file}` ``, an
  undocumented colon-delimited grammar embedding a positional index; published
  as the item's `id` at `:134`.
- `scripts/drift-triage/triage-report.ts:131` — clone-check findings in the
  *same* adapter route through `pairKey` instead, so one adapter emits two
  grammars depending on the check.
- `scripts/drift-triage/triage-report.ts:172` — Semgrep key
  `` `semgrep:${row.path}:${JSON.stringify(row.ranges)}:${identity}` ``:
  serialized-object identity, property-order dependent; published as `id` at
  `:175`.
- `scripts/drift-triage/triage-report-support.ts:97-106` — `pairKey` builds the
  third grammar (`pair:` + locale-sorted locations joined with `<=>`); Dolos
  rows publish it as `id` at `triage-report.ts:224-226`.
- `scripts/drift-triage/triage-report-support.ts:115-134` — `addReviewItem`
  uses the same string as mutable build-state identity: a key collision merges
  evidence, locations, and priority into the existing item, so merge semantics
  and the public ID are one decision made nowhere.
- `scripts/drift-triage/triage-report-types.ts:31`, `:114`, `:124` —
  `TriageItem.id`, `MutableItem.id`, and `BuildState.items: Map<string,
  MutableItem>` are all plain `string`; nothing distinguishes an ID from any
  other string.
- `scripts/drift-triage/triage-packets.ts:95` — packet building copies
  `item.id` into `itemIds`, which the manifest publishes (`:66`) — the point
  where the internal key becomes protocol.
- `scripts/drift-triage/triage-verdict-types.ts:11-12` — `TriageVerdict.itemId`
  is an unbranded `string`; externally authored verdict files carry these
  tokens back.
- `scripts/drift-triage/triage-verdict-collect.ts:76-79` — collect hard-errors
  on any `itemId` not exactly matching the manifest (`unknown item`, wrong
  packet); `:57-58` duplicate verdicts, `:99-100` self-referential
  `canonicalItemId` — exhaustive same-run validation, all by string equality.
- `scripts/drift-triage/triage-packets.ts:23`, `:36-39` — the packet's
  `VERDICT_CONTRACT.requiredFields` leads with `"itemId"`, and `PACKET_TASK`
  instructs the reviewer to "return one verdict for every item ID": the IDs are
  the reviewer-facing handle, by design.
- `docs/agent_notes/backlog/drift-triage-2026-07-13/verdict-collection.json` —
  a completed swarm run, 306 item IDs across 24 packets, every one returned by
  an external reviewer. Re-derived from the file: 204 `pair:`, 68 `drift:`,
  34 `semgrep:`. The longest is 287 characters
  (`semgrep:scripts/lint-ratchet/registry-validation.ts:[{"startLine":92,…}]:CWE-185`),
  and the median `semgrep:` ID is 116. Re-encoding those same four ranges as
  sorted `startLine.startCol-endLine.endCol` pairs gives 109 characters, and
  drops the median to 70.
- `scripts/drift-triage/triage-report.test.ts:317`, `:899`, `:912` — three
  incidental assertions on `drift:`/`pair:` IDs, written as fixtures for other
  behaviors rather than as a stated contract. Measured: zero occurrences of
  `semgrep:` across `scripts/drift-triage/*.test.ts`, so the longest and most
  fragile grammar is entirely unpinned.
- `scripts/drift-triage/MODULE.md:67-83` documents state ownership down to
  "packet item IDs" as an output artifact, and `:109-138` documents the closed
  verdict vocabulary, the clone-merge rule, and Semgrep column preservation —
  but no section states any ID grammar, its stability contract, or its owner.
- `scripts/drift-triage/triage-report-support.ts:146-150` — the only
  prefix-sniffing consumer (`titleSourceRank`) ranks `evidence.source`, not
  item IDs; downstream, IDs are compared but never parsed. The leak is
  entirely producer-side.
- `scripts/drift-triage/triage-report.ts:16` — measured: `triage-report.ts` is
  the sole importer of `pairKey` today, so relocating it is a one-import
  change; no re-export shim is needed (`scripts/drift-ai`'s `pairKey` is an
  unrelated function).
- `scripts/drift-triage/triage-verdict-types.ts:35-48` (the collect-side
  `PacketManifestInput`) and `scripts/drift-triage/triage-packet-types.ts:16-21`
  / `:83-87` (the producer-side manifest and provenance types) — the manifest
  already carries `schemaVersion: 1` plus `gitHead` / `gitDirty` / per-input
  SHA-256 `inputHashes`: the existing identity-evolution surface.

## Proposed direction

Producer-side identity fencing: one branded type, one mint site, in a
dedicated liftable module.

1. **New `scripts/drift-triage/triage-item-id.ts` (~50-100 lines) as the sole
   ID owner.** A branded `TriageItemId` whose brand is minted by exactly one
   private function inside this module — no assertion markers leak elsewhere —
   plus three constructors taking structured identity records:
   `driftItemId({inputPath, check, index, file})`, `pairItemId(...)` taking
   structured locations (path + optional range, so pair identity needs no
   re-decision if leaf [139](./139-triage-locations-have-two-independently.md)
   lands), and `semgrepItemId({path, ranges, identity})`. Relocate `pairKey`
   into this module and update its sole importer (`triage-report.ts:16`).
   Grammars stay verbatim with the readable `drift:`/`pair:`/`semgrep:`
   prefixes, with one exception: replace the `JSON.stringify(row.ranges)`
   segment with a deterministic sorted per-range
   `startLine.startCol-endLine.endCol` encoding joined with a fixed separator.
   That kills the property-order dependence and the hand-copy-hostile length
   while preserving column granularity (no new merge collisions) and staying
   visually cross-checkable against the item's locations. No digest segment.
2. **Thread the brand producer-side only**: `TriageItem.id`, `MutableItem.id`,
   `BuildState.items: Map<TriageItemId, ...>`, and `addReviewItem`'s key
   parameter (`triage-report-types.ts`, `triage-report-support.ts`,
   `triage-report.ts`). Merge key = published ID stays **one** type by
   explicit decision — the single mint site is the mechanism forcing future
   identity decisions. Since `TriageItemId` extends `string`, packet building
   (`triage-packets.ts`) and all collect-side equality compile unchanged.
3. **Do NOT brand or grammar-parse verdict/manifest itemIds at collect.** They
   are re-parsed per-run JSON already exhaustively validated against the
   same-run manifest (unknown item, wrong packet, duplicate, self-referential
   `canonicalItemId` all throw); branding there is machinery with no consumer.
   Likewise no codec version: identity evolution is fenced by the manifest's
   `schemaVersion` plus git-head/dirty/input-hash provenance.
4. **Tripwire tests in `triage-report.test.ts`**: a golden ID block per source
   family, explicitly labeled as the published-ID contract, plus a case
   proving the Semgrep ID is invariant under range-object property
   reordering. (`bun run test:scripts:file --
   scripts/drift-triage/triage-report.test.ts` runs the suite.)
5. **MODULE.md Identity section** in `scripts/drift-triage/MODULE.md`: the
   three grammars, the single mint site, the merge-key = published-ID
   decision, that IDs are opaque tokens downstream (never parsed), why there
   is no codec version (manifest provenance is the versioning surface), and
   that per-run-only stability is the contract — the drift positional index is
   load-bearing identity for duplicate same-check/same-file findings, so
   cross-run stability is out of scope by design.

Land atomically with the test updates, and note in the commit body that
emitted Semgrep IDs change — safe under the per-run contract, but it
invalidates any in-flight swarm run.

## Scope / caveats

Binding rulings from the direction review:

- Do **not** introduce a separate internal merge-key type distinct from the
  published item ID; keep one branded `TriageItemId` whose single mint site
  plus the MODULE.md identity note is the mechanism forcing explicit identity
  decisions.
- Do **not** version the ID codec; the run manifest's `schemaVersion` +
  git-head/input-hash provenance remains the identity-evolution surface, and
  that rationale gets recorded in MODULE.md.
- Do **not** brand or grammar-parse inbound verdict/manifest itemIds at
  collect time; they stay plain strings fenced by the existing exhaustive
  same-run manifest validation. Brand producer-side only.
- Do **not** replace the readable `drift:`/`pair:`/`semgrep:` prefixes or
  introduce a content-digest segment; only the `JSON.stringify(row.ranges)`
  segment changes, to a deterministic sorted range encoding that preserves
  column granularity.
- Do **not** put ID generation in `triage-report-support.ts` (already a
  multi-concern junction); the dedicated liftable `triage-item-id.ts` is the
  point.
- Do **not** promise or pursue cross-run ID stability; document per-run-only
  stability as the contract — the drift positional index is load-bearing for
  duplicate same-check/same-file findings.
- Do **not** brand `TriagePacketId` in this leaf; out of scope to keep it at
  S/M.

Other notes:

- This introduces the repo's first branded string type — measured: no
  `__brand` / brand-`unique symbol` pattern exists today in `scripts/`,
  `packages/shared/src/`, or `eslint-rules/`. The private mint function will
  need one `// type-assertion-boundary: interop - …` marker (see the code
  standards in `AGENTS.md`); keeping it to that one site is the point of step 1,
  and the pattern is worth a sentence in the MODULE.md note from step 5.
- The change is module-internal: `scripts/drift-triage/MODULE.md:62` declares
  files inside the directory module-internal (importing them from outside is a
  bug), so there is no shared→server→client contract impact.
- Sequencing: independent of the live 2026-07-25 pack. Its leaf
  [34-drift-ai-typing.md](../code-quality-2026-07-25/34-drift-ai-typing.md) was
  superseded by [34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md) into slice
  34.1 (type-only-cycle key plus classification-set annotations), slice 34.2
  (the knip memo), and a carved-out step 7 (zod narrowing scoped to the
  `triage-report-input` contracts family, with `triage-verdict-input.ts`
  explicitly excluded). None of them touch ID identity. Slice 34.1 does edit
  `triage-report-support.ts` and refreshes `scripts/drift-triage/MODULE.md`, so
  if it is still open expect a small MODULE.md merge; the step-7 carve-out
  landing first would only mean threading the branded ID through those parsers.
  Leaf
  [139](./139-triage-locations-have-two-independently.md) (dual location
  representations) touches the same files; the structured-location
  `pairItemId` constructor above is what keeps pair identity stable if it
  lands, but avoid working the two concurrently in
  `scripts/drift-triage/triage-report*.ts`.

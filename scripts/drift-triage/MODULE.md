# drift-triage module

Concepts: drift triage, review queue, swarm packets, verdict collection, drift-ai reducer

## Purpose

The downstream triage reducer over drift-ai scan output: it compacts one or
more drift / Semgrep-candidate / Dolos-candidate JSON reports into a single
ranked review queue, optionally emits deterministic swarm packets for
multi-agent review, and collects returned packet verdicts. The module is
behaviorally deep with a tiny external interface, so it has exactly one home.

`scripts/drift-ai/` owns scanning: checks, prototype advisories, and report
production. This module never scans and never rewrites or deletes a source
row — every input stays recoverable from its named raw file.

The flat entry `scripts/drift-triage.ts` is the real ~190-line orchestrator
(collapse ruling 2), not a delegation shell; everything else lives in this
directory as module internals.

## Data Flow

1. **Parse** — `drift-triage-options.ts` parses flags (`--format`, `--output`,
   `--packet-dir`, `--packet-size`, packet filters, deferral opt-ins).
2. **Load** — `drift-triage-inputs.ts` reads and hashes each input; only
   complete schema-v4 drift reports are accepted (finding chunk files are
   rejected), plus `semgrep-candidates` / `dolos-candidates` advisory JSON.
3. **Reduce** — `buildTriageReport` merges equivalent Semgrep locations and
   repeated cross-file clone pairs while retaining every distinct location and
   drift message; drift-authored titles deterministically win over generic
   advisory titles regardless of input order. Policy deferrals (type-only
   cycles, unadjudicated repeated literals, test-only
   security/constant/type/schema evidence, clone evidence with two distinct
   test-only locations, Dolos rows below `--min-clone-fragment`, default `20`)
   are counted with machine-readable reasons.
4. **Render/deliver** — `triage-report-text.ts` formats text; the entry writes
   the report and, with `--packet-dir`, calls `buildTriagePackets` after
   merging and deferrals so every selected item is assigned exactly once, then
   `drift-triage-packet-io.ts` writes the bundle with repo provenance.
5. **Collect** — the `collect` subcommand (`drift-triage-collect.ts` over the
   `triage-verdict-*` cluster) validates returned verdict files against the
   packet manifest and emits completion accounting plus a second-pass queue
   for `needs-human` verdicts and confirmed medium/high findings.

Internally the directory is three clusters plus entry support: the report
cluster (`triage-report*.ts`, with `triage-report-support.ts` holding shared
parse/build helpers), the packet cluster (`triage-packet*.ts`), and the
verdict cluster (`triage-verdict-*.ts`); `drift-triage-options.ts`,
`drift-triage-inputs.ts`, `drift-triage-packet-io.ts`, and
`drift-triage-collect.ts` support the entry.

## External Entry Points

- `bun run drift:triage` — the package script running `scripts/drift-triage.ts`;
  `bun run drift:triage collect` is the verdict-collection subcommand.
- `runDriftTriageCommand` (in `scripts/drift-triage.ts`) is the CLI
  orchestration entry; it dispatches between the report path and `collect`.
  The entry also exports the programmatic seam used by the module tests —
  `runDriftTriage` and `parseArgs` — plus the
  `RunDriftTriageOptions`/`RunDriftTriageResult` types and a `formatText`
  alias of `formatTriageText`.
- Files inside `scripts/drift-triage/` are module-internal; importing them
  from outside the module is a bug.

The harness sensor row for `drift:triage` lives in `docs/ai-harness.md`.

## State Ownership

No DB, cache, or socket state. The module owns its output artifacts only:

- the triage report (`--output`, text or JSON);
- the packet bundle (`--packet-dir`): one packet file per group plus
  `manifest.json` recording Git head/dirty state, SHA-256 of every raw input,
  selection filters, selected/excluded accounting, packet checksums, and
  packet item IDs. Packets group by priority, category, evidence source, repo
  area, and exact path overlap; when a path-connected component would exceed
  `--packet-size`, the hard bound wins and affected packets set
  `splitPathComponent: true`;
- the collect outputs: the collection report and the second-pass queue.

Inputs are read-only; upstream truncations and degradations are copied into
the input summary rather than repaired.

## Drift-AI Contract And Direction Law

The forward contract into drift-ai is exactly five modules: `../drift-ai/types.ts`,
`../drift-ai/check-metadata.ts`, `../drift-ai/scope.ts`,
`../drift-ai/prototype-advisory.ts`, and `../drift-ai/scan-provenance.ts`
(the last imported by the entry for generated-artifact exclusions). Growth of
this list is policed by review, not by an allowlist.

The reverse direction is ESLint-enforced: `scripts/drift-ai/**` must not
import `scripts/drift-triage/**` (`driftDirectionLawConfigs` in
`eslint-config/script-configs.js`, collapse ruling 4).

## Test Seams

- `buildTriageReport` — `triage-report.test.ts` and
  `triage-report-swarm-prep.test.ts`.
- `buildTriagePackets` — `triage-packets.test.ts`.
- Verdict collection — `triage-verdict-collect.test.ts` and
  `drift-triage-collect.test.ts`.
- CLI orchestration — `drift-triage.test.ts` covers `scripts/drift-triage.ts`
  itself.
- All triage tests use inline data only (zero fixtures); the
  `report-contract.*.json` fixtures belong to drift-ai's own contract test.
- Focused runs: `bun run test:scripts:file -- <file>`.

## Gotchas

- Verdict vocabulary is closed: `confirmed`, `false-positive`,
  `accepted-drift`, `duplicate-of`, `needs-human`; `duplicate-of` requires a
  different assigned `canonicalItemId`, every other verdict must leave it
  `null`. The collector rejects malformed files, unknown packets/items,
  cross-packet ownership, duplicate item verdicts, and invalid canonical
  references, and warns when Git HEAD differs from the manifest.
- Same-file clone pairs merge only when their line ranges match, so
  fragment-level drift pairs stay separate from whole-file Dolos ranges.
- Scope/coverage disclosure is deliberate: every drift input preserves and
  displays its scope mode, roots, and enabled checks; changed-scope,
  root-restricted, and missing-default-check scans are marked partial even
  with zero findings (both the default check set and `--check all` count as
  complete coverage); a scope-inapplicable check (e.g. suppressions in current
  scope) is disclosed separately instead of making a scan partial.
  Partial-input disclosures also name skipped drift checks and reasons, hit
  advisory caps, unmet prerequisites, and every degradation reason (including
  zero-row timeouts). Processing caps distinguish an unknown producer tail
  from ordinary display truncation.
- Semgrep evidence is `review-first` only at ERROR/CRITICAL severity or
  declared HIGH confidence; other security candidates stay in the security
  lane without an implied severity verdict. Semgrep rows must carry at least
  one source range, and exact columns are preserved in structured packet
  locations.
- Deferred streams are opt-in recoverable: `--include-literals` and
  `--include-type-only-cycles` run dedicated passes.
- Do not add drift-ai imports beyond the five-module contract above without
  a reviewed ruling update; the founding ruling lives in the closed
  `drift-triage-collapse.md` backlog note (removed 2026-07-19; git history).

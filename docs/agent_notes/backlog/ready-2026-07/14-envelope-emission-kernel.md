# One envelope writer — diagnostics emission kernel

Status: Ready
Date: 2026-07-19
Source: 2026-07-19 harness architecture review, candidate 4 (session artifact,
claims verified against HEAD 544a9d06 the same day); design calls consulted
with Fable 5 + Codex 2026-07-19, rulings folded in below.
Size: M.

## Evidence

Four writers independently produce harness-diagnostics envelopes against the
shared schema (packages/shared/src/schemas/harness-diagnostics.ts):

- scripts/harness-emit-envelope.ts (193 L) — validates via
  harnessDiagnosticsSchema + harnessFindingSchema, atomic write.
- scripts/harness/harness-diagnostics-output.ts (53 L) — sidecar-only,
  routed via the HARNESS_DIAGNOSTICS_OUTPUT env var, validated.
- scripts/lint-ratchet/output.ts (18 L) — delegates render/path to
  harness-diagnostics-output.js but performs NO schema validation on its
  write path. A malformed envelope from this writer is not rejected at the
  source; it surfaces downstream in `harness:audit` as an infrastructure
  failure instead of never being written.
- scripts/lint-agent-envelope.ts (280 L) — its own build+write pipeline from
  ESLint results.

Same contract, four routing/validation behaviors — the unvalidated write path
is the concrete defect this leaf exists to close.

## Scope guard

The envelope SCHEMA is keep-listed
(lint-arch-review-2026-07/00-index.md:146-147;
arch-review-2026-07/00-report.md:296) and stays untouched. Only the writers
around it are in scope.

## Plan

One emission module owning validate → route → atomic write, with EXPLICIT
routing modes: stdout-only, sidecar-only, both, or explicit output path
(Codex ruling — the kernel is scoped around these modes, not around
generalizing the payloads). The four writers become thin adapters that build a
payload and call it. Atomic write is already shared (arch-plans-2026-07/01,
Done) — reuse it, do not reinvent.

## Acceptance (Codex)

- Every envelope is schema-validated even when no sidecar is requested.
- Each producer's exit/error contract and tool-ID gate are unchanged.

## Constraints

- Check the lint-ratchet S3 engine-kernel hold (68a3f000) disposition FIRST:
  scripts/lint-ratchet/output.ts may move under that hold (engine in
  tools/lint-ratchet, @musi/lint-ratchet), which changes where its adapter
  lives.
- Any new module carries the known registration surfaces: smoke-subjects
  header + `bun run test:scripts:subjects` regen,
  eslint-config/config-surface-manifest.json + generator rerun, coverage map
  (hand-edited), and the fixture-copy/import-closure sweep until ready-row B5
  generalizes it.

file:line refs verified 2026-07-19 at HEAD 544a9d06; they drift fast.

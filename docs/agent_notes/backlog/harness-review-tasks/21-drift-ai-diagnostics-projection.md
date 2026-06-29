# 21 - drift:ai diagnostics projection

Status: Superseded -> drift-ai-next-items 11 (drift:ai diagnostics projection, Done)
Track: Dg (diagnostics)
Size: medium
Depends on: 20
Blocks: 23

## Goal

Let `drift:ai` optionally emit a shared harness diagnostics envelope while
preserving its existing text and JSON reports.

## Background

`drift:ai` already owns rich report data and report-only semantics. The missing
piece is a stable projection that another harness command can consume without
parsing human text or drift-specific JSON.

Use the same sidecar-output convention as `lint:ratchet`: the human/native report
stays unchanged, and a shared diagnostics envelope is written only when explicitly
requested through `HARNESS_DIAGNOSTICS_OUTPUT` or an existing equivalent output
path. Do not copy lint-ratchet's stdout behavior; default `drift:ai` output must
remain its current text or native JSON report.

## Seams to touch

- `scripts/drift-ai.ts`
- `scripts/drift-ai/report-builder.ts`
- `scripts/drift-ai/report-output.ts`
- `scripts/drift-ai/report-format.ts`
- `scripts/drift-ai.test.ts`
- `scripts/drift-ai/README.md`

Reconfirm exact seams with `rg` before editing; the drift code moves quickly.

## What to do

1. Add a small diagnostics projection layer from the built drift report to
   `HarnessDiagnostics` with `tool: "drift:ai"`.
2. Include enough metadata for a consumer to display scope, selected checks,
   skipped checks, finding counts, and infrastructure errors.
3. Keep findings report-only: finding presence must not change the command exit
   code.
4. Treat malformed diagnostics output paths as normal CLI errors.
5. Document the opt-in output path and how it differs from `--format json`.

## Testing

- Add focused tests proving:
  - clean drift output writes a valid shared envelope;
  - findings write a valid shared envelope with nonzero counts;
  - skipped checks are represented without pretending a check passed;
  - an unwritable diagnostics path fails clearly.
- Validate the envelope with `harnessDiagnosticsSchema` in tests.
- Run the focused `scripts/drift-ai.test.ts` cases, or the full file if the
  touched helper is shared broadly.

## Out of scope

- Replacing `drift:ai --format json`.
- Adding `harness:audit`.
- Adding CI scheduling.

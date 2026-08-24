# 177. Logs-audit’s ingestion kernel still lives in its CLI facade

Status: Landed on fix/cq-177
Theme: CLI kernel boundary · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The logs-audit family has focused modules for checks, formatting, discovery, diagnostics, and shared types, but its input pipeline and orchestration remain in the flat executable. Extending one audit pass therefore requires contributors to cross the facade/directory boundary to understand how records are parsed, rejected, dispatched, merged, and rendered.

The entry is safely guarded rather than unconditionally side-effecting, so this is mild organization debt rather than an import-safety bug. Completing the module boundary would make the analyzer easier to copy and use programmatically while leaving the flat path as a recognizable CLI.

## Evidence

- `scripts/logs-audit.ts:67-105` owns the option schema, parser, and validation policy.
- `scripts/logs-audit.ts:107-167` performs JSONL normalization, parsing, rejection accounting, record collection, redaction inspection, and check dispatch.
- `scripts/logs-audit.ts:169-198` owns report merging and per-file read/error handling.
- `scripts/logs-audit.ts:200-273` defines the run contract and coordinates argument parsing, latest-file discovery, auditing, formatting, diagnostics sidecar writes, and exit codes.
- `scripts/logs-audit/logs-audit-checks.ts:1-3` is exactly a three-export barrel; the coordinating ingestion algorithm remains outside the directory.
- `scripts/logs-audit.ts:275-279` guards execution with `isCliEntrypoint`, so importing the module does not automatically run the audit.
- The only in-repository importer of the flat module’s exports is `scripts/logs-audit/logs-audit.test.ts:7-20` (one importer, re-derived at the audit pin).

## Proposed direction

Move `parseArgs`, `auditJsonlText`, `mergeReports`, `auditLogFiles`, and `runLogsAudit` into one or two focused modules under `scripts/logs-audit/`.

A practical split is:

- an ingestion module owning JSONL parsing, rejection accounting, check dispatch, report merging, and file-reader injection; and
- a runner module owning CLI option parsing, latest-file resolution, formatting choice, diagnostics-sidecar handling, and exit-code policy.

Leave `scripts/logs-audit.ts` as the shebang-bearing delegate: import `runLogsAudit`, pass user arguments, print stdout, and set the returned exit code. Update `logs-audit.test.ts` to import the relocated APIs from their owning modules. Retain facade re-exports only if a compatibility search finds a genuine consumer; at the pin, the test is the sole importer and can move directly.

## Scope / caveats

Preserve all observable CLI behavior: usage text, explicit-file and `--latest` selection, JSON/text formatting, read-error findings, diagnostics-sidecar failures, and exit codes 0/1/2.

The live 2026-07-25 pack’s [35-code-intel-internals.md](../code-quality-2026-07-25/35-code-intel-internals.md) step 5 and H19 already moved core types to `logs-audit-types.ts`, removed production type back-edges, and established the checks barrel. This leaf is a continuation of that boundary, not permission to reopen or reverse it.

Do not repartition the individual check implementations or change the business-event taxonomy. No sequencing edge is required.

# One envelope writer — diagnostics emission kernel

Status: Done — landed 2026-07-25 on `refactor/envelope-emission-kernel`.

> **2026-07-25 re-verification.** The recorded "check the lint-ratchet S3
> engine-kernel hold (68a3f000) first" constraint is **resolved**: S0–S5 landed
> 2026-07-18 (`6e685069`) and `../lint-arch-review-2026-07/02-slice-plan.md:87`
> keeps `scripts/lint-ratchet/output.ts` adapter-side, so it is not moving.
> Also note `2ed39e02` already put all four writers on the shared atomic-write
> helper, and `lint-agent-envelope.ts` is validated by its caller at
> `scripts/lint-agent.ts:128` — `output.ts:14-18` is the only unvalidated
> write path left.

> **2026-07-25 implementation note (supersedes the Evidence claims below).**
> `scripts/lint-ratchet/output.ts` was unvalidated as a *module*, but
> `lint:ratchet` as a *producer* was not: `default-mode.ts:68` called
> `validateEnvelope` (`diagnostics.ts:299`, a `ConfigError`-typed
> `harnessDiagnosticsSchema.safeParse`) immediately before emitting. So the
> real defect was not "a malformed envelope reaches disk" but "validation lived
> in four different places, one of them detached from the module that writes
> the bytes". The fix keeps the `ConfigError` mapping in the adapter so the
> exit-2 contract survives.
>
> The kernel was added to the existing shared module
> `scripts/harness/harness-diagnostics-output.ts` rather than as a new file:
> that module already owned render + sidecar-path + sidecar write, is already
> in both fixture copy-sets (`test-lint-ratchet.sh` `PORTABLE_RUNTIME_FILES`,
> `output.test.ts` `ADAPTER_SUPPORT_FILES`), and reusing it avoided the entire
> new-module registration surface listed under Constraints. Only two
> registrations were actually needed: `test-lint-agent.sh` and
> `test-generate-module-index.sh` copy their CLI into a synthetic repo and
> execute it there, so each gained the kernel in its copy-set plus a
> `# smoke-subjects:` header line (`bun run test:scripts:subjects` regenerates
> the pair). There is no `CROSS_DIR_RUNTIME_FILES` in the tree — that name is
> stale.
>
> One deliberate behavior change beyond the plan: the kernel renders the
> producer's own envelope object, whereas `writeHarnessDiagnosticsSidecar`
> previously rendered zod's parsed copy. Zod reorders keys into schema
> declaration order, so `drift:ai` and `logs:audit` sidecars now carry the
> producer's key order. Values are identical (the schema is `.strict()`), every
> consumer parses the JSON, and the alternative — canonicalizing all four
> writers — would have changed the stdout bytes of three of them.
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

- ~~Check the lint-ratchet S3 engine-kernel hold (68a3f000) disposition
  FIRST~~ — resolved; see the re-verification note above.
- Any new module carries the known registration surfaces: smoke-subjects
  header + `bun run test:scripts:subjects` regen,
  eslint-config/config-surface-manifest.json + generator rerun, coverage map
  (hand-edited), and the fixture-copy/import-closure sweep until ready-row B5
  generalizes it. (Sidestepped by extending the existing shared module — see
  the implementation note.)

file:line refs verified 2026-07-19 at HEAD 544a9d06; they drift fast.

## Landed

`emitHarnessDiagnostics(envelope, route, { source })` in
`scripts/harness/harness-diagnostics-output.ts`: validate every envelope, then
route by `stdout-only` | `sidecar-only` | `stdout-and-sidecar` | `output-path`.
All four writers are thin adapters over it and none validates twice.

Byte-identity was proven for the ordinary (valid-envelope) CLI routes that were
actually captured before and after: `lint:ratchet` clean run,
`harness-emit-envelope` empty/two-finding/`--output`, `lint:agent` clean and
three-finding — 13/13 stdout, sidecar, stderr and exit code identical. That
capture set covers neither the `drift:ai`/`logs:audit` sidecar producers nor any
malformed-envelope path, and both deviate by design:

- **Sidecar key order** (`drift:ai`, `logs:audit`): the kernel renders the
  producer's own envelope object where `writeHarnessDiagnosticsSidecar`
  previously rendered zod's parsed copy, so those two sidecars now carry
  producer key order instead of schema declaration order. Values are unchanged
  (the schema is `.strict()`), every consumer parses the JSON rather than
  reading bytes, and `harness-diagnostics-output.test.ts` pins the difference
  explicitly.
- **Malformed-envelope message wording**: one unified
  `<source> produced an invalid envelope:` replaces the former per-route
  strings — `lint:agent`/`lint:ratchet`'s "produced an envelope that failed
  schema validation" and the sidecar's "harness diagnostics sidecar received an
  invalid envelope". A single validation message is the point of the kernel, so
  this is intended, not drift; exit codes on those paths are unchanged
  (`lint:ratchet` still maps only `HarnessDiagnosticsValidationError` to
  `ConfigError` and keeps exit 2).

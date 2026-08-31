# 93. The manifest guide's exception inventory claims two sanctioned direct readers remain while the enforced allowlist holds five

Status: Landed on fix/cq-091
Theme: harness doc inventory drift · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`docs/guides/harness-manifest-parser.md` is the page a contributor is sent to
when the `MANIFEST_DIRECT_READERS` tripwire fires, and its "When not to
migrate" section presents itself as the complete inventory of the exception
population: "Two readers stay on the allowlist as `sanctioned-reader`". The
enforced map in `scripts/harness/manifest-contract-check.ts` contains **five**
entries, every one categorized `sanctioned-reader`, with materially different
roles — the read+parse composition seam itself, two typed consumers, and the
two loose-schema/partial-tree exceptions the guide does describe. Anyone
auditing the manifest seam — a core surface of this public harness reference —
or deciding whether their own new reader fits the exception shape gets a false
picture: three of the five sanctioned shapes are invisible, so the guide's
closing test ("if neither, migrate") is being applied against an incomplete
set of precedents.

## Evidence

- `docs/guides/harness-manifest-parser.md:121-122` — "Two readers stay on the
  allowlist as `sanctioned-reader`, each with its reason recorded inline. They
  are the shape of the exceptions worth making" — followed at `:124-131` by
  only `generate-harness-controls.ts` and `check-registry.ts`.
- `scripts/harness/manifest-contract-check.ts:112-140` — `MANIFEST_DIRECT_READERS`
  holds five entries, each with its reason in an inline comment:
  `scripts/harness/harness-manifest-loader.ts` (`:113-114`, the composition
  seam every other consumer imports), `scripts/harness/registration-check.ts`
  (`:115-117`, whole typed parse plus granular per-control live-tree
  validation), `scripts/harness/generate-harness-controls.ts` (`:118-127`),
  `scripts/harness/generate-skill-artifacts.ts` (`:128-129`, projects skill
  artifacts through `skill-inventory-schema.ts`), and
  `scripts/lint-ratchet/check-registry.ts` (`:130-139`).
- `scripts/harness/manifest-contract-check.ts:105-111` — the map's doc comment:
  shrink-only, `reader-pending-migration` fully drained, "every remaining
  entry is a deliberate sanctioned reader with its reason recorded inline".
- `scripts/harness/registration-check.ts:50` and
  `scripts/harness/generate-skill-artifacts.ts:11,103` — both import and call
  `readHarnessManifest`, confirming they are live direct readers today, not
  stale entries (a stale entry would itself fail the tripwire's second
  direction, `docs/guides/harness-manifest-parser.md:89-90`).

## Proposed direction

Update the "When not to migrate" section of
`docs/guides/harness-manifest-parser.md` (`:119-135`) to enumerate all five
`MANIFEST_DIRECT_READERS` entries with their inline-recorded reasons, grouped
by role — composition seam (`harness-manifest-loader.ts`), typed whole-parse
consumers (`registration-check.ts`, `generate-skill-artifacts.ts`), and
loose-schema/partial-tree exceptions (`generate-harness-controls.ts`,
`check-registry.ts`) — replacing the claim that only two readers remain.

Mechanics: treat the allowlist at
`scripts/harness/manifest-contract-check.ts:112-140` as authoritative and
largely transcribe its inline comments; the two existing bullets at
`:124-131` of the guide stay accurate and can be kept as written. Keep the
closing migrate-or-not test (`:133-135`) but reconcile it with the wider
population — the loader and the two typed consumers are sanctioned for reasons
(being the seam; owning aggregated diagnostics/projections) that the current
two-exception framing does not cover. This is a prose-only change; no gate
should move, and `bun run harness:check` must stay green.

## Scope / caveats

- Doc-only: `MANIFEST_DIRECT_READERS` itself, the tripwire, and all five
  readers are out of scope — no allowlist entry is added, removed, or
  recategorized.
- The member evidence floated generating this section from the allowlist
  instead of hand-writing it; the agreed direction here is the enumeration.
  Treat generation as out of scope — it would be a new generated surface with
  its own registration cost, disproportionate for five entries.
- Leave the shell/`jq` consumer paragraph (`:95-98`, `check-wiring.sh`)
  untouched — that independence is deliberate and is not part of the
  five-entry population.
- The guide's "three modules" table (`:10-14`) already documents the loader as
  the seam to import; the rewritten section should present the loader's
  allowlist entry as that same fact seen from the tripwire's side, not as a
  new exception.
- No prior-pack coverage: [HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md) is in progress (18 of 23 slices landed), but none of its slices covers the typed manifest-read seam or this allowlist inventory.
- Related, no ordering dependency:
  [147-major-harness-implementation-directories.md](./147-major-harness-implementation-directories.md)
  covers orientation docs for the harness script directories broadly; this
  leaf is a targeted accuracy fix inside one existing guide.

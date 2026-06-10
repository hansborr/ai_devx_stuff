# 39 - prototype advisory output contract

Status: Done
Track: P
Size: small-medium
Depends on: none
Blocks: 41, 41c, 42b, 42c, 43, 44a, 44b, 45a, 45b, 46, 47, 48

## Goal

Define and implement the shared output contract prototype/heavy drift-ai lenses
use before they have evidence to become real checks.

## Background

`hotspots` and `coldspots` already solve the important trust problem: their JSON
top level is advisory-shaped, they do not expose a `findings` key, and text
output avoids `WARN`/`FIX`. Prototype tasks need the same brand firewall so noisy
candidate rows do not look like promoted `DriftFinding` warnings.

Prefer this advisory route over adding a `severity` or `lane` field to
`DriftFinding`. The main finding stream powers summaries, chunks, and
`--fail-on-findings`; mixing prototypes there would make noisy research output
look gateable before it has field data.

## Seams to touch

- `scripts/drift-ai/hotspots-format.ts`
- `scripts/drift-ai/coldspots-format.ts`
- `scripts/drift-ai/subcommand-args.ts`
- `scripts/drift-ai/runner.ts`
- `scripts/drift-ai/README.md`
- optional new shared prototype/advisory helper modules under `scripts/drift-ai/`

## What to do

1. Document the canonical prototype shape in the README and tests: `kind:
   "advisory"`, a requested lens/subcommand name, a "not defects" banner,
   sections, row provenance, caps/timeouts, prerequisites, and degradations.
2. Add a small shared helper or type only if it removes real duplication for
   future tasks. Do not force hotspots/coldspots through a generic abstraction
   unless the code becomes simpler.
3. Add a test fixture that proves prototype advisory JSON does not contain a
   top-level `findings` key and text output does not contain `WARN` or `FIX:`.
4. Define how future prototype subcommands should name candidate sections and
   disclose partial runs, including stopped-after counts and skipped prerequisites.
   The full-history details themselves belong to task 38, but this task owns the
   shared wording pattern so partial prototype runs do not read as complete.
5. Leave `DriftFinding` unchanged unless a later task is explicitly promoting a
   lens into a check.

## Testing

- Focused tests for the helper/contract if code is added.
- README/example-output assertions if the implementation adds generated docs or
  fixtures.
- Existing hotspots/coldspots tests should keep passing unchanged or with only
  intentional expectation updates.

## Out of scope

- Implementing any prototype lens.
- Adding a generic `prototype` super-command if separate subcommands stay simpler.
- Adding `severity`, `lane`, or `experimental` to `DriftFinding`.

## Implementation notes (2026-06-04)

Landed as a standalone type-home + shared-wording module rather than a refactor of
hotspots/coldspots (per "what to do" #2 — they were not made simpler by going
through a generic abstraction, and the prototype banner is intentionally stronger
than their "areas to check" wording, so they keep their own banners).

- `scripts/drift-ai/prototype-advisory.ts` — the contract:
  - `PROTOTYPE_ADVISORY_LANE` / `PROTOTYPE_ADVISORY_BANNER` constants (shared
    discriminant + mandatory candidate banner, no WARN/FIX language);
  - `PrototypeAdvisory<TSection>` envelope (`kind: "advisory"`, `lane: "prototype"`,
    `subcommand`, `banner`, `prerequisites[]`, `caps[]`, `degradations[]`,
    `sections[]`) with `PrototypePrerequisite`, `PrototypeCap`,
    `PrototypeSection<TRow>` (generic over row; carries `candidateKind`,
    `totalCandidates`, `emptyReason`, `entries`);
  - `buildPrototypeAdvisory` stamps the invariant `kind`/`lane`/`banner` so a lens
    cannot forget the firewall or drift the banner; `formatPrototypeAdvisoryJson`
    is the single JSON chokepoint (guarantees no top-level `findings` key);
  - `formatPrototypeHeader` + `appendPrototypeSection` + `prototypeTruncationNote`
    own the shared partial-run wording: unmet prerequisites (`prerequisite … :
    unmet`), hit caps (`cap … : HIT -- PARTIAL run: <stopped-after>`),
    degradations, and `showing N of M candidates (K more; raise --top …)`.
- `scripts/drift-ai/prototype-advisory.test.ts` — 17 tests including the required
  fixture proving advisory JSON has no top-level `findings` key and text output
  has no `WARN`/`FIX:`, plus the prerequisite/cap/truncation/empty-section
  disclosure wording.
- `scripts/drift-ai/README.md` — new "Prototype advisory contract (heavy/
  experimental lenses)" section documenting the envelope, partial-run disclosure
  rules, and that this is the default route for prototype rows (DriftFinding stays
  unchanged).

Task 38 still owns the full-history scanned-range / stopped-reason DATA; a
history-backed prototype lens feeds that into a `PrototypeCap.detail` here rather
than inventing its own disclosure wording. `DriftFinding` left unchanged (#5).

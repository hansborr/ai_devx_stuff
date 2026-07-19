# 14 — Enumerate the package's subpath exports

Status: Accepted 2026-07-18 — adopt with modifications (owner ruling below;
owner delegated the call to a Fable + Codex design consult and signed off
on the result). Gate satisfied 2026-07-18: leaf 05 item 1 (`c3b233de`),
leaf 12 (`0dbb5e5d`), and leaf 13's operations slice (`e1fa3141`) have all
landed. Re-measured against the post-drain tree the same day (see
Measurement — the pre-drain "~30 deep subpaths" figure is superseded).
Priority: P2 · Size: M (re-sized from S by the ruling: the two
prerequisites below are real work the original sizing didn't include)
Source: architecture review 2026-07-18 (candidate 4); codex/opus consult;
owner ruling 2026-07-18 via Fable + Codex design consult.

## Problem

`tools/lint-ratchet/package.json` exports `"./kernel/*.js"`,
`"./git-rail/*.js"`, `"./governance/*.js"` — every file is API, so the
interface is the whole tree. The old directory fork survives as
reach-anywhere access; internal seams cannot be private. For a public
harness-engineering reference whose README says "copy this directory and
bind it with a thin adapter", the exports surface is also adopter-facing
documentation of the supported contract — and under wildcards it
documents nothing.

## Measurement (post-drain, 2026-07-18)

- Musi adapter (`scripts/`, non-test): **39 distinct deep subpaths** — 38
  via static `from` imports plus one dynamic `import()` of
  `governance/trend.js` at `scripts/lint-ratchet/modes.ts` that a
  `from`-only grep misses. Adapter-side tests add 3 more.
- Demo consumer (`examples/lint-ratchet-demo/`): an 11-subpath subset of
  the adapter's set — evidence for the minimum viable contract.
- Package source: 110 modules; **69 (63%) are never imported externally**
  — the private surface the wildcards keep public.
- **20 package-internal modules self-reference siblings through
  `@musi/lint-ratchet/...`** — exact exports apply to self-references
  too, so these block naive narrowing (prerequisite 1 below).
- The set did not shrink after the 2026-07-18 drains (leaf 13's
  operations entry point landed and the count is what it is), so waiting
  for further natural collapse buys nothing.

## Owner ruling (2026-07-18)

Adopt: replace the wildcards with an enumerated, reviewed export set. The
"second hand-maintained inventory" objection from the leaf 02 slice plan
is mostly neutralized for an exports map specifically, because it fails
closed — an unlisted import breaks resolution immediately at
typecheck/test time instead of drifting silently like the copy manifest
did. It is not a duplicate inventory of package files; it is a
deliberately smaller inventory of supported entry points: adding an
internal file changes nothing, adding an entry point becomes an explicit
contract review, and forgetting an intended export breaks loudly.

But reject the naive execution — "enumerate whatever is imported today"
is a third rejected shape (see below). The observed 39 mix three
different things: genuine adopter-facing capabilities, Musi-only
governance reach-through, and incidental generic utilities that repo
scripts borrowed (`atomic-write`, `codepoint-compare`, `eslint-json`, …).
Enumerating them wholesale would freeze the adapter's present chattiness
as supported API. First classify every consumer import as one of:

- supported adopter capability → enumerate and document;
- incidental generic utility → relocate (or split into an explicitly
  separate utility contract);
- adapter reaching through an abstraction → replace with a cohesive
  operation module (`governance/operations.ts` from leaf 13 is the
  model, not a barrel).

No target count: a larger exact set is fine if every entry is a
documented capability; a smaller set achieved through barrels or
grab-bag modules would be worse.

### Acceptance criterion

The exact export set is reviewed against documented adopter workflows;
every consumer import (static, dynamic, and test/mock specifiers) is
either in that set or deliberately rewritten; package-internal
resolution does not require public export entries.

### Prerequisites (the S→M re-size)

1. **Internal imports go relative.** The 20 self-name imports inside
   `tools/lint-ratchet/src` must switch to relative specifiers first,
   or narrowing exports either breaks the package or forces private
   seams to stay exported. Relative imports (not a private `#imports`
   map) — simplest for a copyable source package.
2. **Close the TS `paths` bypass.** `tsconfig.scripts.json` maps all
   three layers with wildcard `paths` aliases, and TypeScript `paths`
   bypasses `package.json#exports` — scripts would typecheck private
   paths that fail at runtime. Remove the aliases (or derive them from
   the authoritative export map); until then enumeration is not
   fail-closed repo-wide and the flip must not land.

### Sequence

1. Internal imports → relative (prerequisite 1).
2. Consumer classification and drain per the ruling above.
3. Atomic flip wildcards → enumerated set, removing the tsconfig
   `paths` bypass (prerequisite 2) in the same change, and inverting
   `tools/lint-ratchet/test/package-structure.test.ts` — it currently
   requires at least one wildcard; it must instead validate exact keys
   and targets, import every supported entry, and prove a
   representative private module is rejected. Add exact-export fixtures
   to the boundary checker, and verify mock/self-import identity in
   package tests, Vitest resolution across both projects, the demo
   fresh-install smoke plus an explicit demo typecheck, and the
   declaration build's emitted specifiers.
4. Each enumerated subpath gets a one-line capability description in
   the package README — the manifest stays the machine-readable
   authority; the README explains intent, not a second filename list.

## Explicitly rejected shapes

- A barrel/`index.ts` — leaf 02 ruling 3 stands. Enumeration is not a
  barrel.
- An "adapter imports ≤ N subpaths" numeric gate: a number is gameable
  and incentivizes barrels or oversized modules. The acceptance
  criterion is the exact reviewed subpath set, not a count.
- Enumerating the currently-observed import set wholesale (added by the
  2026-07-18 ruling): that blesses implementation-shaped coupling as
  API. Classification and drain come first; the enumerated set is the
  output of that review, not of a grep.

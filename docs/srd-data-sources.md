# SRD Data Sources

Stable reference for SRD seed provenance. For rules claims, use
`docs/SRD_CC_v5.2.1.pdf` as the authority.

## Licensing

The SRD 5.2.1 is licensed under Creative Commons Attribution 4.0
International (CC-BY-4.0). Any derivative work must include this attribution:

> This work includes material from the System Reference Document 5.2.1 ("SRD
> 5.2.1") by Wizards of the Coast LLC, available at
> https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
> Commons Attribution 4.0 International License.

## Repo Inputs

- `docs/SRD_CC_v5.2.1.pdf` — official rules reference.
- `packages/server/src/seed/data/reference/` — **committed** SRD reference JSON
  (`5e-SRD-*.json`) read by the seed at runtime. These ship with the repo so
  `bun run --filter @musi/server db:seed` works on a fresh clone with no network
  and no provisioning step. Provenance (upstream repo + pinned revision +
  per-file checksums) and CC-BY-4.0 attribution live alongside the data in
  `packages/server/src/seed/data/reference/PROVENANCE.json` and `NOTICE.md`.
- `packages/server/src/seed/data/` — other committed seed inputs (spells,
  monsters, magic items, rules glossary) generated from the markdown source.
  Their CC-BY-4.0 attribution, modification notice, pinned upstream revision, and
  per-file checksums live alongside the data in
  `packages/server/src/seed/data/NOTICE.md` and `PROVENANCE.json`
  (distinct from the `reference/` manifests above). The checksums are enforced by
  `packages/server/src/seed/seed-derived-provenance.test.ts`.
- `packages/server/src/seed/` — canonical seed scripts and generated seed data
  checked into this repo.
- `docs/refs/5e-database/src/2024/` and `docs/refs/dndsrd5.2_markdown/src/` —
  **optional** local checkouts of the upstream sources below, used **only** when
  reseeding/regenerating the committed data above. Not committed (gitignored);
  no first-run path depends on them.

## External Sources

- 5e-bits `5e-database` (MIT tooling, CC-BY-4.0 `src/2024` content): structured
  JSON source for the reference tables. The currently-vendored revision is pinned
  in `packages/server/src/seed/data/reference/PROVENANCE.json` (at time of
  writing: commit `c40ab45c3648030f54234083ec599c6969934358`, release 4.5.0).
- `springbov/dndsrd5.2_markdown` (CC-BY-4.0): markdown conversion of the SRD
  used when regenerating class, subclass, monster, magic-item, and glossary seed
  data. The vendored derived data is pinned to commit
  `6a3547c1d625fb125fbbcb8ded563f5beff197a8` in
  `packages/server/src/seed/data/PROVENANCE.json`. Note: the upstream README
  states its monster *formatting* was adapted from `mshea/lazy_gm_tools` (a
  multi-source repo); Musi's imported monster roster was checked to be SRD 5.2.1
  creatures only.
- EN World editable SRD 5.2.1: human-readable fallback when the PDF is awkward.

## Reseeding from upstream

The reference JSON is committed, so routine `db:seed` needs none of the above.
To refresh it from a newer upstream release:

1. Clone `5e-bits/5e-database` into `docs/refs/` (gitignored) and check out the
   target revision.
2. Copy the `5e-SRD-*.json` files the seed reads from `src/2024/` into
   `packages/server/src/seed/data/reference/` **verbatim** (do not reformat).
3. Update `PROVENANCE.json` (pinned commit, release, and per-file `sha256`).

Always pin the exact upstream revision in the provenance manifest and the PR
description so future agents can reproduce it.

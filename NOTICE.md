# NOTICE

This repository contains Musi source code plus SRD-derived game content.

## Source Code

Musi source code is licensed under the MIT License. See `LICENSE`.

## SRD 5.2.1 Game Content

Musi rules logic and seed data include material from the System Reference
Document 5.2.1 ("SRD 5.2.1"). As required by its license, we reproduce the
attribution here:

> This work includes material from the System Reference Document 5.2.1 ("SRD
> 5.2.1") by Wizards of the Coast LLC, available at
> https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
> Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.

The SRD content has been modified: parsed, reformatted, normalized, and
restructured into application data and TypeScript seed files.

Detailed provenance, upstream revisions, source mappings, and checksums live in:

- `docs/srd-data-sources.md`
- `packages/server/src/seed/data/NOTICE.md`
- `packages/server/src/seed/data/PROVENANCE.json`
- `packages/server/src/seed/data/reference/NOTICE.md`
- `packages/server/src/seed/data/reference/PROVENANCE.json`

Musi also exposes this attribution in the application at `/legal`.

## Third-Party Seed Sources

- `5e-bits/5e-database`: `src/2024` JSON reference tables copied verbatim from
  the pinned revision recorded in
  `packages/server/src/seed/data/reference/PROVENANCE.json`. Upstream tooling is
  MIT licensed; the vendored game content is SRD 5.2.1 content under CC-BY-4.0.
- `springbov/dndsrd5.2_markdown`: Markdown conversion used to generate the
  committed spells, monsters, magic items, rules glossary, class features, and
  subclass features. The pinned revision and checksums for generated JSON live
  in `packages/server/src/seed/data/PROVENANCE.json`.

## Dependency Licenses

Third-party package dependencies retain their own licenses. Run
`bun run audit:licenses` after `bun install` to audit the production dependency
closure for copyleft licenses. Full installed-tree review is available with
`bun run audit:licenses -- --all`. The current audit snapshot is documented in
`docs/dependency-license-audit.md`.

## Trademarks

Dungeons & Dragons, D&D, and their respective logos are trademarks of Wizards of
the Coast LLC. Musi is independent and is not affiliated with, endorsed,
sponsored, or approved by Wizards of the Coast. References to fifth edition or
5E describe rules compatibility only and do not imply any association. The
CC-BY-4.0 license for SRD content does not grant trademark rights.

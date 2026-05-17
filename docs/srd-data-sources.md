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
- `docs/refs/5e-database/src/2024/` and `docs/refs/dndsrd5.2_markdown/src/` —
  optional local checkouts of the upstream sources below. Not committed; the
  seed scripts read from these paths only when an operator has cloned the
  upstream repos into `docs/refs/` for a reseed run.
- `packages/server/src/seed/` — canonical seed scripts and generated seed data
  checked into this repo.

## External Sources

- 5e-bits `5e-database`: structured JSON source used for many 2024 SRD tables.
- `springbov/dndsrd5.2_markdown`: markdown conversion useful when regenerating
  class, subclass, monster, magic-item, and glossary seed data.
- EN World editable SRD 5.2.1: human-readable fallback when the PDF is awkward.

Do not rely on this file for current upstream release numbers. If reseeding
from an external source, pin the exact upstream revision in the seed change or
PR description so future agents can reproduce it.

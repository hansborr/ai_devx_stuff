# drift:ai README new surfaces (shipped)

Landed 2026-05-31. Updated `scripts/drift-ai/README.md` so the tools-checkout
quick reference matches the current CLI help for the newer drift:ai surfaces.

## What changed

- Added `duplicate-types` and `duplicate-schemas` to the implemented-checks table,
  alongside the existing `duplicate-literals` and `duplicate-constants` rows.
- Added `drift:ai coldspots` to the subcommand table, including the current
  in-window-touched-file caveat for the `coldspot` lens.

## Notes

- No runtime behavior changed.
- The README already documented the numeric-literal default from the prior
  `duplicate-literals` noise fix, so no provisional numeric warning was needed.

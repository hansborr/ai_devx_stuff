# Drift:ai Coldspots In-window Contract

Completed drift-ai review task 26.

The coldspot lens still uses the existing windowed git-history evidence model.
It now discloses that contract explicitly instead of implying a complete current
source inventory scan:

- `ColdspotSection.candidateModel` is JSON-visible with candidate set
  `in-window-touched-files`.
- Text output renders the candidate model under the coldspot section heading.
- Empty reasons now distinguish "no in-window touched candidates" from
  "in-window candidates existed but none passed the age/revision/amplifier gate."
- `coldspots --help` clarifies that the command is whole-repo but the coldspot
  lens only considers files touched in the effective git window.

Deferred: true current files with no in-window commits should be introduced as a
separate zero-touch evidence section, not mixed into the existing coldspot rows.

Validation:

- `bun run test -- scripts/drift-ai/coldspots-coldspot.test.ts scripts/drift-ai/coldspots.test.ts`
- `bun run drift:ai coldspots --lens coldspot --window 180 --format text`
